# Run on 5.8.4 (8 of 8 checks pass). Run inside a throwaway game process by insights_stats.mjs (-ExecCmds="py insights_stats_probe.py").
# Two modes, chosen by STATS_MODE:
#   stats   runs the stat commands the unreal-quality references name and leaves their output in the log: "stat help" (lists the engine's stat
#           commands), a bare "stat" (the stat help text), "stat unit", "stat fps", and "stat startfile" ... "stat stopfile" around a few ticks.
#   memory  marks three bookmarks (LeakA, LeakB, LeakC) and, between them, makes two large allocations inside the engine: a held one (it is still
#           alive at LeakC) and one freed between LeakB and LeakC. The trace that insights_stats.mjs reads back then answers three Memory Insights
#           queries: Memory Leaks (A, B, C), Limited Lifetime (A, B, C) and Active Alloc (A).
# Environment: STATS_REPORT (JSON path), STATS_MODE, STATS_HELD_ELEMENTS and STATS_FREED_ELEMENTS (array lengths, memory mode).
# The script quits the process when it is done. No console command is guessed: the names below are the ones the unreal-quality references give
# (stat unit, stat fps, stat startfile, stat stopfile), Trace.Bookmark (used by insights_probe.py, which ran on 5.8.2) and the stat help forms
# read in Engine/Source/Runtime/Core/Private/Stats/StatsCommand.cpp and Engine/Source/Runtime/Engine/Private/UnrealEngine.cpp (HandleStatCommand).
import json
import os

import unreal

REPORT = os.environ["STATS_REPORT"]
MODE = os.environ.get("STATS_MODE", "stats")
HELD = int(os.environ.get("STATS_HELD_ELEMENTS", "300000"))
FREED = int(os.environ.get("STATS_FREED_ELEMENTS", "1500000"))

state = {"tick": 0, "commands": [], "held": None, "freed": None}


def cmd(text):
    state["commands"].append({"tick": state["tick"], "command": text})
    unreal.SystemLibrary.execute_console_command(None, text)


def make_array(count):
    """A TArray allocated inside the engine: unreal.Array holds the elements in an engine array, so the allocation is the engine's."""
    array = unreal.Array(float)
    try:
        array.extend([0.0] * count)
    except Exception:
        for _ in range(count):
            array.append(0.0)
    return array


def churn(count=4000):
    """Many short-lived engine allocations (each unreal.Array holds its elements in an engine TArray): at least two memory events each."""
    for _ in range(count):
        small = unreal.Array(float)
        small.append(0.0)


def finish():
    unreal.unregister_slate_post_tick_callback(handle)
    if MODE == "memory":
        cmd("Trace.Stop")
    with open(REPORT, "w", encoding="utf-8") as fh:
        json.dump({"mode": MODE, "ticks": state["tick"], "commands": state["commands"], "heldElements": HELD, "freedElements": FREED}, fh)
    cmd("QUIT_EDITOR")


# The tick numbers leave a few frames between commands so each command's output is complete before the next.
STATS_PLAN = {2: "stat help", 4: "stat", 6: "stat unit", 8: "stat fps", 10: "stat startfile", 40: "stat stopfile", 44: "stat unit", 46: "stat fps"}


def tick(delta):
    n = state["tick"]
    if MODE == "stats":
        if n in STATS_PLAN:
            cmd(STATS_PLAN[n])
        if n > 50:
            finish()
            return
    else:
        # An allocation event carries the time of the last memory marker, and the engine writes a marker once per 4096 memory events
        # (source: Engine/Source/Runtime/Core/Private/ProfilingDebugging/MemoryTrace.cpp, MarkerSamplePeriod and MemoryTrace_UpdateInternal).
        # A bookmark and an allocation made in the same few milliseconds can therefore be ordered the wrong way round in the trace, so
        # churn() runs thousands of small engine allocations between each step to push a marker past it.
        if n == 30:
            cmd("Trace.Bookmark LeakA")
        elif n in (31, 32, 33, 36, 37, 38, 41, 42, 43, 46, 47, 48, 51, 52, 53):
            churn()
        elif n == 35:
            state["held"] = make_array(HELD)       # alive at LeakC: a leak
            state["freed"] = make_array(FREED)     # freed between LeakB and LeakC: not a leak
        elif n == 40:
            cmd("Trace.Bookmark LeakB")
        elif n == 45:
            state["freed"] = None                  # the engine array behind it is freed here
        elif n == 50:
            cmd("Trace.Bookmark LeakC")
        elif n > 58:
            finish()
            return
    state["tick"] = n + 1


handle = unreal.register_slate_post_tick_callback(tick)
