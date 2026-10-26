# Prepared, not yet run on an engine. Run inside a throwaway game process by insights_stats.mjs (-ExecCmds="py insights_stats_probe.py").
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
        if n == 30:
            cmd("Trace.Bookmark LeakA")
        elif n == 31:
            state["held"] = make_array(HELD)       # alive at LeakC: a leak
            state["freed"] = make_array(FREED)     # freed between LeakB and LeakC: not a leak
        elif n == 32:
            cmd("Trace.Bookmark LeakB")
        elif n == 40:
            state["freed"] = None                  # the engine array behind it is freed here
        elif n == 60:
            cmd("Trace.Bookmark LeakC")
        elif n > 70:
            finish()
            return
    state["tick"] = n + 1


handle = unreal.register_slate_post_tick_callback(tick)
