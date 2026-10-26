"""Hold the editor for a number of seconds, then write a report: the probe that lets probe.mjs be tried under its time limit.

Run it through probe.mjs (headless editor), or directly:
  UnrealEditor.exe Project.uproject -ExecutePythonScript=<this file> -nullrhi -unattended -nosplash -nosound -notraceserver
Environment:
  PROBE_HANG    seconds to hold, one number (or several, separated by commas or spaces; they run one after the other)
  PROBE_REPORT  absolute path of the JSON report to write

The report is one object keyed by each requested number. An entry is {"status": "found", "requested_seconds", "slept_seconds"}.
A launcher run with a --timeout shorter than the hold ends the editor before this report is written, which is the case it exists for:
probe.mjs must then exit 1, say that the editor did not finish before the time limit, and name the editor log.
Prepared, not yet run on an engine; probe_timeout.mjs drives it.
"""
import json
import os
import re
import time
import traceback

import unreal


def names_from(text):
    seen = []
    for part in re.split(r"[,;\s]+", text or ""):
        if part and part not in seen:
            seen.append(part)
    return seen


report = {}
requested = names_from(os.environ.get("PROBE_HANG"))
try:
    if not requested:
        raise ValueError("PROBE_HANG is empty")
    for name in requested:
        seconds = float(name)
        unreal.log("[hang_probe] holding for %s s" % name)
        started = time.time()
        time.sleep(seconds)
        report[name] = {"status": "found", "requested_seconds": seconds, "slept_seconds": round(time.time() - started, 1)}
        unreal.log("[hang_probe] held %s s" % name)
except Exception:
    unreal.log_error("[hang_probe] " + traceback.format_exc())

path = os.environ.get("PROBE_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "probe-hang.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w", encoding="utf-8") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[hang_probe] %d holds, wrote %s" % (len(report), path))
