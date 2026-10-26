# World Partition commandlets in Unreal 5.8: converting a map, the builders and the runtime console commands

Target: Unreal Engine 5.8, Windows. Companion to [World Partition](unreal-world-partition.md), which covers the partitioned map, the driving table and Water. These are the facts about converting a plain map, rebuilding with the builder commandlets and the `wp.Runtime` console commands. `examples/unreal/world/world_validate.mjs` re-checks them. Paths are under `Engine/Source/`, or `Engine/` when they start with `Plugins/`.

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

## Sources

- The Epic pages linked above, engine source, the editor Python surface
