# Capturing and reading an Unreal Insights trace for a frame budget

Unreal Engine 5.8, Windows. Evidence: `examples/unreal/insights_capture/` (`node insights_capture.mjs --engine <UE_5.8 folder>`: a game process with `-nullrhi`, a scripted load, 11 checks passed), the vendor pages [Unreal Insights Reference](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-insights-reference-in-unreal-engine-5), [Timers and Counters tabs](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-the-timers-and-counters-tabs-in-unreal-insights-for-unreal-engine) and [Trace Control tab](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-the-trace-control-tab-in-unreal-insights-for-unreal-engine), Epic Games Japan's [Unreal Fest Bali 2025 deck](https://docswell.com/s/EpicGamesJapan/KEYMXN-2025-10-14-210735), Intel's [profiling fundamentals](https://www.intel.com/content/www/us/en/developer/articles/technical/unreal-engine-optimization-profiling-fundamentals.html), Meta's [Insights on Quest](https://developers.meta.com/horizon/documentation/unreal/ts-unreal-insights-ue5/), and installed source under `Engine/Source` (`Runtime/Core/Private/ProfilingDebugging/TraceAuxiliary.cpp`, `Developer/TraceInsights/Private/Insights/TimingProfiler/`). The harness and measured project results are in [native profiling](unreal-native-profiling.md) and [facts](unreal-native-profiling-facts.md).

## Pick channels for the question

- [documented] Find the bound first with `stat unit`: Game near Frame is game logic, Draw is scene complexity, GPU is rendering (Epic deck). The Epic deck then gives one `-trace=` set per thread type:
  - [documented] game thread `cpu,frame,assetloadtime` plus `-statnamedevents`;
  - [documented] render thread `cpu,frame,rendercommands,rhicommands,rdg`;
  - [documented] GPU `cpu,gpu,frame`, at the target resolution, with `r.RDG.AsyncCompute 0` for per-pass times;
  - [documented] worker threads `cpu,frame,task` plus `-statnamedevents` (add `contextswitch` as administrator);
  - [documented] file I/O `cpu,file,assetloadtime,loadtimes,iostore` plus `-statnamedevents`.
- [documented] Meta's minimal-overhead set for a packaged build is `counters,cpu,frame,bookmark,gpu`; its most detailed adds `log,file,loadtime,rhicommands,rendercommands,object`. `-statnamedevents` adds named CPU events at the cost of overhead (Trace Control tab).
- [documented] An event is emitted only when its channel is on (Reference), so add `bookmark,region` to carry markers. [tested] `cpu,frame,bookmark,region,counters` gave game-thread frame timers and the region (`insights_capture.mjs`).

## Start, mark and stop

- [tested] `-traceautostart=0 -trace=<channels>` holds the channels and writes nothing; `Trace.File <path>` then starts the file, so the warm-up stays out (`insights_capture.mjs`, default). `-tracefile=<path>` with no `-traceautostart=0` starts at launch ([general] `--start launch`, observed on an earlier engine build, not repeated on the pinned build). `-tracefile=` together with `-traceautostart=0` stayed "Not tracing" ([general] ad hoc run of `insights_probe.py` on an earlier engine build; source `TraceAuxiliary.cpp` registers the channels only). Use `-notraceserver`; no server was needed for a file trace.
- [tested] `Trace.Status` prints the file and enabled channels; `Trace.Stop` closes the file; `Trace.Pause` and `Trace.Resume` leave the paused ticks out ([general] 101 of 121 events with 20 of 120 ticks paused, `--pause`, on an earlier engine build). [documented] `Trace.Start` is deprecated for `Trace.File` (source); an ad hoc run wrote `Saved/Profiling/<timestamp>.utrace`.
- [tested] `Trace.RegionBegin <name>` and `Trace.RegionEnd <name>` bound the measured window; begin it after warm-up. The Epic deck spells the first `Trace.RegionBeing`; the source defines only `Trace.RegionBegin`. `Trace.Bookmark <name>` marks a point.
- [documented] No installed Insights command exports bookmarks (the commands are `ExportThreads`, `ExportTimers`, `ExportTimingEvents`, `ExportTimerStatistics`, `ExportTimerCallees`, `ExportCounters`, `ExportCounterValues`, `MemoryInsights.ExportAllocs`), so read them in the window.

## Export headless

- [tested] `UnrealInsights.exe -OpenTraceFile=<trace> -NoUI -AutoQuit -ExecOnAnalysisCompleteCmd="@=<file>.rsp"` ran hidden and exited 0 in 2 to 4 s for a 2.4 MB trace. The response file holds one command per line:

```text
TimingInsights.ExportTimerStatistics <out>/stats-{region}.csv -region=Measured -threads=GameThread
TimingInsights.ExportTimingEvents <out>/frames-{region}.csv -region=Measured -threads=GameThread -timers=FEngineLoop::Tick -columns=ThreadName,TimerName,StartTime,EndTime,Duration,Depth
```

- [general] Observed on an earlier engine build; not repeated on the pinned build: the Timers page spells a command `TimingInsights.ExporTimers`; it writes nothing. The command is `TimingInsights.ExportTimers`, as in the source. A `-region=` that matches nothing logs `TimingInsights: Error: Unable to find any region` and Insights still exits 0 (ad hoc response file), so read its log for `Error:` lines.
- [tested] Statistics columns: `Name,Count,C.Avg,Incl,I.Min,I.Max,I.Avg,I.Med,Excl,E.Min,E.Max,E.Avg,E.Med`. Times are seconds (the window shows ms), per instance: `I.Max` is the longest single `FEngineLoop::Tick`. There is no percentile column, so export the events and compute it.
- [tested] `ExportTimingEvents` with `-columns=` including `Duration` gave one row per game-thread frame (`FEngineLoop::Tick` on `GameThread`). A 120-tick region gave 121 rows: the frames running at the region's begin and end are included whole. Drop those two; the statistics export clips them instead.
- [documented] `{region}` in the file name becomes the region name, `-region=` takes wildcards and writes one file per region, and exports stop at 100 files per region name and 10,000 in total with an error (`TimingExporter.cpp` lines 811 and 812; the Timers page gives the same caps). The source notes that `-timers=` is not yet applied by `ExportTimerStatistics`.

## Report against a budget

- [general] Judge the slow tail: the 99th percentile (nearest rank, the `ceil(0.99 n)`-th sorted value) and the maximum over the window, with the mean as context. Intel names the 99th percentile for stutter. With 119 frames the 99th is the second slowest, so use 1,000 or more frames when the tail matters.
- [tested] Two stalls of 30 ms in 119 frames: mean 4.1 and 4.3 ms, median 3.5 and 3.7, 99th 33.5 and 33.7, maximum 33.7 and 33.8 ms. The mean passes 8.33 ms and the tail fails; `budgetVerdict` in `insights-capture-checks.mjs` returns both.
- [general] Fix the resolution (`-ResX`, `-ResY`, or `r.ScreenPercentage`), discard warm-up, repeat the run and compare medians (the example requires two within 25 percent), and record build configuration, channels and flags with every number. Intel says to decide on multiple samples and runs, not one short capture; the Epic deck says to capture at the target resolution.

## Build configuration

- [documented] Intel recommends a modified Test configuration: Development turns on costlier GPU crash debugging (`r.D3D12.DRED`), and its synthbenchmark ran up to 30 percent higher on Test. Test needs `bAllowProfileGPUInTest` for ProfileGPU markers and `FORCE_USE_STATS=1` for full stat support. Meta and Epic assume a Development build.
- [documented] For Development, Intel gives `-dpcvars=r.D3D12.DRED=0,r.D3D12.LightweightDRED=0,r.GPUCrashDebugging.Breadcrumbs=0`, and says that since 5.5 DRED is off and breadcrumbs on by default, so check the defaults on your build. It adds that other Test and Development differences remain.
- [general] No source quantifies Insights trace overhead, or the Test versus Development gap beyond Intel's synthbenchmark note. The project in [native profiling](unreal-native-profiling.md) measured 5 to 8 percent on its game; take headline numbers untraced.

## Where the method stops

- [tested] `-nullrhi` throws render data away: the example shows the export and the statistics, not a rendered frame. The GPU, render thread and `gpu` channel were not exercised. [native profiling](unreal-native-profiling.md) holds the measured headless gap; confirm a budget in a rendered run.
- [general] Observed on an earlier engine build; not repeated on the pinned build: without `-game`, `UnrealEditor-Cmd.exe` capped the tick: a 3 ms load gave a median of 16.70 ms (`--mode editor`), and `t.MaxFPS 0` did not lift it. Measure a game process.
- [general] A trace is one run on one build. Before attributing a cost, pair it with an ablation or a before and after on the same route, as [native profiling](unreal-native-profiling.md) does.
