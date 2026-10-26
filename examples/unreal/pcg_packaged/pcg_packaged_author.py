"""Author the content of the packaged PCG probe (Unreal 5.8, editor).

  UnrealEditor.exe Project.uproject -nullrhi -ExecCmds="py <absolute-path-to-this-file>" -unattended -nosplash -nosound -notraceserver
      (in Git Bash set MSYS_NO_PATHCONV=1 or /Game/... is rewritten)
Environment: PCG_REPORT (JSON path, required by pcg_common.Report), PCGP_ROWS ("p1", "p2" or "p1,p2"; default "p1,p2").

It makes the assets, the graphs and the maps that pcg_packaged.mjs then cooks and packages. Nothing here runs in the packaged game.

  /Game/Pcg/SM_ProbeCube    a copy of the engine cube, so the mesh is a project asset
  /Game/Pcg/SM_Orphan       a second copy that nothing references: the control for "what the cook includes"
  /Game/Pcg/M_ProbeUnlit    an unlit material with used_with_instanced_static_meshes set
  /Game/Pcg/PCG_ProbeGrid   Create Points Grid (8 x 8 points) -> Static Mesh Spawner (the cube and the material)
  /Game/Pcg/PCG_ProbeCells  the same grid sized for the whole partitioned volume of row P2, points culled to the volume
  /Game/Maps/PcgRuntime     P1: a PCG World Actor and four volumes: runtime_near (GenerateAtRuntime), on_demand (GenerateOnDemand, the control),
                            runtime_far (GenerateAtRuntime, far away, generation radius made small when Python reaches the property)
  /Game/Maps/PcgNoWorld     P1 control: one GenerateAtRuntime volume and no PCG World Actor
  /Game/Maps/PcgStream      P2: a World Partition map, one partitioned GenerateAtRuntime volume 1,120 m long, markers at both ends, a player start at one end

The same graph is first generated on demand in the editor on a scratch map (the editor baseline: point count and instance count), so the packaged game can be held to the
same numbers. The report records every step and the exact text of any exception, and is written after each phase.
"""
import os
import sys

import unreal

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pcg_game"))
import pcg_common as pc  # noqa: E402

report = pc.Report("pcg-packaged-author.json")
EL = unreal.EditorLevelLibrary
ROWS = [r.strip() for r in os.environ.get("PCGP_ROWS", "p1,p2").split(",") if r.strip()]
MAPS = {"runtime": "/Game/Maps/PcgRuntime", "noworld": "/Game/Maps/PcgNoWorld", "stream": "/Game/Maps/PcgStream"}
TRIGGER = unreal.PCGComponentGenerationTrigger
CELL_GRID_CM = 3200   # the PCG World Actor's partition grid size for row P2 (a valid HiGen grid: 32 m)
STREAM_A = (-50000.0, 0.0, 100.0)
STREAM_B = (50000.0, 0.0, 100.0)
report["rows"] = ROWS
report["warnings"] = []
report["steps"] = {}


def step(name, value):
    report["steps"][name] = value
    report.flush()


def world_actors():
    return [a for a in EL.get_all_level_actors() if isinstance(a, unreal.PCGWorldActor)]


def make_assets():
    """The mesh, the orphan copy, the material."""
    out = {}
    unreal.EditorAssetLibrary.make_directory(pc.PCG_DIR)
    for name in ("SM_ProbeCube", "SM_Orphan"):
        path = pc.PCG_DIR + "/" + name
        if not unreal.EditorAssetLibrary.does_asset_exist(path):
            try:
                unreal.EditorAssetLibrary.duplicate_asset("/Engine/BasicShapes/Cube", path)
            except Exception as exc:
                out[name + "_error"] = str(exc)[:300]
        asset = unreal.EditorAssetLibrary.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else None
        out[name] = {"path": path, "exists": asset is not None, "class": asset.get_class().get_name() if asset else None}
        if asset is not None:
            unreal.EditorAssetLibrary.save_loaded_asset(asset)
    material = pc.make_material("M_ProbeUnlit", (0.0, 1.0, 0.0), True)
    out["M_ProbeUnlit"] = {"path": material.get_path_name(), "flag": bool(material.get_editor_property("used_with_instanced_static_meshes"))}
    return out


def build_graph(name, extents, cell, cull):
    """Create Points Grid -> Static Mesh Spawner. World coordinate space: the grid is centred on the world origin, whichever volume runs the graph."""
    mesh = unreal.load_asset(pc.PCG_DIR + "/SM_ProbeCube")
    material = unreal.load_asset(pc.PCG_DIR + "/M_ProbeUnlit")
    graph = pc.new_graph(name)
    grid, _ = pc.add_node(graph, unreal.PCGCreatePointsGridSettings, report["warnings"],
                          grid_extents=unreal.Vector(*extents), cell_size=unreal.Vector(*cell), cull_points_outside_volume=cull)
    spawner, spawner_settings = pc.add_node(graph, unreal.PCGStaticMeshSpawnerSettings, report["warnings"])
    pc.weighted_mesh_entries(spawner_settings, [(mesh, material, 1)], report["warnings"])
    graph.add_edge(grid, "Out", spawner, "In")
    graph.add_edge(grid, "Out", graph.get_output_node(), "Out")
    unreal.EditorAssetLibrary.save_loaded_asset(graph)
    return graph


def make_volume(label, center, half, trigger, graph, partitioned=False):
    """A PCG volume with the trigger set before the graph, so a GenerateOnLoad default never generates in the editor."""
    vol = EL.spawn_actor_from_class(unreal.PCGVolume, unreal.Vector(*center))
    vol.set_actor_label(label)
    try:
        vol.rename(label)   # the object name is what the packaged game reports; the label does not survive a cook
    except Exception as exc:
        report["warnings"].append({"rename": label, "error": str(exc)[:200]})
    vol.set_actor_scale3d(unreal.Vector(half[0] / pc.BRUSH_HALF, half[1] / pc.BRUSH_HALF, half[2] / pc.BRUSH_HALF))
    comp = vol.get_editor_property("pcg_component")
    comp.set_editor_property("generation_trigger", trigger)
    if partitioned:
        comp.set_editor_property("is_component_partitioned", True)
    comp.set_graph(graph)
    return vol, comp


def try_radius_override(comp, radius_cm):
    """Make the unbounded generation radius small, if Python reaches the struct. Records what it saw; 'applied' is true only when the read-back equals the request."""
    out = {"requested_cm": radius_cm, "applied": False}
    try:
        comp.set_editor_property("override_generation_radii", True)
        radii = comp.get_editor_property("generation_radii")
        out["struct_type"] = type(radii).__name__
        out["radius_members"] = [m for m in dir(radii) if "radius" in m.lower()][:24]
        per_quality = radii.get_editor_property("radius_unbounded")
        out["before"] = str(per_quality)
        per_quality.set_editor_property("default", float(radius_cm))
        radii.set_editor_property("radius_unbounded", per_quality)
        comp.set_editor_property("generation_radii", radii)
        after = comp.get_editor_property("generation_radii").get_editor_property("radius_unbounded")
        out["after"] = str(after)
        out["applied"] = abs(float(after.get_editor_property("default")) - float(radius_cm)) < 1e-3
    except Exception as exc:
        out["error"] = str(exc)[:400]
    return out


def describe_volumes(volumes):
    rows = []
    for vol in volumes:
        comp = vol.get_editor_property("pcg_component")
        rows.append({"label": vol.get_actor_label(), "name": vol.get_name(), "trigger": str(comp.get_editor_property("generation_trigger")),
                     "partitioned": bool(comp.get_editor_property("is_component_partitioned")),
                     "graph": comp.get_graph().get_path_name() if comp.get_graph() else None,
                     "editor_instances": pc.instance_count(vol), "editor_ism_components": len(pc.ism_components(vol))})
    return rows


def ensure_world_actor():
    """Exactly one PCG World Actor in the map: the editor adds its own on some operations, otherwise one is spawned here. Records which."""
    found = world_actors()
    info = {"before": len(found), "spawned_by_script": False}
    if not found:
        EL.spawn_actor_from_class(unreal.PCGWorldActor, unreal.Vector(0, 0, 0))
        info["spawned_by_script"] = True
    info["after"] = len(world_actors())
    return info


def save_current(path, partitioned):
    if partitioned:
        return bool(unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level())
    return bool(unreal.EditorLoadingAndSavingUtils.save_map(EL.get_editor_world(), path))


def stages():
    yield 30
    step("assets", make_assets())
    graph = build_graph("PCG_ProbeGrid", (400.0, 400.0, 50.0), (100.0, 100.0, 100.0), False)
    step("graph", {"path": graph.get_path_name(), "extents": [400, 400, 50], "cell": [100, 100, 100],
                   "expected_points_from_source": 64, "note": "trunc(2*400/100) * trunc(2*400/100) * trunc(2*50/100) = 8 * 8 * 1"})
    if "p2" in ROWS:
        cells_graph = build_graph("PCG_ProbeCells", (56000.0, 1600.0, 50.0), (400.0, 400.0, 100.0), True)
        step("cells_graph", {"path": cells_graph.get_path_name(), "extents": [56000, 1600, 50], "cell": [400, 400, 100], "cull_points_outside_volume": True})

    if "p1" in ROWS:
        # The editor baseline: the same graph generated on demand on a scratch map that is never saved.
        unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
        yield 20
        vol, comp = make_volume("baseline", (0.0, 0.0, 0.0), (200.0, 200.0, 200.0), TRIGGER.GENERATE_ON_DEMAND, graph)
        result = yield from pc.generate_and_count(vol, comp, 90)
        isms = pc.ism_components(vol)
        step("editor_baseline", {"completed": result["completed"], "points": len(result["points"]), "instances": result["instances"],
                                 "ism_components": len(isms), "world_actors_added_by_editor": len(world_actors())})
        EL.destroy_actor(vol)
        yield 10

        # P1 main map.
        unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
        yield 20
        volumes = [
            make_volume("runtime_near", (0.0, 0.0, 0.0), (200.0, 200.0, 200.0), TRIGGER.GENERATE_AT_RUNTIME, graph)[0],
            make_volume("on_demand", (4000.0, 0.0, 0.0), (200.0, 200.0, 200.0), TRIGGER.GENERATE_ON_DEMAND, graph)[0],
        ]
        far_vol, far_comp = make_volume("runtime_far", (100000.0, 0.0, 0.0), (200.0, 200.0, 200.0), TRIGGER.GENERATE_AT_RUNTIME, graph)
        radius = try_radius_override(far_comp, 1000.0)
        volumes.append(far_vol)
        yield 60
        info = {"world_actor": ensure_world_actor(), "radius_override_far": radius}
        yield 30
        info["volumes"] = describe_volumes(volumes)
        info["world_actors_in_map"] = len(world_actors())
        info["saved"] = save_current(MAPS["runtime"], False)
        step("map_runtime", info)
        yield 10

        # P1 control: no PCG World Actor.
        unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
        yield 20
        solo = make_volume("runtime_near", (0.0, 0.0, 0.0), (200.0, 200.0, 200.0), TRIGGER.GENERATE_AT_RUNTIME, graph)[0]
        yield 60
        info = {"world_actors_before_destroy": len(world_actors())}
        for actor in world_actors():
            EL.destroy_actor(actor)
        yield 10
        info["world_actors_in_map"] = len(world_actors())
        info["volumes"] = describe_volumes([solo])
        info["saved"] = save_current(MAPS["noworld"], False)
        info["world_actors_after_save"] = len(world_actors())
        step("map_noworld", info)
        yield 10

    if "p2" in ROWS:
        levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
        created = False
        try:
            created = bool(levels.new_level(MAPS["stream"], True))
        except Exception as exc:
            step("map_stream_error", str(exc)[:400])
        if created:
            yield 30
            cube = unreal.load_asset(pc.PCG_DIR + "/SM_ProbeCube")
            vol, comp = make_volume("runtime_cells", (0.0, 0.0, 0.0), (56000.0, 1600.0, 500.0), TRIGGER.GENERATE_AT_RUNTIME,
                                    unreal.load_asset(pc.PCG_DIR + "/PCG_ProbeCells"), partitioned=True)
            yield 60
            info = {"world_actor": ensure_world_actor()}
            wa = world_actors()
            if wa:
                grid = {"before": wa[0].bp_get_pcg_grid_size()}
                try:
                    wa[0].set_editor_property("partition_grid_size", CELL_GRID_CM)
                except Exception as exc:
                    grid["error"] = str(exc)[:300]
                grid["after"] = wa[0].bp_get_pcg_grid_size()
                info["grid_size_cm"] = grid
            yield 30
            markers = {}
            for key, where in (("A", STREAM_A), ("B", STREAM_B)):
                actor = EL.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(*where))
                actor.set_actor_label("Marker" + key)
                actor.static_mesh_component.set_static_mesh(cube)
                actor.set_actor_scale3d(unreal.Vector(10.0, 10.0, 10.0))
                try:
                    markers[key] = {"spatially_loaded": str(actor.get_editor_property("is_spatially_loaded")), "runtime_grid": str(actor.get_editor_property("runtime_grid"))}
                except Exception as exc:
                    markers[key] = {"error": str(exc)[:200]}
            start = EL.spawn_actor_from_class(unreal.PlayerStart, unreal.Vector(*STREAM_A))
            info["markers"] = markers
            info["player_start"] = start is not None
            info["volumes"] = describe_volumes([vol])
            info["a"] = list(STREAM_A)
            info["b"] = list(STREAM_B)
            info["grid_cm"] = CELL_GRID_CM
            info["volume_half_extents_cm"] = [56000, 1600, 500]
            info["world_actors_in_map"] = len(world_actors())
            info["saved"] = save_current(MAPS["stream"], True)
            step("map_stream", info)
            yield 10
    report["done"] = True


pc.run_stages(stages, report)
unreal.log("[pcg_packaged_author] stages registered")
