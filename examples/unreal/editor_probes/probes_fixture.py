"""Build the small fixture that probes_validate.mjs reads back with the three editor probes (doc, system, asset).

Run headless (assets only, no rendering):
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
The project needs PythonScriptPlugin, EditorScriptingUtilities, Niagara and NiagaraToolsets. Environment: PROBES_FIXTURE_REPORT, the
absolute path of the JSON report (default: Saved/probes-fixture.json in the project).

What it makes under /Game/Probe (the same paths are listed in probes-validate-checks.mjs, and a node test keeps the two in step):
  SM_Cube         a copy of the engine cube, left as the engine has it
  SM_CubeNanite   a second copy with Nanite enabled, saved
  M_Probe         a material set to masked and two-sided, used with Niagara sprites, with a scalar parameter "Opacity"
  MI_Probe        an instance of M_Probe with Opacity 0.5
  NS_Probe        a Niagara system made with NiagaraSystemFactoryNew and the toolset: emitters "Dust" and "Motes" from two Epic template
                  emitters, Motes' InitializeParticle "Lifetime Min" written as 2.5, the sprite renderer of Motes pointed at M_Probe
The report lists each step with ok and, when it failed, the error, so a failed fixture is named in the validator's output.
"""
import json
import os
import traceback

import unreal

DIR = "/Game/Probe"
TOOLSET = "NiagaraToolsets.NiagaraToolset_System"
TEMPLATES = "/Niagara/DefaultAssets/Templates/Emitters/"
CUBE = "/Engine/BasicShapes/Cube"
LIFETIME_MIN = 2.5

report = {"engine": unreal.SystemLibrary.get_engine_version(), "steps": []}
eal = unreal.EditorAssetLibrary
mel = unreal.MaterialEditingLibrary


def step(name, ok, **detail):
    entry = {"step": name, "ok": bool(ok)}
    entry.update(detail)
    report["steps"].append(entry)
    return ok


def guarded(name, fn):
    """Run one step; a raised exception becomes a failed step and the next step still runs."""
    try:
        return fn()
    except Exception:
        step(name, False, error=traceback.format_exc()[-700:])
        return None


def ref(package_path):
    return {"refPath": package_path + "." + package_path.rsplit("/", 1)[-1]}


def call(tool, args):
    """Run one toolset tool; return the decoded returnValue and raise with the toolset's own message when it fails."""
    result = unreal.ToolsetRegistry.execute_tool(TOOLSET, tool, json.dumps(args))
    error = str(result.get_editor_property("error"))
    if error:
        raise RuntimeError("%s: %s" % (tool, error[:300]))
    if not result.is_complete:
        raise RuntimeError("%s: not complete" % tool)
    return json.loads(str(result.get_editor_property("value")))["returnValue"]


def copy_cube(name):
    target = "%s/%s" % (DIR, name)
    copy = eal.duplicate_asset("%s.%s" % (CUBE, CUBE.rsplit("/", 1)[-1]), target)
    return copy, target


def build_cubes():
    plain, target = copy_cube("SM_Cube")
    step("cube", bool(plain) and eal.save_asset(target), asset=target)
    nanite, target = copy_cube("SM_CubeNanite")
    route = None
    if nanite:
        try:
            settings = nanite.get_editor_property("nanite_settings")
            settings.set_editor_property("enabled", True)
            nanite.set_editor_property("nanite_settings", settings)
            route = "set_editor_property"
        except Exception:
            subsystem = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
            settings = subsystem.get_nanite_settings(nanite)
            settings.set_editor_property("enabled", True)
            subsystem.set_nanite_settings(nanite, settings, True)
            route = "StaticMeshEditorSubsystem"
    enabled = bool(nanite) and bool(nanite.get_editor_property("nanite_settings").get_editor_property("enabled"))
    step("cube_nanite", enabled and eal.save_asset(target), asset=target, route=route, enabled_before_save=enabled)


def build_material():
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    material = tools.create_asset("M_Probe", DIR, unreal.Material, unreal.MaterialFactoryNew())
    material.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
    material.set_editor_property("two_sided", True)
    material.set_editor_property("used_with_niagara_sprites", True)
    opacity = mel.create_material_expression(material, unreal.MaterialExpressionScalarParameter, -400, 0)
    opacity.set_editor_property("parameter_name", "Opacity")
    opacity.set_editor_property("default_value", 1.0)
    mel.connect_material_property(opacity, "", unreal.MaterialProperty.MP_OPACITY_MASK)
    errors = mel.recompile_material(material)
    step("material", eal.save_asset(DIR + "/M_Probe"), asset=DIR + "/M_Probe", recompile_result=str(errors))
    instance = tools.create_asset("MI_Probe", DIR, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    mel.set_material_instance_parent(instance, material)
    mel.set_material_instance_scalar_parameter_value(instance, "Opacity", 0.5)
    step("instance", eal.save_asset(DIR + "/MI_Probe"), asset=DIR + "/MI_Probe")


def build_system():
    if not unreal.ToolsetRegistry.is_toolset_registered(TOOLSET):
        raise RuntimeError("toolset not registered: enable the NiagaraToolsets plugin in the .uproject")
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    created = tools.create_asset("NS_Probe", DIR, unreal.NiagaraSystem, unreal.NiagaraSystemFactoryNew())
    system = ref(DIR + "/NS_Probe")
    step("system_create", bool(created), asset=DIR + "/NS_Probe")
    for name, template in (("Dust", "RecycleParticlesInView"), ("Motes", "HangingParticulates")):
        call("AddEmitter", {"system": system, "templateEmitter": ref(TEMPLATES + template), "emitterName": name})
    names = [e["emitterName"] for e in call("GetSystemSummary", {"system": system})["emitters"]]
    step("add_emitters", sorted(names) == ["Dust", "Motes"], emitters=names)

    life = {"system": system, "emitterName": "Motes", "scriptName": "ParticleSpawnScript", "moduleName": "InitializeParticle",
            "inputNameStack": ["Lifetime Min"]}
    data = call("GetStackInputData", {"stackInputRef": life})
    before = data["value"]["value"]
    data["value"]["value"] = LIFETIME_MIN
    call("SetStackInputData", {"stackInputRef": life, "inputData": data})
    after = call("GetStackInputData", {"stackInputRef": life})["value"]["value"]
    step("lifetime_min", after == LIFETIME_MIN, before=before, after=after)

    renderer = {"system": system, "emitterName": "Motes", "rendererIndex": 0}
    call("SetRendererData", {"renderer": renderer, "rendererData": {"propertyValues": json.dumps({"Material": ref(DIR + "/M_Probe")})}})
    material = json.loads(call("GetRendererData", {"rendererRef": renderer})["propertyValues"]).get("Material")
    step("renderer_material", "M_Probe" in json.dumps(material), material=material)
    step("system", eal.save_asset(DIR + "/NS_Probe"), asset=DIR + "/NS_Probe")


try:
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    eal.make_directory(DIR)
    guarded("cubes", build_cubes)
    guarded("material", build_material)
    guarded("system", build_system)
except Exception:
    report["error"] = traceback.format_exc()[-900:]

path = os.environ.get("PROBES_FIXTURE_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "probes-fixture.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w", encoding="utf-8") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[probes_fixture] wrote " + path)
