"""List what the `unreal` Python module exposes for a feature (Unreal 5.8, editor Python).

Which classes, structs, enums and functions does Python see for a plugin? Run it headless in a project that enables the plugin:
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Set UNREAL_SURFACE_MATCH to comma-separated, case-insensitive fragments of the names you want (for example "Hair,Groom"). The report
lists each match with its kind and the first public members. UNREAL_SURFACE_REPORT sets the output path (an absolute path; default
Saved/unreal-surface.json in the project, because a relative path lands in the engine's binaries folder).
"""
import json
import os

import unreal

MATCH = [m.strip().lower() for m in (os.environ.get("UNREAL_SURFACE_MATCH") or "").split(",") if m.strip()]
LIMIT = 40


def kind(obj):
    if isinstance(obj, type):
        enum_base = getattr(unreal, "EnumBase", None)
        if enum_base is not None and issubclass(obj, enum_base):
            return "enum"
        return "class"
    return "function" if callable(obj) else "other"


def members(obj):
    names = []
    for name in dir(obj):
        if name.startswith("_"):
            continue
        try:
            names.append(name)
        except Exception:
            continue
    return names


report = {"engine": unreal.SystemLibrary.get_engine_version(), "match": MATCH, "names": {}}
for name in sorted(dir(unreal)):
    if name.startswith("_") or not any(fragment in name.lower() for fragment in MATCH):
        continue
    try:
        obj = getattr(unreal, name)
    except Exception as exc:
        report["names"][name] = {"kind": "unreadable", "error": str(exc)[:80]}
        continue
    entry = {"kind": kind(obj)}
    if entry["kind"] in ("class", "enum"):
        found = members(obj)
        entry["members"] = len(found)
        entry["first"] = found[:LIMIT]
    report["names"][name] = entry

out = os.environ.get("UNREAL_SURFACE_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "unreal-surface.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as fh:
    json.dump(report, fh, indent=1)
unreal.log("[unreal_surface] %d names for %s, wrote %s" % (len(report["names"]), MATCH, out))
