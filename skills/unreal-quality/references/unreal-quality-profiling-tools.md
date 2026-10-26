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

- `[documented]` Stat commands are the quickest way to get data while running but less robust than Insights or RenderDoc. `stat startfile` writes a `.uestats` file and keeps running after PIE closes, so `stat stopfile` must be run.
- `[documented]` Unreal Insights has three parts: trace events, the Unreal Trace Server (listening on port 1981, storing `.utrace` files) and the analysis tool. Traces are self-describing and compatible across engine versions.
- `[documented]` Channels control what is emitted. Default-enabled: Bookmark, Cpu, Frame, Gpu, Log, Region and Screenshot. `MemAlloc`, `MemTag` and `Module` must be started from the command line. `ContextSwitch` and `Task` are enabled with `-trace=default,ContextSwitch,Task`, and `ContextSwitch` needs administrator rights on Windows.
- `[documented]` `-tracetailmb=X` sets the tail buffer (4MB by default, 0 disables) so the lead-up to a problem is kept. `trace.bookmark` and `trace.screenshot` mark moments in the trace.
- `[documented]` The Low-Level Memory Tracker gives every engine allocation exactly one tag, so category totals add up to total game memory. Enable with `-LLM` or `-LLMCSV`; it is compiled out of Test and Shipping builds, and its own overhead can be 100MB or more.
- `[documented]` Memory Insights needs `-trace=default,memory` from process start (and `metadata,assetmetadata` for per-asset and per-class cost). Its Memory Leaks query finds allocations made between two times and not freed until after a third.
- `[documented]` The AutomatedPerfTesting plugin lists material, placed-static-camera, replay, sequence and ProfileGo test classes with matching project-settings classes. The captured page is an API listing only: it gives no commands, metrics or thresholds, so do not describe how its results are produced or read.

## Judgements

- `[general]` Pick the cheapest tool that answers the question: `stat unit` to find the bound, a capture to find the frame, a memory trace only for a memory question.
- `[general]` A tool's output is evidence only with its conditions: which channels were on, which build, how long. A trace missing the `memory` channel from process start cannot answer a memory question later.
- `[general]` Prefer a repeatable capture scenario to an interactive one; an automated route through the same scene makes before and after comparable.
- `[general]` The AutomatedPerfTesting plugin may suit regression runs, but with no thresholds or output description captured here, treat its use as an experiment the owner decides on.

Next: [audit](unreal-quality-audit.md).
