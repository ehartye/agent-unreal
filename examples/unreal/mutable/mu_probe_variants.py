"""Mutable probe, variants half (question 3): an Instance of the saved object set to each option in turn, a frame of each, in a Play-In-Editor viewport.
Prepared 2026-10-29, updated 2026-10-30 (waits for each Instance update to report back).

  UnrealEditor.exe Project.uproject -RenderOffScreen -ExecCmds="py <abs path to this file>" -abslog=<log> -notraceserver -nosplash -unattended -nosound
Environment: MU_PROBE_DIR, MU_REPORT, MU_CO, MU_COMPILE_TIMEOUT_S, MU_COMPILE_MODE, MU_PREFIX (screenshot name prefix, default mu).

The editor viewport draws nothing offscreen, so the level is built in the editor (a Customizable Skeletal Mesh actor, a camera, a light, a fixed-exposure
post process volume), saved, and played; the Instance is attached and updated in the play world and each frame is taken with
AutomationLibrary.take_high_res_screenshot (Saved/Screenshots/WindowsEditor/<prefix>_<variant>.png), as the Niagara probes do.
Steps written: object, level, actor, control (a frame of a plain imported skeletal mesh), then one `variant` step per variant (the default Instance first, with option null, then one per option of the
first parameter that has two or more).
If the loaded object is not compiled the script compiles it first, under the same wall-clock limit as the build half.
"""
import os
import sys
import traceback

import unreal

sys.path.insert(0, os.environ["MU_PROBE_DIR"])
import mu_probe_common as c  # noqa: E402

PREFIX = os.environ.get("MU_PREFIX", "mu")
MESH_WAIT_S = float(os.environ.get("MU_MESH_WAIT_S", "90"))      # how long one Instance update may take before its frame is taken anyway
MAP = "/Game/Maps/MuVariants"
WIDTH, HEIGHT = 1280, 720
probe = c.Probe("variants")
ctx = {"co": None, "inst": None, "param": None, "pie": False, "pie_wait": 0.0}


def game_world():
    try:
        w = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_game_world()
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


def build_level():
    unreal.EditorAssetLibrary.make_directory("/Game/Maps")
    unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.CustomizableSkeletalMeshActor, unreal.Vector(0, 0, 0))
    actor.set_actor_label("Mu_Actor")
    # control: a plain imported skeletal mesh at the same place, so a black frame can be told from a capture that sees nothing
    control = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.SkeletalMeshActor, unreal.Vector(0, 0, 0))
    control.set_actor_label("Mu_Control")
    mesh = c.eal.load_asset("/Game/Mu/Parts/person_body/person_body")
    comp = control.get_editor_property("skeletal_mesh_component")
    try:
        comp.set_skeletal_mesh_asset(mesh)
    except Exception:
        comp.set_editor_property("skeletal_mesh_asset", mesh)
    eye = unreal.Vector(-320, 0, 120)
    camera = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.CameraActor, eye)
    camera.set_actor_label("Mu_Cam")
    camera.set_actor_rotation(unreal.MathLibrary.find_look_at_rotation(eye, unreal.Vector(0, 0, 100)), False)
    light = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(-2000, 0, 800), unreal.Rotator(0, -35, 25))
    light.set_actor_label("Sun")
    light.get_component_by_class(unreal.DirectionalLightComponent).set_mobility(unreal.ComponentMobility.MOVABLE)
    volume = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.PostProcessVolume, unreal.Vector(0, 0, 0))
    volume.set_actor_label("FixedLook")
    volume.set_editor_property("unbound", True)
    settings = volume.get_editor_property("settings")
    for key, value in (("auto_exposure_min_brightness", 1.0), ("auto_exposure_max_brightness", 1.0), ("bloom_intensity", 0.0), ("motion_blur_amount", 0.0)):
        settings.set_editor_property("override_" + key, True)
        settings.set_editor_property(key, value)
    volume.set_editor_property("settings", settings)
    return {"saved": bool(unreal.EditorLoadingAndSavingUtils.save_map(unreal.EditorLevelLibrary.get_editor_world(), MAP))}


def load_object():
    co = c.eal.load_asset(c.CO_PATH)
    ctx["co"] = co
    if co is None:
        return {"instance_created": False, "error": "could not load " + c.CO_PATH}
    out = {"loaded": True, "is_compiled": bool(co.is_compiled())}
    bridge = getattr(unreal, "MutableBridgeLibrary", None)
    if bridge is not None:
        out["graph_nodes_on_load"] = len(list(bridge.get_graph_nodes(co)))      # the saved graph reloaded from disk
        out["graph_links_on_load"] = len(list(bridge.get_graph_links(co)))
    out.update({k: v for k, v in c.read_back(co).items() if k != "is_compiled"})
    out["instance_created"] = False
    return out


def first_swap_parameter(parameters):
    return next((p for p in parameters if len(p["options"]) >= 2), None)


def show(label, option):
    """Generator: set (when option is not None) and update the Instance, wait for the update to report back (or for the wait limit), return the variant
    fields. The update is asynchronous; its callback is bound when the dynamic delegate type is reachable from Python, else the wait is a fixed one."""
    inst, param = ctx["inst"], ctx["param"]
    out = {"option": option, "parameter": param["name"] if param else None, "shot": None}
    state = {"done": False}
    try:
        if option is not None:
            setter = getattr(inst, "set_enum_parameter_selected_option", None) or inst.set_int_parameter_selected_option
            getter = getattr(inst, "get_enum_parameter_selected_option", None) or inst.get_int_parameter_selected_option
            setter(param["name"], option)
            out["selected_after"] = str(getter(param["name"]))
        callback = None
        try:
            callback = unreal.InstanceUpdateDelegate()
            callback.bind_callable(lambda *_: state.__setitem__("done", True))
        except Exception:
            callback = None
        out["used_callback"] = callback is not None
        if callback is not None:
            inst.update_skeletal_mesh_async_result(callback, True, True)
        else:
            inst.update_skeletal_mesh_async(True, True)
    except Exception:
        out["error"] = traceback.format_exc()[-500:]
        return out
    waited = 0.0
    while waited < MESH_WAIT_S and not (state["done"] if out["used_callback"] else waited >= 10.0):
        waited += 0.5
        yield 0.5
    out["update_wait_s"] = waited
    out["update_reported"] = state["done"]
    return out


def task():
    probe.guarded("object", load_object)
    yield 1.0
    co = ctx["co"]
    if co is None:
        return
    if not co.is_compiled():
        record = {}
        try:
            yield from c.run_compile(co, record)
        except Exception:
            record["error"] = traceback.format_exc()[-600:]
        probe.step("recompile", **record)
    objstep = [s for s in probe.report["steps"] if s["step"] == "object"][0]
    objstep.update({k: v for k, v in c.read_back(co).items() if k != "parameters"}, parameters=c.read_parameters(co))
    ctx["inst"] = co.create_instance()
    objstep["instance_created"] = ctx["inst"] is not None
    ctx["param"] = first_swap_parameter(objstep["parameters"])
    probe.guarded("level", build_level)
    yield 1.0
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_begin_play()
    waited = 0.0
    while game_world() is None and waited < 120.0:
        waited += 0.5
        yield 0.5
    world = game_world()
    if world is None:
        probe.step("actor", found=False, error="no game world after 120 s")
        return
    yield 8.0
    for pawn in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.DefaultPawn):
        pawn.set_actor_hidden_in_game(True)
    for cmd in ("r.AntiAliasingMethod 0", "r.ScreenPercentage 100", "r.MotionBlurQuality 0"):
        unreal.SystemLibrary.execute_console_command(world, cmd)
    info = {"found": False, "component_found": False, "instance_set": False}
    try:
        actor = by_label(world, unreal.CustomizableSkeletalMeshActor, "Mu_Actor")
        info["found"] = True
        comp = actor.get_component_by_class(unreal.CustomizableSkeletalComponent)
        info["component_found"] = comp is not None
        if comp is not None and ctx["inst"] is not None:
            if co.get_component_count() > 0:
                comp.set_component_name(co.get_component_name(0))
            comp.set_customizable_object_instance(ctx["inst"])
            info["instance_set"] = True
        controller = unreal.GameplayStatics.get_player_controller(world, 0)
        controller.set_view_target_with_blend(by_label(world, unreal.CameraActor, "Mu_Cam"), 0.0)
    except Exception:
        info["error"] = traceback.format_exc()[-500:]
    probe.step("actor", **info)
    control = {"shot": None}
    try:
        yield 3.0
        name = "%s_control" % PREFIX
        control["shot"] = name + ".png"
        probe.step("control", **control)
        unreal.AutomationLibrary.take_high_res_screenshot(WIDTH, HEIGHT, name + ".png")
        yield 2.0
        by_label(world, unreal.SkeletalMeshActor, "Mu_Control").set_actor_hidden_in_game(True)
    except Exception:
        probe.step("control_error", error=traceback.format_exc()[-400:])
    # the default Instance first, then each option of the first parameter that has two or more
    variants = [("default", None)] + ([(o, o) for o in ctx["param"]["options"]] if ctx["param"] else [])
    for label, option in variants:
        out = yield from show(label, option)
        yield 4.0
        try:
            out["has_skeletal_mesh"] = bool(ctx["inst"].has_any_skeletal_mesh())
        except Exception:
            out["has_skeletal_mesh"] = None
        name = "%s_%s" % (PREFIX, label)
        out["shot"] = name + ".png"
        probe.step("variant", **out)     # recorded before the call: take_high_res_screenshot can run the Slate tick again from inside it
        unreal.AutomationLibrary.take_high_res_screenshot(WIDTH, HEIGHT, name + ".png")
        yield 2.0


c.drive(probe, task)
unreal.log("[mu_probe_variants] tick callback registered")
