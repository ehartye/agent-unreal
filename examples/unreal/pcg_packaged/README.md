# PCG in a cooked game: runtime generation and streaming (prepared, not yet run on an engine)

Backs the "Not verified" lines of [PCG in a running game](../../../skills/unreal-procedural/references/unreal-pcg-game-process.md) and the "streaming in play" line of the World Partition reference. **Nothing here has run on an engine.** The runner, the game module, the editor script and the judge were written from reading the PCG plugin source on a 5.8 install; the node test covers the judge with reports shaped from that reading, not from a run. Expect the first engine run to need fixes (see Risks), and do not move any reference line to `[tested]` until a run exists.

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
| Minutes (estimate, from the compare-scene model on a warm machine: Editor build 40 s, Game build 39 s, package 91 s, run 15 s) | about 10 to 15 minutes for both rows: Editor build, one editor session of a few minutes, Game build, package, then four P1 runs of about 45 s and two P2 runs of about 70 s |
| Cook warm-up | The first cook on a machine with a cold shared derived-data cache compiles the shaders of the engine's default materials and can take many times longer than a warm one (tens of minutes). Later runs of a new throwaway project on the same machine are faster. |
| Disk (not measured) | The Editor and Game intermediate files and the Archive are several GB in all; the Archive alone is a few hundred MB to about a GB (an estimate: compare-scene's package size was not recorded). Run once with `--keep` and record the real figure here. |
| First run | Use `--keep` and `--stop-after author` first (about 5 minutes), then without it. The runner keeps the project on any failure; with `--keep` it keeps it on success too. The staged folder holds `Saved/build-*.log`, `Saved/package.log` and, per run, `out/<stamp>/<map>-<mode>/{receipt.json,game.log}`. `--rejudge <project folder>` judges them again without starting anything. |

## What the receipt holds

`complete`, engine version and build configuration, `requires_cooked_data`, `with_editor`, `null_rhi`, the PCG World Actor count and registration, the player controller, pawn and view point, the scheduler console variables, then per original PCG component: trigger, graph, scheduling policy, partitioned, started and generated event counts and times, first sample with instances, a series of changes (generating, generated, instances, output points), the first and the last snapshot (ISM component count, instance count, mesh path, material path, usage flag, whether the material is the engine default), and, at the end, whether each asset loads by path. P2 adds a sample every 0.5 s: the source position, streaming levels (total, loaded, visible), whether each marker actor exists, the partition actors, those holding instances, their cell coordinates, the instances in them, and the instances on the original actor.

## Expectations written before the run

Asserted (from reading the PCG plugin source, `Engine/Plugins/PCG/Source/PCG`):

- `UPCGSubsystem::Tick` ticks the runtime generation scheduler only when a PCG World Actor is registered (`Private/Subsystems/PCGSubsystem.cpp`, `UPCGSubsystem::Tick`), the actor registers itself in `BeginPlay` (`Private/PCGWorldActor.cpp`), and the editor creates one only outside play (`UPCGSubsystem::GetPCGWorldActor`). So `PcgRuntime` generates and `PcgNoWorld` does not.
- Player controllers are generation sources by default (`bTreatPlayerControllersAsGenerationSources`, `Private/RuntimeGen/PCGGenSourceManager.cpp`), and a non-partitioned runtime component is queued when the source is inside its unbounded generation radius (`FPCGRuntimeGenScheduler::TickQueueSourcesForGeneration`), which by default is very large (`FPCGRuntimeGenerationRadii::RadiusUnbounded`).
- `GENERATE_ON_DEMAND` generates only when asked (`UPCGComponent::ShouldGenerate`).
- The editor baseline and the game produce the same instance count for the same graph; the mesh and the material, referenced from the graph, are in the cook; an asset nothing references is not (`DirectoriesToAlwaysCook` is the documented way to cook such a folder).
- P2: a partitioned runtime volume generates per grid cell within a few cells of the source and cleans up cells that fall out of range (`TickCleanup`); the marker at the pawn's position is loaded and the one 1,000 m away is not, because the default runtime grid's loading range is 256 m.

Observed only (recorded, never judged): generation timing, the generated graph output kept on the component, the console variable values, the effect of calling `Generate(true)` on the on-demand component in the game, streaming level counts, partition actor pooling (the scheduler pre-creates a pool, by default 100 actors), the original component's own instance count, instances per cell, LogPCG warnings and errors, and the radius check when Python could not apply the override.

## Files

| File | What |
|---|---|
| `pcg_packaged.mjs` | the runner |
| `pcg_packaged_author.py` | the editor session: assets, graphs, maps, baseline |
| `module/PcgPackaged/` | the game module: `APcgPackagedGameMode` (header, source, `Build.cs`, module file) |
| `pcg-packaged-checks.mjs`, `pcg-packaged.test.mjs` | the judge and its test (canned reports: pass, a missing field and a violated expectation for each check; part of `node scripts/check.mjs`) |

## Not covered

`GENERATE_ON_LOAD` (an editor generation saves its output in the map, a different question), a Shipping or Test build, a non-Windows platform, hierarchical generation, the GPU spawner and procedural ISM components (counted by reflection and recorded, not asserted), multiplayer, Landscape-based graphs in a packaged game (the Landscape cache rules are in the game-process reference), and the material fallback in Play-In-Editor.

## Risks the first engine run is likely to hit

- The game module was never compiled. Look first at `Saved/build-editor.log` for a missing include or an API that is not exported from the PCG module (`UPCGComponent::UseActorComponentlessGeneration`, `IsPartitioned`, `Generate`, `UPCGSubsystem::GetPCGWorldActor` are exported by the headers; the rest is read as public fields or inline).
- Python names: `unreal.PCGComponentGenerationTrigger.GENERATE_AT_RUNTIME`, the `generation_radii` struct (`radius_unbounded` as a per-quality-level float with a `default` member) and `Actor.rename` were not tried. Failures are written to the author report (`warnings`, `radius_override_far.error`); a failed radius override turns that check into an observation.
- Object names: the author renames each volume to its label so the game's actor names are known; if `rename` fails the judge falls back to the label and the component checks report "component not found".
- The partitioned map is made with `LevelEditorSubsystem.new_level(path, True)` and the grid size is set on the PCG World Actor from Python; a refusal is recorded under `grid_size_cm`. A different cell size changes the expected cell columns (`SETTLED_CELL_RANGE` in the checks).
- Packaging a project with `PythonScriptPlugin` and `EditorScriptingUtilities` enabled for the editor session may warn; they are editor plugins.
- The cook of a World Partition map splits it into streaming cells; if the cook rejects the blank partitioned map, `package.log` says so.
- The runner passes file paths to the game on its command line; the project folder must not contain whitespace (it checks).
