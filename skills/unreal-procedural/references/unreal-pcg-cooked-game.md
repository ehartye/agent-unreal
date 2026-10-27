# PCG in a cooked game: runtime generation and streaming

Target: Unreal Engine 5.8, Windows (the build pinned in `engine-version.json`). `[tested]` marks a result of [`examples/unreal/pcg_packaged`](../../../examples/unreal/pcg_packaged/README.md): one throwaway code project, one Development Windows package, each map run headless (`-nullrhi`) and rendered (`-RenderOffScreen`), one machine class. `[documented]` marks the engine install (paths under `Engine/Plugins/PCG/Source/PCG/`). What an editor-binary game process needs: [PCG in a running game](unreal-pcg-game-process.md). Modes and radii: [generation modes](unreal-pcg-generation-modes.md).

## Non-partitioned runtime generation

Graph: Create Points Grid, then Static Mesh Spawner. Volume trigger `GENERATE_AT_RUNTIME`.

- [tested] The cooked game (cooked data true, editor false) generated with no script call: 0 instances at the first sample, 64 before the window ended, headless and rendered, one started and one generated event. The editor's on-demand run of the same graph gave 64 points, 64 instances and 1 ISM component, equal to the game's count. The volume kept 1 output item of 64 points.
- [tested] The PCG World Actor saved in the map registered with the subsystem (1 actor). A map from which that actor was removed, with no other added before save, did not generate in either mode, and the log had no line about the world actor or the scheduler.
- [documented] `UPCGSubsystem::Tick` ticks the runtime scheduler only when a PCG World Actor exists (`Private/Subsystems/PCGSubsystem.cpp` lines 425 to 428); the actor registers in `APCGWorldActor::BeginPlay`, which calls `RegisterToSubsystem` (`Private/PCGWorldActor.cpp` lines 187 to 190 and 232 to 237); the editor creates one only outside play (`GetPCGWorldActor`).
- [tested] The generation source reported in the game was the player controller and its pawn (a `DefaultPawn`). [documented] Player controllers are sources while `bTreatPlayerControllersAsGenerationSources` is set (`Private/RuntimeGen/PCGGenSourceManager.cpp` line 203).
- [tested] A `GENERATE_ON_DEMAND` volume had no instances and no started event until the script called `Generate`; that call then gave 64 instances and 1 generated event.
- [tested] A volume 1,000 m from the player, its runtime generation radius set to 10 m, stayed empty (0 instances, 0 generated events). Python applied the override through the `PCGRuntimeGenerationRadii` struct, member `generation_radius` (1000 cm).

## What the cook held

- [tested] With `MapsToCook` as the only cook setting, the project static mesh, the project material and the graph all loaded by object path in the game, and the material on the spawned instances was the project material, not the default material. An unreferenced copy of the mesh did not load by path. Material usage-flag log lines: 0 in the headless run.
- [documented] A folder nothing references is cooked only when listed ([packaging](../../unreal-native/references/unreal-native-packaging.md)).

## Partitioned runtime generation

Setup: a World Partition map from `new_level(path, True)`, PCG World Actor partition grid 3200 cm set from Python (25600 before), a partitioned `GENERATE_AT_RUNTIME` volume 1,120 m long, two spatially loaded markers A and B 1,000 m apart, a pawn that is the streaming and generation source: 12 s at A, 20 s travel, 15 s at B.

- [tested] Every asserted check held in the headless and the rendered run: the markers loaded and unloaded as the pawn moved, and generated cells stayed near the source, followed it and were cleaned up behind it.
- [tested] Observed at the end of each hold (each mode's assertions held; one set of numbers is recorded for the run): loaded streaming levels 2 of 2 (lowest 1, highest 2 during the run); 100 `APCGPartitionActor`s in the pool, 10 holding instances; 288 instances over those 10 cells (28.8 each); no component still generating; no LogPCG warning or error.
- [tested] The original volume component showed 0 generated events and 0 instances; the output sat on the partition actors. First generated cell 0.50 s after `BeginPlay` headless, 0.51 s rendered.

## Observed values (one run each, not budgets)

| Observation | Headless | Rendered |
|---|---|---|
| First started event | 0.002 s | 0.011 s |
| First generated event | 0.007 s | 0.48 s |
| First sample with instances | 0.25 s | 0.62 s |

- [tested] Read in the game: `pcg.RuntimeGeneration.Enable` true, `.NumGeneratingComponents` 16, `.EnablePooling` true, `.BasePoolSize` 100, `.EnableWorldStreamingQueries` true, `.GlobalRadiusMultiplier` 1, `.FramesBeforeFirstGenerate` 0, `.TimeBetweenRuntimeGenSchedulerTicks` 0.

## Not covered by these runs

`GENERATE_ON_LOAD`, a Shipping build, hierarchical generation, the GPU Static Mesh Spawner, Landscape graphs in a packaged game, non-Windows platforms, and the material fallback in Play-In-Editor.

## Sources

- Epic: [Using PCG Generation Modes](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-pcg-generation-modes-in-unreal-engine).
- The PCG plugin sources named above, UE 5.8 install.
