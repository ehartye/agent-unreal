"""Place Water, Landmass and PCG actors in a World Partition map and read back how each is partitioned (Unreal 5.8, editor).

  UnrealEditor.exe Project.uproject -nullrhi -ExecCmds="py <absolute-path-to-this-file>" -unattended -nosplash -nosound -notraceserver
Environment: WORLD_SRC (default /Game/Maps/WorldLarge), WORLD_DST (default /Game/Maps/WorldPlaced), WORLD_REPORT (JSON path).
Needs the editor, not the commandlet: spawning a water body in UnrealEditor-Cmd.exe stops on a Slate assertion
(CurrentBaseApplication.IsValid) raised from LandscapeEditor. -nullrhi is enough, there is no rendering in this script.
world_place_commandlet.py reproduces that stop.

It places a Water Zone, a second actor through the Water Mesh Actor class name, a River, a second River that is moved out of spatial
loading onto a runtime grid and into a Data Layer, the Landmass brush manager and a Landmass brush, and a PCG volume set to partitioned. After each spawn it reads is_spatially_loaded, runtime_grid and the data layers. It saves the
map under a new name, reopens it, and reads the actor descriptors again, which also shows the actors that the engine added by itself
(the Water brush manager, the PCG World Actor and the PCG partition grid actors).
"""
import json
import os
import re
import traceback

import unreal

SRC = os.environ.get("WORLD_SRC", "/Game/Maps/WorldLarge")
DST = os.environ.get("WORLD_DST", "/Game/Maps/WorldPlaced")
REPORT = os.environ.get("WORLD_REPORT", "world-place.json").replace("\\", "/")
EL = unreal.EditorLevelLibrary
WPL = unreal.WorldPartitionBlueprintLibrary
LANDMASS = "/Landmass/Landscape/BlueprintBrushes/"
report = {"engine": unreal.SystemLibrary.get_engine_version(), "src": SRC, "dst": DST, "placed": {}}


def flush():
    os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=2, default=str)


def cls_name(desc):
    found = re.search(r"\.(\w+)'", str(desc.native_class))
    return found.group(1) if found else str(desc.native_class)


def read(actor):
    out = {"class_path": actor.get_class().get_path_name(), "label": actor.get_actor_label()}
    for prop in ("is_spatially_loaded", "runtime_grid", "data_layer_assets"):
        try:
            out[prop] = str(actor.get_editor_property(prop))
        except Exception as exc:
            out[prop] = "unreadable: " + str(exc)[:80]
    return out


def spawn(key, cls, location=unreal.Vector(0, 0, 0)):
    actor = EL.spawn_actor_from_class(cls, location)
    report["placed"][key] = read(actor) if actor else {"spawned": False}
    flush()
    return actor


def edit_layers(landscape):
    return [str(e.get_name_bp()) for e in landscape.get_edit_layers_bp()]


def place():
    unreal.EditorLoadingAndSavingUtils.load_map(SRC)
    land = [a for a in EL.get_all_level_actors() if isinstance(a, unreal.Landscape)][0]
    report["edit_layers_before"] = edit_layers(land)
    report["pcg_world_actors_before"] = len([a for a in EL.get_all_level_actors() if isinstance(a, unreal.PCGWorldActor)])
    names_before = {a.get_name() for a in EL.get_all_level_actors()}

    manager = spawn("landmass_manager", unreal.EditorAssetLibrary.load_blueprint_class(LANDMASS + "LandmassBrushManager"), unreal.Vector(0, 20000, 0))
    spawn("landmass_brush", unreal.EditorAssetLibrary.load_blueprint_class(LANDMASS + "CustomBrush_Landmass"), unreal.Vector(0, 20000, 0))
    report["landmass_manager_target"] = str(manager.get_landscape())
    report["landscape_brush_members"] = [m for m in dir(unreal.Landscape) if "brush" in m.lower()]
    verbs = re.compile(r"create|import|export|spawn|new_|build")
    report["landscape_creation_members"] = sorted({m for cls in (unreal.Landscape, unreal.LandscapeProxy) for m in dir(cls)
                                                   if m not in set(dir(unreal.Actor)) and not m.startswith("_") and verbs.search(m)})

    spawn("water_zone", unreal.WaterZone)
    alias = spawn("water_mesh_actor", unreal.WaterMeshActor)
    report["water_mesh_actor_is_zone"] = unreal.WaterMeshActor.static_class().get_path_name() == unreal.WaterZone.static_class().get_path_name()
    if alias:
        EL.destroy_actor(alias)
    river = spawn("river", unreal.WaterBodyRiver, unreal.Vector(-30000, 0, 0))
    spline = river.get_water_spline()
    spline.clear_spline_points(True)
    for x, y in [(-30000, 0), (-10000, 2000), (10000, -2000), (30000, 0)]:
        spline.add_spline_point(unreal.Vector(x, y, 0), unreal.SplineCoordinateSpace.WORLD, True)
    report["edit_layers_after"] = edit_layers(land)

    # A second river with its partition settings changed: always loaded, on the map's runtime grid, in a Data Layer.
    tuned = spawn("river_tuned", unreal.WaterBodyRiver, unreal.Vector(0, 10000, 0))
    tuned.set_actor_label("RiverTuned")
    tuned.set_editor_property("is_spatially_loaded", False)
    tuned.set_editor_property("runtime_grid", "MainGrid")
    layer_asset = unreal.AssetToolsHelpers.get_asset_tools().create_asset("DL_Water", "/Game/DataLayers", unreal.DataLayerAsset, unreal.DataLayerFactory())
    params = unreal.DataLayerCreationParameters()
    params.set_editor_property("data_layer_asset", layer_asset)
    layers = unreal.get_editor_subsystem(unreal.DataLayerEditorSubsystem)
    report["data_layer_added"] = bool(layers.add_actor_to_data_layer(tuned, layers.create_data_layer_instance(params)))
    report["river_tuned_after"] = read(tuned)

    volume = spawn("pcg_volume", unreal.PCGVolume)
    volume.set_actor_scale3d(unreal.Vector(100, 100, 20))
    comp = volume.get_editor_property("pcg_component")
    report["pcg_partitioned_before"] = bool(comp.get_editor_property("is_component_partitioned"))
    comp.set_editor_property("is_component_partitioned", True)
    report["pcg_partitioned_after"] = bool(comp.get_editor_property("is_component_partitioned"))
    world_actors = [a for a in EL.get_all_level_actors() if isinstance(a, unreal.PCGWorldActor)]
    report["pcg_world_actors_after"] = len(world_actors)
    if world_actors:
        report["pcg_grid_size_cm"] = world_actors[0].bp_get_pcg_grid_size()
    report["water_brush_manager_class"] = [a.get_class().get_path_name() for a in EL.get_all_level_actors() if a.get_class().get_name() == "WaterBrushManager"][:1]
    report["added_by_engine"] = sorted(a.get_name() for a in EL.get_all_level_actors()
                                       if a.get_name() not in names_before and a.get_class().get_name() in ("WaterBrushManager", "PCGWorldActor"))
    report["save_as"] = bool(unreal.EditorLoadingAndSavingUtils.save_map(EL.get_editor_world(), DST))
    flush()

    unreal.EditorLoadingAndSavingUtils.load_map(DST)
    interesting = ("WaterZone", "WaterBodyRiver", "WaterBrushManager", "LandmassBrushManager_C", "CustomBrush_Landmass_C", "PCGVolume", "PCGWorldActor", "PCGPartitionGridActor")
    descs = list(WPL.get_actor_descs())
    report["descriptors_after_reload"] = [{"class": cls_name(d), "label": str(d.label), "spatially_loaded": bool(d.is_spatially_loaded),
                                           "runtime_grid": str(d.runtime_grid), "data_layers": str(d.data_layer_assets)}
                                          for d in descs if any(str(d.label).startswith(k.replace("_C", "")) or cls_name(d) == k for k in interesting)]


state = {"t": 0.0, "done": False}


def tick(dt):
    if state["done"]:
        return
    state["t"] += dt
    if state["t"] < 3.0:
        return
    state["done"] = True
    try:
        place()
    except Exception:
        report["error"] = traceback.format_exc()[-900:]
    flush()
    unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")


unreal.register_slate_post_tick_callback(tick)
