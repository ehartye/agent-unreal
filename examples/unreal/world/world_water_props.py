"""Read the Water Zone Local Tessellation setting and each water body's spatial-loading default (Unreal 5.8, editor Python).

  UnrealEditor.exe Project.uproject -nullrhi -ExecCmds="py <this file>" -unattended -nosplash -nosound -notraceserver
Environment: WORLD_NEW_MAP (map to create, default /Game/Maps/WaterProps), WORLD_REPORT (JSON path).

It creates a blank partitioned map with LevelEditorSubsystem.new_level, spawns a Water Zone and one Ocean, Lake and River, and reads
is_spatially_loaded on each. On the zone it reads enable_local_only_tessellation and local_tessellation_extent, sets the first to True,
reads both back, saves the map, reopens it and reads them again. The place for the Water edits is the editor, not the commandlet
(see world_place_commandlet.py).
"""
import json
import os
import traceback

import unreal

PATH = os.environ.get("WORLD_NEW_MAP", "/Game/Maps/WaterProps")
REPORT = os.environ.get("WORLD_REPORT", "world-water-props.json").replace("\\", "/")
EL = unreal.EditorLevelLibrary
report = {"engine": unreal.SystemLibrary.get_engine_version(), "path": PATH}


def flush():
    os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=2, default=str)


def prop(actor, name):
    try:
        return str(actor.get_editor_property(name))
    except Exception as exc:
        return "unreadable: " + str(exc)[:100]


def zone_state(zone):
    extent = zone.get_editor_property("local_tessellation_extent")
    return {"enable_local_only_tessellation": prop(zone, "enable_local_only_tessellation"),
            "local_tessellation_extent": [extent.x, extent.y, extent.z]}


def run():
    report["new_level"] = bool(unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).new_level(PATH, True))
    zone = EL.spawn_actor_from_class(unreal.WaterZone, unreal.Vector(0, 0, 0))
    bodies = {"ocean": unreal.WaterBodyOcean, "lake": unreal.WaterBodyLake, "river": unreal.WaterBodyRiver}
    report["is_spatially_loaded"] = {"zone": prop(zone, "is_spatially_loaded")}
    for key, cls in bodies.items():
        actor = EL.spawn_actor_from_class(cls, unreal.Vector(0, 0, 0))
        report["is_spatially_loaded"][key] = prop(actor, "is_spatially_loaded") if actor else "not spawned"
    report["zone_default"] = zone_state(zone)
    zone.set_editor_property("enable_local_only_tessellation", True)
    report["zone_after_set"] = zone_state(zone)
    report["saved"] = bool(unreal.EditorLoadingAndSavingUtils.save_map(EL.get_editor_world(), PATH))
    unreal.EditorLoadingAndSavingUtils.load_map(PATH)
    reopened = [a for a in EL.get_all_level_actors() if isinstance(a, unreal.WaterZone)]
    report["zone_after_reopen"] = zone_state(reopened[0]) if reopened else "no zone"


state = {"t": 0.0, "done": False}


def tick(dt):
    if state["done"]:
        return
    state["t"] += dt
    if state["t"] < 3.0:
        return
    state["done"] = True
    try:
        run()
    except Exception:
        report["error"] = traceback.format_exc()[-900:]
    flush()
    unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")


unreal.register_slate_post_tick_callback(tick)
