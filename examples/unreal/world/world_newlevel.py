"""Create a new level with LevelEditorSubsystem.new_level and report what it is (Unreal 5.8, editor or commandlet Python).

  UnrealEditor.exe Project.uproject -nullrhi -ExecCmds="py <this file>" -unattended -nosplash -nosound -notraceserver
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound
  UnrealEditor-Cmd.exe Project.uproject -ExecutePythonScript=<this file> -unattended -nullrhi -nosplash -nosound
Environment: WORLD_NEW_MAP (object path to create), WORLD_PARTITIONED ("1" for a World Partition map, "0" for a plain one),
WORLD_ACTORS (number of cube actors to add and save, default 0), WORLD_TICK ("1" to wait for editor ticks and then quit, needed for
UnrealEditor.exe with -ExecCmds), WORLD_REPORT (JSON path). Run it twice with the same WORLD_NEW_MAP to see new_level refuse an existing path.

The report records the return value of new_level (or the exception text), the actor descriptors (a partitioned world has them; Python's World
class has no is_partitioned_world), and the classes of the actors the new map contains.
"""
import collections
import json
import os
import re
import traceback

import unreal

PATH = os.environ.get("WORLD_NEW_MAP", "/Game/Maps/NewWorld")
PARTITIONED = os.environ.get("WORLD_PARTITIONED", "1") == "1"
ACTORS = int(os.environ.get("WORLD_ACTORS", "0"))
TICK = os.environ.get("WORLD_TICK", "0") == "1"
REPORT = os.environ.get("WORLD_REPORT", "world-newlevel.json").replace("\\", "/")
EL = unreal.EditorLevelLibrary
WPL = unreal.WorldPartitionBlueprintLibrary
report = {"engine": unreal.SystemLibrary.get_engine_version(), "path": PATH, "requested_partitioned": PARTITIONED, "tick_mode": TICK}


def flush():
    os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=2, default=str)


def cls_name(desc):
    found = re.search(r"\.(\w+)'", str(desc.native_class))
    return found.group(1) if found else str(desc.native_class)


def describe():
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    report["world"] = str(world.get_path_name()) if world else None
    if not world:
        return
    report["world_partition_members"] = [m for m in dir(world) if "partition" in m.lower()]
    descs = list(WPL.get_actor_descs() or [])
    report["actor_descs"] = len(descs)
    by_class = collections.Counter(cls_name(d) for d in descs)
    report["descriptor_classes"] = dict(by_class)
    report["descriptors_spatially_loaded"] = sorted({cls_name(d) for d in descs if d.is_spatially_loaded})
    actors = EL.get_all_level_actors()
    report["level_actor_classes"] = dict(collections.Counter(a.get_class().get_name() for a in actors))
    report["landscape_count"] = len([a for a in actors if isinstance(a, unreal.LandscapeProxy)])
    settings = world.get_world_settings()
    report["world_settings_partition_members"] = [m for m in dir(settings) if "partition" in m.lower()] if settings else []


def build():
    levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    try:
        report["new_level_result"] = levels.new_level(PATH, PARTITIONED)
    except Exception as exc:
        report["new_level_result"] = "exception"
        report["new_level_error"] = str(exc)[:400]
    flush()
    describe()
    # Save only a map this script created under /Game, never an engine map that happens to be open.
    if ACTORS and report.get("new_level_result") is True and PATH.startswith("/Game/"):
        shape = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cube")
        for i in range(ACTORS):
            actor = EL.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(400 * i, 0, 100))
            actor.static_mesh_component.set_static_mesh(shape)
            actor.set_actor_label("TestCube%d" % i)
        report["actors_added"] = ACTORS
        report["saved"] = bool(levels.save_current_level())
        report["level_actor_classes_after"] = dict(collections.Counter(a.get_class().get_name() for a in EL.get_all_level_actors()))
        report["actor_descs_after"] = len(list(WPL.get_actor_descs() or []))
    flush()


def run():
    try:
        build()
    except Exception:
        report["error"] = traceback.format_exc()[-900:]
    flush()
    unreal.log("[world_newlevel] wrote " + REPORT)


if TICK:
    state = {"t": 0.0, "done": False}

    def tick(dt):
        if state["done"]:
            return
        state["t"] += dt
        if state["t"] < 3.0:
            return
        state["done"] = True
        run()
        unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")

    unreal.register_slate_post_tick_callback(tick)
else:
    run()
