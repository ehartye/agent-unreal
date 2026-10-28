"""Build the UEFN sample scene in a scratch project through native editor Python (one phase per run).

Run it through an already verified native editor connection (Epic's remote_execution.py, MODE_EXEC_FILE), with a JSON file named
sample_scene_config.json next to this script:

  {"phase": "audio", "mount": "/<project-guid>/<project>", "level": "/<project-guid>/<project>",
   "sources": "<absolute folder holding the WAVs>", "report": "<absolute path of the JSON report to write>"}

Phases (each refuses to run if the loaded world is not config.level, and never replaces an existing asset):
  audio     imports survey-drone.wav as a looping Sound Cue and relic-discovered.wav as a Sound Cue under <mount>/AgentEngine/Audio
  materials builds one unlit masked flipbook material per one-row sprite sheet under <mount>/AgentEngine/Sprites
            (config.sheets: [{"name", "texture", "cells", "fps"}]); the frame is floor(Time * fps) mod cells, no particles
  vcolor    builds a lit material that shows a skinned mesh's vertex colours (config.vertex_color_material: {"folder", "name"}); a
            model whose colours are vertex colours imports with white default materials until this is assigned to its slots
  fbx       imports a skinned FBX natively (config.fbx: {"file", "folder", "name", "vertex_colors"}); vertex_colors true sets the importer's
            vertex colour option to REPLACE, to see whether the model's vertex colours survive the import
  quads     spawns a plane static mesh per sheet with its material at config.quads[{"name", "material", "location", "rotation" (roll, pitch, yaw), "scale"}]
  inspect   reads back what is under <mount>/AgentEngine (classes, counts) and the placed actors
No project name is written here: the mount and level come from the config.
"""
import hashlib
import json
import os
import traceback

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = json.load(open(os.path.join(HERE, "sample_scene_config.json"), encoding="utf-8"))
MOUNT = CONFIG["mount"]
FOLDER = MOUNT + "/AgentEngine"
REPORT = {"phase": CONFIG["phase"], "steps": [], "errors": []}
EAL = unreal.EditorAssetLibrary


def step(name, **fields):
    REPORT["steps"].append(dict(step=name, **fields))


def guard():
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world().get_path_name().split(".")[0]
    if world != CONFIG["level"]:
        raise RuntimeError("wrong loaded world: " + world)
    step("guard", world=world)


def registry(path):
    reg = unreal.AssetRegistryHelpers.get_asset_registry()
    return [(str(a.asset_name), str(a.asset_class_path.asset_name)) for a in reg.get_assets_by_path(path, recursive=True)]


def import_wav(file_name, name, loop):
    source = os.path.join(CONFIG["sources"], file_name)
    data = open(source, "rb").read()
    destination = FOLDER + "/Audio"
    if EAL.does_asset_exist(destination + "/" + name) or EAL.does_asset_exist(destination + "/" + name + "_Cue"):
        raise RuntimeError("destination already exists: " + name)
    before = set(registry(destination)) if EAL.does_directory_exist(destination) else set()
    factory = unreal.SoundFactory()
    for key, value in {"auto_create_cue": True, "include_looping_node": False, "include_attenuation_node": False,
                       "include_modulator_node": False, "cue_package_suffix": "_Cue", "cue_volume": 1.0}.items():
        factory.set_editor_property(key, value)
    task = unreal.AssetImportTask()
    for key, value in {"filename": source, "destination_path": destination, "destination_name": name, "automated": True,
                       "replace_existing": False, "save": False, "factory": factory}.items():
        task.set_editor_property(key, value)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    created = sorted(set(registry(destination)) - before)
    wave = unreal.load_asset(destination + "/" + name)
    cue = unreal.load_asset(destination + "/" + name + "_Cue")
    node = cue.get_editor_property("first_node") if cue else None
    if loop and node is not None:
        node.set_editor_property("looping", True)
    saved = [bool(EAL.save_asset(destination + "/" + name, only_if_is_dirty=False)), bool(EAL.save_asset(destination + "/" + name + "_Cue", only_if_is_dirty=False))]
    step("import_" + name, sha256=hashlib.sha256(data).hexdigest(), created=created,
         duration=round(wave.get_editor_property("duration"), 3) if wave else None,
         channels=wave.get_editor_property("num_channels") if wave else None,
         sample_rate=wave.get_editor_property("imported_sample_rate") if wave else None,
         cue_volume=cue.get_editor_property("volume_multiplier") if cue else None,
         node_class=node.get_class().get_name() if node else None,
         node_looping=node.get_editor_property("looping") if node else None, saved=saved)


def flipbook_material(sheet):
    mel = unreal.MaterialEditingLibrary
    folder = FOLDER + "/Sprites"
    name = "M_" + sheet["name"]
    if EAL.does_asset_exist(folder + "/" + name):
        raise RuntimeError("destination already exists: " + name)
    texture = unreal.load_asset(sheet["texture"])
    texture.set_editor_property("filter", unreal.TextureFilter.TF_NEAREST)
    texture.set_editor_property("mip_gen_settings", unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS)
    material = unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, folder, unreal.Material, unreal.MaterialFactoryNew())
    material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    material.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
    material.set_editor_property("two_sided", True)
    new = lambda cls, x, y: mel.create_material_expression(material, cls, x, y)
    coord, time = new(unreal.MaterialExpressionTextureCoordinate, -1400, 0), new(unreal.MaterialExpressionTime, -1400, 200)
    fps, cells = new(unreal.MaterialExpressionConstant, -1400, 300), new(unreal.MaterialExpressionConstant, -1400, 400)
    fps.set_editor_property("r", float(sheet["fps"]))
    cells.set_editor_property("r", float(sheet["cells"]))
    ticks = new(unreal.MaterialExpressionMultiply, -1200, 200)
    wrapped = new(unreal.MaterialExpressionFmod, -1000, 200)
    frame = new(unreal.MaterialExpressionFloor, -800, 200)
    frame_u = new(unreal.MaterialExpressionDivide, -600, 200)
    u0 = new(unreal.MaterialExpressionComponentMask, -1200, 0)
    u0.set_editor_property("r", True)
    u0.set_editor_property("g", False)
    v0 = new(unreal.MaterialExpressionComponentMask, -1200, 100)
    v0.set_editor_property("r", False)
    v0.set_editor_property("g", True)
    u_cell = new(unreal.MaterialExpressionDivide, -1000, 0)
    u = new(unreal.MaterialExpressionAdd, -400, 100)
    uv = new(unreal.MaterialExpressionAppendVector, -200, 100)
    sample = new(unreal.MaterialExpressionTextureSample, 0, 100)
    sample.set_editor_property("texture", texture)
    connected = []
    for a, ao, b, bi in ((time, "", ticks, "A"), (fps, "", ticks, "B"), (ticks, "", wrapped, "A"), (cells, "", wrapped, "B"), (wrapped, "", frame, ""),
                         (frame, "", frame_u, "A"), (cells, "", frame_u, "B"), (coord, "", u0, ""), (coord, "", v0, ""), (u0, "", u_cell, "A"),
                         (cells, "", u_cell, "B"), (u_cell, "", u, "A"), (frame_u, "", u, "B"), (u, "", uv, "A"), (v0, "", uv, "B")):
        connected.append((type(a).__name__, type(b).__name__, bi, bool(mel.connect_material_expressions(a, ao, b, bi))))
    for pin in ("UVs", "Coordinates", ""):   # the texture sample's UV pin is named differently across builds; take the first that connects
        linked = bool(mel.connect_material_expressions(uv, "", sample, pin))
        if linked:
            break
    connected.append(("MaterialExpressionAppendVector", "MaterialExpressionTextureSample", pin, linked))
    outputs = [bool(mel.connect_material_property(sample, "RGB", unreal.MaterialProperty.MP_EMISSIVE_COLOR)),
               bool(mel.connect_material_property(sample, "A", unreal.MaterialProperty.MP_OPACITY_MASK))]
    mel.recompile_material(material)
    saved = [bool(EAL.save_asset(folder + "/" + name, only_if_is_dirty=False)), bool(EAL.save_asset(sheet["texture"].rsplit(".", 1)[0], only_if_is_dirty=False))]
    step("material_" + name, cells=sheet["cells"], fps=sheet["fps"], expressions=mel.get_num_material_expressions(material),
         outputs=outputs, failed_connections=[c for c in connected if not c[3]], saved=saved)


def vertex_color_material(spec):
    mel = unreal.MaterialEditingLibrary
    path = spec["folder"] + "/" + spec["name"]
    if EAL.does_asset_exist(path):
        raise RuntimeError("destination already exists: " + spec["name"])
    material = unreal.AssetToolsHelpers.get_asset_tools().create_asset(spec["name"], spec["folder"], unreal.Material, unreal.MaterialFactoryNew())
    material.set_editor_property("used_with_skeletal_mesh", True)
    color = mel.create_material_expression(material, unreal.MaterialExpressionVertexColor, -400, 0)
    rough = mel.create_material_expression(material, unreal.MaterialExpressionConstant, -400, 200)
    rough.set_editor_property("r", 0.85)
    base = False
    for pin in ("", "RGB"):   # the vertex colour node's colour output is the unnamed pin on some builds, RGB on others
        base = bool(mel.connect_material_property(color, pin, unreal.MaterialProperty.MP_BASE_COLOR))
        if base:
            break
    linked = [base, bool(mel.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS))]
    mel.recompile_material(material)
    step("vertex_color_material", path=path, linked=linked, skeletal_usage=material.get_editor_property("used_with_skeletal_mesh"), saved=bool(EAL.save_asset(path, only_if_is_dirty=False)))


def import_fbx(spec):
    if EAL.does_directory_exist(spec["folder"]):
        raise RuntimeError("destination already exists: " + spec["folder"])
    options = unreal.FbxImportUI()
    for key, value in {"import_as_skeletal": True, "import_mesh": True, "import_materials": True, "import_textures": True, "import_animations": True}.items():
        options.set_editor_property(key, value)
    if spec.get("vertex_colors"):
        options.skeletal_mesh_import_data.set_editor_property("vertex_color_import_option", unreal.VertexColorImportOption.REPLACE)
    task = unreal.AssetImportTask()
    for key, value in {"filename": spec["file"], "destination_path": spec["folder"], "destination_name": spec["name"], "automated": True,
                       "replace_existing": False, "save": True, "options": options}.items():
        task.set_editor_property(key, value)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    step("import_fbx", asset=spec["name"], vertex_colors=bool(spec.get("vertex_colors")), assets=sorted(registry(spec["folder"])))


def spawn_quads():
    library = unreal.EditorLevelLibrary
    plane = unreal.load_asset("/Engine/BasicShapes/Plane")
    step("plane", found=plane is not None)
    for quad in CONFIG["quads"]:
        material = unreal.load_asset(quad["material"])
        loc, scale = quad["location"], quad["scale"]
        actor = library.spawn_actor_from_object(plane, unreal.Vector(*loc), unreal.Rotator(*quad.get("rotation", [0, 0, 0])))
        actor.set_actor_label(quad["name"])
        actor.set_actor_scale3d(unreal.Vector(*scale))
        actor.set_folder_path("AgentEngine")
        component = actor.get_component_by_class(unreal.StaticMeshComponent)
        component.set_material(0, material)
        step("quad_" + quad["name"], label=actor.get_actor_label(), material=component.get_material(0).get_path_name(), location=[round(v, 1) for v in loc])


def run():
    guard()
    if CONFIG["phase"] == "audio":
        import_wav("survey-drone.wav", "survey_drone", True)
        import_wav("relic-discovered.wav", "relic_discovered", False)
    if CONFIG["phase"] == "materials":
        for sheet in CONFIG["sheets"]:
            flipbook_material(sheet)
    if CONFIG["phase"] == "fbx":
        import_fbx(CONFIG["fbx"])
    if CONFIG["phase"] == "vcolor":
        vertex_color_material(CONFIG["vertex_color_material"])
    if CONFIG["phase"] == "quads":
        spawn_quads()
    if CONFIG["phase"] == "inspect":
        step("assets", items=registry(FOLDER) if EAL.does_directory_exist(FOLDER) else [])
        actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
        step("actors", count=len(actors), labels=sorted(a.get_actor_label() for a in actors)[:80])


try:
    run()
except Exception:
    REPORT["errors"].append(traceback.format_exc()[-1500:])
with open(CONFIG["report"], "w", encoding="utf-8") as fh:
    json.dump(REPORT, fh, indent=2, default=str)
unreal.log("[sample_scene_build] wrote " + CONFIG["report"])
