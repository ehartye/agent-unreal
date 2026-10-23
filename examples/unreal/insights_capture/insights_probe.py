# Run inside a throwaway editor by insights_capture.mjs (-ExecCmds="py insights_probe.py"). Drives a short, known workload from the
# editor's tick so the trace has something to read back: it burns WORK_MS of the game thread on every tick, plus SPIKE_MS on every
# SPIKE_EVERY-th tick, marks the measured window with a trace region and bookmarks, then stops tracing and quits.
#
# Environment: INSIGHTS_REPORT (JSON path), INSIGHTS_WARMUP and INSIGHTS_FRAMES (ticks before and inside the region), INSIGHTS_REGION,
# INSIGHTS_WORK_MS, INSIGHTS_SPIKE_MS, INSIGHTS_SPIKE_EVERY, INSIGHTS_TRACE_FILE (when set, the trace is started late with Trace.File
# after the warm-up instead of at launch by -tracefile=), INSIGHTS_CONSOLE (console commands separated by ';' run on the first tick),
# INSIGHTS_PAUSE_AT and INSIGHTS_PAUSE_FOR (ticks into the region at which Trace.Pause runs, and how many ticks later Trace.Resume runs).
import json
import os
import time

import unreal

REPORT = os.environ["INSIGHTS_REPORT"]
WARMUP = int(os.environ.get("INSIGHTS_WARMUP", "30"))
FRAMES = int(os.environ.get("INSIGHTS_FRAMES", "120"))
REGION = os.environ.get("INSIGHTS_REGION", "Measured")
WORK_MS = float(os.environ.get("INSIGHTS_WORK_MS", "3"))
SPIKE_MS = float(os.environ.get("INSIGHTS_SPIKE_MS", "30"))
SPIKE_EVERY = int(os.environ.get("INSIGHTS_SPIKE_EVERY", "40"))
LATE_FILE = os.environ.get("INSIGHTS_TRACE_FILE", "")
PAUSE_AT = int(os.environ.get("INSIGHTS_PAUSE_AT", "0"))
PAUSE_FOR = int(os.environ.get("INSIGHTS_PAUSE_FOR", "0"))
CONSOLE = [c.strip() for c in os.environ.get("INSIGHTS_CONSOLE", "").split(";") if c.strip()]

state = {"tick": 0, "last": None, "intervals": [], "commands": [], "spikes": 0}


def cmd(text):
    state["commands"].append(text)
    unreal.SystemLibrary.execute_console_command(None, text)


def burn(ms):
    end = time.perf_counter() + ms / 1000.0
    while time.perf_counter() < end:
        pass


def finish():
    unreal.unregister_slate_post_tick_callback(handle)
    cmd("Trace.Status")
    cmd("Trace.Stop")
    with open(REPORT, "w", encoding="utf-8") as fh:
        json.dump({"warmup": WARMUP, "frames": FRAMES, "region": REGION, "workMs": WORK_MS, "spikeMs": SPIKE_MS, "spikeEvery": SPIKE_EVERY,
                   "spikes": state["spikes"], "pauseAt": PAUSE_AT, "pauseFor": PAUSE_FOR, "ticks": state["tick"], "commands": state["commands"],
                   "tickIntervalsMs": [round(v, 3) for v in state["intervals"]]}, fh)
    cmd("QUIT_EDITOR")


def tick(delta):
    now = time.perf_counter()
    n = state["tick"]
    if state["last"] is not None and n > WARMUP:
        state["intervals"].append((now - state["last"]) * 1000.0)
    state["last"] = now
    if n == 0:
        for c in CONSOLE:
            cmd(c)
    if n == WARMUP:
        if LATE_FILE:
            cmd("Trace.File " + LATE_FILE)
        cmd("Trace.Status")
        cmd("Trace.Bookmark MeasuredBegin")
        cmd("Trace.RegionBegin " + REGION)
    elif PAUSE_FOR and n == WARMUP + PAUSE_AT:
        cmd("Trace.Pause")
    elif PAUSE_FOR and n == WARMUP + PAUSE_AT + PAUSE_FOR:
        cmd("Trace.Resume")
    elif n == WARMUP + FRAMES:
        cmd("Trace.RegionEnd " + REGION)
        cmd("Trace.Bookmark MeasuredEnd")
    elif n > WARMUP + FRAMES + 3:
        finish()
        return
    if n > WARMUP and n < WARMUP + FRAMES:
        burn(WORK_MS)
        if SPIKE_EVERY and (n - WARMUP) % SPIKE_EVERY == 0:
            burn(SPIKE_MS)
            state["spikes"] += 1
    state["tick"] = n + 1


handle = unreal.register_slate_post_tick_callback(tick)
