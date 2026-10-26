# GPU time next to wall time in the comparison scene

The `perf` block of the [comparison scene](unreal-native-compare-scene.md) records wall, game thread, render thread and GPU frame time for each candidate. Scope of every [tested] line here: Unreal 5.8.4, Windows, a Development build packaged from one throwaway native C++ project, the `perf` set, one machine class. The rendered mode was run once and rerun with the same result; the headless output was judged twice (see below) and the first Editor build failed. The perf table is from the rerun; the timings, compiler and headless figures are from the first run. A different engine version, GPU, resolution or project can read differently; use the numbers to see what the block shows, not as targets.

## Reproduce it

- [general] `node examples/unreal/compare-scene/compare_gpu_run.mjs --engine <UE_5.8 folder>` does the whole run on Windows (PowerShell 7 and Node only): it writes a throwaway code project holding the harness sources, builds the Editor target, makes an empty map with the commandlet, builds the Game target, packages with `RunUAT BuildCookRun`, runs `compare.ps1 -Set perf` rendered and then with `-Headless`, and judges each receipt with `compare_perf.mjs`. It exits 0 only when both judges pass. Read from the script; it is not part of `node scripts/check.mjs`.
- [general] Flags: `--engine` (or the `UE_ROOT` environment variable), `--keep` (keep the project folder after a pass; a failed step always keeps it), `--project <folder>` (reuse a folder the runner wrote, building incrementally), `--skip-package` (run the executable already under `<project>/Archive`; needs `--project`), `--modes rendered,headless` (the default; pass one to make one run), `--compiler` and `--sdk` (pin the toolchain `discoverToolchain` would otherwise find).

## What the run showed

- [tested] The run found compiler 14.44.35223 and SDK 10.0.26100.0. In the first run the second attempt built the Editor target (exit 0, 40 s), wrote `CompareStage.umap` with the map commandlet (exit 0, 11 s), built the Game target (39 s), packaged with `RunUAT BuildCookRun` (exit 0, 91 s, not blocked), and ran `compare.ps1 -Set perf` rendered (exit 0, 17 s) and headless (exit 0, 15 s); these timings are first-run figures.
- [tested] The first Editor build failed to link (exit 6): `AECompare.cpp` uses `EKeys` and the module had no `InputCore`. Module dependencies that built: `InputCore`, `Json`, `RHI`, `RenderCore`, `Niagara`.
- [tested] The rendered run used `-RenderOffScreen`, which `compare.ps1` passes. `compare_perf.mjs` passed 7 of 7 in both runs. Perf block, milliseconds per candidate:

| Candidate | GPU | Game thread | Render thread | Wall |
|---|---|---|---|---|
| `perf-baseline` | 0.82 | 0.41 | 1.28 | 1.28 |
| `perf-gpu-supersample` (`r.ScreenPercentage` 200) | 3.09 | 0.41 | 3.38 | 3.38 |
| `perf-cpu-spin` (4 ms busy-wait) | 0.82 | 4.43 | 1.07 | 4.44 |

- [tested] In the rerun GPU time rose about 3.8 times with `r.ScreenPercentage` 200 and did not rise with the CPU spin; game thread time rose with the spin and did not rise with the supersample. Wall time equalled render thread time in the baseline and supersample rows and sat at the game thread time (plus about 0.01 ms) in the spin row.
- [tested] A headless run (`-Headless`) read `gpu_time_available` false and GPU time 0.00 ms for all three candidates, and game thread and render thread time 0.00 ms for all three. The rerun read the same zeros. Wall time still moved: 0.11 to 0.12 ms for the baseline and 4.22 ms for the spin row (first-run figures).
- [tested] The first headless judge checked that game thread time moves with CPU work (2 ms threshold) and failed 3 of 4, because game thread time reads 0. The check now reads `wall_ms`, and passes 4 of 4 on the same package (rerun into a new output folder).
- [general] A headless sampler is probably better off reading wall time than the game and render thread series; a judgement from this one run.
- [documented] `compare.ps1 -Headless` starts the game with `-nullrhi` (read from the script, not from the run evidence).
- [documented] The engine assigns `GGameThreadTime` in `FViewport::Draw` (`Engine/Source/Runtime/Engine/Private/UnrealClient.cpp`) and is assigned only there. Why the game and render thread series read 0 in the headless run was not traced.
- [tested] The receipt carries the GPU adapter name (`rhi_adapter`).
- [general] Strip `rhi_adapter` before publishing a receipt.
- [tested] The receipt's engine string read `++UE5+Release-5.8-CL-58902052` while the install's `Build.version` read changelist 58210709. Both came from the same install, updated through the Launcher: the update can leave `Build.version` stale, and the executable's changelist is the one that matches the binaries.

## Not shown

- [general] One packaged project and one scene on one machine class: nothing here says how the three engine values behave in a real scene, in a Shipping build, or on another GPU.
- [general] The three engine values are those of the previous frame ([native profiling](unreal-native-profiling.md)); compare runs, not machines, and repeat a run before trusting a gap.
