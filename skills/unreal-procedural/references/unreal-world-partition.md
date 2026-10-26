# World Partition in Unreal 5.8: building and automating a large world

Target: Unreal Engine 5.8, Windows. World Partition stores a level as one file per actor and streams grid cells by distance from a streaming source ([World Partition](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition-in-unreal-engine)). It covers the partitioned map, its Landscape, and converting and rebuilding from scripts. Paths are under `Engine/Source/`, or `Engine/` when they start with `Plugins/`.

## Use it when

- The world is too large to keep loaded, or a script or CI job must create, convert or rebuild maps.
- Order: partitioned map, terrain ([Landmass](unreal-landmass.md), [Water](unreal-water.md)), read heights back, scatter with [PCG](unreal-pcg.md).
- A level that fits in memory needs no partition: `new_level(path)` makes a plain map.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Blank partitioned map | Python, editor or commandlet | `unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).new_level("/Game/Maps/X", True)` |
| Map with a Landscape | Python | `EditorLoadingAndSavingUtils.load_map("/Engine/Maps/Templates/OpenWorld")`, then `save_map(world, "/Game/Maps/X")` |
| Convert a plain map | Commandlet | `UnrealEditor-Cmd.exe Project -run=WorldPartitionConvertCommandlet /Game/Maps/Map -SCCProvider=None -ConversionSuffix -AllowCommandletRendering -nullrhi` |
| Rebuild data | Commandlet | `-run=WorldPartitionBuilderCommandlet <map> -builder=<Name> -SCCProvider=None` |

Workflow: create or convert, confirm `get_actor_descs()` returns descriptors, shape and fill, rebuild. `examples/unreal/world/world_validate.mjs` re-checks these facts.

## Partitioned map

- [tested] `new_level(path, True)` returns True and makes a partitioned map in `UnrealEditor.exe -nullrhi -ExecCmds="py ..."`, in `UnrealEditor-Cmd.exe -run=pythonscript` and in `-ExecutePythonScript`; all exit 0. It writes the map, two `<Map>_HLODLayer_*` assets, two actor files.
- [tested] The blank map holds an always-loaded Data Layers actor and minimap actor, no Landscape, proxies, sky or lights. The Open World template has 138: Landscape, 64 proxies, 64 HLOD actors, sun, sky, fog, clouds.
- [tested] Python's `World` has no partition property. `get_actor_descs()` returns descriptors for a partitioned map, unloaded actors included (`is_spatially_loaded`, `runtime_grid`, `data_layer_assets`), none for a plain map.
- [tested] `new_level` on an existing path returns False and logs `An asset already exists at this location.`; a commandlet that logs it exits 1.
- [tested] Python creates no Landscape: `Landscape` and `LandscapeProxy` expose only heightmap and weightmap render-target import and export. Use the template ([documented] a 2 km by 2 km Landscape) or convert a Landscape map.

The template Landscape, its proxy grid and grid size, reading heights back, Landmass brushes, unloaded proxies and PCG on a partitioned Landscape: [World Partition Landscape](unreal-world-partition-landscape.md).

Converting a plain map, the builder commandlets and the `wp.Runtime` console commands: [World Partition commandlets](unreal-world-partition-commandlets.md).

## Water in a partitioned map

- [tested] Place water in `UnrealEditor.exe -nullrhi -ExecCmds="py script"` on an editor tick; in `UnrealEditor-Cmd.exe` a River stops the process on a Slate assertion (`CurrentBaseApplication.IsValid`).
- [tested] Water Zone and Ocean are always loaded; Lake and River are spatially loaded; a new actor has `runtime_grid` None and no Data Layers. Brush managers are always loaded (`Runtime/Landscape/Private/LandscapeBlueprintBrushBase.cpp:130`).
- [tested] Do not place a Water Brush Manager: the first body on a Landscape with edit layers adds `Landscape_WaterBrushManager` and a Water edit layer.
- [tested] River: `get_water_spline()` (`clear_spline_points`, `add_spline_point` in `SplineCoordinateSpace.WORLD`), `set_river_width_at_spline_input_key` and `set_river_depth_at_spline_input_key` per point, then `spline.k2_synchronize_and_broadcast_data_change()`. A river at Z -600, depth 400, carved to -1000: bed = Z minus depth.
- [tested] `set_editor_property("is_spatially_loaded", False)` and `("runtime_grid", "MainGrid")` persist in saved descriptors; for a Data Layer use a `DataLayerAsset` (`DataLayerFactory`), `DataLayerEditorSubsystem.create_data_layer_instance`, `add_actor_to_data_layer`.
- [documented] Local Tessellation limits a Water Zone's info texture and quad tree to a window around the view (`Plugins/Experimental/Water/Source/Runtime/Public/WaterZoneActor.h:205`). [tested] `enable_local_only_tessellation` defaults False, `local_tessellation_extent` (51200, 51200, 10000) cm; True persists through save and reopen. An Epic forum [reply](https://forums.unrealengine.com/t/waterzone/2719663) recommends one large zone, streamed bodies and Local Tessellation.
- [tested] `is_component_partitioned` on a PCG volume adds the PCG World Actor (always loaded, 25,600 cm grid) and spatially loaded `PCGPartitionGridActor` actors.
- [tested] Streaming in play, on 5.8.4 in a cooked Development game (one throwaway project, PCG World Actor partition grid 3200 cm): two spatially loaded markers 1,000 m apart loaded and unloaded as a pawn that was the streaming source travelled between them, with 2 of 2 streaming levels loaded at each hold. A partitioned `GENERATE_AT_RUNTIME` volume generated cells near the pawn and cleaned them up behind it. Details: [PCG in a cooked game](unreal-pcg-cooked-game.md).

## Not verified

Carving of proxies that are not loaded was not covered by these runs. In the template map the editor loaded every proxy and `unload_actors` unloaded none; in a bridge-made map `load_actors` then `unload_actors` left four proxies unloaded (see [World Partition Landscape](unreal-world-partition-landscape.md)). Streaming in play was run only for the PCG case in the bullet above. On 5.8.4, attaching a Landmass brush (the three Python routes tried did not attach; a bridge function did) and a PCG graph on a partitioned Landscape (1209 points over 4 cells in a rendering editor, 0 in `-nullrhi` editors) are in the same reference and [Landmass](unreal-landmass.md); the Open World template Landscape, brushes with a spline and Water were not covered there.

## Sources

- The Epic pages linked above, engine source, the editor Python surface
