"""Probe five editor Python facts headless (Unreal 5.8, commandlet): re-creating a map, property names, soft_set, rotation, plane cuts.

  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
      -abslog=<log path>
Environment: EP_REPORT (JSON report path). The project needs PythonScriptPlugin, EditorScriptingUtilities and GeometryScripting.
The commandlet exit code is 1 on purpose: the script provokes engine errors and records them (the validator reads the log for the
NewLevel error text). Every result is in the report; nothing here needs a rendering editor.

  recreate  delete_asset on a loaded level, new_level on a map that is still on disk, the working order by hand, and H.recreate_map
  names     wrong and right property names on a post-process volume and an exponential height fog component, soft_set on both
  look      Vector has no rotation(); make_rot_from_x makes a camera face a target
  geometry  a plane cut that leaves an empty mesh, the triangle count that shows it, and cuts that work
  instancing  used_with_instanced_static_meshes on materials built without any rendering, saved for ep_flags.py to read back
"""
import json
import os
import sys
import traceback

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import editor_python_helpers as H  # noqa: E402

REPORT = os.environ.get("EP_REPORT", "ep-probe.json").replace("\\", "/")
PROJECT = unreal.SystemLibrary.get_project_directory()
MAP = "/Game/Maps/EpRebuild"
UMAP = PROJECT + "Content/Maps/EpRebuild.umap"
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
eal = unreal.get_editor_subsystem(unreal.EditorAssetSubsystem)
ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
report = {"engine": unreal.SystemLibrary.get_engine_version()}


def attempt(fn):
    try:
        return {"value": fn()}
    except Exception as exc:
        return {"error": str(exc).splitlines()[0][:300]}


def world_name():
    return ues.get_editor_world().get_path_name()


# ---------------------------------------------------------------- 1 recreate a map that exists on disk
def recreate():
    out = {}
    eal.make_directory("/Game/Maps")
    if os.path.exists(UMAP):
        os.remove(UMAP)
    out["first_new_level"] = les.new_level(MAP)
    out["first_save"] = les.save_current_level()
    out["on_disk_after_save"] = os.path.exists(UMAP)
    # the obvious order: delete the loaded level, create again
    out["naive_delete_asset"] = eal.delete_asset(MAP)
    out["on_disk_after_naive_delete"] = os.path.exists(UMAP)
    out["naive_new_level"] = les.new_level(MAP)
    # the working order, by hand: neutral map, delete, remove the file, rescan, create
    les.load_level("/Engine/Maps/Entry")
    out["neutral_world"] = world_name()
    out["neutral_delete_asset"] = eal.delete_asset(MAP)
    out["on_disk_after_neutral_delete"] = os.path.exists(UMAP)
    out["new_level_with_file_on_disk"] = les.new_level(MAP)
    os.remove(UMAP)
    out["new_level_before_rescan"] = les.new_level(MAP)
    unreal.AssetRegistryHelpers.get_asset_registry().scan_paths_synchronous([os.path.dirname(UMAP)], True)
    out["new_level_after_rescan"] = les.new_level(MAP)
    out["world_after_rescan"] = world_name()
    les.save_current_level()
    # the helper, with the level loaded and on disk
    out["helper_created"] = H.recreate_map(MAP)
    out["helper_world"] = world_name()
    out["helper_saved"] = les.save_current_level()
    out["helper_on_disk"] = os.path.exists(UMAP)
    out["helper_created_again"] = H.recreate_map(MAP)
    return out


# ---------------------------------------------------------------- 2 property names
def names():
    out = {}
    fog_actor = eas.spawn_actor_from_class(unreal.ExponentialHeightFog, unreal.Vector(0, 0, 0))
    fog = fog_actor.get_component_by_class(unreal.ExponentialHeightFogComponent)
    ppv = eas.spawn_actor_from_class(unreal.PostProcessVolume, unreal.Vector(0, 0, 0))

    def error_of(obj, name, value):
        try:
            obj.set_editor_property(name, value)
            return None
        except Exception as exc:
            return str(exc).splitlines()[0]

    out["wrong_on_volume_enable_volumetric_fog"] = error_of(ppv, "enable_volumetric_fog", True)
    out["wrong_on_volume_bloom"] = error_of(ppv, "bloom", 1.0)
    out["wrong_on_fog_actor_density"] = error_of(fog_actor, "fog_density", 0.05)
    out["wrong_on_fog_component_volumetric_fog"] = error_of(fog, "volumetric_fog", True)
    out["wrong_on_fog_component_inscattering_color"] = error_of(fog, "fog_inscattering_color", unreal.LinearColor(0.1, 0.1, 0.2, 1))
    out["right_on_fog_component"] = {"enable_volumetric_fog": error_of(fog, "enable_volumetric_fog", True),
                                     "fog_inscattering_luminance": error_of(fog, "fog_inscattering_luminance", unreal.LinearColor(0.1, 0.1, 0.2, 1)),
                                     "fog_density": error_of(fog, "fog_density", 0.03)}
    out["fog_readback"] = {"enable_volumetric_fog": fog.get_editor_property("enable_volumetric_fog"), "fog_density": round(fog.get_editor_property("fog_density"), 4)}
    out["probe_fog_volumetric"] = H.probe(fog, "volumetric_fog")[:8]
    settings = ppv.get_editor_property("settings")
    out["probe_settings_bloom_intensity"] = H.probe(settings, "bloom_intensity")
    out["probe_settings_auto_exposure_min"] = H.probe(settings, "auto_exposure_min")
    warnings = []
    ok_bad = H.soft_set(ppv, "enable_volumetric_fog", True, warnings)
    ok_flag = H.soft_set(settings, "override_bloom_intensity", True, warnings)
    ok_val = H.soft_set(settings, "bloom_intensity", 3.0, warnings)
    ok_wrong_struct = H.soft_set(settings, "bloom", 3.0, warnings)
    ppv.set_editor_property("settings", settings)
    after = ppv.get_editor_property("settings")
    out["soft_set"] = {"wrong_name_returned": ok_bad, "right_name_returned": ok_val and ok_flag, "wrong_struct_name_returned": ok_wrong_struct,
                       "warnings": warnings, "bloom_intensity_readback": round(after.get_editor_property("bloom_intensity"), 3),
                       "override_readback": after.get_editor_property("override_bloom_intensity")}
    # dir() lists script-exposed attributes only; an EditAnywhere property is reached by name
    mat = unreal.AssetToolsHelpers.get_asset_tools().create_asset("M_EpProbe", "/Game/Mat", unreal.Material, unreal.MaterialFactoryNew())
    node = unreal.MaterialEditingLibrary.create_material_expression(mat, unreal.MaterialExpressionCustom, 0, 0)
    out["custom_code_in_dir"] = "code" in dir(node)
    node.set_editor_property("code", "return 1;")
    out["custom_code_readback"] = node.get_editor_property("code")
    return out


# ---------------------------------------------------------------- 3 rotation
def look():
    out = {}
    start, target = unreal.Vector(0, 0, 100), unreal.Vector(1000, 500, 300)
    out["rotation_call"] = attempt(lambda: unreal.Vector(1, 0, 0).rotation())
    direction = target - start
    out["rotator_method"] = str(direction.rotator())
    rot = unreal.MathLibrary.make_rot_from_x(direction)
    out["make_rot_from_x"] = str(rot)
    out["helper"] = str(H.look_at_rotation(start, target))
    out["same_as_rotator_method"] = all(abs(getattr(rot, a) - getattr(direction.rotator(), a)) < 1e-3 for a in ("pitch", "yaw", "roll"))
    cam = eas.spawn_actor_from_class(unreal.CameraActor, start, rot)
    fwd = cam.get_actor_forward_vector()
    length = direction.length()
    out["forward_dot_direction"] = round(fwd.x * direction.x / length + fwd.y * direction.y / length + fwd.z * direction.z / length, 6)
    return out


# ---------------------------------------------------------------- 5 plane cut
P, BO, Q = unreal.GeometryScript_Primitives, unreal.GeometryScript_MeshBooleans, unreal.GeometryScript_MeshQueries


def sphere(steps=16):
    mesh = unreal.new_object(unreal.DynamicMesh)
    P.append_sphere_lat_long(mesh, unreal.GeometryScriptPrimitiveOptions(), unreal.Transform(), 100.0, steps, steps)
    return mesh


def plane_cut(z, flip):
    mesh = sphere()
    options = unreal.GeometryScriptMeshPlaneCutOptions()
    options.set_editor_property("flip_cut_side", flip)
    BO.apply_mesh_plane_cut(mesh, unreal.Transform(unreal.Vector(0, 0, z)), options)
    return mesh


def describe(mesh):
    return {"triangles": H.triangle_count(mesh), "num_triangle_ids": Q.get_num_triangle_i_ds(mesh), "vertices": Q.get_vertex_count(mesh)}


def create(path, mesh):
    asset, outcome = unreal.GeometryScript_NewAssetUtils.create_new_static_mesh_asset_from_mesh(
        mesh, path, unreal.GeometryScriptCreateNewStaticMeshAssetOptions())
    return {"asset": None if asset is None else asset.get_path_name(), "outcome": str(outcome)}


def geometry():
    out = {"sphere": describe(sphere())}
    for z, flip in ((-30, False), (-30, True), (150, False), (150, True), (-150, False), (-150, True)):
        out["cut z=%d flip=%s" % (z, flip)] = describe(plane_cut(z, flip))
    out["create_from_empty_cut"] = create("/Game/Meshes/SM_EpEmptyCut", plane_cut(150, True))
    out["create_from_empty_mesh"] = create("/Game/Meshes/SM_EpNothing", unreal.new_object(unreal.DynamicMesh))
    kept = plane_cut(-30, True)
    out["boulder_base_plane_cut"] = dict(describe(kept), **create("/Game/Meshes/SM_EpBasePlane", kept),
                                         bounds_min_z=round(Q.get_mesh_bounding_box(kept).min.z, 2))
    # the same base with a Boolean: subtract a box that covers the sphere below z = -30
    mesh, box = sphere(), unreal.new_object(unreal.DynamicMesh)
    P.append_box(box, unreal.GeometryScriptPrimitiveOptions(), unreal.Transform(unreal.Vector(0, 0, -130)), 300.0, 300.0, 200.0, 0, 0, 0,
                 unreal.GeometryScriptPrimitiveOriginMode.CENTER)
    BO.apply_mesh_boolean(mesh, unreal.Transform(), box, unreal.Transform(), unreal.GeometryScriptBooleanOperation.SUBTRACT,
                          unreal.GeometryScriptMeshBooleanOptions())
    out["boulder_base_boolean"] = dict(describe(mesh), **create("/Game/Meshes/SM_EpBaseBoolean", mesh),
                                       bounds_min_z=round(Q.get_mesh_bounding_box(mesh).min.z, 2))
    # a faceted sphere (few steps) pushed around by Perlin noise needs no cut at all
    rock = sphere(8)
    options = unreal.GeometryScriptPerlinNoiseOptions()
    layer = options.get_editor_property("base_layer")
    out["noise_layer_fields"] = sorted(layer.to_dict().keys())
    warnings = []
    for name, value in (("magnitude", 18.0), ("frequency", 0.05), ("random_seed", 7)):
        H.soft_set(layer, name, value, warnings)
    options.set_editor_property("base_layer", layer)
    unreal.GeometryScript_MeshDeformers.apply_perlin_noise_to_mesh2(rock, unreal.GeometryScriptMeshSelection(), options)
    out["boulder_noise"] = dict(describe(rock), **create("/Game/Meshes/SM_EpNoiseRock", rock), warnings=warnings)
    return out


# ---------------------------------------------------------------- 6 the instancing usage flag without a render
def instancing():
    out = {}
    factory = unreal.MaterialFactoryNew()
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    for name in ("M_EpCmdPlain", "M_EpCmdFlagged", "M_EpCmdLibrary"):    # a re-run starts from new assets
        if eal.does_asset_exist("/Game/Mat/" + name):
            eal.delete_asset("/Game/Mat/" + name)
    plain = tools.create_asset("M_EpCmdPlain", "/Game/Mat", unreal.Material, factory)
    flagged = tools.create_asset("M_EpCmdFlagged", "/Game/Mat", unreal.Material, factory)
    out["default_flag"] = plain.get_editor_property("used_with_instanced_static_meshes")
    out["helper_changed"] = [p.rsplit(".", 1)[-1] for p in H.allow_instancing([flagged])]
    out["helper_again_changed"] = H.allow_instancing([flagged])
    instancer = H.make_instancer("/Game/BP/BP_EpInstancerProbe")
    for label, mat in (("plain", plain), ("flagged", flagged)):
        comp = eas.spawn_actor_from_class(instancer, unreal.Vector(0, 0, 0)).get_component_by_class(unreal.InstancedStaticMeshComponent)
        comp.set_static_mesh(unreal.load_asset("/Engine/BasicShapes/Sphere"))
        comp.set_material(0, mat)
        comp.add_instance(unreal.Transform())
        out[label + "_flag_after_instances"] = mat.get_editor_property("used_with_instanced_static_meshes")
    out["usage_via_library"] = unreal.MaterialEditingLibrary.has_material_usage(flagged, unreal.MaterialUsage.MATUSAGE_INSTANCED_STATIC_MESHES)
    lib = tools.create_asset("M_EpCmdLibrary", "/Game/Mat", unreal.Material, factory)
    out["set_material_usage"] = str(unreal.MaterialEditingLibrary.set_material_usage(lib, unreal.MaterialUsage.MATUSAGE_INSTANCED_STATIC_MESHES))
    out["library_usage_flag"] = lib.get_editor_property("used_with_instanced_static_meshes")
    out["saved"] = unreal.EditorAssetLibrary.save_directory("/Game/Mat")
    return out


for name, fn in (("recreate", recreate), ("names", names), ("look", look), ("geometry", geometry), ("instancing", instancing)):
    try:
        if name != "recreate":
            les.new_level("/Game/Maps/EpScratch_" + name)
        report[name] = fn()
    except Exception:
        report[name] = {"traceback": traceback.format_exc()[-900:]}

os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
with open(REPORT, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[ep_probe] wrote " + REPORT)
