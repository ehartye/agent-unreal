# A Geometry Collection built in code, and a check that it breaks

Backs [Chaos destruction from C++](../../../skills/unreal-effects/references/unreal-chaos-destruction-native.md). Unreal Engine 5.8, Windows, Visual Studio 2022 Build Tools.

**Status:** Prepared 2026-10-26; not yet run on an engine. A first run tests the probe before it tests the engine.

The question: does a collection built from a static mesh with `AppendStaticMesh`, `VoronoiFracture` and the convex hull step break in a running game, how many pieces separate, and does the check fail for a collection that loads, renders and never breaks?

## Files

- `module/ChaosBreakBuild/` (editor module): `UChaosBreakBuildCommandlet`, run as `-run=ChaosBreakBuild`. It builds one asset per variant from a static mesh, saves it and writes a JSON report. Variants: `healthy` (hulls from `GetValidConvexHullData`, then `CreateSimulationData`), `nohull` (the negative control), `update_hulls` (the engine's own `UpdateGeometryDependentProperties` route), `simdata_first` (simulation data before the hulls, with no second invalidate) and `fine_spacing` (noise point spacing 1 cm, for the file-size claim).
- `module/ChaosBreak/` (runtime module): `UChaosBreakRunSubsystem`, a game instance subsystem that exists only when the command line carries `-CBScenarios=`. It spawns each scenario high above the floor, binds `OnChaosBreakEvent`, applies `ApplyExternalStrain` and then `CrumbleActiveClusters`, counts the break events and writes a JSON report. Scenario actions: `none` (a control that must not break), `strain`, and `noproxy` (`DestroyPhysicsState` first, so the calls are silent no-ops). Spawn orders: `deferred` (`SpawnActorDeferred`, `SetRestCollection`, `FinishSpawning`) and `late` (`SetRestCollection` after `FinishSpawning`).
- `chaos_break.mjs` writes a throwaway code project in the OS temp folder with the Fracture, PlanarCut and GeometryProcessing plugins, builds the Editor target, runs the commandlet once, then starts the game three times on an engine map: with `-LogCmds="LogChaos Verbose"` (the judged run), with no log switch, and with `-ExecCmds="log LogChaos Verbose"`.
- `chaos-break-checks.mjs` judges the reports and the logs; `chaos-break.test.mjs` tests it with hand-built reports and needs no Unreal (it runs in `node scripts/check.mjs`). The report shapes are an assumption until the first run.

## Run

```text
node examples/unreal/chaos_break/chaos_break.mjs --engine "<UE_5.8 folder>" [--sizes] [--material engine|project] [--render] [--keep] [--compiler <x.y.z>] [--sdk <10.0.n.n>]
```

`--sizes` adds the fine-spacing asset. `--material project` builds a project material with the Geometry Collections usage flag; `--render` starts the game with a renderer, offscreen, so the engine's material usage warning can appear (a null-RHI game may never create the scene proxy that logs it). Exit code 0 when every counted check passes; observations print as INFO and never fail.

## What it checks

Counted: the project compiles; the commandlet saves every requested asset with no error; the healthy asset has convex hulls and a file under 2 MB; the no-hull asset has none; the game process wrote a report for every scenario; the healthy collection produces break events and no no-geometry line names it; the idle control produces none; the no-hull control fails the judge with a zero count and `tried to create N particles with no geometry` naming it; a component with no physics proxy produces none; at normal verbosity the broken collection logs nothing and still produces none; `-LogCmds="LogChaos Verbose"` prints both no-geometry lines.

Observations: the late `SetRestCollection` order, the `update_hulls` and `simdata_first` variants, the `fine_spacing` file size, the `-ExecCmds` form, and the material usage warning.

## Source anchors

Each engine call in the modules carries a `source:` comment with the install-relative header. `UE_LOG` with `Verbose` is compiled out when `NO_LOGGING` is on, and `Engine/Source/Runtime/Core/Public/Misc/Build.h` sets `NO_LOGGING` to `!USE_LOGGING_IN_SHIPPING` for the Test and Shipping configurations (default 0), so the verbose lines this probe reads are not expected in those builds; this probe does not build them.

## Not verified

Everything in this folder. In particular the first run decides whether `VoronoiFracture` accepts the rest collection directly, whether `CreateSimulationData` is needed before saving, whether the strain values break a collection this small, and whether the break-event count is a good proxy for separated pieces. A radial velocity field (`ApplyPhysicsField`) and the sign of its direction are not probed.
