# Profiling a native Unreal game against a frame budget

Observed in one consuming Unreal **5.8.2 CL56702186** project on Windows (packaged Development build, D3D12 on a discrete GPU, 1920x1080 for rendered runs); the numbers are not reproduced in this repo (the one bullet marked [tested] is). The steps are the engine-neutral profiling method (`phaser-verification` skill, agent-engine) (budget, ablation for diagnosis, cost model, who approves a fix, right-sized verification); this file is the Unreal harness and what it measured. [Profiling measurements](unreal-native-profiling-measurements.md) holds the ablation table, the per-item cost model and the fix results; [profiling facts and traps](unreal-native-profiling-facts.md) holds the exactness-check evidence, engine-source facts and tooling traps. Every number is from one project and some are interim; use them to see the method, not as targets. Route, scene and switch names are placeholders.

## Build the sampler into the game, and into the baseline

- [general] A scripted multi-actor scenario (`-MyScenario=race`, fixed seed per route, `-Deterministic -FPS=60`) writes a JSON receipt with a `perf` block: wall frame time, `GGameThreadTime`, `GRenderThreadTime`, `RHIGetGPUFrameCycles()`, `GNumDrawCallsRHI[0]`, each as mean, p50, p95 and max. A few seconds of warm-up are discarded. The engine thread timings are those of the previous frame, so compare runs, not machines.
- [tested] The comparison scene reads the same four series (wall, game thread, render thread, GPU) and was run on 5.8.4 in one throwaway project (the `perf` set): GPU time rose about 3.8 times with a GPU-side change (`r.ScreenPercentage` 200) and not with a 4 ms CPU spin, game thread time the reverse. In its headless run (`-Headless`) the GPU, game thread and render thread series read 0 while wall time moved. Numbers, scope and the source note: [GPU time in the comparison scene](unreal-native-compare-gpu-time.md).
- [general] A sampler that has to run headless is probably better off reading wall time than the three engine series; judgement from one run, so check it on your own build.
- [general] The first baseline package had no sampler, so only the experimental side reported. Build the sampler into the unchanged baseline too, and keep that package out of any prune script (a prune script once deleted it).
- [general] `-FPS=` is the fixed simulation step, not a frame-rate cap. Frames ran unthrottled: a 120 Hz step cost about the same per frame as a 60 Hz step on the heaviest scene, so per-frame cost does not depend on the step. Report frame cost and scenario clock; never divide frames by simulated time and call it FPS.

## Decompose first

- [general] Rendered, 60 Hz step, five repeats: GPU about 1 ms or less on every scene, render thread 2 to 3 ms, game thread within a few hundredths of a millisecond of the wall frame (about 99.6%). Mean frame cost ranged from about 5 ms on the lightest scene to about 13.5 ms on the heaviest, against an 8.33 ms budget: the lightest scenes pass on the mean, the heaviest needs about 5 ms back. The cost is game-thread CPU, so culling, instancing and Nanite choices cannot reach it alone.
- [general] Headless (`-nullrhi` plus a project headless flag, no GPU needed) means, traced, were lower by 1.4 to 2.9 ms, with spread under 0.5 ms; the difference is the cost of render state and submission. An interim estimate of about 4 ms, from partial single runs, was not reproduced by the matrix. Use headless for attribution, rendered for acceptance.

## The diagnosis harness (heavier than shipping a fix needs)

- [general] A script runs one packaged scenario with `-trace=cpu,frame,counters,bookmark,region,log` (plus `gpu` when rendered), then exports per-timer statistics with `UnrealInsights.exe` ([capture and export steps](unreal-native-insights-capture.md)). A matrix script loops phases and appends one line per run to a progress file; summarize scripts aggregate; an export script condenses the runs into a committed CSV.
- [general] One run at a time, never two rendered runs at once; measure on a quiet machine ([how](unreal-native-profiling-facts.md#measure-on-a-quiet-machine)). A run whose mean is over 1.25 times the median of its earlier repeats is flagged, and a rerun phase repeats flagged runs. A row that writes no receipt is logged as FAILED; a minimum-free-disk guard skips runs rather than failing mid-write.
- [general] Phases ran overnight: baselines on all scenes, rendered and headless ablation on the heaviest and lightest, prototypes, and fixes combined with +50% content growth. That scale answered "where does the time go"; it is not the bar for shipping a fix.
- [general] Switches (for example `-MyExp=noeffects,noscenery,noactors,noaudio,flames=0.5,scenery=1.5,effects=1.5`) live on a branch marked EXPERIMENT ONLY and never merged. State what a scale switch scales: `effects=` scaled the spawn rate only, because the pooled meshes are built per slot.

## Right-sized verification

- [general] Ship a fix when it is a good idea architecturally and you are reasonably sure it does not make the game worse. Verification scales with blast radius, not with the diagnosis harness above.
- [general] The bar: the project's own automation tests, the in-game exactness check ([facts](unreal-native-profiling-facts.md)) when the fix is claimed exact, and before and after frame time on the three worst scenes by frame time, two runs each. One independent verifier per PR, merge when it passes, and a one-paragraph rollback note in the PR.
- [general] Not required: per-route sweeps, noise-floor studies, multi-verifier panels. Behaviour-changing fixes need the owner's approval whatever the number of runs.

Cost levers: [Lumen](../../unreal-rendering/references/unreal-lumen.md), [Nanite](../../unreal-rendering/references/unreal-nanite.md), [Virtual Shadow Maps](../../unreal-rendering/references/unreal-virtual-shadow-maps.md), [MegaLights](../../unreal-rendering/references/unreal-megalights.md).
