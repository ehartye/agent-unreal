# Profiling tools: what each answers

Source for every `[documented]` line here: Epic's 5.8 pages "Stat Commands in Unreal Engine", "Unreal Insights in Unreal Engine", "Trace in Unreal Engine 5", "Timing Insights in Unreal Engine", "Using the Low-Level Memory Tracker in Unreal Engine", "Memory Insights in Unreal Engine", "PSO Precaching for Unreal Engine" and the AutomatedPerfTesting plugin API page. Running a capture and exporting its numbers is [unreal-native](../../unreal-native/SKILL.md): see its [Insights capture](../../unreal-native/references/unreal-native-insights-capture.md) and [profiling](../../unreal-native/references/unreal-native-profiling.md) references.

## Which tool for which question

| Question | Tool |
|---|---|
| Which thread is the frame bound on? | `stat unit` (Frame, Game, Draw, GPU, RHIT) |
| Which part of rendering is slow? | `stat SceneRendering`, `stat InitViews`, `stat LightRendering`, `stat GPU` |
| Which frame spiked, and what ran in it? | Insights Timing view: Frames panel, Timing panel, Timers, Callers and Callees |
| Where does memory go, and what leaked? | Low-Level Memory Tracker, then Memory Insights queries |
| Which shader compile caused a hitch? | `r.PSOPrecache.Validation`, `stat PSOPrecache`, Insights timers |
| Do loads respect priorities? | Insights Asset Loading view |

## What Epic documents

- `[documented]` Stat commands are the quickest way to get data while running but less robust than Insights or RenderDoc.
- `[tested]` `examples/unreal/insights_capture/insights_stats.mjs`, 8 of 8: `stat help` lists `stat unit` and `stat fps`, and a bare `stat` prints "Empty stat command!" and the brief list.
- `[tested]` Correction to Epic's page: in the installed build `stat startfile` and `stat stopfile` are compiled out. The help does not list them, and no `.uestats` file or "Wrote stats file" line appears. `StatsCommand.cpp` compiles them only when `UE_ENABLE_STATS_FILE_DEPRECATED_IN_5_8` is 1, and `StatsFile.h` defaults it to 0. Capture an Insights trace instead.
- `[documented]` Unreal Insights has three parts: trace events, the Unreal Trace Server (listening on port 1981, storing `.utrace` files) and the analysis tool. Traces are self-describing and compatible across engine versions.
- `[documented]` Channels control what is emitted. Default-enabled: Bookmark, Cpu, Frame, Gpu, Log, Region and Screenshot. `MemAlloc`, `MemTag` and `Module` must be started from the command line. `ContextSwitch` and `Task` are enabled with `-trace=default,ContextSwitch,Task`, and `ContextSwitch` needs administrator rights on Windows.
- `[documented]` `-tracetailmb=X` sets the tail buffer (4MB by default, 0 disables) so the lead-up to a problem is kept. `trace.bookmark` and `trace.screenshot` mark moments in the trace.
- `[documented]` The Low-Level Memory Tracker gives every engine allocation exactly one tag, so category totals add up to total game memory. Enable with `-LLM` or `-LLMCSV`; it is compiled out of Test and Shipping builds, and its own overhead can be 100MB or more.
- `[documented]` Memory Insights needs `-trace=default,memory` from process start (and `metadata,assetmetadata` for per-asset and per-class cost). Its Memory Leaks query finds allocations made between two times and not freed until after a third.
- `[tested]` Same example, probe scenario: a trace started with `-trace=default,memory` was 319 MB against 1.7 MB for `-trace=default`. `MemoryInsights.ExportAllocs` with the Active Alloc rule answered the first (3.5 million allocations alive at a bookmark); the `-trace=default` trace returned 0 rows and wrote no CSV.
- `[tested]` The Memory Leaks rule (`-Rule=AaBCf`) returned the held 1,200,000-byte array and not the freed 6,000,000-byte one; the Limited Lifetime rule (`-Rule=AaBfC`) returned the freed one. `Trace.Bookmark` bookmarks are found by exact name.
- `[tested]` An allocation made within a few milliseconds of a bookmark can be stamped before it, so the query returns 0 rows. Allocation times come from a marker written once per 4096 memory events (`MarkerSamplePeriod` in `MemoryTrace.cpp`). The probe makes thousands of small allocations between each bookmark and the allocation under test to move the marker.
- `[documented]` The AutomatedPerfTesting plugin lists material, placed-static-camera, replay, sequence and ProfileGo test classes with matching project-settings classes. The captured page is an API listing only: it gives no commands, metrics or thresholds, so do not describe how its results are produced or read.

## Judgements

- `[general]` Pick the cheapest tool that answers the question: `stat unit` to find the bound, a capture to find the frame, a memory trace only for a memory question.
- `[general]` A tool's output is evidence only with its conditions: which channels were on, which build, how long. A trace missing the `memory` channel from process start cannot answer a memory question later.
- `[general]` Prefer a repeatable capture scenario to an interactive one; an automated route through the same scene makes before and after comparable.
- `[general]` The AutomatedPerfTesting plugin may suit regression runs, but with no thresholds or output description captured here, treat its use as an experiment the owner decides on.

Next: [audit](unreal-quality-audit.md).
