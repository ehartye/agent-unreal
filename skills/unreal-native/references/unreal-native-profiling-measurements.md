# Profiling measurements: ablation, per-item costs and fix results from one native game

The numbers behind the method in [native profiling](unreal-native-profiling.md), from one consuming Unreal **5.8.2 CL56702186** project on Windows (packaged Development build, 1920x1080 for rendered runs); not reproduced in this repo. Every number is from one project and some are interim; use them to see the method, not as targets. Route, scene and switch names are placeholders. Exactness proofs, engine-source facts and tooling traps: [profiling facts](unreal-native-profiling-facts.md).

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
