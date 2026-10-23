"""Check that the World Partition console commands exist in the editor (Unreal 5.8, editor Python).

  UnrealEditor.exe Project.uproject -nullrhi -ExecCmds="py <this file>" -unattended -nosplash -nosound -notraceserver
Environment: WORLD_MAP (a partitioned map, default /Game/Maps/WorldLarge), WORLD_REPORT (JSON path).

Python reads console variables, not console commands. So the script asks the console for the registered commands: DumpConsoleCommands with
the wp.Runtime. prefix prints one line per command between marker lines in the log, and world_validate.mjs reads that listing. A console
variable is read from Python; a name that is not registered logs "Failed to find console variable" and reads 0. The script also runs each
command once; the console echoes a line starting "Cmd:" only for a name it does not know.
"""
import json
import os
import traceback

import unreal

MAP = os.environ.get("WORLD_MAP", "/Game/Maps/WorldLarge")
REPORT = os.environ.get("WORLD_REPORT", "world-console.json").replace("\\", "/")
# Names as Epic's World Partition page prints them, then the names the engine registers where they differ, then one name that exists nowhere.
COMMANDS = [
    "wp.Runtime.ToggleDrawRuntimeHash2D",
    "wp.Runtime.ToggleDrawRuntimeHash3D",
    "wp.Runtime.OverrideRuntimeSpatialHashLoadingRange -grid=0 -range=12800",
    "wp.Runtime.HLOD 1",
    "wp.Runtime.MaxLoadingLevelStreamingCells 4",
    "wp.Runtime.MaxLoadingStreamingCells 4",
    "wp.Runtime.NoSuchCommandForTheCheck",
]
CVARS = ["wp.Runtime.MaxLoadingStreamingCells", "wp.Runtime.MaxLoadingLevelStreamingCells"]
report = {"engine": unreal.SystemLibrary.get_engine_version(), "map": MAP, "commands": COMMANDS, "cvars": {}}


def flush():
    os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=2, default=str)


def run():
    unreal.EditorLoadingAndSavingUtils.load_map(MAP)
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    for name in CVARS:
        try:
            report["cvars"][name] = unreal.SystemLibrary.get_console_variable_int_value(name)
        except Exception as exc:
            report["cvars"][name] = "error: " + str(exc)[:80]
    for command in COMMANDS:
        unreal.log("[world_console] BEGIN " + command)
        unreal.SystemLibrary.execute_console_command(world, command)
        unreal.log("[world_console] END " + command)
    unreal.log("[world_console] BEGIN DumpConsoleCommands")
    unreal.SystemLibrary.execute_console_command(world, "DumpConsoleCommands wp.Runtime.")
    unreal.log("[world_console] END DumpConsoleCommands")


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
