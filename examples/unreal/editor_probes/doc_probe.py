"""Print the docstring of dotted `unreal` callables, so a call is written from the signature instead of guessed.

Run it through probe.mjs (headless editor), or directly:
  UnrealEditor.exe Project.uproject -ExecutePythonScript=<this file> -nullrhi -unattended -nosplash -nosound -notraceserver
Environment:
  PROBE_CALLABLES  names to look up, separated by commas or spaces; relative to `unreal`, for example
                   GeometryScript_Primitives.append_disc,EditorAssetLibrary.save_asset (an `unreal.` prefix is accepted)
  PROBE_REPORT     absolute path of the JSON report to write

The report is one object keyed by each requested name. An entry is {"status": "found", "kind", "doc"}, or {"status": "missing",
"reason", "nearby"} when a part of the path does not exist, or {"status": "unavailable", "reason"} when the object has no docstring.
A function's docstring starts with its signature (parameter names, defaults, return type) and lists each parameter with its type.
A class docstring is a description and the header it comes from, not a signature: look up a member of the class instead.
"""
import inspect
import json
import os
import re
import traceback

import unreal


def names_from(text):
    seen = []
    for part in re.split(r"[,;\s]+", text or ""):
        if part and part not in seen:
            seen.append(part)
    return seen


def kind_of(obj):
    if inspect.isclass(obj):
        return "class"
    return "callable" if callable(obj) else "value"


def look_up(name):
    parts = name.split(".")
    if parts and parts[0] == "unreal":
        parts = parts[1:]
    holder = unreal
    walked = "unreal"
    for part in parts:
        if not hasattr(holder, part):
            like = [n for n in dir(holder) if part.lower() in n.lower() or n.lower() in part.lower()]
            return {"status": "missing", "reason": "%s has no attribute '%s'" % (walked, part), "nearby": sorted(like)[:12]}
        holder = getattr(holder, part)
        walked += "." + part
    doc = inspect.getdoc(holder) if parts else None
    if not doc or not doc.strip():
        return {"status": "unavailable", "reason": "%s has no docstring" % walked}
    return {"status": "found", "kind": kind_of(holder), "doc": doc.replace("\r\n", "\n")}


report = {}
requested = names_from(os.environ.get("PROBE_CALLABLES"))
try:
    if not requested:
        raise ValueError("PROBE_CALLABLES is empty")
    for name in requested:
        try:
            report[name] = look_up(name)
        except Exception as exc:
            report[name] = {"status": "unavailable", "reason": "%s: %s" % (type(exc).__name__, exc)}
except Exception:
    unreal.log_error("[doc_probe] " + traceback.format_exc())

path = os.environ.get("PROBE_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "probe-doc.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w", encoding="utf-8") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[doc_probe] %d names, wrote %s" % (len(report), path))
