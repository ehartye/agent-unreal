# Capturing an Unreal Insights trace and exporting frame times headless

Backs [Capturing and reading an Unreal Insights trace](../../../skills/unreal-native/references/unreal-native-insights-capture.md). Unreal Engine 5.8.2, Windows. No GPU and no window are needed.

The question: can an agent capture a short trace with a named region and read per-frame game-thread times out of it without opening the Insights window, and are the numbers the ones the script produced? A script runs a known load on the game thread (3 ms on every tick, plus a 30 ms stall on every 40th tick) inside `Trace.RegionBegin Measured` / `Trace.RegionEnd Measured`, with a bookmark at each end. `UnrealInsights.exe` then exports the region.

## Files

- `insights_probe.py` runs inside the throwaway editor. It marks the window, burns the load from `register_slate_post_tick_callback`, and stops the trace and quits. Environment variables set the warm-up, the frame count, the load, `INSIGHTS_PAUSE_AT` / `INSIGHTS_PAUSE_FOR` (a `Trace.Pause` and `Trace.Resume` inside the window) and `INSIGHTS_CONSOLE` (extra console commands on the first tick).
- `insights_capture.mjs` writes a content-only project (`PythonScriptPlugin` only) in the OS temp folder, starts the editor hidden, writes the response file, runs `UnrealInsights.exe` on each trace and prints one PASS or FAIL per claim, then the frame statistics per run.
- `insights-capture-checks.mjs` parses the CSV files and judges them: columns, region match, frame times, nearest-rank percentile, maximum, a budget verdict. `insights-capture.test.mjs` tests it with fixtures and needs no Unreal (it runs in `node scripts/check.mjs`).

## Run

```text
node examples/unreal/insights_capture/insights_capture.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--runs 2] [--frames 120] [--warmup 30] [--budget-ms 8.33] [--pause] [--start late|launch] [--mode game|editor] [--keep]
```

About 15 s per run plus 3 s for the export. Exit code 0 when every check passes.

## Command lines that worked

```text
UnrealEditor-Cmd.exe <Project>/Probe.uproject -game -nullrhi -unattended -nosplash -nopause -nosound -notraceserver
    -traceautostart=0 -trace=cpu,frame,bookmark,region,counters -statnamedevents -abslog=<log> -ExecCmds="py insights_probe.py"
UnrealInsights.exe -OpenTraceFile=<trace>.utrace -NoUI -AutoQuit -ExecOnAnalysisCompleteCmd="@=<file>.rsp" -abslog=<log>
```

The response file, one command per line:

```text
TimingInsights.ExportTimerStatistics <out>/stats-{region}.csv -region=Measured -threads=GameThread
TimingInsights.ExportTimingEvents <out>/frames-{region}.csv -region=Measured -threads=GameThread -timers=FEngineLoop::Tick -columns=ThreadName,TimerName,StartTime,EndTime,Duration,Depth
TimingInsights.ExportTimers <out>/timers.csv
TimingInsights.ExporTimers <out>/timers-typo.csv
```

## What was observed (12 of 12 checks passed on 5.8.2; one run is 119 full frames)

- The page [Using the Timers and Counters tabs in Unreal Insights](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-the-timers-and-counters-tabs-in-unreal-insights-for-unreal-engine) spells one command `TimingInsights.ExporTimers`. The installed source and the run agree on `TimingInsights.ExportTimers`; the page spelling writes no file.
- `ExportTimerStatistics` columns: `Name,Count,C.Avg,Incl,I.Min,I.Max,I.Avg,I.Med,Excl,E.Min,E.Max,E.Avg,E.Med`, one row per timer, values in seconds, aggregated per instance. The Insights window shows milliseconds. There is no percentile column.
- `ExportTimingEvents` writes the requested columns, one row per timer instance, `Duration` in seconds. Of the available columns (`ThreadId, ThreadName, TimerId, TimerName, StartTime, EndTime, Duration, Depth`) the default is `ThreadId,TimerId,StartTime,EndTime,Depth`, which has no duration, so ask for `Duration`.
- A region with 120 ticks gave 121 `FEngineLoop::Tick` events: the tick running when the region began and the one running when it ended are included whole. The statistics export clips them to the region, so its `Incl` is a little smaller than the sum of the event durations. The checks drop the two edge events.
- Two runs of the same window: median 3.5 and 3.7 ms, 99th percentile 33.5 and 33.7 ms, maximum 33.7 and 33.8 ms, mean 4.1 and 4.3 ms; both stalls found. `--pause` (20 of 120 ticks paused) left 101 events instead of 121.
- Without `-game` (`--mode editor`) the same load gave a median of 16.70 ms: the editor caps its tick rate, so the frame time is the cap and not the work. `t.MaxFPS 0` set from the script did not lift it.
- `-traceautostart=0` with `-tracefile=<path>` and no `Trace.File` stays "Not tracing" and writes no file. `Trace.Start` logs that it is deprecated in favour of `Trace.File` and writes `<Project>/Saved/Profiling/<timestamp>.utrace`. Both were observed in ad hoc runs of `insights_probe.py`, not in the runner.
- Insights exits 0 when `-region=` matches nothing; the failure is a `TimingInsights: Error:` line in its log, which the runner reads.

## Not verified

A rendered frame (`-nullrhi` throws render data away), the `gpu` and `rendercommands` channels, the render thread's frame time, a packaged build, trace overhead, and bookmarks read back from the trace (no headless export command reads them).
