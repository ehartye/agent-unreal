# A Geometry Collection built in code, and a check that it breaks

Backs [Chaos destruction from C++](../../../skills/unreal-effects/references/unreal-chaos-destruction-native.md). Unreal Engine 5.8, Windows, Visual Studio 2022 Build Tools.

**Status:** Run 2026-10-26 on Unreal 5.8.2 (Windows, Visual Studio 2022 toolset 14.44): 11 of 11 counted checks pass, with the default flags and with `--render`. The first run found two probe faults, fixed here: the ticker handle type in the subsystem (`FTSTicker::FDelegateHandle`, not `FDelegateHandle`), and a spawn height of 5000 cm that let the no-strain control reach the floor and break from the impact (now 100000 cm). Not run: `--sizes`, `--material project`, an interactive editor, 5.8.3.

The question: does a collection built from a static mesh with `AppendStaticMesh`, `VoronoiFracture` and the convex hull step break in a running game, how many pieces separate, and does the check fail for a collection that loads, renders and never breaks?

## Files

- `module/ChaosBreakBuild/` (editor module): `UChaosBreakBuildCommandlet`, run as `-run=ChaosBreakBuild`. It builds one asset per variant from a static mesh, saves it and writes a JSON report. Variants: `healthy` (hulls from `GetValidConvexHullData`, then `CreateSimulationData`), `nohull` (the negative control), `update_hulls` (the engine's own `UpdateGeometryDependentProperties` route), `simdata_first` (simulation data before the hulls, with no second invalidate) and `fine_spacing` (noise point spacing 1 cm, for the file-size claim).
- `module/ChaosBreak/` (runtime module): `UChaosBreakRunSubsystem`, a game instance subsystem that exists only when the command line carries `-CBScenarios=`. It spawns each scenario high above the floor, binds `OnChaosBreakEvent`, applies `ApplyExternalStrain` and then `CrumbleActiveClusters`, counts the break events, records the time, height and vertical velocity of the first one, and writes a JSON report. Scenario actions: `none` (a control that must not break), `strain`, and `noproxy` (`DestroyPhysicsState` first, so the calls are silent no-ops). Spawn orders: `deferred` (`SpawnActorDeferred`, `SetRestCollection`, `FinishSpawning`) and `late` (`SetRestCollection` after `FinishSpawning`).
- `chaos_break.mjs` writes a throwaway code project in the OS temp folder with the Fracture, PlanarCut and GeometryProcessing plugins, builds the Editor target, runs the commandlet once, then starts the game three times on an engine map: with `-LogCmds="LogChaos Verbose"` (the judged run), with no log switch, and with `-ExecCmds="log LogChaos Verbose"`.
- `chaos-break-checks.mjs` judges the reports and the logs; `chaos-break.test.mjs` tests it with hand-built reports and needs no Unreal (it runs in `node scripts/check.mjs`).

## Run

```text
node examples/unreal/chaos_break/chaos_break.mjs --engine "<UE_5.8 folder>" [--sizes] [--material engine|project] [--render] [--keep] [--compiler <x.y.z>] [--sdk <10.0.n.n>]
```

`--sizes` adds the fine-spacing asset. `--material project` builds a project material with the Geometry Collections usage flag; `--render` starts the game with a renderer, offscreen, so the engine's material usage warning can appear (no warning appeared in a null-RHI run or in an offscreen render run with the engine's basic shape material; the cause is not established). Exit code 0 when every counted check passes; observations print as INFO and never fail.

## What it checks

Counted: the project compiles; the commandlet saves every requested asset with no error; the healthy asset has convex hulls and a file under 2 MB; the no-hull asset has none; the game process wrote a report for every scenario; the healthy collection produces break events and no no-geometry line names it; the idle control produces none; the no-hull control fails the judge with a zero count and `tried to create N particles with no geometry` naming it; a component with no physics proxy produces none; at normal verbosity the broken collection logs nothing and still produces none; `-LogCmds="LogChaos Verbose"` prints both no-geometry lines.

Observations: the late `SetRestCollection` order, the `update_hulls` and `simdata_first` variants, the `fine_spacing` file size, the `-ExecCmds` form, and the material usage warning.

## Source anchors

Each engine call in the modules carries a `source:` comment with the install-relative header. `UE_LOG` with `Verbose` is compiled out when `NO_LOGGING` is on, and `Engine/Source/Runtime/Core/Public/Misc/Build.h` sets `NO_LOGGING` to `!USE_LOGGING_IN_SHIPPING` for the Test and Shipping configurations (default 0), so the verbose lines this probe reads are not expected in those builds; this probe does not build them.

## Observed on the 5.8.2 run

- A collection of a 100 cm cube and 24 Voronoi sites: 25 transforms, 24 with one convex hull each (the root cluster has none), a 0.25 MB asset. The strain alone broke all 24 pieces (24 distinct indices) before the crumble call.
- Without the hull step the same collection logs `GeometryCollection Transform N has no geometry` for transforms 1 to 24 and `tried to create 24 particles with no geometry` naming the actor, and produces no break event. Neither line appears without `LogChaos Verbose`. `-ExecCmds="log LogChaos Verbose"` printed both lines as well.
- `simdata_first` (simulation data created before the hulls, no second invalidate) has 24 hulls on disk but behaves like the no-hull collection: no break event and the same two log lines. Create the simulation data after the hulls.
- `update_hulls` (`UpdateGeometryDependentProperties`) gave 25 hulls (the root too) and broke 24 pieces. `SetRestCollection` after `FinishSpawning` also broke 24 pieces.
- Spawned 5000 cm up, an untouched collection reached the floor about 2.7 s later and broke from the impact (first break at height 18 cm, moving up at 1018 cm/s); the control must start far above where the run lasts.

## Not verified

The `fine_spacing` file size (`--sizes`), the project material path (`--material project`), the material usage warning, a radial velocity field (`ApplyPhysicsField`) and its direction, an interactive editor, and Unreal 5.8.3. The break-event count equalled the number of leaf pieces here; that it is a good proxy on a larger asset is not shown.
