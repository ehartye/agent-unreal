"""Import a small generated GLB through Interchange and record what arrived (Unreal 5.8, headless commandlet).

  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: EPF_REPORT (JSON report path), EPF_GLB (the .glb), EPF_DEST (the /Game folder), EPF_PIPELINE ("default" or "owned").
  default  the engine's default glTF stack
  owned    a saved InterchangeGenericAssetsPipeline with import_materials True and reuse_existing_materials False, passed through
           ImportAssetParameters.override_pipelines (the pattern in skills/unreal-import/scripts/unreal_import_native.py)
The glTF files come from tiny_glb.mjs. The validator counts the "Invalid input AlphaMode" log lines of each run.
"""
import json
import os
import traceback

import unreal

report = {"engine": unreal.SystemLibrary.get_engine_version(), "pipeline": os.environ.get("EPF_PIPELINE", "default")}
DEST = os.environ.get("EPF_DEST", "/Game/Tiny")
PIPELINE = "P_" + DEST.rsplit("/", 1)[-1]

try:
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    params = unreal.ImportAssetParameters()
    params.is_automated = True
    if report["pipeline"] == "owned":
        unreal.EditorAssetLibrary.make_directory("/Game/Pipelines")
        pipeline = tools.create_asset(PIPELINE, "/Game/Pipelines", unreal.InterchangeGenericAssetsPipeline, None)
        materials = pipeline.get_editor_property("material_pipeline")
        materials.set_editor_property("import_materials", True)
        materials.set_editor_property("reuse_existing_materials", False)
        unreal.EditorAssetLibrary.save_loaded_asset(pipeline, only_if_is_dirty=False)
        params.override_pipelines = [unreal.SoftObjectPath("/Game/Pipelines/%s.%s" % (PIPELINE, PIPELINE))]
    manager = unreal.InterchangeManager.get_interchange_manager_scripted()
    source = unreal.InterchangeManager.create_source_data(os.environ["EPF_GLB"])
    report["returned"] = bool(manager.import_asset(DEST, source, params))
    # 5.8 leaves the assets of an automated import in memory: save them before reading anything back
    unreal.EditorAssetLibrary.save_directory(DEST, only_if_is_dirty=False, recursive=True)
    by_class = {}
    materials_out = {}
    for path in unreal.EditorAssetLibrary.list_assets(DEST, recursive=True, include_folder=False):
        asset = unreal.EditorAssetLibrary.load_asset(str(path))
        cls = asset.get_class().get_name()
        by_class.setdefault(cls, []).append(asset.get_name())
        if cls == "Material":
            materials_out[asset.get_name()] = {"blend_mode": asset.get_editor_property("blend_mode").name,
                                               "mask_clip": round(asset.get_editor_property("opacity_mask_clip_value"), 3)}
        elif cls == "MaterialInstanceConstant":
            materials_out[asset.get_name()] = {"parent": asset.get_editor_property("parent").get_name()}
    report["assets"] = {k: sorted(v) for k, v in by_class.items()}
    report["materials"] = materials_out
    # the glTF body function the importer calls for a Material: which inputs does it have?
    body = unreal.load_asset("/InterchangeAssets/gltf/MaterialBodies/MF_Default_Body.MF_Default_Body")
    inputs = [str(e.get_editor_property("input_name")) for e in unreal.MaterialEditingLibrary.get_material_function_expressions(body)
              if isinstance(e, unreal.MaterialExpressionFunctionInput)]
    report["mf_default_body_inputs"] = {"count": len(inputs), "has_AlphaMode": "AlphaMode" in inputs, "has_AlphaCutoff": "AlphaCutoff" in inputs}
except Exception:
    report["error"] = traceback.format_exc()[-900:]

path = os.environ.get("EPF_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "epf-import.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[epf_import] wrote " + path)
