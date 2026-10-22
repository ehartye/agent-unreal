"""Report the Substrate console variables of the project this editor opened (no rendering).

  UnrealEditor-Cmd.exe <abs-path>/Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Set STYLIZED_REPORT for the JSON report path. stylized_validate.mjs runs it on a project with no Config folder, to show what a bare
project gets without r.Substrate set in DefaultEngine.ini.
"""
import json
import os

import unreal

lib = unreal.SystemLibrary
report = {"engine": lib.get_engine_version(), "r.Substrate": lib.get_console_variable_int_value("r.Substrate"),
          "r.Substrate.ProjectGBufferFormat": lib.get_console_variable_int_value("r.Substrate.ProjectGBufferFormat")}
path = os.environ.get("STYLIZED_REPORT") or os.path.join(lib.get_project_directory(), "Saved", "stylized-cvar.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as fh:
    json.dump(report, fh, indent=2)
