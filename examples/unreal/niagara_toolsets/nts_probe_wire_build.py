"""Probe, build half: generated assets wired into Niagara. A GLB through Interchange into a mesh renderer, and a sprite atlas into a Sub UV flipbook.
Run on 2026-10-26, 2026-10-27 and 2026-10-29.

Run headless (assets and level only, no rendering), through nts_probe.mjs --only wire, or by hand:
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: NTS_PROBE_DIR, NTS_REPORT, NTS_MANIFEST, and the inputs nts_probe.mjs resolves and checks first:
  NTS_WIRE_MESHES    JSON list of {"id", "path", "skinned"}: the GLB files to import (the sample model, a static export of it, and a small built-in static cube)
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
          NiagaraFunctionLibrary.override_system_user_variable_static_mesh; the renderer is NOT bound to it, so that call is
          recorded for acceptance, not for appearance
  bind    copies of the mesh system get an object-typed Static Mesh user parameter (User.MeshBind, default the engine sphere), and the
          mesh slot's meshParameterBinding (FNiagaraParameterBinding, source: NiagaraMeshRendererMeshProperties.h; it allows
          UStaticMesh objects, NiagaraMeshRendererProperties.cpp) is written through SetRendererData. The binding's variable carries a
          registered type index (FNiagaraTypeDefinitionHandle.RegisteredTypeIndex) that has no readable name, so one copy per candidate
          index is made, plus a copy with the name only and a copy with no binding (the control). nts_probe_sim.py swaps the mesh with
          set_variable_static_mesh and takes a shot before and after; a copy whose pair of shots differs is bound
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
    # an emitter added to a template-made system starts dead until a numeric stack input is written after the last AddEmitter (unreal-niagara-toolsets.md; Lifetime is hidden on this emitter, so the system's Loop Duration is written)
    revive = c.call("SetStackInputData", {"stackInputRef": c.at(system, None, "SystemUpdateScript", "SystemState", ["Loop Duration"]), "inputData": {"struct": {"refPath": c.FLOAT}, "value": {"value": 5.0}}})
    fields["revive_error"] = revive["error"]
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

MESH_PARAM = "User.MeshBind"
SPHERE, CONE = "/Engine/BasicShapes/Sphere", "/Engine/BasicShapes/Cone"
BIND_SPAN = int(os.environ.get("NTS_WIRE_BIND_SPAN", "22"))   # how many type indices the bind chain tries
BIND_FIRST = os.environ.get("NTS_WIRE_BIND_FIRST")   # the first index tried; by default one above the highest index the renderer's own bindings show
ONE_PARTICLE = os.environ.get("NTS_WIRE_ONE_PARTICLE", "1") != "0"   # run 2 (many particles, fixed seed) still differed by about 2,000 pixels between copies from the shot timing alone
DETERMINISTIC = os.environ.get("NTS_WIRE_DETERMINISTIC", "1") != "0"   # the first run (random seeds) could not tell a swapped mesh from the noise between two shots
base = next((p for p in placed if p[0] == "Mesh_builtin" and p[2]), None) or next((p for p in placed if p[2]), None)   # the cube carries the copies


def duplicate_of(source, target):
    duplicate = eal.duplicate_asset("%s.%s" % (source, source.rsplit("/", 1)[-1]), target)   # as niagara_build.py
    if not duplicate or not eal.save_asset(target):
        raise RuntimeError("could not copy " + source)


def object_variable(system, name, asset):
    """AddUserVariables with the object shape that listed in the earlier runs (type StaticMesh, NiagaraExt_VariableValue_Object)."""
    return c.call("AddUserVariables", {"system": c.ref(system), "variablesToAdd": [{
        "name": name, "type": {"classStructOrEnum": {"refPath": "/Script/Engine.StaticMesh"}},
        "defaultValue": {"struct": {"refPath": "/Script/NiagaraEditor.NiagaraExt_VariableValue_Object"}, "value": {
            "objectClass": {"refPath": "/Script/Engine.StaticMesh"}, "object": {"refPath": asset + "." + asset.rsplit("/", 1)[-1]}}},
        "description": "Mesh chosen from Python"}]})


def variables_in(node, path=""):
    """Every JSON object that holds a name and a child object with one integer index in it (an FNiagaraVariableBase and its type handle)."""
    found = []
    if isinstance(node, dict):
        name = next((v for k, v in node.items() if k.lower() == "name" and isinstance(v, str)), None)
        for key, child in node.items():
            if isinstance(child, dict):
                index_key = next((k for k, v in child.items() if isinstance(v, int) and not isinstance(v, bool) and "index" in k.lower()), None)
                if name is not None and index_key:
                    found.append({"path": path, "name": name, "handle": key, "index_key": index_key, "index": child[index_key]})
        for key, child in node.items():
            found += variables_in(child, "%s/%s" % (path, key))
    elif isinstance(node, list):
        for i, child in enumerate(node):
            found += variables_in(child, "%s[%d]" % (path, i))
    return found


def rewrite_binding(binding, name, index):
    """A copy of the read-back binding with every variable in it renamed to `name` and, when `index` is not None, given that type index."""
    out = json.loads(json.dumps(binding))

    def walk(node):
        if isinstance(node, dict):
            for key in list(node):
                if key.lower() == "name" and isinstance(node[key], str):
                    node[key] = name
                    if index is not None:
                        for child in node.values():
                            if isinstance(child, dict):
                                for k in child:
                                    if isinstance(child[k], int) and not isinstance(child[k], bool) and "index" in k.lower():
                                        child[k] = index
                else:
                    walk(node[key])
        elif isinstance(node, list):
            for item in node:
                walk(item)
    walk(out)
    return out


def bind_chain():
    """Copies of the mesh system with User.MeshBind and a bound mesh slot, one candidate type index per copy (see the header)."""
    system, mesh = base[1], base[2]
    renderer = c.at(system, "Mesh", renderer=0)
    props = json.loads(c.tool("GetRendererData", {"rendererRef": renderer})["propertyValues"])
    slot = dict((props.get("Meshes") or [{}])[0])
    key = next((k for k in slot if k.lower() == "meshparameterbinding"), None)
    if key is None:
        raise RuntimeError("the mesh slot has no meshParameterBinding; keys %s" % sorted(slot))
    anchors = variables_in({k: v for k, v in props.items() if k != "Meshes"}) + variables_in({k: v for k, v in slot.items() if k != key})
    highest = max([a["index"] for a in anchors] or [0])
    first = int(BIND_FIRST) if BIND_FIRST else highest + 1
    fields = {"slot_keys": sorted(slot), "binding_key": key, "binding_default": json.dumps(slot[key], sort_keys=True)[:700],
              "binding_variables": variables_in(slot[key]), "anchors": [{"name": a["name"], "index": a["index"]} for a in anchors][:24], "first_index": first, "span": BIND_SPAN}
    probe.step("bind_shape", **fields)
    probe.write()
    candidates = [("ctl", None, False), ("default", None, True)] + [(str(i), i, True) for i in range(first, first + BIND_SPAN)]
    rows = []
    for tag, index, bind in candidates:
        sid = "Bind_" + tag
        path = FOLDER + "/NS_" + sid
        row = {"id": sid, "index": index, "bound": False, "set_error": ""}
        try:
            duplicate_of(system, path)
            added = object_variable(path, MESH_PARAM, SPHERE)
            row["add_error"] = added["error"]
            if DETERMINISTIC:   # the same random seed on every restart, so two shots of one mesh differ only by the sub-frame timing of the shot
                row["determinism_error"] = c.call("SetEmitterData", {"emitter": c.at(path, "Mesh"), "emitterData": {"propertyValues": json.dumps({"bDeterminism": True, "RandomSeed": 7})}})["error"]
            if ONE_PARTICLE:   # one big particle, so the swapped mesh is the only thing that differs between a copy and the control
                row["count_error"] = c.call("SetStackInputData", {"stackInputRef": c.at(path, "Mesh", "EmitterUpdateScript", "SpawnBurst_Instantaneous", ["Spawn Count"]), "inputData": {"struct": {"refPath": c.INT32}, "value": {"value": 1}}})["error"]
            binding = rewrite_binding(slot[key], MESH_PARAM, index) if bind else slot[key]
            big = dict(slot, **{key: binding})
            if ONE_PARTICLE and isinstance(big.get("scale"), dict):
                big["scale"] = {axis: 3.0 for axis in big["scale"]}
            row["binding_sent"] = json.dumps(binding, sort_keys=True)[:400] if bind else "none (control)"
            written = c.call("SetRendererData", {"renderer": c.at(path, "Mesh", renderer=0), "rendererData": {"propertyValues": json.dumps({"Meshes": [big]})}})
            row["set_error"] = written["error"]
            after = json.loads(c.tool("GetRendererData", {"rendererRef": c.at(path, "Mesh", renderer=0)})["propertyValues"])
            first_slot = (after.get("Meshes") or [{}])[0]
            row["binding_after"] = json.dumps(first_slot.get(key), sort_keys=True)[:400] if isinstance(first_slot, dict) else None
            row["bound"] = bool(bind) and not written["error"] and MESH_PARAM in (row["binding_after"] or "") and (index is None or str(index) in (row["binding_after"] or ""))
            eal.save_asset(path)
            placed.append((sid, path, mesh))
        except Exception as exc:
            row["exception"] = str(exc)[:300]
        rows.append(row)
        probe.step("bind_" + tag, **row)
        probe.write()
    return {"candidates": rows, "mesh": mesh, "first_index": first, "span": BIND_SPAN}


# a copy of the cube's mesh system, for the user-parameter override (see the header)
user_system = None
if base:
    def copy_for_user():
        global user_system
        user_system = FOLDER + "/NS_MeshUser"
        duplicate_of(base[1], user_system)
        placed.append(("MeshUser", user_system, base[2]))
        return {"copy": user_system}
    probe.guarded("user_copy", copy_for_user)
    probe.guarded("bind_mesh", bind_chain)

positions = {sid: (i * 1500, 0, 100) for i, (sid, _, _) in enumerate(placed)}
samples = []
for sid, path, mesh in placed:
    if sid == "MeshUser":
        samples.append({"id": sid, "actor": "Fx_" + sid, "camera": "Cam_" + sid, "metric_emitter": "Mesh",
                        "sequence": [{"name": "override", "frames": 30, "override_mesh": {"name": "User.Mesh", "asset": mesh}}]})
    elif sid.startswith("Bind_"):
        samples.append({"id": sid, "actor": "Fx_" + sid, "camera": "Cam_" + sid, "metric_emitter": "Mesh",
                        "sequence": [{"name": "w", "frames": 5, "shot": sid + "_w", "live_seconds": 0.5},   # a warm-up shot: the first shot of a sample differed from the later ones in the second run
                                     {"name": "a", "frames": 5, "shot": sid + "_a", "live_seconds": 0.5},
                                     {"name": "b", "frames": 5, "set": [{"type": "static_mesh", "name": MESH_PARAM, "asset": CONE}], "shot": sid + "_b", "live_seconds": 0.5}]})
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

# last, because an unconfirmed payload may take the editor down: Static Mesh user parameters on the copy, one attempt per shape, riskiest last.
# Each attempt gets its own name and is listed back; the report keeps every result. The first attempt is the default shape that listed nothing before.
if user_system:
    DI = "/Script/Niagara.NiagaraDataInterfaceStaticMesh"   # source: Engine/Plugins/FX/Niagara/Source/Niagara/Internal/DataInterface/NiagaraDataInterfaceStaticMesh.h
    VALUE = "/Script/NiagaraEditor.NiagaraExt_VariableValue_"   # source: NiagaraExternalSystemEditorUtilities.h FNiagaraExt_VariableValue_DataInterface and _Object
    CUBE = "/Engine/BasicShapes/Cube.Cube"

    def attempt_of(name, type_path, struct, value):
        added = c.call("AddUserVariables", {"system": c.ref(user_system), "variablesToAdd": [{
            "name": name, "type": {"classStructOrEnum": {"refPath": type_path}},
            "defaultValue": {"struct": {"refPath": VALUE + struct}, "value": value}, "description": "Mesh chosen from Python"}]})
        listed = c.call("GetUserVariables", {"system": c.ref(user_system)})
        names = [v.get("name") for v in ((listed["value"] or {}).get("userVariables") or [])]
        return {"name": name, "type": type_path, "struct": struct, "add_error": added["error"], "add_value": str(added["value"])[:300],
                "list_error": listed["error"], "listed": name in names}

    def di_instance_value():
        # a Static Mesh data interface object owned by the system, so the default can carry an instance and not only the class
        instance = unreal.new_object(unreal.NiagaraDataInterfaceStaticMesh, outer=unreal.load_asset(user_system))
        return {"dataInterfaceClass": {"refPath": DI}, "dataInterface": {"refPath": instance.get_path_name()}}

    ATTEMPTS = [
        ("di_class", "User.Mesh", DI, "DataInterface", lambda: {"dataInterfaceClass": {"refPath": DI}}),
        ("object", "User.MeshObj", "/Script/Engine.StaticMesh", "Object", lambda: {"objectClass": {"refPath": "/Script/Engine.StaticMesh"}, "object": {"refPath": CUBE}}),
        ("di_instance", "User.MeshDi", DI, "DataInterface", di_instance_value),
    ]
    results = []

    def add_user_variables():
        for key, name, type_path, struct, value in ATTEMPTS:
            try:
                row = attempt_of(name, type_path, struct, value())
            except Exception as exc:
                row = {"name": name, "type": type_path, "struct": struct, "exception": str(exc)[:300]}
            row["variant"] = key
            results.append(row)
            probe.step("user_variable_" + key, **{("variable" if k == "name" else k): v for k, v in row.items()})
            probe.write()
        lead = next((r for r in results if r.get("listed")), results[0])
        saved = eal.save_asset(user_system)
        return {"variants": results, "lead": lead["variant"], "add_error": lead.get("add_error", lead.get("exception", "")), "add_value": lead.get("add_value", ""),
                "list_error": lead.get("list_error", ""), "names": [r["name"] for r in results if r.get("listed")], "saved": bool(saved)}
    probe.guarded("user_variable", add_user_variables)
    probe.write()
