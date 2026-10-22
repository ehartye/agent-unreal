"""Play the stylized probe level offscreen, take one engine screenshot per look, sample the flipbook index, then quit.

  UnrealEditor.exe <abs-path>/Project.uproject /Game/Maps/StylizedProbe -RenderOffScreen -ExecCmds="py <abs-path-to-this-file>"
      -abslog=<log> -notraceserver -nosplash -unattended -nosound        (in Git Bash set MSYS_NO_PATHCONV=1)
Build the level first with stylized_build.py. Set STYLIZED_REPORT for the JSON report (default Saved/stylized-render.json). The
screenshots land in Saved/Screenshots/WindowsEditor/stylized_<shot>.png and are measured by stylized_validate.mjs.
Do not use -ExecutePythonScript: that mode exits when the script ends.

Shots, in order: lit Toon and plain meshes; the Toon sprite (masked, translucent); the stepped-ramp and smooth-ramp sprites;
eight shots of the age-driven flipbook at irregular intervals (the frame follows time); three flipbook systems fixed on frames 2, 9 and
13 (SubUV Direct Index); then frame 9 again with a bright backdrop and a strong sun, and with a dark backdrop and no sun. Before the
shots a simulation cache records the age-driven flipbook's sub-image index over 2 seconds. Nothing here measures cost.
"""
import json
import os
import traceback

import unreal

SETTLE_SECONDS = float(os.environ.get("STYLIZED_SETTLE", "30"))
SHOT_SETTLE = 1.2       # seconds after a camera or light change before the capture is requested
SHOT_WRITE = 1.8        # seconds after the capture is requested before the next change
TOOLSET = "NiagaraToolsets.NiagaraToolset_System"
WIDTH, HEIGHT = 1280, 720

state = {"t": 0.0, "pie": False, "pie_t": 0.0, "queue": None, "next": 0.0, "done": False, "pending": {}, "busy": False, "phase": "wait"}
report = {"shots": [], "compile": {}, "events": []}


def report_path():
    return os.environ.get("STYLIZED_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "stylized-render.json")


def game_world():
    try:
        w = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_game_world()
        if w:
            return w
    except Exception:
        pass
    for getter in ("get_game_world", "get_editor_world"):
        fn = getattr(unreal.EditorLevelLibrary, getter, None)
        if fn:
            try:
                w = fn()
                if w:
                    return w
            except Exception:
                pass
    return None


def by_label(world, cls, label):
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, cls):
        if actor.get_actor_label() == label:
            return actor
    raise RuntimeError("no actor labelled " + label)


def view(label):
    def go(world):
        controller = unreal.GameplayStatics.get_player_controller(world, 0)
        controller.set_view_target_with_blend(by_label(world, unreal.CameraActor, "Cam_" + label), 0.0)
    return go


def request_compile_states():
    registry = getattr(unreal, "ToolsetRegistry", None)
    if registry is None or not registry.is_toolset_registered(TOOLSET):
        report["compile"] = "NiagaraToolsets not enabled"
        return
    ar = unreal.AssetRegistryHelpers.get_asset_registry()
    for data in ar.get_assets_by_path("/Game/Stylized", recursive=True):
        name = str(data.get_editor_property("asset_name"))
        if name.startswith("NS_"):
            state["pending"][name] = registry.execute_tool(TOOLSET, "GetSystemCompileState", json.dumps({"system": {"refPath": f"/Game/Stylized/{name}.{name}"}}))


def poll_compile_states():
    for name, result in list(state["pending"].items()):
        if result.is_complete:
            value = str(result.get_editor_property("value"))
            report["compile"][name] = json.loads(value).get("returnValue") if value else {"error": str(result.get_editor_property("error"))}
            del state["pending"][name]


def drawn_component(world):
    return by_label(world, unreal.NiagaraActor, "Fx_drawn").get_editor_property("niagara_component")


def light_backdrop(world, shown):
    by_label(world, unreal.StaticMeshActor, "Backdrop_frame_9_light").set_actor_hidden_in_game(not shown)


def set_sun(world, intensity):
    sun = by_label(world, unreal.DirectionalLight, "Sun")
    sun.get_component_by_class(unreal.DirectionalLightComponent).set_editor_property("intensity", intensity)


FRAMES = [2, 9, 13]


def plan():
    """The ordered list of (shot name, setup function or None)."""
    steps = []
    for name in ("meshes", "toon_masked", "toon_translucent", "stepped", "smooth"):
        steps.append((name, view(name)))
    steps.append(("drawn_t0", view("drawn")))
    for i in range(1, 8):
        steps.append((f"drawn_t{i}", None))
    for frame in FRAMES:
        steps.append((f"frame_{frame}", lambda w, f=frame: (view(f"frame_{f}")(w), light_backdrop(w, False))))
    steps.append(("frame_9_bright", lambda w: (view("frame_9")(w), light_backdrop(w, True), set_sun(w, 10.0))))
    steps.append(("frame_9_dark", lambda w: (light_backdrop(w, False), set_sun(w, 0.0))))
    return steps


def sample_sub_image(world):
    """Record the sprite's SubImageIndex after each of 120 simulation steps of 1/60 s, with a Niagara simulation cache."""
    out = {"sub_image_index": []}
    comp = drawn_component(world)
    comp.reset_system()
    lib = unreal.NiagaraSimCacheFunctionLibrary
    cache = lib.create_niagara_sim_cache(world)
    params = unreal.NiagaraSimCacheCreateParameters()
    for _ in range(120):
        got = lib.capture_niagara_sim_cache_immediate(cache, params, comp, True, 1.0 / 60.0)
        values = []
        if got is not None:
            emitter = str(got.get_emitter_names()[0])
            try:
                values = [float(v) for v in got.read_float_attribute("SubImageIndex", emitter, got.get_num_frames() - 1)]
            except Exception as exc:
                out["read_error"] = str(exc)[:200]
        out["sub_image_index"].append(values[0] if values else None)
    return out


def finish():
    state["done"] = True
    report["engine"] = unreal.SystemLibrary.get_engine_version()
    os.makedirs(os.path.dirname(report_path()), exist_ok=True)
    with open(report_path(), "w") as fh:
        json.dump(report, fh, indent=2, default=str)
    unreal.log("[stylized_render] wrote " + report_path())
    unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")


def step_tick(dt):
    state["t"] += dt
    if state["pending"]:
        poll_compile_states()
    if not state["pie"]:
        if state["t"] > 1.0 and not state.get("asked"):
            state["asked"] = True
            request_compile_states()
        if state["t"] > 5.0 and not state["pending"]:
            unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_begin_play()
            state["pie"], state["pie_t"] = True, state["t"]
        return
    rel = state["t"] - state["pie_t"]
    world = game_world()
    if world is None:
        return
    if rel > 2.0 and not state.get("setup"):
        state["setup"] = True
        for pawn in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.DefaultPawn):
            pawn.set_actor_hidden_in_game(True)
        for cmd in ("r.AntiAliasingMethod 0", "r.ScreenPercentage 100", "r.MotionBlurQuality 0"):
            unreal.SystemLibrary.execute_console_command(world, cmd)
    if rel < SETTLE_SECONDS:
        return
    if state["queue"] is None:
        state["queue"] = plan()
        state["next"] = rel
        state["phase"] = "setup"
        report["flipbook_sample"] = sample_sub_image(world)
    if state["phase"] == "closing":
        if rel >= state["next"] and not state["pending"]:
            finish()
        elif rel >= state["next"] + 60:
            report["compile_timeout"] = list(state["pending"])
            finish()
        return
    if rel < state["next"]:
        return
    index = len(report["shots"])
    if index >= len(state["queue"]):
        state["phase"] = "closing"
        state["next"] = rel + 1.0
        return
    name, setup = state["queue"][index]
    if state["phase"] == "setup":
        if setup:
            setup(world)
        state["phase"] = "capture"
        state["next"] = rel + (SHOT_SETTLE if setup else 0.0)
        return
    if state["phase"] == "capture":
        # take_high_res_screenshot can run the Slate tick again from inside the call, so record the shot and advance first
        report["shots"].append({"name": name, "t": round(rel, 2)})
        state["phase"] = "setup"
        state["next"] = rel + (0.43 + 0.37 * (len(report["shots"]) % 3) if name.startswith("drawn_t") and name != "drawn_t7" else SHOT_WRITE)
        unreal.AutomationLibrary.take_high_res_screenshot(WIDTH, HEIGHT, f"stylized_{name}.png")


def tick(dt):
    if state["done"] or state["busy"]:
        return
    state["busy"] = True
    try:
        step_tick(dt)
    except Exception:
        report["events"].append(traceback.format_exc()[-700:])
        finish()
    finally:
        state["busy"] = False


unreal.register_slate_post_tick_callback(tick)
unreal.log("[stylized_render] tick callback registered")
