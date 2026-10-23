"""Ask the Niagara toolsets for the stack issues of the systems nts_author.py saved, from an editor tick (Unreal 5.8, Experimental NiagaraToolsets).

GetStackIssues and GetSystemCompileState wait for a compile, so their results complete from the editor tick, not in a commandlet. Run
the editor headless after nts_author.py (same project); the callback writes the report and quits the editor:
  UnrealEditor.exe Project.uproject -ExecCmds="py <absolute path to this file>" -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: NTS_REPORT (JSON report path).

NS_Broken holds a ribbon renderer whose material has no ribbon usage flag; NS_Linked holds one whose material has it. The report keeps
each tool's raw value so the checks can look for the renderer's material-usage warning ("do not have the correct usage flags set").
"""
import json
import os
import traceback

import unreal

TOOLSET = "NiagaraToolsets.NiagaraToolset_System"
SYSTEMS = ("NS_Linked", "NS_Broken")
TOOLS = ("GetStackIssues", "GetSystemCompileState")
LIMIT_SECONDS = 120.0
state = {"t": 0.0, "asked": False, "done": False, "pending": {}}
report = {"engine": unreal.SystemLibrary.get_engine_version(), "results": {}}


def finish():
    state["done"] = True
    path = os.environ.get("NTS_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "nts-issues.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(report, fh, indent=2, default=str)
    unreal.log("[nts_issues] wrote " + path)
    unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")


def tick(dt):
    if state["done"]:
        return
    state["t"] += dt
    try:
        if not state["asked"] and state["t"] > 2.0:
            state["asked"] = True
            unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
            for name in SYSTEMS:
                system = {"refPath": f"/Game/FX/{name}.{name}"}
                for tool in TOOLS:
                    state["pending"][(name, tool)] = unreal.ToolsetRegistry.execute_tool(TOOLSET, tool, json.dumps({"system": system}))
        for (name, tool), result in list(state["pending"].items()):
            if result.is_complete:
                error = str(result.get_editor_property("error"))
                value = str(result.get_editor_property("value"))
                report["results"].setdefault(name, {})[tool] = {"error": error, "value": json.loads(value)["returnValue"] if value and not error else None}
                del state["pending"][(name, tool)]
        if state["asked"] and not state["pending"]:
            finish()
        elif state["t"] > LIMIT_SECONDS:
            report["timeout"] = [list(k) for k in state["pending"]]
            finish()
    except Exception:
        report["error"] = traceback.format_exc()[-900:]
        finish()


unreal.register_slate_post_tick_callback(tick)
unreal.log("[nts_issues] tick callback registered")
