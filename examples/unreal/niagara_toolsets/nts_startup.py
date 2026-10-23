"""Report that the Niagara toolset still registers and answers when a project's own init_unreal.py raised at start-up (Unreal 5.8).

nts_validate.mjs writes Content/Python/init_unreal.py into the throwaway project (it raises AttributeError after one log line), then runs
this script headless like the others:
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: NTS_REPORT (JSON report path). Needs the NS_Worked system that nts_author.py saved.
"""
import json
import os

import unreal

TOOLSET = "NiagaraToolsets.NiagaraToolset_System"
result = unreal.ToolsetRegistry.execute_tool(TOOLSET, "GetSystemSummary", json.dumps({"system": {"refPath": "/Game/FX/NS_Worked.NS_Worked"}}))
report = {"registered": unreal.ToolsetRegistry.is_toolset_registered(TOOLSET), "call_complete": result.is_complete,
          "call_error": str(result.get_editor_property("error")),
          "emitters": [e["emitterName"] for e in json.loads(str(result.get_editor_property("value")))["returnValue"]["emitters"]]}
path = os.environ.get("NTS_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "nts-startup.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as fh:
    json.dump(report, fh, indent=2)
unreal.log("[nts_startup] wrote " + path)
