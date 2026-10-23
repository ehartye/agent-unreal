"""Describe saved assets as the editor loads them, so an import or a material build is judged by what was saved, not by the build log.

Run it through probe.mjs (headless editor), or directly:
  UnrealEditor.exe Project.uproject -ExecutePythonScript=<this file> -nullrhi -unattended -nosplash -nosound -notraceserver
Environment:
  PROBE_ASSETS  asset paths, separated by commas or spaces: /Game/Props/SM_Crate (an object path with .SM_Crate works too)
  PROBE_REPORT  absolute path of the JSON report to write

The report is one object keyed by each requested path. A found entry has "status": "found", "class" and the fields of that class:
  StaticMesh                material_slots [{slot, material}], bounds {origin, box_extent, sphere_radius}, nanite_enabled
  Material                  blend_mode, shading_model, two_sided, used_with_nanite, used_with_niagara_sprites,
                            used_with_niagara_ribbons, used_with_niagara_mesh_particles
  MaterialInstanceConstant  parent (asset path or null), scalar_parameters {name: value}
A property the editor cannot read holds the string "unavailable". A path with no asset is {"status": "missing", "reason"}; an asset of
another class is {"status": "unavailable", "reason", "class"}.
"""
import json
import os
import re
import traceback

import unreal


def names_from(text):
    seen = []
    for part in re.split(r"[,;\s]+", text or ""):
        if part and part not in seen:
            seen.append(part)
    return seen


def plain(value):
    """JSON-friendly form of an editor property: enum name, number, bool, string or list."""
    if isinstance(value, unreal.EnumBase):
        return value.name
    return value


def prop(obj, name):
    try:
        return plain(obj.get_editor_property(name))
    except Exception:
        return "unavailable"


def path_of(obj):
    return obj.get_path_name() if obj is not None else None


def vec(v):
    return {"x": v.x, "y": v.y, "z": v.z}


def describe_mesh(mesh):
    slots = []
    for slot in mesh.get_editor_property("static_materials"):
        slots.append({"slot": str(slot.get_editor_property("material_slot_name")),
                      "material": path_of(slot.get_editor_property("material_interface"))})
    bounds = mesh.get_bounds()
    try:
        nanite = bool(mesh.get_editor_property("nanite_settings").get_editor_property("enabled"))
    except Exception:
        nanite = "unavailable"
    return {"material_slots": slots,
            "bounds": {"origin": vec(bounds.origin), "box_extent": vec(bounds.box_extent), "sphere_radius": bounds.sphere_radius},
            "nanite_enabled": nanite}


def describe_material(material):
    return {name: prop(material, name) for name in (
        "blend_mode", "shading_model", "two_sided", "used_with_nanite", "used_with_niagara_sprites",
        "used_with_niagara_ribbons", "used_with_niagara_mesh_particles")}


def describe_instance(instance):
    scalars = {}
    for entry in instance.get_editor_property("scalar_parameter_values"):
        scalars[str(entry.get_editor_property("parameter_info").get_editor_property("name"))] = entry.get_editor_property("parameter_value")
    return {"parent": path_of(instance.get_editor_property("parent")), "scalar_parameters": scalars}


DESCRIBE = ((unreal.StaticMesh, "StaticMesh", describe_mesh), (unreal.Material, "Material", describe_material),
            (unreal.MaterialInstanceConstant, "MaterialInstanceConstant", describe_instance))


def look_up(path):
    if not unreal.EditorAssetLibrary.does_asset_exist(path):
        return {"status": "missing", "reason": "no asset at %s" % path}
    asset = unreal.EditorAssetLibrary.load_asset(path)
    if asset is None:
        return {"status": "unavailable", "reason": "the asset at %s did not load" % path}
    for cls, label, describe in DESCRIBE:
        if isinstance(asset, cls):
            return dict(status="found", **{"class": label}, **describe(asset))
    return {"status": "unavailable", "reason": "no description for class %s" % type(asset).__name__, "class": type(asset).__name__}


report = {}
try:
    requested = names_from(os.environ.get("PROBE_ASSETS"))
    if not requested:
        raise ValueError("PROBE_ASSETS is empty")
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    for path in requested:
        try:
            report[path] = look_up(path)
        except Exception as exc:
            report[path] = {"status": "unavailable", "reason": "%s: %s" % (type(exc).__name__, str(exc)[:300])}
except Exception:
    unreal.log_error("[asset_probe] " + traceback.format_exc())

out = os.environ.get("PROBE_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "probe-asset.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w", encoding="utf-8") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[asset_probe] %d assets, wrote %s" % (len(report), out))
