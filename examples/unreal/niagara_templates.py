"""List the description Epic ships with each Niagara template system (Unreal 5.8, editor Python).

Each template system carries a one-line `template_asset_description`, which the editor shows in its New System picker. This writes
them to a JSON report, one entry per system, so the catalog in the Niagara templates reference can be reproduced:
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
The project needs PythonScriptPlugin, EditorScriptingUtilities, Niagara and NiagaraFluids. Set NIAGARA_TEMPLATES_REPORT for the output
(an absolute path; default Saved/niagara-templates.json in the project, because a relative path lands in the engine's binaries folder).

It also records what niagara_validate.mjs judges against the Niagara stock-content reference:
  - "emitter_templates": the emitter assets under /Niagara/DefaultAssets/Templates/Emitters;
  - "stock": for FountainLightweight and Grid2D_Gas_MovingFire, the user variables, and for the fire template its emitters, each emitter's
    renderer classes and the material names found in each renderer's properties (read through Epic's NiagaraToolsets when the plugin is enabled;
    a part the toolset cannot answer holds "unavailable" and its error);
  - "fire_material": blend mode, shading model and the scalar and vector parameter names of M_2D_SmokeFire.
"""
import json
import os
import re

import unreal

TOOLSET = "NiagaraToolsets.NiagaraToolset_System"
EMITTER_FOLDER = "/Niagara/DefaultAssets/Templates/Emitters"
STOCK = {
    "FountainLightweight": "/Niagara/DefaultAssets/Templates/Systems/FountainLightweight",
    "Grid2D_Gas_MovingFire": "/NiagaraFluids/Templates/Gas/2D/Systems/Grid2D_Gas_MovingFire",
}
FIRE_MATERIAL = "/NiagaraFluids/Materials/Grid2D/M_2D_SmokeFire"

FOLDERS = [
    "/NiagaraFluids/Templates/Gas/2D/Systems",
    "/NiagaraFluids/Templates/Gas/3D/Systems",
    "/NiagaraFluids/Templates/Liquid/3D/Systems",
    "/NiagaraFluids/Templates/Sand/Systems",
    "/Niagara/DefaultAssets/Templates/Systems",
]

unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
report = {"engine": unreal.SystemLibrary.get_engine_version(), "templates": {}}
for folder in FOLDERS:
    for path in sorted(unreal.EditorAssetLibrary.list_assets(folder, recursive=False, include_folder=False)):
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if not asset or asset.get_class().get_name() != "NiagaraSystem":
            continue
        try:
            description = str(asset.get_editor_property("template_asset_description"))
        except Exception as exc:   # an engine version without the property
            description = "unavailable: " + str(exc)[:80]
        report["templates"][path.split(".")[0]] = " ".join(description.split())



def object_ref(package_path):
    return {"refPath": package_path + "." + package_path.rsplit("/", 1)[-1]}


def call(tool, args):
    """Run one toolset tool and return its decoded returnValue; raise when it fails or has not completed."""
    result = unreal.ToolsetRegistry.execute_tool(TOOLSET, tool, json.dumps(args))
    error = str(result.get_editor_property("error"))
    if error or not result.is_complete:
        raise RuntimeError("%s: %s" % (tool, (error or "not complete")[:300]))
    text = str(result.get_editor_property("value"))
    return json.loads(text).get("returnValue") if text else None


def short_class(value):
    text = value.get("refPath", "") if isinstance(value, dict) else str(value)
    return text.rsplit(".", 1)[-1]


def inspect_stock(name, package_path):
    """User variables of a stock system; for the fire template also its emitters, renderer classes and renderer materials."""
    out = {"path": package_path}
    system = object_ref(package_path)
    try:
        listed = call("GetUserVariables", {"system": system}) or {}
        out["user_variables"] = [str(v.get("name")) for v in (listed.get("userVariables") or [])]
        if name != "Grid2D_Gas_MovingFire":
            return out
        out["emitters"] = {}
        for emitter in (call("GetSystemSummary", {"system": system}) or {}).get("emitters", []):
            emitter_name = emitter["emitterName"]
            ref = {"system": system, "emitterName": emitter_name}
            topology = call("GetEmitterTopology", {"emitterRef": ref}) or {}
            renderers = sorted(topology.get("renderers") or [], key=lambda r: r.get("rendererIndex", 0))
            info = {"renderers": [short_class(r.get("rendererClass")) for r in renderers], "materials": []}
            for index, renderer in enumerate(renderers):
                data = call("GetRendererData", {"rendererRef": dict(ref, rendererIndex=renderer.get("rendererIndex", index))})
                text = json.dumps(data, default=str)
                info["materials"] += sorted(set(re.findall(r"M_[A-Za-z0-9_]+", text)))
            out["emitters"][emitter_name] = info
    except Exception as exc:
        out["error"] = str(exc)[:400]
    return out


if hasattr(unreal, "ToolsetRegistry") and unreal.ToolsetRegistry.is_toolset_registered(TOOLSET):
    report["stock"] = {name: inspect_stock(name, path) for name, path in STOCK.items()}
else:
    report["stock"] = "NiagaraToolsets not enabled"

report["emitter_templates"] = sorted(
    p.split(".")[0] for p in unreal.EditorAssetLibrary.list_assets(EMITTER_FOLDER, recursive=False, include_folder=False))

material = unreal.EditorAssetLibrary.load_asset(FIRE_MATERIAL)
report["fire_material"] = {"path": FIRE_MATERIAL, "loaded": material is not None}
for key, read in (
    ("blend_mode", lambda: str(material.get_editor_property("blend_mode"))),
    ("shading_model", lambda: str(material.get_editor_property("shading_model"))),
    ("scalar", lambda: sorted(str(n) for n in unreal.MaterialEditingLibrary.get_scalar_parameter_names(material))),
    ("vector", lambda: sorted(str(n) for n in unreal.MaterialEditingLibrary.get_vector_parameter_names(material))),
):
    try:
        report["fire_material"][key] = read()
    except Exception as exc:
        report["fire_material"][key + "_error"] = str(exc)[:200]

out = os.environ.get("NIAGARA_TEMPLATES_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "niagara-templates.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as fh:
    json.dump(report, fh, indent=2)
unreal.log("[niagara_templates] %d systems, wrote %s" % (len(report["templates"]), out))
