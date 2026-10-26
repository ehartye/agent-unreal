# World Partition Landscape in Unreal 5.8: proxy grid, grid size and reading heights back

Target: Unreal Engine 5.8, Windows. Companion to [World Partition](unreal-world-partition.md), which covers the partitioned map, converting and rebuilding from scripts, console commands and Water. These are the facts about the Landscape inside a partitioned map. `examples/unreal/world/world_validate.mjs` re-checks them. Paths are under `Engine/Source/`, or `Engine/` when they start with `Plugins/`.

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

## Sources

- The Epic pages linked above, engine source, the editor Python surface
