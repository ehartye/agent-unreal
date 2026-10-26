# PCG in a cooked game: runtime generation and streaming (run on Unreal 5.8.3)

Backs [PCG in a cooked game](../../../skills/unreal-procedural/references/unreal-pcg-cooked-game.md) and the streaming line of the World Partition reference. **Run on Unreal Engine 5.8.3, Windows: one throwaway project, one Development package, one machine class; 63 of 63 checks passed and 36 observations were recorded** (headless and rendered, three maps). The runner, game module, editor script and judge were written from reading the PCG plugin source; the run is what the references cite. Claims outside this run are listed under Not covered.

## The questions

- **P1.** In a packaged Development game, does a PCG component with generation trigger `GENERATE_AT_RUNTIME` (not partitioned) generate once its actor is in the loaded level, and what does the game process show (instances, time)? Are the PCG graph, the static mesh and the material in the cook with no extra cook rule? Does `GENERATE_ON_DEMAND` stay silent?
- **P2.** With a World Partition map, a partitioned `GENERATE_AT_RUNTIME` volume and a pawn that travels between two points, do streaming cells load and PCG grid cells generate per cell near the source, and do cells behind it clean up?

## What it does

```text
node examples/unreal/pcg_packaged/pcg_packaged.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--rows p1,p2] [--modes headless,rendered] [--stop-after author|package]
```

1. Writes a throwaway code project in the OS temp folder (`../native-build.mjs`): the game module `module/PcgPackaged`, the PCG plugin listed, `MapsToCook` naming the maps and **no other cook rule** (no `DirectoriesToAlwaysCook`).
2. Builds the Editor target, then starts the editor once (`-nullrhi`) on `pcg_packaged_author.py`. It reuses `../pcg_game/pcg_common.py`. It makes a project copy of the engine cube (`SM_ProbeCube`), a second copy nothing references (`SM_Orphan`, the cook control), an unlit material with the instanced-meshes usage flag, and two graphs (Create Points Grid then Static Mesh Spawner). It generates the P1 graph on demand on a scratch map first (the editor baseline), then saves the maps.
3. Builds the Game target and packages it (`RunUAT BuildCookRun`, Development, Windows).
4. Runs the packaged game once per map and mode on `APcgPackagedGameMode`, which only reads and writes a JSON receipt (rewritten every two seconds, so a crash leaves a partial one), then exits. Headless runs use `-nullrhi`; rendered runs use `-RenderOffScreen`, which a session with no desktop needs.
5. Judges the author report and the receipts with `pcg-packaged-checks.mjs`: PASS, FAIL, or OBSERVE per check, exit code 0 when every asserted check passes.

| Map | Row | What is in it |
|---|---|---|
| `PcgRuntime` | P1 | a PCG World Actor and three volumes: `runtime_near` (`GENERATE_AT_RUNTIME`), `on_demand` (`GENERATE_ON_DEMAND`, the control), `runtime_far` (`GENERATE_AT_RUNTIME`, 1,000 m away, unbounded generation radius made 10 m if Python reaches the property) |
| `PcgNoWorld` | P1 | one `GENERATE_AT_RUNTIME` volume and no PCG World Actor (the control for "the scheduler needs the saved world actor") |
| `PcgStream` | P2 | a World Partition map, one partitioned `GENERATE_AT_RUNTIME` volume 1,120 m by 32 m, a PCG World Actor with a 32 m partition grid (small defaults chosen here: the owner can change `CELL_GRID_CM` and the path in `pcg_packaged_author.py`), two marker cubes 1,000 m apart and a player start at one end |

The pawn path (P2): hold 12 s at A, travel 20 s to B (50 m/s), hold 15 s at B. The pawn is the view target, so it is the PCG generation source (player controllers are sources by default) and the World Partition streaming source (`APlayerController::GetStreamingSources` uses the view target).

## Commands and cost

| Item | Value |
|---|---|
| Needs a rendering GPU | Only the `rendered` mode. `--modes headless` needs none and is the evidence for the generation questions; the rendered run adds the material usage-flag log check. |
| Stage times, 5.8.3 | Editor build 39 s; author session (editor, `-nullrhi`) 19 s; Game build 35 s; package (`RunUAT BuildCookRun`, Development, Windows) 81 s; each game run 30 to 49 s (six runs: headless and rendered, each of three maps). |
| Disk after the run | Archive 0.88 GB, Saved 0.93 GB, Intermediate 4.52 GB, Binaries 0.74 GB, total 7.08 GB. |
| Cook warm-up | The cache state of the first cook was not recorded, so the 81 s package time is one observation, not a warm or cold figure. |
| First run | Use `--keep` and `--stop-after author` first, then without it. The runner keeps the project on any failure; with `--keep` it keeps it on success too. The staged folder holds `Saved/build-*.log`, `Saved/package.log` and, per run, `out/<stamp>/<map>-<mode>/{receipt.json,game.log}`. `--rejudge <project folder>` judges them again without starting anything. |

## What the receipt holds

`complete`, engine version and build configuration, `requires_cooked_data`, `with_editor`, `null_rhi`, the PCG World Actor count and registration, the player controller, pawn and view point, the scheduler console variables, then per original PCG component: trigger, graph, scheduling policy, partitioned, started and generated event counts and times, first sample with instances, a series of changes (generating, generated, instances, output points), the first and the last snapshot (ISM component count, instance count, mesh path, material path, usage flag, whether the material is the engine default), and, at the end, whether each asset loads by path. P2 adds a sample every 0.5 s: the source position, streaming levels (total, loaded, visible), whether each marker actor exists, the partition actors, those holding instances, their cell coordinates, the instances in them, and the instances on the original actor.

## Expectations, and what the run showed

Asserted, written from reading the PCG plugin source (`Engine/Plugins/PCG/Source/PCG`); every one held on 5.8.3, headless and rendered:

- `UPCGSubsystem::Tick` ticks the runtime generation scheduler only when a PCG World Actor is registered (`Private/Subsystems/PCGSubsystem.cpp`), the actor registers itself in `BeginPlay` (`Private/PCGWorldActor.cpp`), and the editor creates one only outside play (`UPCGSubsystem::GetPCGWorldActor`). The run: `PcgRuntime` generated (instances 0 at the first sample, then 64) and `PcgNoWorld`, where the actor was removed and the editor added none before save, did not, with no LogPCG line about the world actor or the scheduler.
- Player controllers are generation sources by default (`bTreatPlayerControllersAsGenerationSources`, `Private/RuntimeGen/PCGGenSourceManager.cpp`). The run: the receipt named the player controller and its pawn (a `DefaultPawn`) as the source.
- `GENERATE_ON_DEMAND` generates only when asked (`UPCGComponent::ShouldGenerate`). The run: no instances and no started event until the script called `Generate`, then 64 instances and 1 generated event.
- The editor baseline and the game produce the same instance count for the same graph (64 and 64); the mesh, the material and the graph, referenced from the map and graph, loaded by object path in the game with no cook rule beyond `MapsToCook`; the unreferenced mesh did not (`DirectoriesToAlwaysCook` is the documented way to cook such a folder; this run did not set it).
- A volume 1,000 m from the player with its generation radius set to 10 m stayed empty (0 instances, 0 generated events). Python applied the override through the `PCGRuntimeGenerationRadii` struct, member `generation_radius` (1000 cm). The author step also set the World Partition grid size to 3200 cm from Python (25600 before).
- P2: a partitioned runtime volume generates per grid cell within a few cells of the source and cleans up cells that fall out of range (`TickCleanup`); the marker at the pawn is loaded and the one 1,000 m away is not (from reading, the default runtime grid's loading range is 256 m). The run: markers loaded and unloaded as expected, generated cells stayed near the source, followed it and were cleaned up behind it.

Observed (recorded, never judged), 5.8.3:

| Observation | Headless | Rendered |
|---|---|---|
| Start to first started event (P1) | 0.002 s | 0.011 s |
| Start to first generated event (P1) | 0.007 s | 0.48 s |
| Start to first sample with instances (P1) | 0.25 s | 0.62 s |
| Start to first generated cell (P2) | 0.50 s | 0.51 s |

- Console variables in the game: `pcg.RuntimeGeneration.Enable` true, `NumGeneratingComponents` 16, `GlobalRadiusMultiplier` 1, `FramesBeforeFirstGenerate` 0, `TimeBetweenRuntimeGenSchedulerTicks` 0, `EnableWorldStreamingQueries` true, `EnablePooling` true, `BasePoolSize` 100.
- P2, at the end of each hold in both modes: 2 of 2 loaded streaming levels (lowest 1, highest 2); 100 `APCGPartitionActor`s in the pool, 10 holding instances; 288 instances over those 10 cells (28.8 per cell); the original volume component showed 0 generated events and 0 instances (the output sits on the partition actors); 0 components still generating.
- No LogPCG warnings or errors in any run. Material usage-flag log lines: 0 (headless).
- The author step: the map held one PCG World Actor that the script did not spawn (the author report records `spawned_by_script` false), and the editor baseline run reported one world actor added by the editor. Saving a map that held runtime volumes baked no instances.

## Files

| File | What |
|---|---|
| `pcg_packaged.mjs` | the runner |
| `pcg_packaged_author.py` | the editor session: assets, graphs, maps, baseline |
| `module/PcgPackaged/` | the game module: `APcgPackagedGameMode` (header, source, `Build.cs`, module file) |
| `pcg-packaged-checks.mjs`, `pcg-packaged.test.mjs` | the judge and its test (canned reports: pass, a missing field and a violated expectation for each check; part of `node scripts/check.mjs`) |

## Not covered

`GENERATE_ON_LOAD` (an editor generation saves its output in the map, a different question), a Shipping or Test build, a non-Windows platform, hierarchical generation, the GPU spawner, multiplayer, Landscape-based graphs in a packaged game (the Landscape cache rules are in the game-process reference), and the material fallback in Play-In-Editor. Procedural ISM components are counted by reflection and recorded, not asserted.

## Constraint

The runner passes file paths to the game on its command line; the project folder must not contain whitespace (it checks).
