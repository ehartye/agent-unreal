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

## Landscape in a partitioned map

- [tested] The template has one always-loaded Landscape actor with no components and 64 spatially loaded `LandscapeStreamingProxy` actors (8 by 8); two edit layers.
- [tested] A proxy holds 2 by 2 components of 126 quads: 252 quads, 252 m at 100 cm per quad, per side. All 256 components make 16 by 16, 2017 vertices per side.
- [documented] The grid size counts components per proxy side: `ChangeGridSize` fills a cell with N by N components (`Runtime/Landscape/Private/LandscapeConfigHelper.cpp:135`) and the cell side is N times the component quads (`Runtime/Landscape/Private/LandscapeEdit.cpp:5405`). Epic's [heightmap import page](https://dev.epicgames.com/documentation/en-us/unreal-engine/importing-and-exporting-landscape-heightmaps-in-unreal-engine) words World Partition Grid Size the other way round (proxies per component).
- [tested] `LandscapeGridSize` in the `<map>.ini` the commandlet writes is that number: 4 gave one proxy for a 2 by 2 Landscape of 255-quad components, 1 gave four.
- [tested] Python reaches no grid size: `unreal.LandscapeSubsystem` and `LandscapeInfo` do not exist, `runtime_grid` is the only grid member, quad counts are not properties. [documented] `ChangeGridSize` is a plain C++ function (`Runtime/Landscape/Public/LandscapeSubsystem.h:153`). Edit the ini and convert again.
- [documented] Valid sizes ([Landscape technical guide](https://dev.epicgames.com/documentation/en-us/unreal-engine/landscape-technical-guide-in-unreal-engine)): vertices per side = quads per component times components plus 1; sections a power of two vertices up to 256; at most 1024 components. [tested] All 11 recommended rows satisfy it (pure Node check).
- [tested] In a commandlet no proxy is in the world until `WorldPartitionBlueprintLibrary.load_actors` gets their guids; the rendering editor loaded all 64 at open.
- [tested] In a rendering editor (`-RenderOffScreen`), `landscape.render_heightmap(Transform(), Box2D, target)` into an `RTF_RGBA8` target (float formats return False) gives final heights after `force_layers_full_update()` and 25 s of ticks; height = R*256 + G; Z = Landscape Z + (height - 32768) / 128 * scale Z.
- [tested] Python spawns `LandmassBrushManager` and `CustomBrush_Landmass`, but neither attaches (`get_landscape()` is None); add brushes in Landscape mode.

## Convert and rebuild

- [tested] Conversion exits 1 without `-AllowCommandletRendering` (`The option "-AllowCommandletRendering" is required`).
- [tested] `-ReportOnly` writes no file. `-GenerateIni` writes only `<map>.ini` (`LandscapeGridSize=4`, `CellSize=12800`, runtime hash set) and implies ReportOnly (`Editor/UnrealEd/Private/Commandlets/WorldPartitionConvertCommandlet.cpp:684`).
- [tested] `-ConversionSuffix` writes `<map>_WP` and leaves the source plain; without it the map is converted in place.
- [tested] `WorldPartitionResaveActorsBuilder` exits 0 and saves every actor. The class filter is `-ActorClassName=StaticMeshActor` (`Editor/UnrealEd/Public/WorldPartition/WorldPartitionResaveActorsBuilder.h:8`); the `-ActorClass` of Epic's [builder page](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition-builder-commandlet-reference) is ignored.
- [tested] `WorldPartitionFoliageBuilder -NewGridSize=512` logs `from 25600 to 512` (256 m default) and rewrites the map.
- [tested] `WorldPartitionMiniMapBuilder -AllowCommandletRendering` exits 1 with `-nullrhi` (`render target ... has been released`); without `-nullrhi` it exits 0 with no error and the actor gets a 26 by 2 minimap texture.

## Console commands

- [tested] `DumpConsoleCommands wp.Runtime.` lists `ToggleDrawRuntimeHash2D`, `OverrideRuntimeSpatialHashLoadingRange` and `HLOD`.
- [tested] The variable is `wp.Runtime.MaxLoadingStreamingCells` (default 4, `Runtime/Engine/Private/WorldPartition/WorldPartitionSubsystem.cpp:204`); Epic's `MaxLoadingLevelStreamingCells` is not registered.

## Water in a partitioned map

- [tested] Place water in `UnrealEditor.exe -nullrhi -ExecCmds="py script"` on an editor tick; in `UnrealEditor-Cmd.exe` a River stops the process on a Slate assertion (`CurrentBaseApplication.IsValid`).
- [tested] Water Zone and Ocean are always loaded; Lake and River are spatially loaded; a new actor has `runtime_grid` None and no Data Layers. Brush managers are always loaded (`Runtime/Landscape/Private/LandscapeBlueprintBrushBase.cpp:130`).
- [tested] Do not place a Water Brush Manager: the first body on a Landscape with edit layers adds `Landscape_WaterBrushManager` and a Water edit layer.
- [tested] River: `get_water_spline()` (`clear_spline_points`, `add_spline_point` in `SplineCoordinateSpace.WORLD`), `set_river_width_at_spline_input_key` and `set_river_depth_at_spline_input_key` per point, then `spline.k2_synchronize_and_broadcast_data_change()`. A river at Z -600, depth 400, carved to -1000: bed = Z minus depth.
- [tested] `set_editor_property("is_spatially_loaded", False)` and `("runtime_grid", "MainGrid")` persist in saved descriptors; for a Data Layer use a `DataLayerAsset` (`DataLayerFactory`), `DataLayerEditorSubsystem.create_data_layer_instance`, `add_actor_to_data_layer`.
- [documented] Local Tessellation limits a Water Zone's info texture and quad tree to a window around the view (`Plugins/Experimental/Water/Source/Runtime/Public/WaterZoneActor.h:205`). [tested] `enable_local_only_tessellation` defaults False, `local_tessellation_extent` (51200, 51200, 10000) cm; True persists through save and reopen. An Epic forum [reply](https://forums.unrealengine.com/t/waterzone/2719663) recommends one large zone, streamed bodies and Local Tessellation.
- [tested] `is_component_partitioned` on a PCG volume adds the PCG World Actor (always loaded, 25,600 cm grid) and spatially loaded `PCGPartitionGridActor` actors.

## Not verified

Carving of proxies that are not loaded (the editor loaded every proxy and `unload_actors` did not unload them); attaching a Landmass brush from Python; a PCG graph on a partitioned Landscape; streaming in play.

## Sources

- The Epic pages linked above, engine source, the editor Python surface
