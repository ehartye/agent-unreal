"""Build maps that differ only in the PCG World Actor and its Landscape cache, plus two materials (Unreal 5.8, editor).

  UnrealEditor.exe Project.uproject /Game/Maps/PcgBase -nullrhi -ExecCmds="py <absolute-path-to-this-file>" -unattended -nosplash -nosound -notraceserver
      (in Git Bash set MSYS_NO_PATHCONV=1 or /Game/... is rewritten)
Environment: PCG_REPORT (JSON path). Start from the map that pcg_maps.py copies. Each map holds two PCG volumes over the Landscape
(one spawns cubes with a material that has used_with_instanced_static_meshes set, the other with a material that does not), a camera and
no generated output; pcg_game_run.py generates in a game process and reports.

  /Game/Maps/PcgNoWorld   no PCGWorldActor at all
  /Game/Maps/PcgSpawned   a PCGWorldActor spawned from Python (unreal.PCGWorldActor), default cache mode (NeverSerialize)
  /Game/Maps/PcgCacheOff  the PCGWorldActor that the editor adds itself on the first generation, default cache mode
  /Game/Maps/PcgModeOnly  the same, with serialization_mode ALWAYS_SERIALIZE but no cache build
  /Game/Maps/PcgCacheOn   the same, with serialization_mode ALWAYS_SERIALIZE and a cache built by the console command pcg.BuildLandscapeCache

A short generation first finds the terrain height, so the volumes and the camera sit on the ground. The editor adds a PCGWorldActor by itself on
a generation (UPCGSubsystem::GetPCGWorldActor creates one outside runtime and PIE); the report counts the actors in each saved map.
"""
import os
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pcg_common as pc  # noqa: E402

report = pc.Report("pcg-build.json")
EL = unreal.EditorLevelLibrary
MAPS = {"nw": "/Game/Maps/PcgNoWorld", "sp": "/Game/Maps/PcgSpawned", "off": "/Game/Maps/PcgCacheOff",
        "mode": "/Game/Maps/PcgModeOnly", "on": "/Game/Maps/PcgCacheOn"}
SPOTS = {"flagged": (-1800.0, 0.0), "unflagged": (1800.0, 0.0)}   # volume centres in x, y (cm); each volume is 24 m by 24 m
HALF = 1200.0


def pcg_world_actors():
    return [a for a in EL.get_all_level_actors() if isinstance(a, unreal.PCGWorldActor)]


def stages():
    yield 30
    unreal.EditorAssetLibrary.make_directory(pc.PCG_DIR)
    cube = unreal.load_asset("/Engine/BasicShapes/Cube")
    mats = {"flagged": pc.make_material("M_Flagged", (1.0, 0.0, 0.0), True), "unflagged": pc.make_material("M_Unflagged", (0.0, 1.0, 0.0), False)}
    report["materials"] = {k: {"path": m.get_path_name(), "used_with_instanced_static_meshes": bool(m.get_editor_property("used_with_instanced_static_meshes"))}
                           for k, m in mats.items()}
    steps = [(unreal.PCGSurfaceSamplerSettings, {"points_per_squared_meter": 0.04, "point_extents": unreal.Vector(50, 50, 50)}),
             (unreal.PCGTransformPointsSettings, {"scale_min": unreal.Vector(2.5, 2.5, 2.5), "scale_max": unreal.Vector(3.5, 3.5, 3.5)})]
    graphs = {k: pc.build_variant("PCG_Game_" + k, steps, spawner=(cube, mats[k]))[0] for k in mats}
    unreal.EditorAssetLibrary.save_directory(pc.PCG_DIR)

    # terrain height at each spot: generate a ground-hugging graph once and average z
    ground = {}
    probe_graph = pc.build_variant("PCG_Ground", [steps[0]])[0]
    for key, (x, y) in SPOTS.items():
        vol, comp = pc.spawn_volume("ground_" + key, unreal.Vector(x, y, -900), HALF, HALF, 3000, probe_graph)
        res = yield from pc.generate_and_count(vol, comp)
        zs = [p[2] for p in res["points"]]
        ground[key] = {"points": len(zs), "z_mean": round(sum(zs) / len(zs), 1) if zs else None, "z_min": round(min(zs), 1) if zs else None,
                       "z_max": round(max(zs), 1) if zs else None}
        EL.destroy_actor(vol)
    report["ground"] = ground
    report.flush()
    zmean = sum(g["z_mean"] for g in ground.values()) / len(ground)
    cam_loc = unreal.Vector(0.0, -3600.0, zmean + 1500.0)
    look_at = unreal.Vector(0.0, 0.0, zmean + 100.0)
    cam_rot = unreal.MathLibrary.find_look_at_rotation(cam_loc, look_at)
    report["camera"] = {"location": [cam_loc.x, cam_loc.y, cam_loc.z], "ground_z": round(zmean, 1)}

    # a graph that never reads the Landscape: its generation still makes the editor add the PCGWorldActor, but fills no cache entries
    maker_graph = pc.new_graph("PCG_Maker")
    maker_node, _ = pc.add_node(maker_graph, unreal.PCGCreatePointsGridSettings)
    maker_graph.add_edge(maker_node, "Out", maker_graph.get_output_node(), "Out")

    # an actor spawned from Python is not the one the subsystem registers in the editor: the cache build console command adds another
    unreal.EditorLoadingAndSavingUtils.load_map("/Game/Maps/PcgBase")
    yield 20
    EL.spawn_actor_from_class(unreal.PCGWorldActor, unreal.Vector(0, 0, 0))
    spawned = {"actors_after_spawn": len(pcg_world_actors())}
    pcg_world_actors()[0].get_editor_property("landscape_cache_object").set_editor_property(
        "serialization_mode", unreal.PCGLandscapeCacheSerializationMode.ALWAYS_SERIALIZE)
    unreal.SystemLibrary.execute_console_command(EL.get_editor_world(), "pcg.BuildLandscapeCache")
    yield 60
    spawned["actors_after_build_command"] = len(pcg_world_actors())
    report["python_spawned_then_build"] = spawned
    report.flush()

    sizes = {}
    for variant in ("nw", "sp", "off", "mode", "on"):
        unreal.EditorLoadingAndSavingUtils.load_map("/Game/Maps/PcgBase")
        yield 20
        for actor in pcg_world_actors():
            EL.destroy_actor(actor)
        for key, (x, y) in SPOTS.items():
            pc.spawn_volume("Vol_" + key, unreal.Vector(x, y, zmean), HALF, HALF, 3000, graphs[key])
        cam = EL.spawn_actor_from_class(unreal.CameraActor, cam_loc, cam_rot)
        cam.set_actor_label("ShotCam")
        info = {"world_actors_before": len(pcg_world_actors())}
        if variant == "sp":
            EL.spawn_actor_from_class(unreal.PCGWorldActor, unreal.Vector(0, 0, 0))
        if variant in ("off", "mode", "on"):
            vol, comp = pc.spawn_volume("maker", unreal.Vector(0, 0, zmean), 500.0, 500.0, 3000, maker_graph)
            yield from pc.generate_and_count(vol, comp)   # the generation makes the editor add the PCGWorldActor
            EL.destroy_actor(vol)
            info["world_actors_after_generation"] = len(pcg_world_actors())
        if variant in ("off", "mode", "on", "sp"):
            cache = pcg_world_actors()[0].get_editor_property("landscape_cache_object")
            info["default_mode"] = str(cache.get_editor_property("serialization_mode"))
            if variant in ("mode", "on"):
                cache.set_editor_property("serialization_mode", unreal.PCGLandscapeCacheSerializationMode.ALWAYS_SERIALIZE)
            if variant == "on":
                unreal.SystemLibrary.execute_console_command(EL.get_editor_world(), "pcg.BuildLandscapeCache")
                yield 120
            if variant in ("mode", "on"):
                info["mode_after"] = str(cache.get_editor_property("serialization_mode"))
                info["cache_entry_count"] = cache.get_editor_property("cache_entry_count")
        info["saved"] = bool(unreal.EditorLoadingAndSavingUtils.save_map(EL.get_editor_world(), MAPS[variant]))
        info["world_actors_in_map"] = len(pcg_world_actors())
        info["volumes"] = len([a for a in EL.get_all_level_actors() if isinstance(a, unreal.PCGVolume)])
        sizes[variant] = info
        report["maps"] = sizes
        report.flush()
        yield 10


pc.run_stages(stages, report)
unreal.log("[pcg_build] stages registered")
