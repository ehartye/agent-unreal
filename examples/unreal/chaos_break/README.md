# A Geometry Collection built in code, and a check that it breaks

Run the launcher commands below from the plugin root. They wrap each complete probe in the [shared owned process tree](../engine_lock/README.md); retained scientific results describe their original runs.

Backs [Chaos destruction from C++](../../../skills/unreal-effects/references/unreal-chaos-destruction-native.md). Unreal Engine 5.8, Windows, Visual Studio 2022 Build Tools.

**Status:** Run 2026-10-26 (Windows, Visual Studio 2022 toolset 14.44): 11 of 11 counted checks pass, with the default flags, with `--render`, with `--sizes` and, in a session with no desktop, with `--material project --render`, and the break-event counts are the same in the default and `--material project --render` runs (below); the `--render` and `--sizes` runs were judged 11 of 11 only. The first run found two probe faults, fixed here: the ticker handle type in the subsystem (`FTSTicker::FDelegateHandle`, not `FDelegateHandle`), and a spawn height of 5000 cm that let the no-strain control reach the floor and break from the impact (now 100000 cm). Not run: an interactive editor.

The question: does a collection built from a static mesh with `AppendStaticMesh`, `VoronoiFracture` and the convex hull step break in a running game, how many pieces separate, and does the check fail for a collection that loads, renders and never breaks?

## Files

- `module/ChaosBreakBuild/` (editor module): `UChaosBreakBuildCommandlet`, run as `-run=ChaosBreakBuild`. It builds one asset per variant from a static mesh, saves it and writes a JSON report. Variants: `healthy` (hulls from `GetValidConvexHullData`, then `CreateSimulationData`), `nohull` (the negative control), `update_hulls` (the engine's own `UpdateGeometryDependentProperties` route), `simdata_first` (simulation data before the hulls, with no second invalidate) and `fine_spacing` (noise point spacing 1 cm, for the file-size claim).
- `module/ChaosBreak/` (runtime module): `UChaosBreakRunSubsystem`, a game instance subsystem that exists only when the command line carries `-CBScenarios=`. It spawns each scenario high above the floor, binds `OnChaosBreakEvent`, applies `ApplyExternalStrain` and then `CrumbleActiveClusters`, counts the break events, records the time, height and vertical velocity of the first one, and writes a JSON report. Scenario actions: `none` (a control that must not break), `strain`, and `noproxy` (`DestroyPhysicsState` first, so the calls are silent no-ops). Spawn orders: `deferred` (`SpawnActorDeferred`, `SetRestCollection`, `FinishSpawning`) and `late` (`SetRestCollection` after `FinishSpawning`).
- `chaos_break.mjs` writes a throwaway code project in the OS temp folder with the Fracture, PlanarCut and GeometryProcessing plugins, builds the Editor target, runs the commandlet once, then starts the game three times on an engine map: with `-LogCmds="LogChaos Verbose"` (the judged run), with no log switch, and with `-ExecCmds="log LogChaos Verbose"`.
- `chaos-break-checks.mjs` judges the reports and the logs; `chaos-break.test.mjs` tests it with hand-built reports and needs no Unreal (it runs in `node scripts/check.mjs`).

## Run

```text
pwsh -NoProfile -File examples/unreal/engine_lock/with-engine-lock.ps1 node examples/unreal/chaos_break/chaos_break.mjs --engine "<UE_5.8 folder>" [--sizes] [--material engine|project] [--render] [--keep] [--compiler <x.y.z>] [--sdk <10.0.n.n>]
```

`--sizes` adds the fine-spacing asset. `--material project` builds a project material with the Geometry Collections usage flag; `--render` starts the game with a renderer, offscreen (`-RenderOffScreen`), so the engine's material usage warning can appear (no warning appeared in a null-RHI run, in the verbose run of an offscreen render with the engine's basic shape material, or in the verbose run with a project material carrying the Geometry Collections usage flag, rendered offscreen; the cause is not established). Exit code 0 when every counted check passes; observations print as INFO and never fail.

## What it checks

Counted: the project compiles; the commandlet saves every requested asset with no error; the healthy asset has convex hulls and a file under 2 MB; the no-hull asset has none; the game process wrote a report for every scenario; the healthy collection produces break events and no no-geometry line names it; the idle control produces none; the no-hull control fails the judge with a zero count and `tried to create N particles with no geometry` naming it; a component with no physics proxy produces none; at normal verbosity the broken collection logs nothing and still produces none; `-LogCmds="LogChaos Verbose"` prints both no-geometry lines.

Observations: the late `SetRestCollection` order, the `update_hulls` and `simdata_first` variants, the `fine_spacing` file size, the `-ExecCmds` form, and the material usage warning.

## Source anchors

Each engine call in the modules carries a `source:` comment with the install-relative header. `UE_LOG` with `Verbose` is compiled out when `NO_LOGGING` is on, and `Engine/Source/Runtime/Core/Public/Misc/Build.h` sets `NO_LOGGING` to `!USE_LOGGING_IN_SHIPPING` for the Test and Shipping configurations (default 0), so the verbose lines this probe reads are not expected in those builds; this probe does not build them.

## Observed on the first run (the default-flag counts were the same on the rerun)

- A collection of a 100 cm cube and 24 Voronoi sites: 25 transforms, 24 with one convex hull each (the root cluster has none), a 0.25 MB asset. The strain alone broke all 24 pieces (24 distinct indices) before the crumble call.
- Without the hull step the same collection logs `GeometryCollection Transform N has no geometry` for transforms 1 to 24 and `tried to create 24 particles with no geometry` naming the actor, and produces no break event. Neither line appears without `LogChaos Verbose`. `-ExecCmds="log LogChaos Verbose"` printed both lines as well.
- `simdata_first` (simulation data created before the hulls, no second invalidate) has 24 hulls on disk but behaves like the no-hull collection: no break event and the same two log lines. Create the simulation data after the hulls.
- `update_hulls` (`UpdateGeometryDependentProperties`) gave 25 hulls (the root too) and broke 24 pieces. `SetRestCollection` after `FinishSpawning` also broke 24 pieces.
- Spawned 5000 cm up, an untouched collection reached the floor about 2.7 s later and broke from the impact (first break at height 18 cm, moving up at 1018 cm/s); the control must start far above where the run lasts.

## Observed on the `--material project --render` run

- The same 11 counted checks passed with the same break-event counts: the healthy collection gave 24 break events after the strain and 24 after the crumble; the control gave 0; the no-hull control gave 0 with the log line `tried to create particles with no geometry`; a component with no physics proxy stayed silent; normal verbosity printed nothing and `-LogCmds` turned the lines on.
- Observations (numbers from this run): late `SetRestCollection` gave 24 break events (24 distinct); the healthy asset was 0.25 MB; `update_hulls` gave 25 transforms with hulls of 25, 0.25 MB, simulation data dirty false and 24 break events; `simdata_first` gave 24 transforms with hulls of 25, 0.23 MB and 0 break events.
- The material usage warning did not appear in the verbose run, with a project material that carries the Geometry Collections usage flag. The cause is not established.

## Not verified

The `fine_spacing` file size (`--sizes` ran 11 of 11, but this README records no value for it), a radial velocity field (`ApplyPhysicsField`) and its direction, and an interactive editor. The material usage warning did not appear in any run, so what triggers it is not shown. The break-event count equalled the number of leaf pieces here; that it is a good proxy on a larger asset is not shown.
