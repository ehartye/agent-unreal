"""UMG probe, run half: play a map offscreen, add a compiled widget to the viewport, save frames with and without it, then quit.

  UnrealEditor.exe Project.uproject -RenderOffScreen -ExecCmds="py <abs path to this file>" -abslog=<log> -notraceserver -nosplash -unattended -nosound
  (in Git Bash set MSYS_NO_PATHCONV=1; do not use -ExecutePythonScript, that mode exits when the script ends). umg_probe.mjs starts it and passes the environment.

Environment: UMG_MODE ("widget" or "commonui"), UMG_REPORT (JSON report path), UMG_PREFIX (screenshot name prefix), UMG_WIDGET (the Widget Blueprint
asset path the session saved, for example /Game/UI/WBP_ProbeHud), UMG_INPUT_DATA (commonui: the CommonUIInputData Blueprint asset path).

What it does, in order:
  asset      load the saved Widget Blueprint in this new process: class, blueprint status (a compiled blueprint reads up to date)
  settings   commonui only: read back what the session saved into the project settings (Game Viewport Client Class, Common Input Settings Input Data)
  play       a blank saved map (a black scene), Play In Editor (the viewport of a rendering editor with no window), settle
  frames     a frame with no widget, by two routes: the console command `Shot showui filename=<stem>` (the viewport with its UI) and
             AutomationLibrary.take_high_res_screenshot (a shot without UI, as the engine documents the high-resolution shot)
  widget     unreal.new_object on the generated widget class (the creation call the counted run used) and add_to_viewport; commonui also reads is_activated(), calls
             activate_widget() and reads it again; then the same two frames with the widget
The report lists each frame (label, route, file stem) so the runner can find the PNGs under Saved/Screenshots. Files are written by the engine with its own
suffix (a 00000 after the stem for the console command), so the runner matches on the stem. Nothing here writes a machine name or a user path into a report.
"""
import json
import os
import traceback

import unreal

MODE = os.environ.get("UMG_MODE", "widget")
PREFIX = os.environ.get("UMG_PREFIX", "umg")
WIDGET = os.environ.get("UMG_WIDGET", "/Game/UI/WBP_ProbeHud")
INPUT_DATA = os.environ.get("UMG_INPUT_DATA", "")
WIDTH, HEIGHT = 1280, 720
MAP = "/Game/Maps/UmgProbe"
PROJECT = unreal.SystemLibrary.get_project_directory().replace("\\", "/")
report = {"probe": "stage", "mode": MODE, "engine": unreal.SystemLibrary.get_engine_version(), "steps": {}, "shots": [], "events": []}
state = {"widget_class": None, "t": 0.0, "pie": False, "pie_t": 0.0, "done": False, "busy": False, "setup": False, "task": None, "wait": 0.0, "world": None}


def report_path():
    return os.environ.get("UMG_REPORT") or os.path.join(unreal.SystemLibrary.get_project_saved_directory(), "umg-stage.json")


def clean(text):
    """Keep an error text whole, but never write the project folder into a report."""
    return str(text).replace("\\", "/").replace(PROJECT.rstrip("/"), "<project>")


def write_report():
    os.makedirs(os.path.dirname(report_path()), exist_ok=True)
    with open(report_path(), "w") as fh:
        json.dump(report, fh, indent=2, default=str)


def guarded(name, fn):
    """Run fn (returns a dict of fields); a step that raises is recorded as {error} and the next step still runs."""
    try:
        report["steps"][name] = fn() or {}
    except Exception:
        report["steps"][name] = {"error": clean(traceback.format_exc()[-700:])}
    write_report()
    return report["steps"][name]


def game_world():
    try:
        return unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_game_world()
    except Exception:
        return None


def read_properties(object_path, names):
    """The toolset library's reader: it works by reflection, so it also reads classes Python does not expose."""
    obj = unreal.load_object(None, object_path)
    if obj is None:
        return {"error": "no object at " + object_path}
    text = unreal.ToolsetLibrary.get_object_properties(obj, [unreal.Name(n) for n in names])
    try:
        return {"values": json.loads(text)}
    except Exception:
        return {"text": str(text)[:400]}


# ---------------------------------------------------------------- before play
def asset_step():
    blueprint = unreal.EditorAssetLibrary.load_asset(WIDGET)
    cls = unreal.EditorAssetLibrary.load_blueprint_class(WIDGET)
    state["widget_class"] = cls   # loaded here, before play: the same call returned nothing while a Play-In-Editor world was running
    out = {"asset_loaded": blueprint is not None, "class_loaded": cls is not None, "class_name": cls.get_name() if cls else None}
    try:
        status = getattr(blueprint, "status", None) if blueprint is not None else None
        out["blueprint_status"] = str(status() if callable(status) else status) if blueprint is not None else None
    except Exception as exc:
        out["blueprint_status_error"] = clean(exc)[:200]
    return out


def settings_step():
    out = {"engine": read_properties("/Script/Engine.Default__Engine", ["GameViewportClientClassName"]),
           "input_settings": read_properties("/Script/CommonInput.Default__CommonInputSettings", ["InputData"])}
    if INPUT_DATA:
        cls = unreal.EditorAssetLibrary.load_blueprint_class(INPUT_DATA)
        out["input_data_class_loaded"] = cls is not None
    return out


# ---------------------------------------------------------------- playing
def shot(world, label):
    """Two frames: the console command with the UI, and the high-resolution shot. Recorded before the call (it can run the Slate tick again)."""
    stem = "%s_%s" % (PREFIX, label)
    report["shots"].append({"label": label, "route": "showui", "stem": stem + "_showui"})
    write_report()
    unreal.SystemLibrary.execute_console_command(world, "Shot showui filename=" + stem + "_showui")
    yield 2.5
    report["shots"].append({"label": label, "route": "hires", "stem": stem + "_hires"})
    write_report()
    unreal.AutomationLibrary.take_high_res_screenshot(WIDTH, HEIGHT, stem + "_hires.png")
    yield 2.5


def widget_state(widget):
    out = {"class_name": widget.get_class().get_name(), "in_viewport": bool(widget.is_in_viewport())}
    if MODE == "commonui":
        out["activated"] = bool(widget.is_activated())
        out["is_activatable"] = isinstance(widget, unreal.CommonActivatableWidget)
    return out


def instantiate(world, cls, controller):
    """Make the widget instance. WidgetLibrary.create (the Create Widget node) is not reachable from Python in the build this was written against, so the
    routes are tried in order and the one that worked is recorded: the library function when it exists, then a plain new_object owned by the controller."""
    tried = []
    if hasattr(unreal.WidgetLibrary, "create"):
        tried.append("WidgetLibrary.create")
        try:
            widget = unreal.WidgetLibrary.create(world, cls, controller)
            report["steps"]["create"] = {"created": widget is not None, "route": tried[-1], "class_name": widget.get_class().get_name() if widget else None}
            return widget
        except Exception:
            report["steps"]["create_error_" + tried[-1]] = clean(traceback.format_exc()[-400:])
    tried.append("new_object")
    try:
        widget = unreal.new_object(cls, controller)
        widget.set_owning_player(controller)
        report["steps"]["create"] = {"created": widget is not None, "route": tried[-1], "class_name": widget.get_class().get_name() if widget else None}
        return widget
    except Exception:
        report["steps"]["create"] = {"created": False, "tried": tried, "error": clean(traceback.format_exc()[-600:])}
        return None


def sequence():
    """A generator: each yield is a number of seconds to wait before the next piece of work."""
    world = game_world()
    controller = unreal.GameplayStatics.get_player_controller(world, 0)
    size = unreal.WidgetLayoutLibrary.get_viewport_size(world)
    report["steps"]["viewport"] = {"width": size.x, "height": size.y, "controller": controller.get_class().get_name() if controller else None}
    yield 3.0
    for item in shot(world, "base"):
        yield item
    widget = instantiate(world, state.get("widget_class"), controller)
    if widget is None:
        return
    if MODE == "commonui":
        report["steps"]["before_activation"] = widget_state(widget)
    widget.add_to_viewport(0)
    yield 1.0
    report["steps"]["added"] = widget_state(widget)
    write_report()
    if MODE == "commonui":
        widget.activate_widget()
        yield 1.0
        report["steps"]["after_activation"] = widget_state(widget)
        unreal.SystemLibrary.execute_console_command(world, "CommonUI.DumpActivatableTree")
        yield 0.5
        write_report()
    yield 1.5
    for item in shot(world, "widget"):
        yield item


def finish():
    state["done"] = True
    write_report()
    unreal.log("[umg_stage] wrote " + report_path())
    unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")


def step_tick(dt):
    state["t"] += dt
    if not state["pie"]:
        if state["t"] > 5.0:
            unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_begin_play()
            state["pie"], state["pie_t"] = True, state["t"]
        return
    rel = state["t"] - state["pie_t"]
    world = game_world()
    if world is None:
        if rel > 120.0:
            report["events"].append("no game world after 120 s")
            finish()
        return
    if rel > 2.0 and not state["setup"]:
        state["setup"] = True
        for pawn in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.DefaultPawn):
            pawn.set_actor_hidden_in_game(True)
        for cmd in ("r.AntiAliasingMethod 0", "r.ScreenPercentage 100"):
            unreal.SystemLibrary.execute_console_command(world, cmd)
    if rel < 8.0:
        return
    if state["task"] is None:
        state["task"] = sequence()
    if state["wait"] > 0:
        state["wait"] -= dt
        return
    try:
        state["wait"] = next(state["task"])
    except StopIteration:
        finish()


def tick(dt):
    if state["done"] or state["busy"]:
        return
    state["busy"] = True
    try:
        step_tick(dt)
    except Exception:
        report["events"].append(clean(traceback.format_exc()[-700:]))
        finish()
    finally:
        state["busy"] = False


guarded("asset", asset_step)
if MODE == "commonui":
    guarded("settings", settings_step)
try:
    # a blank map: nothing in the scene, so the frame without the widget is black and does not move (a template level has a sky that drifts between two frames)
    unreal.EditorAssetLibrary.make_directory("/Game/Maps")
    unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
    unreal.EditorLoadingAndSavingUtils.save_map(unreal.EditorLevelLibrary.get_editor_world(), MAP)
except Exception:
    report["events"].append("blank map: " + clean(traceback.format_exc()[-300:]))
write_report()
unreal.register_slate_post_tick_callback(tick)
unreal.log("[umg_stage] tick callback registered (%s)" % MODE)
