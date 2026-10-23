"""Read back, in a new process, what nts_author.py saved: the emitters, the edited stack input and the renderer material.

Run headless after nts_author.py (same project, same flags):
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: NTS_REPORT (JSON report path).
"""
import json
import os
import traceback

import unreal

TOOLSET = "NiagaraToolsets.NiagaraToolset_System"
report = {"engine": unreal.SystemLibrary.get_engine_version()}


def call(tool, args):
    result = unreal.ToolsetRegistry.execute_tool(TOOLSET, tool, json.dumps(args))
    error = str(result.get_editor_property("error"))
    return {"error": error, "value": json.loads(str(result.get_editor_property("value")))["returnValue"] if result.is_complete and not error else None}


try:
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    system = {"refPath": "/Game/FX/NS_Worked.NS_Worked"}
    summary = call("GetSystemSummary", {"system": system})
    report["emitters"] = [e["emitterName"] for e in summary["value"]["emitters"]]
    lifetime = call("GetStackInputData", {"stackInputRef": {"system": system, "emitterName": "Motes", "scriptName": "ParticleSpawnScript",
                                                          "moduleName": "InitializeParticle", "inputNameStack": ["Lifetime Min"]}})
    report["lifetime_min"] = lifetime["value"]["value"]["value"]
    renderer = call("GetRendererData", {"rendererRef": {"system": system, "emitterName": "Motes", "rendererIndex": 0}})
    values = json.loads(renderer["value"]["propertyValues"])
    report["material"] = values["Material"]
    report["sub_image_size"] = values["SubImageSize"]
except Exception:
    report["error"] = traceback.format_exc()[-900:]

path = os.environ.get("NTS_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "nts-readback.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[nts_readback] wrote " + path)
