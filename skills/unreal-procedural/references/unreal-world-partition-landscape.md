# World Partition Landscape in Unreal 5.8: proxy grid, grid size, reading heights back, unloaded proxies and PCG

Target: Unreal Engine 5.8, Windows. Companion to [World Partition](unreal-world-partition.md), which covers the partitioned map, converting and rebuilding from scripts, console commands and Water. These are the facts about the Landscape inside a partitioned map. `examples/unreal/world/world_validate.mjs` re-checks the first set; the last two sections ran on 5.8.3 in [`examples/unreal/landscape_bridge`](../../../examples/unreal/landscape_bridge/README.md) (`landscape_world.mjs`). Paths are under `Engine/Source/`, or `Engine/` when they start with `Plugins/`.

## Landscape in a partitioned map

- [tested] The template has one always-loaded Landscape actor with no components and 64 spatially loaded `LandscapeStreamingProxy` actors (8 by 8); two edit layers.
- [tested] A proxy holds 2 by 2 components of 126 quads: 252 quads, 252 m at 100 cm per quad, per side. All 256 components make 16 by 16, 2017 vertices per side.
- [documented] The grid size counts components per proxy side: `ChangeGridSize` fills a cell with N by N components (`Runtime/Landscape/Private/LandscapeConfigHelper.cpp:135`) and the cell side is N times the component quads (`Runtime/Landscape/Private/LandscapeEdit.cpp:5405`). Epic's [heightmap import page](https://dev.epicgames.com/documentation/en-us/unreal-engine/importing-and-exporting-landscape-heightmaps-in-unreal-engine) words World Partition Grid Size the other way round (proxies per component).
- [tested] `LandscapeGridSize` in the `<map>.ini` the commandlet writes is that number: 4 gave one proxy for a 2 by 2 Landscape of 255-quad components, 1 gave four.
- [tested] Python reaches no grid size: `unreal.LandscapeSubsystem` and `LandscapeInfo` do not exist, `runtime_grid` is the only grid member, quad counts are not properties. [documented] `ChangeGridSize` is a plain C++ function (`Runtime/Landscape/Public/LandscapeSubsystem.h:153`). Edit the ini and convert again.
- [documented] Valid sizes ([Landscape technical guide](https://dev.epicgames.com/documentation/en-us/unreal-engine/landscape-technical-guide-in-unreal-engine)): vertices per side = quads per component times components plus 1; sections a power of two vertices up to 256; at most 1024 components. [tested] All 11 recommended rows satisfy it (pure Node check).
- [tested] In a commandlet no proxy is in the world until `WorldPartitionBlueprintLibrary.load_actors` gets their guids; the rendering editor loaded all 64 at open.
- [tested] In a rendering editor (`-RenderOffScreen`), `landscape.render_heightmap(Transform(), Box2D, target)` into an `RTF_RGBA8` target (float formats return False) gives final heights after `force_layers_full_update()` and 25 s of ticks; height = R*256 + G; Z = Landscape Z + (height - 32768) / 128 * scale Z.
- [tested] Python spawns `LandmassBrushManager` and `CustomBrush_Landmass`, but neither attaches (`get_landscape()` is None). On 5.8.3 the bridge function `attach_brush_to_layer` attached a manager to edit layer 0; the run, the cause and the heights are in [Landmass](unreal-landmass.md). Otherwise add brushes in Landscape mode.

## Proxies that are not loaded

Run on 5.8.3 in a `-nullrhi` and a rendering editor, one throwaway project: a Landscape from the bridge module (505 by 505 vertices, 4 by 4 components, grid size 2: 4 proxies), saved as a partitioned map.

- [tested] After `load_map` of that saved map: loaded proxies 0, loaded Landscape actors 1, proxy descriptors 4, unloaded proxies 4, in both editors. The template map above was loaded in full by a rendering editor at open; these runs did not isolate why the two maps differ.
- [tested] `WorldPartitionBlueprintLibrary.unload_actors` on guids that `load_actors` had not loaded changed nothing (0 loaded before and after). `load_actors` on the four proxies, then `unload_actors`: loaded proxies 4, then 0 (unloaded 4). From Python a proxy can be left unloaded.
- [documented] `UWorldPartitionBlueprintLibrary::UnloadActors` removes only guids that `LoadActors` added in the same session (`Engine/Source/Runtime/Engine/Private/WorldPartitionBlueprintLibrary.cpp`).
- [tested] The `bDisableLoadingOfLastLoadedRegions` user setting was not exposed to Python (exposed false; every read and write returned null).
- Not covered by these runs: carving heights through unloaded proxies, the Open World template Landscape.

## PCG on a partitioned Landscape

Same project and Landscape (each cell's Landscape data listed the 4 proxies). Graph: Get Landscape Data, Surface Sampler (0.005 points per square metre, extents 50), Transform Points, Static Mesh Spawner (a cube); a 504 m square volume over the Landscape. Setting `is_component_partitioned` True stuck; the PCG World Actor's grid was 25600 cm, and the volume made 4 partition actors, each with a local component.

- [tested] Rendering editor: the non-partitioned control completed with 1209 points and 1209 instances. The partitioned volume gave 1209 points over 4 cells (289, 303, 302, 315; ratio to the control 1.0), instances equal to points on each cell, 0 instances on the volume and 0 points on the original component. Each cell received one Landscape data listing the 4 proxies.
- [tested] Sampled points sat within 0.37 cm (maximum) of the input surface in the control (mean 0.13 cm over 403 sampled) and in the partitioned run (maximum). The completion event of the original component fired 0 s after the call; the cells were read 0.3 s later.
- [tested] `-nullrhi` editor: the same graph gave 0 points in the control and in all four cells, with the Landscape data present (one per cell listing 4 proxies), the completion event at 0.1 s, 0 instances and no LogPCG lines. Variants that also gave 0: sampler density 0.05, `unbounded` True, `use_legacy_grid_creation_method` True, and a Python-spawned PCG World Actor with `pcg.BuildLandscapeCache` run first. A variant run in a `-RenderOffScreen` editor without the full flow (the stage did not wait for the edit-layer merge) also read 0. The cause is not isolated.
- [tested] The earlier 5.8.2 runs of [`examples/unreal/pcg_game`](../../../examples/unreal/pcg_game/README.md) gave points on a copied engine sample Landscape in `-nullrhi` editors (2,401 points in the Perlin cases of [PCG in a running game](unreal-pcg-game-process.md)). The cause of the difference from the bridge runs above is not isolated.
- [documented] `UPCGLandscapeData::ProjectPoint` returns false when the PCG subsystem's landscape cache is null or the cache entry for the component is absent (`Engine/Plugins/PCG/Source/PCG/Private/Data/PCGLandscapeData.cpp`). These runs did not tie it to the 0 points. Defaults: Get Landscape Data has actor selector filter `Self`, `unbounded` True, `get_layer_weights` True; Surface Sampler has 0.1 points per square metre and `unbounded` False.

## Sources

- The Epic pages linked above, engine source, the editor Python surface
