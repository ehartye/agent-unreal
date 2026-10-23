"""Construct unreal.Box several ways and record which work (Unreal 5.8, headless commandlet).

  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: EPF_REPORT (JSON report path). The project needs PythonScriptPlugin.
Box has a native make function (Engine/Source/Runtime/CoreUObject/Public/UObject/NoExportTypes.h, FBox: HasNativeMake=MakeBox with
parameters Min and Max), so the Python constructor takes min and max and nothing else. IsValid is a property, not a constructor argument.
"""
import json
import os

import unreal

report = {"engine": unreal.SystemLibrary.get_engine_version()}
low, high = unreal.Vector(-1, -2, -3), unreal.Vector(4, 5, 6)


def attempt(make):
    try:
        box = make()
        return {"ok": True, "min": [box.min.x, box.min.y, box.min.z], "max": [box.max.x, box.max.y, box.max.z], "is_valid": box.get_editor_property("is_valid")}
    except Exception as exc:
        return {"ok": False, "error": type(exc).__name__ + ": " + str(exc).splitlines()[0][:200]}


report["keywords_with_is_valid"] = attempt(lambda: unreal.Box(min=low, max=high, is_valid=True))
report["is_valid_only"] = attempt(lambda: unreal.Box(is_valid=True))
report["three_positional"] = attempt(lambda: unreal.Box(low, high, True))
report["positional"] = attempt(lambda: unreal.Box(low, high))
report["keywords"] = attempt(lambda: unreal.Box(min=low, max=high))

box = unreal.Box(low, high)
box.set_editor_property("is_valid", False)
report["set_false"] = box.get_editor_property("is_valid")
box.set_editor_property("is_valid", True)
report["set_true"] = box.get_editor_property("is_valid")
report["bounds_after_set"] = [box.get_editor_property("min").x, box.get_editor_property("max").z]
report["center_size"] = [str(v) for v in box.get_box_center_size()]

path = os.environ.get("EPF_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "epf-box.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[epf_box] wrote " + path)
