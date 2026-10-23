"""Build and capture a small map from editor Python with a stage runner (Unreal 5.8, rendering editor).

  UnrealEditor.exe Project.uproject -RenderOffScreen -ExecCmds="py <absolute-path-to-this-file>" -unattended -nosplash -nosound
      -notraceserver -abslog=<log path>
Environment: EP_REPORT (JSON path), EP_SHOT_DIR (folder for the PNG). The project needs PythonScriptPlugin, EditorScriptingUtilities
and GeometryScripting. Do not use -ExecutePythonScript: the editor would exit when the script returns, before the ticks it waits for.

The work is one generator, driven by editor_python_helpers.run_stages. Stages: wait ticks; create the map (twice, the second time
over a map that is on disk); sky, fog and a post-process volume set through soft_set (one wrong name on purpose); a boulder mesh from
a noise-displaced sphere with a plane-cut base, checked with triangle_count before the asset is made; a material with a #define macro
in a Custom node, one with a function in a Custom node, and one that is used by instances; an instanced boulder field; a
SceneCapture2D picture that faces its target; a screenshot and Play-In-Editor start, each waited for by the tick. It reports what each
step returned and quits the editor. The Custom-node compile error is in the log: look for "function definition is not allowed here".
"""
import json
import os
import random
import sys
import time

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import editor_python_helpers as H  # noqa: E402

REPORT = os.environ.get("EP_REPORT", "ep-stages.json").replace("\\", "/")
SHOT_DIR = os.environ.get("EP_SHOT_DIR", os.path.dirname(REPORT) or ".").replace("\\", "/")
PROJECT = unreal.SystemLibrary.get_project_directory()
MAP = "/Game/Maps/EpScene"
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
mel = unreal.MaterialEditingLibrary
RL = unreal.RenderingLibrary
report = {"engine": unreal.SystemLibrary.get_engine_version(), "warnings": []}

# A Custom node body is one function body: a macro is allowed, a helper function is not.
CODE_MACRO = ("#define EP_STEPS 4.0\n#define EP_QUANT(x) (floor((x) * EP_STEPS) / EP_STEPS)\n"
              "float h = saturate(Pos.z * 0.006);\nreturn Tint * (0.35 + 0.65 * EP_QUANT(h));")
CODE_FUNCTION = ("float quant(float x) { return floor(x * 4.0) / 4.0; }\n"
                 "float h = saturate(Pos.z * 0.006);\nreturn Tint * (0.35 + 0.65 * quant(h));")


def make_material(name, code, tint):
    path = "/Game/Mat/" + name
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)
    mat = unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, "/Game/Mat", unreal.Material, unreal.MaterialFactoryNew())
    node = mel.create_material_expression(mat, unreal.MaterialExpressionCustom, -400, 0)
    pos = mel.create_material_expression(mat, unreal.MaterialExpressionWorldPosition, -800, -100)
    color = mel.create_material_expression(mat, unreal.MaterialExpressionConstant3Vector, -800, 100)
    color.set_editor_property("constant", unreal.LinearColor(*tint, 1.0))
    node.set_editor_property("code", code)
    node.set_editor_property("output_type", unreal.CustomMaterialOutputType.CMOT_FLOAT3)
    inputs = []
    for input_name in ("Pos", "Tint"):
        entry = unreal.CustomInput()
        entry.set_editor_property("input_name", input_name)
        inputs.append(entry)
    node.set_editor_property("inputs", inputs)
    mel.connect_material_expressions(pos, "", node, "Pos")
    mel.connect_material_expressions(color, "", node, "Tint")
    mel.connect_material_property(node, "", unreal.MaterialProperty.MP_BASE_COLOR)
    return mat


def pixel_instructions(mat):
    return mel.get_statistics(mat).get_editor_property("num_pixel_shader_instructions")


def rock_asset():
    """Noise-displaced faceted sphere with a flat base: a plane cut that keeps the part above z = -60."""
    P, Q = unreal.GeometryScript_Primitives, unreal.GeometryScript_MeshQueries
    mesh = unreal.new_object(unreal.DynamicMesh)
    P.append_sphere_lat_long(mesh, unreal.GeometryScriptPrimitiveOptions(), unreal.Transform(), 100.0, 8, 8)
    noise = unreal.GeometryScriptPerlinNoiseOptions()
    layer = noise.get_editor_property("base_layer")
    for name, value in (("magnitude", 18.0), ("frequency", 0.05), ("random_seed", 11)):
        H.soft_set(layer, name, value, report["warnings"])
    noise.set_editor_property("base_layer", layer)
    unreal.GeometryScript_MeshDeformers.apply_perlin_noise_to_mesh2(mesh, unreal.GeometryScriptMeshSelection(), noise)
    cut = unreal.GeometryScriptMeshPlaneCutOptions()
    cut.set_editor_property("flip_cut_side", True)
    unreal.GeometryScript_MeshBooleans.apply_mesh_plane_cut(mesh, unreal.Transform(unreal.Vector(0, 0, -60)), cut)
    triangles = H.triangle_count(mesh)
    report["rock"] = {"triangles": triangles, "min_z": round(Q.get_mesh_bounding_box(mesh).min.z, 1)}
    if triangles == 0:
        raise RuntimeError("the cut left an empty mesh")
    options = unreal.GeometryScriptCreateNewStaticMeshAssetOptions()
    for name in ("enable_recompute_normals", "enable_recompute_tangents"):
        options.set_editor_property(name, True)
    asset, outcome = unreal.GeometryScript_NewAssetUtils.create_new_static_mesh_asset_from_mesh(mesh, "/Game/Meshes/SM_EpRock", options)
    report["rock"]["outcome"] = str(outcome)
    return asset


def environment():
    w = report["warnings"]
    sun = eas.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(0, 0, 1000), unreal.Rotator(roll=0, pitch=-35, yaw=40))
    sun_comp = sun.get_component_by_class(unreal.DirectionalLightComponent)
    H.soft_set(sun_comp, "intensity", 8.0, w)
    H.soft_set(sun_comp, "atmosphere_sun_light", True, w)
    eas.spawn_actor_from_class(unreal.SkyAtmosphere, unreal.Vector(0, 0, 0))
    sky = eas.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0, 0, 500))
    H.soft_set(sky.get_component_by_class(unreal.SkyLightComponent), "real_time_capture", True, w)
    fog = eas.spawn_actor_from_class(unreal.ExponentialHeightFog, unreal.Vector(0, 0, 0)).get_component_by_class(unreal.ExponentialHeightFogComponent)
    H.soft_set(fog, "fog_density", 0.004, w)
    H.soft_set(fog, "enable_volumetric_fog", True, w)
    H.soft_set(fog, "volumetric_fog", True, w)            # a wrong name on purpose: it becomes a warning, the build goes on
    ppv = eas.spawn_actor_from_class(unreal.PostProcessVolume, unreal.Vector(0, 0, 0))
    H.soft_set(ppv, "unbound", True, w)
    settings = ppv.get_editor_property("settings")
    for name, value in (("override_auto_exposure_min_brightness", True), ("auto_exposure_min_brightness", 1.8),
                        ("override_auto_exposure_max_brightness", True), ("auto_exposure_max_brightness", 1.8)):
        H.soft_set(settings, name, value, w)
    ppv.set_editor_property("settings", settings)
    floor = eas.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(0, 0, 0))
    floor.static_mesh_component.set_static_mesh(unreal.load_asset("/Engine/BasicShapes/Plane"))
    floor.set_actor_scale3d(unreal.Vector(60, 60, 1))


def stages():
    # 1 the tick: `yield 5` waits five editor ticks, the frame counter moves by five
    frames = unreal.SystemLibrary.get_frame_count()
    yield 5
    report["ticks"] = {"frames_for_yield_5": unreal.SystemLibrary.get_frame_count() - frames}

    # 2 a map that exists on disk is created again
    report["map"] = {"first": H.recreate_map(MAP)}
    les.save_current_level()
    report["map"]["on_disk"] = os.path.exists(PROJECT + "Content/Maps/EpScene.umap")
    report["map"]["second"] = H.recreate_map(MAP)
    report["map"]["world"] = ues.get_editor_world().get_path_name()
    yield 2

    environment()
    rock = rock_asset()

    # 3 materials: a macro compiles, a helper function does not, and the instancing flag is set on a list
    good = make_material("M_EpRock", CODE_MACRO, (0.55, 0.5, 0.45))
    bad = make_material("M_EpRockBad", CODE_FUNCTION, (0.55, 0.5, 0.45))
    auto = make_material("M_EpRockAuto", CODE_MACRO, (0.4, 0.45, 0.55))
    flag_before = good.get_editor_property("used_with_instanced_static_meshes")
    changed = H.allow_instancing([good, "/Game/Mat/M_EpRockBad"])
    mats = {"flag_default": flag_before, "changed": changed, "flag_after": good.get_editor_property("used_with_instanced_static_meshes"),
            "flag_on_unlisted": auto.get_editor_property("used_with_instanced_static_meshes")}
    for label, mat in (("macro", good), ("function", bad)):
        started = time.time()
        mel.recompile_material(mat)
        mats[label] = {"pixel_instructions_same_tick": pixel_instructions(mat), "seconds": round(time.time() - started, 1)}
    mats["has_usage_good"] = mel.has_material_usage(good, unreal.MaterialUsage.MATUSAGE_INSTANCED_STATIC_MESHES)
    report["materials"] = mats
    yield 2

    # 4 an instanced boulder field: one instancer actor class holds the component; two materials, one with the flag set
    instancer = H.make_instancer("/Game/BP/BP_EpInstancer")
    rng = random.Random(5)
    field = {}
    for label, mat, origin in (("flagged", good, -700.0), ("unflagged", auto, 700.0)):
        actor = eas.spawn_actor_from_class(instancer, unreal.Vector(0, origin, 0))
        comp = actor.get_component_by_class(unreal.InstancedStaticMeshComponent)
        comp.set_static_mesh(rock)
        comp.set_material(0, mat)
        field[label + "_flag_after_set_material"] = mat.get_editor_property("used_with_instanced_static_meshes")
        for _ in range(14):
            comp.add_instance(unreal.Transform(unreal.Vector(rng.uniform(-900, 900), rng.uniform(-350, 350), 60.0),
                                               unreal.Rotator(roll=0, pitch=0, yaw=rng.uniform(0, 360)),
                                               unreal.Vector(*(rng.uniform(0.5, 1.2),) * 3)))
        field[label] = comp.get_instance_count()
    report["field"] = field

    # 5 a picture from a camera that faces its target (look_at_rotation), after the sky and shaders had ticks to settle
    world = ues.get_editor_world()
    start, target = unreal.Vector(-2300, 0, 700), unreal.Vector(0, 0, 40)
    rt = RL.create_render_target2d(world, 1280, 720, unreal.TextureRenderTargetFormat.RTF_RGBA8)
    cam = eas.spawn_actor_from_class(unreal.SceneCapture2D, start, H.look_at_rotation(start, target))
    cap = cam.get_editor_property("capture_component2d")
    H.soft_set(cap, "texture_target", rt, report["warnings"])
    H.soft_set(cap, "capture_source", unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR, report["warnings"])
    H.soft_set(cap, "capture_every_frame", True, report["warnings"])
    fwd = cam.get_actor_forward_vector()
    length = (target - start).length()
    report["camera"] = {"forward_dot_target": round(((target - start).dot(fwd)) / length, 5)}
    yield 120
    cap.capture_scene()
    yield 10
    RL.export_render_target(world, rt, SHOT_DIR, "ep-scene.png")
    shot = SHOT_DIR + "/ep-scene.png"
    report["picture"] = {"path": shot, "exists": os.path.exists(shot), "bytes": os.path.getsize(shot) if os.path.exists(shot) else 0}
    report["flag_after_render"] = {"flagged": good.get_editor_property("used_with_instanced_static_meshes"),
                                   "unflagged": auto.get_editor_property("used_with_instanced_static_meshes")}

    # 6 results that arrive on a later tick: a screenshot file, and the Play-In-Editor world
    yield 5
    editor_shot = PROJECT + "Saved/Screenshots/WindowsEditor/ep_editor_view.png"
    if os.path.exists(editor_shot):
        os.remove(editor_shot)
    unreal.AutomationLibrary.take_high_res_screenshot(960, 540, "ep_editor_view.png")
    same_tick = os.path.exists(editor_shot)
    waited = 0
    while waited < 600 and not os.path.exists(editor_shot):
        waited += 1
        yield
    report["screenshot"] = {"exists_same_tick": same_tick, "ticks_waited": waited, "exists_after": os.path.exists(editor_shot)}
    les.editor_request_begin_play()
    same_tick = ues.get_game_world() is not None
    ticks = 0
    while ticks < 1200 and ues.get_game_world() is None:
        ticks += 1
        yield
    report["play"] = {"world_same_tick": same_tick, "ticks_waited": ticks, "world": None if ues.get_game_world() is None else ues.get_game_world().get_path_name()}
    yield 10
    les.editor_request_end_play()
    yield 10
    unreal.EditorAssetLibrary.save_directory("/Game/Mat")


def done(error):
    report["error"] = error
    report["reentered_ticks_skipped"] = RUNNER["reentered"]
    os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=2, default=str)
    unreal.log("[ep_stages] wrote " + REPORT)
    unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")


RUNNER = H.run_stages(stages, done)
