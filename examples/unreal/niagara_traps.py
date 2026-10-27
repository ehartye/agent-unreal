"""Check the Niagara API facts that skills/unreal-effects/references/unreal-niagara.md states, in a headless Unreal 5.8 commandlet.

  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Set NIAGARA_PROBE_REPORT for the JSON report (default: Saved/niagara-traps.json in the project). niagara_validate.mjs reads it.

What it records, each backing a sentence in the reference:
  - duplicate_asset on an engine template fails before the asset registry is scanned and succeeds after search_all_assets(True);
  - spawn_system_at_location returns None in the commandlet's blank map;
  - the Python surface: NiagaraComponent runtime setters and getters exist; NiagaraSystem has no authoring methods;
    UNiagaraExternalEditUtilities is absent while its NiagaraExt_* data structs are present; NiagaraPythonEmitter and
    NiagaraPythonModule offer no way to add emitters, renderers or modules;
  - what the stock-content reference says Python lacks without the toolsets: no Niagara editor library among the Niagara*Library classes,
    no NiagaraMeshRendererProperties class, and a NiagaraSystemFactoryNew whose emitter list (a C++ member, not a property) cannot be set.
It must run before anything else touches the asset registry in the same process, so it is its own commandlet run.
"""
import json
import os
import traceback

import unreal

TEMPLATE = "/Niagara/DefaultAssets/Templates/Systems/MinimalLightweight"
report = {"engine": unreal.SystemLibrary.get_engine_version()}


def report_path():
    return os.environ.get("NIAGARA_PROBE_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "niagara-traps.json")


def members(cls):
    base = set(dir(unreal.Object))
    return sorted(n for n in dir(cls) if not n.startswith("_") and n not in base)


try:
    source = f"{TEMPLATE}.{TEMPLATE.rsplit('/', 1)[-1]}"
    unreal.EditorAssetLibrary.make_directory("/Game/FX")
    report["duplicate_before_scan"] = bool(unreal.EditorAssetLibrary.duplicate_asset(source, "/Game/FX/NS_TrapBefore"))
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    report["duplicate_after_scan"] = bool(unreal.EditorAssetLibrary.duplicate_asset(source, "/Game/FX/NS_TrapAfter"))

    unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
    world = unreal.EditorLevelLibrary.get_editor_world()
    system = unreal.EditorAssetLibrary.load_asset("/Game/FX/NS_TrapAfter")
    spawned = unreal.NiagaraFunctionLibrary.spawn_system_at_location(world, system, unreal.Vector(0, 0, 100)) if system else "no system"
    report["spawn_in_commandlet_is_none"] = spawned is None

    comp = members(unreal.NiagaraComponent)
    report["component_api"] = {n: n in comp for n in (
        "set_variable_float", "set_variable_vec3", "set_variable_linear_color", "set_variable_static_mesh", "set_variable_texture",
        "set_variable_object", "get_variable_float", "get_variable_vec3")}
    report["library_mesh_override"] = "override_system_user_variable_static_mesh" in members(unreal.NiagaraFunctionLibrary)
    report["system_members"] = members(unreal.NiagaraSystem)
    report["external_edit_utilities_in_python"] = hasattr(unreal, "NiagaraExternalEditUtilities")
    report["ext_structs_in_python"] = hasattr(unreal, "NiagaraExt_SystemData") and hasattr(unreal, "NiagaraExt_EmitterData")
    report["python_emitter_members"] = members(unreal.NiagaraPythonEmitter)
    report["python_module_members"] = members(unreal.NiagaraPythonModule)
except Exception:
    report["error"] = traceback.format_exc()[-900:]

try:
    report["niagara_libraries"] = sorted(n for n in dir(unreal) if n.startswith("Niagara") and "Library" in n)
    report["niagara_editor_utilities_names"] = sorted(n for n in dir(unreal) if n.startswith("Niagara") and ("EditorLibrary" in n or "EditUtilities" in n or "EditorUtilities" in n))
    report["mesh_renderer_properties_in_python"] = hasattr(unreal, "NiagaraMeshRendererProperties")
    factory = unreal.NiagaraSystemFactoryNew()
    report["factory_emitters_attribute"] = hasattr(factory, "emitters_to_add_to_new_system")
    try:
        factory.set_editor_property("emitters_to_add_to_new_system", [])
        report["factory_emitters_set_error"] = ""
    except Exception as exc:
        report["factory_emitters_set_error"] = (str(exc) or type(exc).__name__)[:200]
except Exception:
    report["surface_error"] = traceback.format_exc()[-600:]

path = report_path()
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[niagara_traps] wrote " + path)
