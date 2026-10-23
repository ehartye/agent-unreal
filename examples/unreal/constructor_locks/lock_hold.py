"""Keep the editor open with the lock-test classes loaded, optionally spawn their actors, and wait for the runner (Unreal 5.8, editor).

  UnrealEditor.exe Project.uproject -nullrhi -ExecCmds="py <absolute-path-to-this-file>" -unattended -nosplash -nosound -notraceserver
Environment: LOCK_STAGE (loaded = only the classes are loaded; spawned = one actor of each class is spawned in the editor world;
played = those actors are in a running Play-In-Editor session; ended = the session has ended and garbage was collected),
LOCK_REPORT (JSON path), LOCK_READY and LOCK_DONE (marker files).
The script writes the report and the ready marker, then quits the editor when the runner has created the done marker (or after ten minutes).
The runner tries to delete the asset files between those two markers, so the editor must still be running then. It runs inside a Slate tick.
"""
import json
import os
import time

import unreal

STAGE = os.environ.get("LOCK_STAGE", "loaded")
REPORT = os.environ.get("LOCK_REPORT", "lock-hold.json").replace("\\", "/")
READY = os.environ.get("LOCK_READY", "lock-ready").replace("\\", "/")
DONE = os.environ.get("LOCK_DONE", "lock-done").replace("\\", "/")
ASSETS = [kind + "_" + key for key in ("Ctor", "Post", "Soft") for kind in ("M", "SM")]
CLASSES = ["LockCtorActor", "LockPostActor", "LockSoftActor"]
state = {"t": 0.0, "prepared": False, "start": time.time(), "phase": None}


def loaded(name):
    path = "/Game/Lock/%s.%s" % (name, name)
    try:
        return bool(unreal.EditorAssetLibrary.find_asset_data(path).is_asset_loaded())
    except Exception as exc:
        return "error: %s" % exc


def snapshot():
    return {name: loaded(name) for name in ASSETS}


def prepare():
    report = {"engine": unreal.SystemLibrary.get_engine_version(), "stage": STAGE,
              "classes_found": {name: hasattr(unreal, name) for name in CLASSES}, "loaded_at_start": snapshot()}
    if STAGE in ("spawned", "played", "ended"):
        world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
        report["world"] = world.get_path_name() if world else None
        actors = []
        for i, name in enumerate(CLASSES):
            actors.append(unreal.EditorLevelLibrary.spawn_actor_from_class(getattr(unreal, name), unreal.Vector(300.0 * i, 0.0, 0.0)))
        report["spawned"] = [a.get_class().get_name() if a else None for a in actors]
        report["meshes_set_in_editor_world"] = [(a.get_component_by_class(unreal.StaticMeshComponent).static_mesh is not None) if a else None for a in actors]
        report["loaded_after_spawn"] = snapshot()
    state["report"] = report
    if STAGE in ("played", "ended"):
        unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_begin_play()
        state["phase"] = "playing"
        state["phase_t"] = state["t"]
    else:
        finish()


def finish():
    report = state["report"]
    if STAGE != "played":   # no snapshot while the play session runs
        report["loaded_final"] = snapshot()
    os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=2, default=str)
    with open(READY, "w") as fh:
        fh.write("ready")
    state["phase"] = "waiting"
    unreal.log("[lock] stage %s ready" % STAGE)


def advance():
    """Play-In-Editor stages: wait for the session to run, then (stage ended) end it and collect garbage."""
    waited = state["t"] - state["phase_t"]
    if state["phase"] == "playing" and waited > 10.0:
        if STAGE == "played":
            finish()
        else:
            unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_end_play()
            state["phase"] = "ending"
            state["phase_t"] = state["t"]
    elif state["phase"] == "ending" and waited > 8.0:
        unreal.SystemLibrary.collect_garbage()
        finish()


def tick(dt):
    state["t"] += dt
    if not state["prepared"]:
        if state["t"] < 3.0:
            return
        state["prepared"] = True
        try:
            prepare()
        except Exception as exc:
            with open(REPORT, "w") as fh:
                json.dump({"stage": STAGE, "error": repr(exc)}, fh)
            with open(READY, "w") as fh:
                fh.write("error")
        return
    if state.get("phase") in ("playing", "ending"):
        advance()
        return
    if os.path.exists(DONE) or time.time() - state["start"] > 600:
        unreal.unregister_slate_post_tick_callback(handle)
        unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")


handle = unreal.register_slate_post_tick_callback(tick)
