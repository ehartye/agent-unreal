"""Read back, in a new process, what nts_author.py saved: the emitters, the edited stack input, the renderer material and an input audit.

Run headless after nts_author.py (same project, same flags):
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: NTS_REPORT (JSON report path).

The audit is `audit_system`: it reads every module input of every emitter (GetEmitterInputValues) and returns the problems that
a write can leave behind without any error: a linked input that reads as an empty link (Module.None) and a particle lifetime
that reads zero or less. NS_Worked and NS_Linked must come back clean; this script logs an error for any problem there, so the
commandlet exits non-zero. NS_Broken holds one empty link and one zero lifetime on purpose and must report both.
"""
import json
import os
import traceback

import unreal

TOOLSET = "NiagaraToolsets.NiagaraToolset_System"
LINKED = "NiagaraExt_StackInputData_Linked"
LIFETIME_INPUTS = ("Lifetime", "Lifetime Min", "Lifetime Max")
report = {"engine": unreal.SystemLibrary.get_engine_version()}


def call(tool, args):
    result = unreal.ToolsetRegistry.execute_tool(TOOLSET, tool, json.dumps(args))
    error = str(result.get_editor_property("error"))
    return {"error": error, "value": json.loads(str(result.get_editor_property("value")))["returnValue"] if result.is_complete and not error else None}


def audit_system(system):
    """Problems in one saved system: [{emitter, module, input, problem}]. Hidden inputs read as Unsupported and are skipped."""
    problems = []
    summary = call("GetSystemSummary", {"system": system})
    for emitter in [e["emitterName"] for e in summary["value"]["emitters"]]:
        modules = call("GetEmitterInputValues", {"emitterRef": {"system": system, "emitterName": emitter}})
        if modules["error"]:
            problems.append({"emitter": emitter, "module": None, "input": None, "problem": "cannot read inputs: " + modules["error"]})
            continue
        for module in modules["value"]:
            for item in module["inputs"]:
                kind = item["value"]["struct"]["refPath"].rsplit(".", 1)[-1]
                where = {"emitter": emitter, "module": module["moduleName"], "input": item["name"]}
                if kind == LINKED:
                    name = (item["value"]["value"].get("linkedVariable") or {}).get("name", "")
                    if name in ("", "None") or name.endswith(".None"):
                        problems.append(dict(where, problem="empty link: " + (name or "no name")))
                elif kind == "NiagaraFloat" and module["moduleName"] == "InitializeParticle" and item["name"] in LIFETIME_INPUTS:
                    if item["value"]["value"]["value"] <= 0:
                        problems.append(dict(where, problem="lifetime reads %s" % item["value"]["value"]["value"]))
    return problems


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

    # the bound-input systems: values that were written as a whole persist, and the audit tells the clean system from the broken one
    linked = {"refPath": "/Game/FX/NS_Linked.NS_Linked"}
    life = call("GetStackInputData", {"stackInputRef": {"system": linked, "emitterName": "Orb", "scriptName": "ParticleSpawnScript", "moduleName": "InitializeParticle", "inputNameStack": ["Lifetime"]}})
    width = call("GetStackInputData", {"stackInputRef": {"system": linked, "emitterName": "Beam", "scriptName": "ParticleSpawnScript", "moduleName": "BeamWidth", "inputNameStack": ["Beam Width"]}})
    beam = json.loads(call("GetRendererData", {"rendererRef": {"system": linked, "emitterName": "Beam", "rendererIndex": 0}})["value"]["propertyValues"])
    orb_renderer = json.loads(call("GetRendererData", {"rendererRef": {"system": linked, "emitterName": "Orb", "rendererIndex": 0}})["value"]["propertyValues"])
    orb_data = json.loads(call("GetEmitterData", {"emitterRef": {"system": linked, "emitterName": "Orb"}})["value"]["propertyValues"])
    report["linked"] = {"lifetime": life["value"], "beam_width": width["value"], "beam_material": beam["Material"], "beam_sort": beam["SortOrderHint"],
                        "orb_sort": orb_renderer["SortOrderHint"], "orb_local_space": orb_data.get("bLocalSpace")}
    report["audit"] = {}
    for name in ("NS_Worked", "NS_Linked", "NS_Broken"):
        report["audit"][name] = audit_system({"refPath": f"/Game/FX/{name}.{name}"})
    for name in ("NS_Worked", "NS_Linked"):
        for problem in report["audit"][name]:
            unreal.log_error("[nts_readback] %s: %s" % (name, json.dumps(problem)))
except Exception:
    report["error"] = traceback.format_exc()[-900:]

path = os.environ.get("NTS_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "nts-readback.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[nts_readback] wrote " + path)
