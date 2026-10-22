# Profiling a native Unreal game against a frame budget

Observed in one consuming Unreal **5.8.2 CL56702186** project on Windows (packaged Development build, D3D12 on a discrete GPU, 1920x1080 for rendered runs); not reproduced in this repo. The steps are the engine-neutral method in profiling method (`engine-phaser` skill, agent-engine) (budget, ablation for diagnosis, cost model, who approves a fix, right-sized verification); this file is the Unreal harness and what it measured. [Profiling facts and traps](unreal-native-profiling-facts.md) holds the exactness-check evidence, engine-source facts and tooling traps. Every number below is reported from one project and some are interim; use them to see the method, not as targets. Route, scene and switch names are placeholders.

## Build the sampler into the game, and into the baseline

- [general] A scripted multi-actor scenario (`-MyScenario=race`, fixed seed per route, `-Deterministic -FPS=60`) writes a JSON receipt with a `perf` block: wall frame time, `GGameThreadTime`, `GRenderThreadTime`, `RHIGetGPUFrameCycles()`, `GNumDrawCallsRHI[0]`, each as mean, p50, p95 and max. A few seconds of warm-up are discarded. The engine thread timings are those of the previous frame, so compare runs, not machines.
- [general] The first baseline package had no sampler, so only the experimental side reported. Build the sampler into the unchanged baseline too, and keep that package out of any prune script (a prune script once deleted it).
- [general] `-FPS=` is the fixed simulation step, not a frame-rate cap. Frames ran unthrottled: a 120 Hz step cost about the same per frame as a 60 Hz step on the heaviest scene, so per-frame cost does not depend on the step. Report frame cost and scenario clock; never divide frames by simulated time and call it FPS.

## Decompose first

- [general] Rendered, 60 Hz step, five repeats: GPU about 1 ms or less on every scene, render thread 2 to 3 ms, game thread within a few hundredths of a millisecond of the wall frame (about 99.6%). Mean frame cost ranged from about 5 ms on the lightest scene to about 13.5 ms on the heaviest, against an 8.33 ms budget: the lightest scenes pass on the mean, the heaviest needs about 5 ms back. The cost is game-thread CPU, so culling, instancing and Nanite choices cannot reach it alone.
- [general] Headless (`-nullrhi` plus a project headless flag, no GPU needed) means, traced, were lower by 1.4 to 2.9 ms, with spread under 0.5 ms; the difference is the cost of render state and submission. An interim estimate of about 4 ms, from partial single runs, was not reproduced by the matrix. Use headless for attribution, rendered for acceptance.

## The diagnosis harness (heavier than shipping a fix needs)

- [general] A script runs one packaged scenario with `-trace=cpu,frame,counters,bookmark,region,log` (plus `gpu` when rendered), then exports per-timer statistics with `UnrealInsights.exe`. A matrix script loops phases and appends one line per run to a progress file; summarize scripts aggregate; an export script condenses the runs into a committed CSV.
- [general] One run at a time, never two rendered runs at once. A run whose mean is over 1.25 times the median of its earlier repeats is flagged, and a rerun phase repeats flagged runs. A row that writes no receipt is logged as FAILED; a minimum-free-disk guard skips runs rather than failing mid-write.
- [general] Phases ran overnight: baselines on all scenes, rendered and headless ablation on the heaviest and lightest, prototypes, and fixes combined with +50% content growth. That scale answered "where does the time go"; it is not the bar for shipping a fix.
- [general] Switches (for example `-MyExp=noeffects,noscenery,noactors,noaudio,flames=0.5,scenery=1.5,effects=1.5`) live on a branch marked EXPERIMENT ONLY and never merged. State what a scale switch scales: `effects=` scaled the spawn rate only, because the pooled meshes are built per slot.

## What the ablation showed (heaviest scene, headless, four repeats each)

| Row | Frame ms | Delta |
|---|---|---|
| base | 10.61 | |
| no AI hazard layer | 7.11 | -3.50 |
| no actors | 8.90 | -1.71 |
| no hazard actors (per-tick contact tests) | 8.92 | -1.69 |
| no scenery animation | 10.28 | -0.33 |
| no effects | 10.45 | -0.16 |
| fewer flames, no hazard animation, no audio | 10.44, 10.50, 10.51 | -0.17, -0.11, -0.10 |
| scenery x1.5 | 10.76 | +0.15 |

- [general] The heaviest scene was about 6 ms heavier than the lightest mostly because of one hazard system: the AI's hazard layer (a product of hazards x stations x lanes, computed twice per car per frame) and the hazard actors' per-tick contact tests. Effects, scenery animation and audio were each under 0.35 ms headless.
- [general] Rendered rows were too noisy to rank small effects (the baseline ranged 12.3 to 14.4 ms over three repeats; "no effects" read slower than base). Draw calls were the clearer rendered signal (498 to 418 without effects).
- [general] Scale rows for effects wrote no result (no receipt after 8 to 10 s) in two phases. A later commit redefined the switch to scale spawn rate only, since the pooled meshes are built per slot and capacity cannot grow. With that, a rendered run read 13.10, 13.29 and 12.30 ms for base, 1.25x and 1.5x, the last below base: within noise, so the cost model supplies the number.

## Per-item cost model (headless Insights timers, Development build, 60 Hz, spread under 3%)

| Class | Items | Cost | Scales with | Game thread ms |
|---|---|---|---|---|
| Pooled effect, per tick | about 105 live (13 per car) | about 0.5 us each (Move 0.34, Scale 0.25 us per call) | live effects | 0.07 |
| Pooled effect, spawn | 8 acquires/frame | 1 to 17 us per spawn by kind | spawn events | 0.03 |
| Animated flame | 332 | 0.71 us (2 transform calls) | items, every frame | 0.24 |
| Animated prop | 20 | 5.1 us (15 calls) | items | 0.10 |
| Hazard actor tick | 78 | 20 us, 0.98 us of it animation | hazards x 8 cars | 1.57 |
| Hazard in AI loop | 78 in view | 3.18 ms total | hazards x stations x lanes x 2 passes x 8 cars | 3.18 |
| Machine | 10 | 43 us per tick | machines | 0.43 |
| Vehicle | 8 | 91 to 150 us per car; suspension trace 13 to 26 us each | cars | 0.73 to 1.20 |
| Track queries | about 40 per frame | 16 to 19 us each | same cars asked 4 to 5 times | 0.65 to 0.78 |

- [general] Tracing costs 5 to 8%: untraced 9.7/3.6/4.4 ms against traced 10.2/3.9/4.7 on three scenes. Take the headline number untraced.
- [general] Budget at 1.25x and 1.5x is cost per item times the count. Computed from the table, not measured: flames 0.24 becomes 0.30 and 0.36 ms, props 0.10 becomes 0.125 and 0.15, hazard actor ticks 1.57 becomes about 1.96 and 2.36, the AI layer 3.18 becomes at least 3.98 and 4.77 (pairwise and per-lane terms grow faster than the count).
- [general] That headless model under-predicts rendered cost. The heaviest scene with scenery, effects and props scaled up, unfixed, rose from 13.96 to 16.04 ms (p95 21.5), render thread 2.84 to 3.65 ms and draws 498 to 571, two repeats each, interim. Add a rendered scale row before promising a content budget.

## Result of the fixes, interim (rendered, three repeats)

- [general] Headless, prototypes alone: an AI loop hoist brought the heaviest scene to 7.33 ms, a hazard far-reject 9.01, a nearest-distance memo 9.88, a merged effect transform 10.61 (no gain, do not ship), all together 5.03 ms against 10.57 off. Rendered, all exact prototypes cut the heaviest scene 13.06 to 7.18 ms, and two lighter scenes 5.36 to 4.72 and 6.75 to 5.67.
- [general] With +50% growth the exact set gave 7.79 ms mean but p95 10.05, still above 8.33. A non-exact scenery-distance skip gave 7.23 against 7.19 without it (no gain, within noise). Other growth rows were still running.

## Right-sized verification

- [general] Ship a fix when it is a good idea architecturally and you are reasonably sure it does not make the game worse. Verification scales with blast radius, not with the diagnosis harness above.
- [general] The bar: the project's own automation tests, the in-game exactness check ([facts](unreal-native-profiling-facts.md)) when the fix is claimed exact, and before and after frame time on the three worst scenes by frame time, two runs each. One independent verifier per PR, merge when it passes, and a one-paragraph rollback note in the PR.
- [general] Not required: per-route sweeps, noise-floor studies, multi-verifier panels. Behaviour-changing fixes need the owner's approval whatever the number of runs.

Cost levers: [Lumen](../../unreal-features/references/unreal-lumen.md), [Nanite](../../unreal-features/references/unreal-nanite.md), [Virtual Shadow Maps](../../unreal-features/references/unreal-virtual-shadow-maps.md), [MegaLights](../../unreal-features/references/unreal-megalights.md).
