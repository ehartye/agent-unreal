"""Probe, run half: play a probe level offscreen, count particles with a simulation cache, read attributes, take screenshots, then quit.
Run on 2026-10-26 and after by the emit, frame and wire groups.

  UnrealEditor.exe Project.uproject <map from the manifest> -RenderOffScreen -ExecCmds="py <abs path to this file>"
      -abslog=<log> -notraceserver -nosplash -unattended -nosound        (in Git Bash set MSYS_NO_PATHCONV=1)
Do not use -ExecutePythonScript: that mode exits when the script ends. nts_probe.mjs starts it and passes the environment.
Environment: NTS_PROBE_DIR (unused here), NTS_MANIFEST (JSON written by a build script), NTS_REPORT (JSON report), NTS_SIM_PREFIX
(screenshot name prefix, default nts).

The manifest (written by nts_probe_*_build.py; the shape is this file's own contract):
  {"map": ..., "settle_seconds": 8, "systems": [{"id", "asset"}],
   "samples": [{"id", "actor": "Fx_<id>", "camera": "Cam_<id>", "metric_emitter": "Probe" or null,
                "sequence": [{"name", "frames": 40, "step_seconds": 0.016667, "attributes": ["SubImageIndex"],
                              "set": [{"type": "float", "name": "User.X", "value": 1.0}, {"type": "static_mesh", "name": "User.Mesh", "asset": "/Game/..."}],
                              "override_mesh": {"name": "User.Mesh", "asset": "/Game/..."},
                              "hidden": false, "shot": "<name>", "live_seconds": 1.2}]}]}
Each step: apply `set`, restart the system, capture `frames` simulation-cache frames and record the particle count per emitter after
every frame and the attributes of the last frame; then, when `shot` is set, show or hide the actor, restart it, wait `live_seconds`
and take a screenshot named <prefix>_<shot>.png (Saved/Screenshots/WindowsEditor). The compile state and stack issues of each system in
`systems` are asked from the editor tick before Play-In-Editor starts. A capture of a system that already completed is refused
(NiagaraSimCache.cpp WriteFrame, "System already completed its simulation"): the call returns None, and the step records `captured`
false and `refused_frames`, the number of frames refused.

Engine calls, all already used by niagara_verify.py or stylized_render.py (5.8.2 runs): NiagaraSimCacheFunctionLibrary.create_niagara_sim_cache /
capture_niagara_sim_cache_immediate, NiagaraSimCache.get_emitter_names / get_num_frames / read_position_attribute / read_float_attribute,
NiagaraComponent.reset_system / activate / set_variable_bool, AutomationLibrary.take_high_res_screenshot, GameplayStatics,
PlayerController.set_view_target_with_blend, LevelEditorSubsystem.editor_request_begin_play. New here, checked against the install:
NiagaraComponent.set_variable_float / set_variable_int (NiagaraComponent.h SetVariableFloat / SetVariableInt, FName + value) and
NiagaraFunctionLibrary.override_system_user_variable_static_mesh (NiagaraFunctionLibrary.h OverrideSystemUserVariableStaticMesh,
component + FString name + StaticMesh).
"""
import json
import os
import traceback

import unreal

TOOLSET = "NiagaraToolsets.NiagaraToolset_System"
WIDTH, HEIGHT = 1280, 720
manifest = json.load(open(os.environ["NTS_MANIFEST"]))
prefix = os.environ.get("NTS_SIM_PREFIX", "nts")
state = {"t": 0.0, "pie": False, "pie_t": 0.0, "done": False, "busy": False, "asked": False, "setup": False, "task": None, "wait": 0.0, "pending": {}}
report = {"probe": "sim", "samples": {}, "compile": {}, "issues": {}, "shots": [], "events": []}


def report_path():
    return os.environ.get("NTS_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "nts-probe-sim.json")


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


def request_diagnostics():
    registry = getattr(unreal, "ToolsetRegistry", None)
    if registry is None or not registry.is_toolset_registered(TOOLSET):
        report["compile"] = report["issues"] = "NiagaraToolsets not enabled"
        return
    for entry in manifest.get("systems", []):
        name = entry["asset"].rsplit("/", 1)[-1]
        args = json.dumps({"system": {"refPath": "%s.%s" % (entry["asset"], name)}})
        for tool, bucket in (("GetSystemCompileState", "compile"), ("GetStackIssues", "issues")):
            state["pending"][(entry["id"], bucket)] = registry.execute_tool(TOOLSET, tool, args)


def poll_diagnostics():
    for (sid, bucket), result in list(state["pending"].items()):
        if result.is_complete:
            text = str(result.get_editor_property("value"))
            error = str(result.get_editor_property("error"))
            report[bucket][sid] = {"error": error, "value": json.loads(text).get("returnValue") if text and not error else None}
            del state["pending"][(sid, bucket)]


def apply_sets(comp, step):
    for item in step.get("set", []):
        name = unreal.Name(item["name"])
        if item["type"] == "float":
            comp.set_variable_float(name, float(item["value"]))      # source: NiagaraComponent.h SetVariableFloat(FName, float)
        elif item["type"] == "int":
            comp.set_variable_int(name, int(item["value"]))          # source: NiagaraComponent.h SetVariableInt(FName, int32)
        elif item["type"] == "bool":
            comp.set_variable_bool(name, bool(item["value"]))        # as showcase_run.py
        elif item["type"] == "static_mesh":
            comp.set_variable_static_mesh(name, unreal.EditorAssetLibrary.load_asset(item["asset"]))   # source: NiagaraComponent.h SetVariableStaticMesh(FName, UStaticMesh*)
        else:
            raise RuntimeError("unknown variable type " + str(item["type"]))
    override = step.get("override_mesh")
    if override:
        mesh = unreal.EditorAssetLibrary.load_asset(override["asset"])
        # source: NiagaraFunctionLibrary.h OverrideSystemUserVariableStaticMesh(UNiagaraComponent*, const FString& OverrideName, UStaticMesh*)
        unreal.NiagaraFunctionLibrary.override_system_user_variable_static_mesh(comp, override["name"], mesh)


def capture(world, comp, step, metric_emitter):
    lib = unreal.NiagaraSimCacheFunctionLibrary
    cache = lib.create_niagara_sim_cache(world)
    params = unreal.NiagaraSimCacheCreateParameters()
    seconds = float(step.get("step_seconds", 1.0 / 60.0))
    totals, per_frame, attributes, errors = [], [], {}, []
    got = None
    refused = 0
    for _ in range(int(step["frames"])):
        got = lib.capture_niagara_sim_cache_immediate(cache, params, comp, True, seconds)
        refused += got is None   # a system that completed refuses the capture (the log says "System already completed its simulation")
        counts = {}
        if got is not None:
            last = got.get_num_frames() - 1
            for emitter in [str(n) for n in got.get_emitter_names()]:
                try:
                    counts[emitter] = len(got.read_position_attribute("Position", emitter, last))
                except Exception as exc:
                    counts[emitter] = None
                    if len(errors) < 3:
                        errors.append("%s: %s" % (emitter, str(exc)[:120]))
        per_frame.append(counts)
        totals.append(sum(v for v in counts.values() if isinstance(v, int)))
    out = {"captured": got is not None, "valid": bool(got.is_cache_valid()) if got is not None else False,
           "num_frames": got.get_num_frames() if got is not None else 0, "emitters": sorted(per_frame[-1].keys()) if per_frame else [],
           "totals": totals, "refused_frames": refused, "max_total": max(totals) if totals else 0, "read_errors": errors}
    out["last"] = {k: v for k, v in (per_frame[-1] if per_frame else {}).items()}
    out["max_by_emitter"] = {}
    for counts in per_frame:
        for k, v in counts.items():
            if isinstance(v, int):
                out["max_by_emitter"][k] = max(out["max_by_emitter"].get(k, 0), v)
    metric = metric_emitter if metric_emitter in out["max_by_emitter"] else None
    out["metric_emitter"] = metric
    out["metric_max"] = out["max_by_emitter"].get(metric, 0) if metric else out["max_total"]
    if got is not None:
        last = got.get_num_frames() - 1
        for attr in step.get("attributes", []):
            for emitter in out["emitters"]:
                try:
                    values = [float(v) for v in got.read_float_attribute(attr, emitter, last)]
                    attributes.setdefault(emitter, {})[attr] = values[:8]
                except Exception as exc:
                    attributes.setdefault(emitter, {})[attr] = "error: " + str(exc)[:100]
    out["attributes"] = attributes
    return out


def run_samples():
    """A generator: each yield is a number of seconds to wait before the next piece of work."""
    for sample in manifest["samples"]:
        record = report["samples"].setdefault(sample["id"], {"steps": {}})
        for step in sample["sequence"]:
            out = record["steps"].setdefault(step["name"], {})
            try:
                world = game_world()
                actor = by_label(world, unreal.NiagaraActor, sample["actor"])
                comp = actor.get_editor_property("niagara_component")
                asset = comp.get_asset()
                out["asset"] = asset.get_name() if asset else None
                actor.set_actor_hidden_in_game(False)
                comp.reset_system()
                apply_sets(comp, step)   # after the restart, so a restart cannot put a default back
                if step.get("frames"):
                    out.update(capture(world, comp, step, sample.get("metric_emitter")))
                if step.get("shot"):
                    if sample.get("camera"):
                        controller = unreal.GameplayStatics.get_player_controller(world, 0)
                        controller.set_view_target_with_blend(by_label(world, unreal.CameraActor, sample["camera"]), 0.0)
                    actor.set_actor_hidden_in_game(bool(step.get("hidden")))
                    comp.reset_system()
                    apply_sets(comp, step)
                    yield float(step.get("live_seconds", 1.2))
                    name = "%s_%s" % (prefix, step["shot"])
                    out["shot"] = name + ".png"
                    # take_high_res_screenshot can run the Slate tick again from inside the call, so record the shot first (as stylized_render.py)
                    report["shots"].append({"sample": sample["id"], "step": step["name"], "name": name + ".png", "hidden": bool(step.get("hidden"))})
                    unreal.AutomationLibrary.take_high_res_screenshot(WIDTH, HEIGHT, name + ".png")
                    yield 1.8
            except Exception:
                out["error"] = traceback.format_exc()[-600:]
            yield 0.0


def finish():
    state["done"] = True
    report["engine"] = unreal.SystemLibrary.get_engine_version()
    os.makedirs(os.path.dirname(report_path()), exist_ok=True)
    with open(report_path(), "w") as fh:
        json.dump(report, fh, indent=2, default=str)
    unreal.log("[nts_probe_sim] wrote " + report_path())
    unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")


def step_tick(dt):
    state["t"] += dt
    if state["pending"]:
        poll_diagnostics()
    if not state["pie"]:
        if state["t"] > 1.0 and not state["asked"]:
            state["asked"] = True
            request_diagnostics()
        if state["t"] > 5.0 and not state["pending"]:
            unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_begin_play()
            state["pie"], state["pie_t"] = True, state["t"]
        elif state["t"] > 125.0:
            report["diagnostics_timeout"] = [list(k) for k in state["pending"]]
            state["pending"].clear()
        return
    rel = state["t"] - state["pie_t"]
    world = game_world()
    if world is None:
        if rel > 120.0:
            report["events"].append("no game world after 120 s")
            finish()
        return
    if rel > 2.0 and not state["setup"]:
        state["setup"] = True
        for pawn in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.DefaultPawn):
            pawn.set_actor_hidden_in_game(True)
        for cmd in ("r.AntiAliasingMethod 0", "r.ScreenPercentage 100", "r.MotionBlurQuality 0"):   # as stylized_render.py
            unreal.SystemLibrary.execute_console_command(world, cmd)
    if rel < float(manifest.get("settle_seconds", 8)):
        return
    if state["task"] is None:
        state["task"] = run_samples()
    if state["wait"] > 0:
        state["wait"] -= dt
        return
    try:
        state["wait"] = next(state["task"])
    except StopIteration:
        finish()


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
unreal.log("[nts_probe_sim] tick callback registered")
