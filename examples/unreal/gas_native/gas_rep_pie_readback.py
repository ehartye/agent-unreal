"""Read back the Play In Editor multiplayer settings from Python without starting Play In Editor (Unreal 5.8, editor, no rendering).

  UnrealEditor.exe Project.uproject -nullrhi -ExecCmds="py <absolute-path-to-this-file>" -unattended -nosplash -nosound -notraceserver
Environment: GAS_REP_PIE_REPORT (JSON path). gas_rep.mjs --pie-readback starts it.

LevelEditorPlaySettings has PlayNetMode, PlayNumberOfClients, RunUnderOneProcess, bLaunchSeparateServer and ServerPort as EditAnywhere
properties in the 5.8 install header (the first three are private members). The question is whether Python reaches them, with which
names, and whether a write reads back. Nothing here is asserted: the report lists what each call returned or the exact exception text.
The default object is changed in memory only (never saved) and restored.
"""
import json
import os
import traceback

import unreal

REPORT = os.environ.get("GAS_REP_PIE_REPORT", "gas-rep-pie.json").replace("\\", "/")
report = {"engine": unreal.SystemLibrary.get_engine_version(), "class_found": False, "reads": {}, "writes": {}, "enum": {}, "errors": []}
state = {"wait": 3.0, "done": False}

# The Python name Unreal derives from a C++ property name is snake case; a bool drops its leading b. Both spellings are tried.
CANDIDATES = {
    "PlayNetMode": ["play_net_mode"],
    "PlayNumberOfClients": ["play_number_of_clients"],
    "RunUnderOneProcess": ["run_under_one_process"],
    "bLaunchSeparateServer": ["launch_separate_server", "b_launch_separate_server"],
    "ServerPort": ["server_port"],
}


def attempt(fn):
    try:
        return {"ok": True, "value": str(fn())}
    except Exception as exc:
        return {"ok": False, "error": repr(exc)[:300]}


def settings_object():
    cls = getattr(unreal, "LevelEditorPlaySettings", None)
    if cls is None:
        return None
    getter = getattr(unreal, "get_default_object", None)
    if getter is not None:
        return getter(cls)
    return cls.get_default_object()


def run():
    obj = settings_object()
    report["class_found"] = obj is not None
    if obj is None:
        return
    # Reads
    for cpp_name, names in CANDIDATES.items():
        report["reads"][cpp_name] = {n: attempt(lambda n=n: obj.get_editor_property(n)) for n in names}
    # The net mode enum, by the names the Python module offers.
    enum_cls = getattr(unreal, "PlayNetMode", None)
    report["enum"]["PlayNetMode_found"] = enum_cls is not None
    if enum_cls is not None:
        report["enum"]["members"] = [m for m in dir(enum_cls) if m.isupper()]
    # A write that reads back, restored afterwards: the number of clients, then the net mode.
    name = "play_number_of_clients"
    before = attempt(lambda: obj.get_editor_property(name))
    entry = {"before": before}
    if before["ok"]:
        original = obj.get_editor_property(name)
        entry["set"] = attempt(lambda: obj.set_editor_property(name, 2))
        entry["after"] = attempt(lambda: obj.get_editor_property(name))
        entry["restore"] = attempt(lambda: obj.set_editor_property(name, original))
        entry["restored"] = attempt(lambda: obj.get_editor_property(name))
    report["writes"][name] = entry
    mode_name = "play_net_mode"
    mode = {"before": attempt(lambda: obj.get_editor_property(mode_name))}
    if mode["before"]["ok"] and enum_cls is not None:
        original_mode = obj.get_editor_property(mode_name)
        target = getattr(enum_cls, "PIE_CLIENT", None) or getattr(enum_cls, "PIE_LISTEN_SERVER", None)
        mode["target"] = str(target)
        if target is not None:
            mode["set"] = attempt(lambda: obj.set_editor_property(mode_name, target))
            mode["after"] = attempt(lambda: obj.get_editor_property(mode_name))
            mode["restore"] = attempt(lambda: obj.set_editor_property(mode_name, original_mode))
            mode["restored"] = attempt(lambda: obj.get_editor_property(mode_name))
    report["writes"][mode_name] = mode


def finish():
    state["done"] = True
    os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=2, default=str)
    unreal.log("[gas-rep] PIE settings report written")
    unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")


def tick(dt):
    if state["done"]:
        return
    state["wait"] -= dt
    if state["wait"] > 0:
        return
    try:
        run()
    except Exception as exc:
        report["errors"].append({"error": repr(exc)[:500], "trace": traceback.format_exc()[-900:]})
    finish()


handle = unreal.register_slate_post_tick_callback(tick)
