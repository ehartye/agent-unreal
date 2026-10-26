"""Probe, build half: generated assets wired into Niagara. A GLB through Interchange into a mesh renderer, and a sprite atlas into a Sub UV flipbook.
Prepared 2026-10-26; not yet run on an engine. A first run tests the probe before it tests the engine.

Run headless (assets and level only, no rendering), through nts_probe.mjs --only wire, or by hand:
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: NTS_PROBE_DIR, NTS_REPORT, NTS_MANIFEST, and the inputs nts_probe.mjs resolves and checks first:
  NTS_WIRE_MESHES    JSON list of {"id", "path", "skinned"}: the GLB files to import (the sample model, and a small built-in static cube)
  NTS_WIRE_ATLAS_PNG, NTS_WIRE_ATLAS_JSON   the sprite atlas image and its Aseprite-style JSON
  NTS_WIRE_GRID      "<columns>,<rows>" computed from the atlas JSON by atlasGrid() in nts-probe-checks.mjs
The project needs the Interchange plugins the import sample uses (see examples/unreal/README.md) on top of nts_validate.mjs's plugins;
nts_probe.mjs writes them into its throwaway project.

The three changes Unreal 5.8.3 needed for the import sample are kept here: a skinned model is imported with a saved pipeline asset that
combines skeletal meshes by skeleton (the default stack split a 48-skin model into 48 meshes), every import is followed by
EditorAssetLibrary.save_directory (an automated import stays in memory otherwise), and no FBX clip is involved.
A mesh renderer needs a static mesh; Interchange makes a skeletal mesh from a skinned GLB, so the sample model is imported and counted
(static and skeletal) and the built-in cube carries the mesh chain when the sample gives no static mesh.

Chains:
  mesh    import the GLB; a template system with the UpwardMeshBurst emitter; the mesh renderer's Meshes[0].Mesh set through SetRendererData
          (the property names come from FNiagaraMeshRendererMeshPropertiesBase in NiagaraMeshRendererMeshProperties.h); read back
  atlas   import the PNG; an unlit masked SubUV material; a template system with the SubUVAnimation emitter and Sub Image Size = the grid
  user    a copy of the mesh system gets a Static Mesh data-interface user parameter (AddUserVariables), for the runtime override
          NiagaraFunctionLibrary.override_system_user_variable_static_mesh; the renderer is NOT bound to it (the JSON shape of
          FNiagaraParameterBinding was not confirmed), so that call is recorded for acceptance, not for appearance
"""
import json
import os
import sys

sys.path.insert(0, os.environ.get("NTS_PROBE_DIR", ""))
import nts_probe_common as c  # noqa: E402
import unreal  # noqa: E402

FOLDER, MAP = "/Game/Probe/Wire", "/Game/Maps/NtsProbeWire"
TEMPLATE_SYSTEM = c.SYSTEMS + "DirectionalBurst"
MESHES = json.loads(os.environ.get("NTS_WIRE_MESHES", "[]"))
ATLAS_PNG, ATLAS_JSON = os.environ.get("NTS_WIRE_ATLAS_PNG", ""), os.environ.get("NTS_WIRE_ATLAS_JSON", "")
COLS, ROWS = (int(v) for v in (os.environ.get("NTS_WIRE_GRID") or "1,1").split(","))
eal, mel = unreal.EditorAssetLibrary, unreal.MaterialEditingLibrary
probe = c.Probe("wire-build", "nts-probe-wire-build.json")
placed = []   # (sample id, system path)


def combine_by_skeleton_pipeline():
    """A saved pipeline asset that merges the skins of one skeleton into one SkeletalMesh (build_scene.py; needed on 5.8.3)."""
    behavior = unreal.InterchangeCombineSkeletalMeshesBehavior.BY_SKELETON
    folder, name = "/Game/Pipelines", "P_combine_by_skeleton"
    eal.make_directory(folder)
    if not eal.does_asset_exist(folder + "/" + name):
        asset = unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, folder, unreal.InterchangeGenericAssetsPipeline, None)
        asset.get_editor_property("mesh_pipeline").set_editor_property("combine_skeletal_meshes_behavior", behavior)
        eal.save_asset(folder + "/" + name)
    return unreal.SoftObjectPath(folder + "/" + name + "." + name)


def import_file(src, dest, pipeline=None):
    """Interchange import with is_automated (a headless run asserts on the Slate path otherwise), then save the folder (5.8.3)."""
    manager = unreal.InterchangeManager.get_interchange_manager_scripted()
    source = unreal.InterchangeManager.create_source_data(src)
    params = unreal.ImportAssetParameters()
    params.is_automated = True
    if pipeline is not None:
        params.override_pipelines = [pipeline]
    returned = bool(manager.import_asset(dest, source, params))
    eal.save_directory(dest, only_if_is_dirty=False, recursive=True)
    return returned, [str(p) for p in eal.list_assets(dest, recursive=True, include_folder=False)]


def classify(paths):
    out = {"static": [], "skeletal": [], "texture": []}
    for path in paths:
        asset = eal.load_asset(path)
        for key, cls in (("static", unreal.StaticMesh), ("skeletal", unreal.SkeletalMesh), ("texture", unreal.Texture2D)):
            if asset is not None and isinstance(asset, cls):
                out[key].append(path)
    return out


def new_system(name):
    path = c.create_system(name, FOLDER, TEMPLATE_SYSTEM)
    return path


def keep_only(system, emitter):
    for old in c.emitter_names(system):
        if old != emitter:
            c.tool("RemoveEmitter", {"emitterToRemove": c.at(system, old)})


def mesh_chain(source):
    sid = source["id"]
    dest = "%s/Mesh_%s" % (FOLDER, sid)
    pipeline = combine_by_skeleton_pipeline() if source.get("skinned") else None
    returned, paths = import_file(source["path"], dest, pipeline)
    kinds = classify(paths)
    fields = {"id": sid, "returned": returned, "assets": len(paths), "static_meshes": kinds["static"], "skeletal_meshes": len(kinds["skeletal"])}
    if not kinds["static"]:
        fields["error"] = "the import produced no static mesh (%d skeletal)" % len(kinds["skeletal"])
        return fields
    mesh_path = kinds["static"][0]
    system = new_system("NS_Mesh_" + sid)
    c.add_emitter(system, c.EMITTERS + "UpwardMeshBurst", "Mesh")
    keep_only(system, "Mesh")
    renderer = c.at(system, "Mesh", renderer=0)
    raw = c.tool("GetRendererData", {"rendererRef": renderer})
    props = json.loads(raw["propertyValues"])
    fields["renderer_keys"] = sorted(props.keys())
    fields["meshes_before"] = json.dumps(props.get("Meshes"), sort_keys=True)[:600]
    slot = (props.get("Meshes") or [{}])[0]
    slot = dict(slot) if isinstance(slot, dict) else {}
    # SetRendererData reads nested struct fields in lower camel case: the read-back names the field "mesh", and a "Mesh" key is accepted without an error and stores nothing (a 5.8.3 run)
    key = next((k for k in slot if k.lower() == "mesh"), "mesh")
    slot[key] = {"refPath": mesh_path if "." in mesh_path.rsplit("/", 1)[-1] else "%s.%s" % (mesh_path, mesh_path.rsplit("/", 1)[-1])}
    written = c.call("SetRendererData", {"renderer": renderer, "rendererData": {"propertyValues": json.dumps({"Meshes": [slot]})}})
    after = json.loads(c.tool("GetRendererData", {"rendererRef": renderer})["propertyValues"])
    first = (after.get("Meshes") or [{}])[0]
    fields.update({"mesh_path": mesh_path, "set_error": written["error"], "mesh_after": (first.get(key) or {}).get("refPath") if isinstance(first, dict) else None})
    life = c.call("SetStackInputData", {"stackInputRef": c.at(system, "Mesh", "ParticleSpawnScript", "InitializeParticle", ["Lifetime"]), "inputData": {"struct": {"refPath": c.FLOAT}, "value": {"value": 8.0}}})
    fields["lifetime_error"] = life["error"]
    eal.save_asset(system)
    placed.append(("Mesh_" + sid, system, mesh_path))
    return fields


def atlas_chain():
    returned, paths = import_file(ATLAS_PNG, FOLDER + "/Atlas")
    kinds = classify(paths)
    if not kinds["texture"]:
        return {"returned": returned, "error": "the import produced no texture"}
    texture_path = kinds["texture"][0]
    tex = eal.load_asset(texture_path)
    tex.set_editor_property("filter", unreal.TextureFilter.TF_NEAREST)
    tex.set_editor_property("mip_gen_settings", unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS)
    eal.save_asset(texture_path)
    mat = unreal.AssetToolsHelpers.get_asset_tools().create_asset("M_Atlas", FOLDER, unreal.Material, unreal.MaterialFactoryNew())
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
    sample = mel.create_material_expression(mat, unreal.MaterialExpressionTextureSampleParameterSubUV, -400, 0)
    sample.set_editor_property("parameter_name", "Flipbook")
    sample.set_editor_property("texture", tex)
    mel.connect_material_property(sample, "RGB", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.connect_material_property(sample, "A", unreal.MaterialProperty.MP_OPACITY_MASK)
    mat.set_editor_property("used_with_niagara_sprites", True)
    mel.recompile_material(mat)
    eal.save_asset(FOLDER + "/M_Atlas")
    system = new_system("NS_Atlas")
    c.add_emitter(system, c.BEHAVIOR + "SubUVAnimation", "Sprite")   # the flipbook emitter stylized_build.py uses
    keep_only(system, "Sprite")
    renderer = {"Material": c.ref(FOLDER + "/M_Atlas"), "bSubImageBlend": False, "SubImageSize": {"x": COLS, "y": ROWS}}
    set_error = c.call("SetRendererData", {"renderer": c.at(system, "Sprite", renderer=0), "rendererData": {"propertyValues": json.dumps(renderer)}})["error"]
    c.set_float(c.at(system, "Sprite", "ParticleSpawnScript", "InitializeParticle", ["Lifetime"]), 2.0)
    c.set_float(c.at(system, "Sprite", "ParticleSpawnScript", "InitializeParticle", ["Uniform Sprite Size"]), 300.0)
    c.set_float(c.at(system, "Sprite", "EmitterUpdateScript", "EmitterState", ["Loop Duration"]), 2.0)
    after = json.loads(c.tool("GetRendererData", {"rendererRef": c.at(system, "Sprite", renderer=0)})["propertyValues"])
    eal.save_asset(system)
    placed.append(("Atlas", system, None))
    return {"returned": returned, "texture": texture_path, "grid": [COLS, ROWS], "set_error": set_error,
            "sub_image_size": after.get("SubImageSize"), "material": (after.get("Material") or {}).get("refPath")}


try:
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    eal.make_directory(FOLDER)
    probe.step("setup", toolset_registered=unreal.ToolsetRegistry.is_toolset_registered(c.TOOLSET), meshes=[m["id"] for m in MESHES], atlas=bool(ATLAS_PNG), grid=[COLS, ROWS])
except Exception as exc:
    probe.step("setup", error=str(exc)[:300])

for source in MESHES:
    probe.guarded("mesh_" + source["id"], lambda s=source: mesh_chain(s))
if ATLAS_PNG:
    probe.guarded("atlas", atlas_chain)
probe.write()

# a copy of the first mesh system, for the user-parameter override (see the header)
user_system = None
if placed and placed[0][2]:
    def copy_for_user():
        global user_system
        source = placed[0][1]
        user_system = FOLDER + "/NS_MeshUser"
        duplicate = eal.duplicate_asset("%s.%s" % (source, source.rsplit("/", 1)[-1]), user_system)   # as niagara_build.py
        if not duplicate or not eal.save_asset(user_system):
            raise RuntimeError("could not copy " + source)
        placed.append(("MeshUser", user_system, placed[0][2]))
        return {"copy": user_system}
    probe.guarded("user_copy", copy_for_user)

positions = {sid: (i * 1500, 0, 100) for i, (sid, _, _) in enumerate(placed)}
samples = []
for sid, path, mesh in placed:
    if sid == "MeshUser":
        samples.append({"id": sid, "actor": "Fx_" + sid, "camera": "Cam_" + sid, "metric_emitter": "Mesh",
                        "sequence": [{"name": "override", "frames": 30, "override_mesh": {"name": "User.Mesh", "asset": mesh}}]})
    elif sid.startswith("Mesh_"):
        samples.append({"id": sid, "actor": "Fx_" + sid, "camera": "Cam_" + sid, "metric_emitter": "Mesh",
                        "sequence": [{"name": "base", "hidden": True, "shot": sid + "_base", "live_seconds": 0.5},
                                     {"name": "on", "frames": 30, "shot": sid + "_on", "live_seconds": 0.4}]})
    else:
        samples.append({"id": sid, "actor": "Fx_" + sid, "camera": "Cam_" + sid, "metric_emitter": "Sprite",
                        "sequence": [{"name": "base", "hidden": True, "shot": sid + "_base", "live_seconds": 0.5},
                                     {"name": "early", "frames": 10, "attributes": ["SubImageIndex"]},
                                     {"name": "late", "frames": 60, "attributes": ["SubImageIndex"], "shot": sid + "_on", "live_seconds": 1.0}]})
probe.manifest.update({"map": MAP, "settle_seconds": 8, "samples": samples, "systems": [{"id": sid, "asset": path} for sid, path, _ in placed]})
probe.guarded("level", lambda: c.build_level(MAP, [{"id": sid, "asset": path, "location": positions[sid]} for sid, path, _ in placed]))
probe.write()
probe.write_manifest()

# last, because an unconfirmed payload may take the editor down: the Static Mesh data-interface user parameter on the copy
if user_system:
    def add_user_variable():
        di = "/Script/Niagara.NiagaraDataInterfaceStaticMesh"   # source: Engine/Plugins/FX/Niagara/Source/Niagara/Internal/DataInterface/NiagaraDataInterfaceStaticMesh.h
        added = c.call("AddUserVariables", {"system": c.ref(user_system), "variablesToAdd": [{
            "name": "User.Mesh", "type": {"classStructOrEnum": {"refPath": di}},
            "defaultValue": {"struct": {"refPath": "/Script/NiagaraEditor.NiagaraExt_VariableValue_DataInterface"}, "value": {"dataInterfaceClass": {"refPath": di}}},
            "description": "Mesh chosen from Python"}]})
        listed = c.call("GetUserVariables", {"system": c.ref(user_system)})
        saved = eal.save_asset(user_system)
        return {"add_error": added["error"], "add_value": str(added["value"])[:300], "list_error": listed["error"], "names": [v.get("name") for v in ((listed["value"] or {}).get("userVariables") or [])], "saved": bool(saved)}
    probe.guarded("user_variable", add_user_variable)
    probe.write()
