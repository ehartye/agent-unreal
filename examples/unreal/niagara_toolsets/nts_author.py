"""Author a Niagara system through Epic's Niagara toolsets and record every call shape (Unreal 5.8, Experimental NiagaraToolsets).

Run headless (assets only, no rendering):
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: NTS_REPORT (JSON report path). The project needs PythonScriptPlugin, EditorScriptingUtilities, Niagara and NiagaraToolsets.

The flow is the worked example in unreal-niagara-toolsets.md:
  1 create an empty system with NiagaraSystemFactoryNew
  2 AddEmitter from two Epic template emitters (asset refs are {"refPath": "/Package/Path.Name"})
  3 read a stack input (GetStackInputData), change its value, write it back (SetStackInputData), read it again
  4 set the sprite renderer's Material and SubImageSize with SetRendererData, whose propertyValues is a JSON string
  5 save, so nts_readback.py can read the values in a new process
"""
import json
import os
import traceback

import unreal

TOOLSET = "NiagaraToolsets.NiagaraToolset_System"
FX = "/Game/FX"
SYSTEM, MATERIAL = "NS_Worked", "M_Worked"
TEMPLATES = "/Niagara/DefaultAssets/Templates/Emitters/"

report = {"engine": unreal.SystemLibrary.get_engine_version(), "steps": []}


def ref(package_path):
    """Asset ref: {"refPath": "/Package/Path.Name"}."""
    return {"refPath": package_path + "." + package_path.rsplit("/", 1)[-1]}


def call(tool, args):
    """Run one tool; return {complete, error, value} where value is the decoded {"returnValue": ...} JSON."""
    result = unreal.ToolsetRegistry.execute_tool(TOOLSET, tool, json.dumps(args))
    error = str(result.get_editor_property("error"))
    value = None
    if result.is_complete and not error:
        value = json.loads(str(result.get_editor_property("value")))["returnValue"]
    return {"complete": result.is_complete, "error": error, "value": value}


def step(name, **fields):
    report["steps"].append(dict(step=name, **fields))


try:
    report["toolset_registered"] = unreal.ToolsetRegistry.is_toolset_registered(TOOLSET)
    report["agent_skill_class"] = hasattr(unreal, "AgentSkill")
    skills = json.loads(str(unreal.ToolsetRegistry.execute_tool("ToolsetRegistry.AgentSkillToolset", "ListSkills", "{}").get_editor_property("value")))["returnValue"]
    report["niagara_skills"] = sorted(k.rsplit(".", 1)[-1] for k in skills if "NiagaraToolsets" in k)
    report["system_tool_count"] = len(json.loads(unreal.ToolsetRegistry.get_toolset_json_schema(unreal.NiagaraToolset_System))["tools"])
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    unreal.EditorAssetLibrary.make_directory(FX)
    tools = unreal.AssetToolsHelpers.get_asset_tools()

    # 1 create: an empty system from the factory, and a material the sprite renderer can use
    system = tools.create_asset(SYSTEM, FX, unreal.NiagaraSystem, unreal.NiagaraSystemFactoryNew())
    material = tools.create_asset(MATERIAL, FX, unreal.Material, unreal.MaterialFactoryNew())
    material.set_editor_property("used_with_niagara_sprites", True)
    sys_ref = ref(f"{FX}/{SYSTEM}")
    summary = call("GetSystemSummary", {"system": sys_ref})
    step("create", system=bool(system), material=bool(material), emitters=[e["emitterName"] for e in summary["value"]["emitters"]])

    # 2 AddEmitter from template emitters
    added = {}
    for name, template in (("Dust", "RecycleParticlesInView"), ("Motes", "HangingParticulates")):
        out = call("AddEmitter", {"system": sys_ref, "templateEmitter": ref(TEMPLATES + template), "emitterName": name})
        added[name] = {"error": out["error"], "emitterName": (out["value"] or {}).get("emitterName"), "topology_keys": sorted((out["value"] or {}).keys())}
    summary = call("GetSystemSummary", {"system": sys_ref})
    step("add_emitters", added=added, emitters=[e["emitterName"] for e in summary["value"]["emitters"]],
         summary_emitter_keys=sorted(summary["value"]["emitters"][0].keys()))

    # 3 stack input: reference, read, modify, write, read again
    input_ref = {"system": sys_ref, "emitterName": "Motes", "scriptName": "ParticleSpawnScript", "moduleName": "InitializeParticle",
                 "inputNameStack": ["Lifetime Min"]}
    got = call("GetStackInputData", {"stackInputRef": input_ref})
    data = got["value"]
    before = data["value"]["value"]
    data["value"]["value"] = 2.5
    written = call("SetStackInputData", {"stackInputRef": input_ref, "inputData": data})
    again = call("GetStackInputData", {"stackInputRef": input_ref})
    other = lambda name: call("GetStackInputData", {"stackInputRef": dict(input_ref, inputNameStack=[name])})["value"]
    color, mode = other("Color"), other("Lifetime Mode")
    wrong = call("GetStackInputData", {"stackInputRef": dict(input_ref, inputNameStack=["No Such Input"])})
    step("stack_input", get_error=got["error"], struct=data["struct"], value_keys=sorted(data.keys()), before=before,
         set_error=written["error"], after=again["value"]["value"]["value"], unknown_input_error=wrong["error"][:300],
         unknown_input_complete=wrong["complete"], color_struct=color["struct"], color_value=color["value"],
         enum_struct=mode["struct"], enum_keys=sorted(mode["value"].keys()))

    # 4 renderer: propertyValues is a JSON string. An object in its place is accepted and changes nothing.
    renderer_ref = {"system": sys_ref, "emitterName": "Motes", "rendererIndex": 0}
    read = lambda: json.loads(call("GetRendererData", {"rendererRef": renderer_ref})["value"]["propertyValues"])
    default_material = read()["Material"]
    wanted = ref(f"{FX}/{MATERIAL}")
    as_object = call("SetRendererData", {"renderer": renderer_ref, "rendererData": {"propertyValues": {"Material": wanted}}})
    after_object = read()["Material"]
    as_string = call("SetRendererData", {"renderer": renderer_ref, "rendererData": {"propertyValues": json.dumps({"Material": wanted, "SubImageSize": {"x": 4, "y": 4}})}})
    after_string = read()
    step("renderer", default_material=default_material, object_error=as_object["error"], after_object=after_object,
         string_error=as_string["error"], after_string=after_string["Material"], sub_image_size=after_string["SubImageSize"],
         wanted=wanted, renderers=[r["rendererIndex"] for r in call("GetEmitterTopology", {"emitterRef": {"system": sys_ref, "emitterName": "Motes"}})["value"]["renderers"]])

    # 5 save
    step("save", system=unreal.EditorAssetLibrary.save_asset(f"{FX}/{SYSTEM}"), material=unreal.EditorAssetLibrary.save_asset(f"{FX}/{MATERIAL}"))
except Exception:
    report["error"] = traceback.format_exc()[-900:]

path = os.environ.get("NTS_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "nts-author.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[nts_author] wrote " + path)
