"""Verify Niagara systems in a running Unreal 5.8 world through simulation caches, then quit.

  UnrealEditor.exe Project.uproject /Game/Maps/NiagaraProbe -RenderOffScreen -ExecCmds="py <absolute-path-to-this-file>"
      -log=niagara.log -notraceserver -nosplash -unattended
(in Git Bash set MSYS_NO_PATHCONV=1, or /Game/... is rewritten into a Windows path). Build the level first with
niagara_build.py. Set NIAGARA_PROBE_REPORT to the report path (default: Saved/niagara-verify.json in the project).

Play-In-Editor starts after the map loads. For each NiagaraActor the script reads the component, activates it if a one-shot
system already finished, advances the simulation for 20 frames with NiagaraSimCacheFunctionLibrary and records, per emitter,
how many particle positions the cache holds. That is a numeric check of "this effect spawned N particles" that needs no
screenshot. It does not judge appearance, timing against a budget, or GPU cost.

If the Experimental NiagaraToolsets plugin is enabled, the script also asks Epic's GetSystemCompileState tool for every system under
/Game/FX. That tool waits for a compile, so its result is incomplete when first returned in a commandlet; here the result is polled
from the editor tick until it completes and the status is recorded under "compile".

Observed on UE 5.8.2: a stateful template reports one cache emitter per authored emitter with particle positions; a
stateless (lightweight) template reports a single emitter named "None" with no positions, because stateless emitters keep
no per-particle simulation data to read. A one-shot burst is no longer active a few seconds after PIE starts; activate(True)
restarts it. The callback must keep the editor alive: do not use -ExecutePythonScript, which exits when the script ends.
"""
import json
import os
import traceback

import unreal

SETTLE_SECONDS = 8.0     # let shaders compile and the first frames render
SAMPLES = 2
SAMPLE_GAP = 3.0
state = {"t": 0.0, "pie": False, "done": False, "pending": {}}
report = {"samples": [], "compile": {}}
TOOLSET = "NiagaraToolsets.NiagaraToolset_System"


def report_path():
    return os.environ.get("NIAGARA_PROBE_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "niagara-verify.json")


def game_world():
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


def request_compile_states():
    """Start GetSystemCompileState for each system asset under /Game/FX when the toolset is registered."""
    registry = getattr(unreal, "ToolsetRegistry", None)
    if registry is None or not registry.is_toolset_registered(TOOLSET):
        report["compile"] = "NiagaraToolsets not enabled"
        return
    ar = unreal.AssetRegistryHelpers.get_asset_registry()
    for data in ar.get_assets_by_path("/Game/FX", recursive=True):
        name = str(data.get_editor_property("asset_name"))
        ref = {"refPath": f"/Game/FX/{name}.{name}"}
        state["pending"][name] = registry.execute_tool(TOOLSET, "GetSystemCompileState", json.dumps({"system": ref}))


def poll_compile_states():
    for name, result in list(state["pending"].items()):
        if result.is_complete:
            value = str(result.get_editor_property("value"))
            report["compile"][name] = json.loads(value).get("returnValue") if value else {"error": str(result.get_editor_property("error"))}
            del state["pending"][name]


def sample():
    world = game_world()
    out = {"world": str(world), "systems": {}}
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.NiagaraActor):
        comp = actor.get_editor_property("niagara_component")
        asset = comp.get_asset()
        info = {"asset": asset.get_name() if asset else None, "active_before": comp.is_active()}
        try:
            if not comp.is_active():
                comp.activate(True)
            cache = unreal.NiagaraSimCacheFunctionLibrary.create_niagara_sim_cache(world)
            params = unreal.NiagaraSimCacheCreateParameters()
            got = None
            for _ in range(20):
                got = unreal.NiagaraSimCacheFunctionLibrary.capture_niagara_sim_cache_immediate(cache, params, comp, True, 0.0166)
            info["captured"] = got is not None
            if got:
                info["valid"] = got.is_cache_valid()
                info["frames"] = got.get_num_frames()
                info["emitters"] = {}
                last = got.get_num_frames() - 1
                for name in [str(n) for n in got.get_emitter_names()]:
                    try:
                        info["emitters"][name] = len(got.read_position_attribute("Position", name, last))
                    except Exception as exc:
                        info["emitters"][name] = "error: " + str(exc)[:120]
        except Exception:
            info["error"] = traceback.format_exc()[-400:]
        out["systems"][actor.get_actor_label()] = info
    return out


def finish():
    state["done"] = True
    report["engine"] = unreal.SystemLibrary.get_engine_version()
    os.makedirs(os.path.dirname(report_path()), exist_ok=True)
    with open(report_path(), "w") as fh:
        json.dump(report, fh, indent=2, default=str)
    unreal.log("[niagara_verify] wrote " + report_path())
    unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")


def tick(dt):
    if state["done"]:
        return
    state["t"] += dt
    if state["pending"]:
        poll_compile_states()
    if not state["pie"]:
        if state["t"] > 1.0 and not state.get("asked"):
            state["asked"] = True
            request_compile_states()
        if state["t"] > 5.0:
            unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_begin_play()
            state["pie"], state["pie_t"] = True, state["t"]
        return
    rel = state["t"] - state["pie_t"]
    n = len(report["samples"])
    if n < SAMPLES and rel >= SETTLE_SECONDS + n * SAMPLE_GAP:
        try:
            report["samples"].append(dict(sample(), t=round(rel, 1)))
        except Exception:
            report["samples"].append({"error": traceback.format_exc()[-600:]})
    elif n >= SAMPLES and not state["pending"]:
        finish()
    elif n >= SAMPLES and rel > SETTLE_SECONDS + 60:
        report["compile_timeout"] = list(state["pending"])
        finish()


unreal.register_slate_post_tick_callback(tick)
unreal.log("[niagara_verify] tick callback registered")
