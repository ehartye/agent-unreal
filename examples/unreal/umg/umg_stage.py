"""UMG probe, run half: play a map offscreen, add a compiled widget to the viewport, save frames with and without it, then quit. Mode "input" reads the running
  game viewport client and tries to deliver a key or a click to the active Common button.

  UnrealEditor.exe Project.uproject -RenderOffScreen -ExecCmds="py <abs path to this file>" -abslog=<log> -notraceserver -nosplash -unattended -nosound
  (in Git Bash set MSYS_NO_PATHCONV=1; do not use -ExecutePythonScript, that mode exits when the script ends). umg_probe.mjs starts it and passes the environment.

Environment: UMG_MODE ("widget", "commonui", "input" or "rpc"), UMG_RPC (a folder; the stage script runs <folder>/request.py on the game thread and writes <folder>/result.json), UMG_CONTINUE (input: a file the runner writes when its calls to the Slate inspector are done), UMG_REPORT (JSON report path), UMG_PREFIX (screenshot name prefix), UMG_WIDGET (the Widget Blueprint
asset path the session saved, for example /Game/UI/WBP_ProbeHud), UMG_INPUT_DATA (commonui: the CommonUIInputData Blueprint asset path).

What it does, in order:
  asset      load the saved Widget Blueprint in this new process: class, blueprint status (a compiled blueprint reads up to date)
  settings   commonui only: read back what the session saved into the project settings (Game Viewport Client Class, Common Input Settings Input Data)
  play       a blank saved map (a black scene), Play In Editor (the viewport of a rendering editor with no window), settle
  frames     a frame with no widget, by two routes: the console command `Shot showui filename=<stem>` (the viewport with its UI) and
             AutomationLibrary.take_high_res_screenshot (a shot without UI, as the engine documents the high-resolution shot)
  input      (mode "input", after the widget is active) viewport_client: the class of the running game viewport client, read by reflection from the player controller;
             input_ready: the Common button, its state and what Python reaches; then, once UMG_CONTINUE exists, a frame, each route (a control that calls the click
             delegate, a focus precondition, then the routes that try to deliver a key or click) with the log counter and the button state read before and after, a frame
  widget     unreal.new_object on the generated widget class (the creation call the counted run used) and add_to_viewport; commonui also reads is_activated(), calls
             activate_widget() and reads it again; then the same two frames with the widget
The report lists each frame (label, route, file stem) so the runner can find the PNGs under Saved/Screenshots. Files are written by the engine with its own
suffix (a 00000 after the stem for the console command), so the runner matches on the stem. Nothing here writes a machine name or a user path into a report.
"""
import json
import os
import re
import traceback

import unreal

MODE = os.environ.get("UMG_MODE", "widget")
PREFIX = os.environ.get("UMG_PREFIX", "umg")
WIDGET = os.environ.get("UMG_WIDGET", "/Game/UI/WBP_ProbeHud")
INPUT_DATA = os.environ.get("UMG_INPUT_DATA", "")
CONTINUE = os.environ.get("UMG_CONTINUE", "")
RPC_DIR = os.environ.get("UMG_RPC", "")
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
    if MODE in ("commonui", "input"):
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



# ---------------------------------------------------------------- input mode: the running viewport client, and the routes that try to reach the Common button
CLICKS = {"count": 0}
STATE_GETTERS = ["is_hovered", "is_pressed", "has_any_user_focus", "has_keyboard_focus", "has_mouse_capture", "get_selected", "is_selected", "get_is_selected", "is_interaction_enabled", "is_visible", "is_activated"]
REACH_WORDS = r"click|press|key|input|simulate|focus|navigate|mouse|touch|inject|submit|trigger|handle"
REACH_CLASSES = ["EnhancedInputLibrary", "EnhancedInputLocalPlayerSubsystem", "EnhancedPlayerInput", "KismetInputLibrary", "WidgetBlueprintLibrary", "CommonUILibrary",
                 "CommonInputSubsystem", "CommonButtonBase", "CommonUserWidget", "SlateBlueprintLibrary", "PlayerInput", "InputSettings"]


def on_click(button=None):
    CLICKS["count"] += 1
    unreal.log("[umg_stage] CLICKED count=%d" % CLICKS["count"])


def plain(value):
    """A value that JSON can write."""
    if isinstance(value, (bool, int, float, str)) or value is None:
        return value
    return str(value)[:200]


def read_state(widget):
    out = {}
    for name in STATE_GETTERS:
        fn = getattr(widget, name, None)
        if callable(fn):
            try:
                out[name] = plain(fn())
            except Exception as exc:
                out[name] = "error: " + clean(exc)[:80]
    return out


def mouse_position(controller):
    """Where the game viewport sees the cursor: it moves when a simulated mouse event reaches the viewport."""
    try:
        return [plain(v) for v in controller.get_mouse_position()]
    except Exception as exc:
        return "error: " + clean(exc).splitlines()[0][:80]


def reach(obj, pattern=REACH_WORDS):
    try:
        return sorted(n for n in dir(obj) if not n.startswith("_") and re.search(pattern, n, re.I))
    except Exception as exc:
        return ["error: " + clean(exc)[:80]]


def read_object_properties(obj, names):
    """The toolset library's reader by reflection: the JSON it returns, parsed (a property Python does not expose is read too)."""
    text = unreal.ToolsetLibrary.get_object_properties(obj, [unreal.Name(n) for n in names])
    try:
        return json.loads(text)
    except Exception:
        return {"text": str(text)[:400]}


def ref_paths(value):
    found = []
    if isinstance(value, dict):
        if isinstance(value.get("refPath"), str):
            found.append(value["refPath"])
        for item in value.values():
            found.extend(ref_paths(item))
    elif isinstance(value, list):
        for item in value:
            found.extend(ref_paths(item))
    elif isinstance(value, str) and value.startswith("/") and ("." in value or ":" in value):
        found.append(value)
    return found


def find_by_path(path):
    for fn in (unreal.find_object, unreal.load_object):
        try:
            obj = fn(None, path)
            if obj is not None:
                return obj
        except Exception:
            pass
    return None


def viewport_step(world, controller):
    """Question 3: the class of the game viewport client that is running. Each route is recorded; the first that names a class sets running_class."""
    out = {"routes": [], "running_class": None, "running_path": None}

    def add(route, **fields):
        fields["route"] = route
        out["routes"].append(fields)
        return fields

    try:
        got = read_object_properties(controller, ["Player"])
        paths = ref_paths(got)
        add("player controller, Player property by reflection", value=got if not paths else paths[0])
        player = find_by_path(paths[0]) if paths else None
        add("the local player object", value=player.get_class().get_name() if player else None)
        if player is not None:
            vgot = read_object_properties(player, ["ViewportClient"])
            vpaths = ref_paths(vgot)
            add("local player, ViewportClient property by reflection", value=vpaths[0] if vpaths else vgot)
            viewport = find_by_path(vpaths[0]) if vpaths else None
            if viewport is not None:
                cls = viewport.get_class()
                out["running_class"], out["running_path"] = cls.get_name(), cls.get_path_name()
                add("viewport client object, get_class()", value=out["running_path"])
            elif vpaths:
                name = re.sub(r"_\d+$", "", vpaths[0].split(":")[-1].split(".")[-1])
                add("viewport client name from the reference (the object was not found)", value=name)
                out["running_class"] = out["running_class"] or name
    except Exception:
        add("controller, local player, viewport client by reflection", error=clean(traceback.format_exc()[-400:]))
    if out["running_class"] is None:
        # the object lives under the editor engine; its name carries the class, so the two names a viewport client can have are tried by path
        for outer in ("/Engine/Transient.UnrealEdEngine_0",):
            for name in ("CommonGameViewportClient_0", "GameViewportClient_0"):
                obj = find_by_path(outer + ":" + name)
                add("find_object %s:%s" % (outer, name), value=obj.get_class().get_path_name() if obj is not None else None)
                if obj is not None and out["running_class"] is None:
                    out["running_class"], out["running_path"] = obj.get_class().get_name(), obj.get_class().get_path_name()
    unreal.log("[umg_stage] viewport_client class=%s path=%s" % (out["running_class"], out["running_path"]))
    return out


def attempts(*thunks):
    """Try each way of calling in turn; the first that does not raise wins. Returns (index, result, errors)."""
    errors = []
    for index, thunk in enumerate(thunks):
        try:
            return index, thunk(), errors
        except Exception as exc:
            errors.append("form %d: %s" % (index, clean(exc).splitlines()[0][:160] if str(exc) else type(exc).__name__))
    return None, None, errors


def key_struct(name):
    try:
        return unreal.Key(key_name=unreal.Name(name))
    except Exception:
        key = unreal.Key()
        key.set_editor_property("key_name", unreal.Name(name))
        return key


def python_reach(widget, button, controller):
    out = {"button": reach(button), "activatable_widget": reach(widget, r"key|input|click|focus|navigate"), "player_controller": reach(controller, r"input_key|input_touch|input_axis|key|click|simulate"),
           "unreal_module": sorted(n for n in dir(unreal) if re.search(r"simulat|inject|automationdriver|slateapp|InputKey", n, re.I))[:40]}
    for name in REACH_CLASSES:
        cls = getattr(unreal, name, None)
        out["class_" + name] = reach(cls, REACH_WORDS) if cls is not None else "not exposed to Python"
    return out


def input_routes(world, controller, widget, button):
    """The routes that try to deliver a key or a click to the Common button. Each returns (delivered, detail); kind 'control' routes call the click delegate itself."""
    key_enter, key_left = key_struct("Enter"), key_struct("LeftMouseButton")

    def control_broadcast():
        button.on_button_base_clicked.broadcast(button)
        return True, "OnButtonBaseClicked.broadcast() on the button runs the bound handler (not an input event)"

    def focus_button():
        button.set_focus()
        return False, "set_focus() (a precondition, not an input); state read back after"

    def controller_input_key():
        fn = getattr(controller, "input_key", None)
        if fn is None:
            return False, "the player controller has no input_key in Python"
        index, result, errors = attempts(
            lambda: fn(unreal.InputKeyParams(key=key_enter, event=unreal.InputEvent.IE_PRESSED, amount_depressed=1.0, b_gamepad=False)),
            lambda: fn(key_enter, unreal.InputEvent.IE_PRESSED, 1.0, False),
            lambda: fn(key_enter, unreal.InputEvent.IE_PRESSED, 1.0),
        )
        if index is None:
            return False, "input_key exists; no call form worked: " + " | ".join(errors)
        return True, "input_key(Enter pressed) returned %s (form %d)" % (plain(result), index)

    def controller_mouse_click():
        fn = getattr(controller, "input_key", None)
        if fn is None:
            return False, "the player controller has no input_key in Python"
        index, result, errors = attempts(
            lambda: fn(unreal.InputKeyParams(key=key_left, event=unreal.InputEvent.IE_PRESSED, amount_depressed=1.0, b_gamepad=False)),
            lambda: fn(key_left, unreal.InputEvent.IE_PRESSED, 1.0, False),
        )
        if index is None:
            return False, "input_key exists; no call form worked: " + " | ".join(errors)
        return True, "input_key(LeftMouseButton pressed) returned %s (form %d)" % (plain(result), index)

    def button_simulate():
        for name in ("simulate_click", "simulate_button_click", "click", "press", "simulate_press", "trigger_click"):
            fn = getattr(button, name, None)
            if callable(fn):
                fn()
                return True, "button.%s() called" % name
        return False, "the button has none of simulate_click, simulate_button_click, click, press, simulate_press, trigger_click in Python"

    def widget_key_down():
        fn = getattr(widget, "on_key_down", None)
        if fn is None:
            return False, "the activatable widget has no on_key_down in Python"
        index, result, errors = attempts(lambda: fn(unreal.Geometry(), unreal.KeyEvent(key=key_enter)), lambda: fn(unreal.Geometry(), unreal.KeyEvent()))
        if index is None:
            return False, "on_key_down exists; no call form worked: " + " | ".join(errors)
        return True, "on_key_down(Enter) returned %s" % plain(result)

    return [
        ("control: OnButtonBaseClicked.broadcast() on the Common button", "control", control_broadcast),
        ("precondition: set_focus() on the Common button", "precondition", focus_button),
        ("player controller input_key(Enter)", "input", controller_input_key),
        ("player controller input_key(LeftMouseButton)", "input", controller_mouse_click),
        ("Common button simulate/click function", "input", button_simulate),
        ("activatable widget on_key_down(Enter)", "input", widget_key_down),
    ]


def find_button(world):
    """The Common button of the active widget. UserWidget has no get_widget_from_name in Python, so the widget library lists the widgets of the class in the viewport."""
    notes = []
    for lib in ("WidgetBlueprintLibrary", "WidgetLibrary"):
        fn = getattr(getattr(unreal, lib, None), "get_all_widgets_of_class", None)
        if fn is None:
            notes.append("unreal.%s.get_all_widgets_of_class is not there" % lib)
            continue
        try:
            found = list(fn(world, unreal.CommonButtonBase.static_class(), False))
            notes.append("unreal.%s.get_all_widgets_of_class found %d" % (lib, len(found)))
            if found:
                return found[0], notes
        except Exception as exc:
            notes.append("unreal.%s.get_all_widgets_of_class: %s" % (lib, clean(exc).splitlines()[0][:160]))
    return None, notes


def input_sequence(world, controller):
    guarded("viewport_client", lambda: viewport_step(world, controller))
    unreal.SystemLibrary.execute_console_command(world, "obj list class=GameViewportClient")
    yield 1.0
    widget = instantiate(world, state.get("widget_class"), controller)
    if widget is None:
        return
    report["steps"]["before_activation"] = widget_state(widget)
    widget.add_to_viewport(0)
    yield 1.0
    report["steps"]["added"] = widget_state(widget)
    widget.activate_widget()
    yield 1.0
    report["steps"]["after_activation"] = widget_state(widget)
    unreal.SystemLibrary.execute_console_command(world, "CommonUI.DumpActivatableTree")
    yield 0.5
    button, notes = find_button(world)
    state["button"], state["widget"], state["controller"], state["world"] = button, widget, controller, world
    bound = {}
    if button is not None:
        try:
            button.on_button_base_clicked.add_callable(on_click)
            bound = {"bound": True}
        except Exception:
            bound = {"bound": False, "error": clean(traceback.format_exc()[-300:])}
    report["steps"]["input_ready"] = {"button_class": button.get_class().get_name() if button else None, "find_button": notes, "state": read_state(button) if button else None, "handler": bound,
                                      "reach": guarded_value(lambda: python_reach(widget, button, controller))}
    write_report()
    waited = 0.0
    while CONTINUE and not os.path.exists(CONTINUE) and waited < 1500.0:
        waited += 1.0
        report["steps"]["input_wait"] = {"waited_seconds": waited, "released": False, "clicks": CLICKS["count"], "state": read_state(button) if button else None, "mouse": mouse_position(controller)}
        write_report()
        yield 1.0
    report["steps"]["input_wait"] = {"waited_seconds": waited, "released": bool(CONTINUE) and os.path.exists(CONTINUE), "clicks": CLICKS["count"], "state": read_state(button) if button else None, "mouse": mouse_position(controller)}
    for item in shot(world, "before"):
        yield item
    routes = []
    report["steps"]["input"] = {"routes": routes}
    if button is None:
        routes.append({"route": "find the Common button", "kind": "control", "tried": True, "delivered": False, "observed": False, "error": "; ".join(notes)})
    else:
        for name, kind, fn in input_routes(world, controller, widget, button):
            count_before, state_before = CLICKS["count"], read_state(button)
            entry = {"route": name, "kind": kind, "tried": True, "delivered": False, "observed": False}
            try:
                entry["delivered"], entry["detail"] = fn()
            except Exception:
                entry["error"] = clean(traceback.format_exc()[-400:])
            routes.append(entry)
            write_report()
            yield 0.8
            state_after = read_state(button)
            entry["clicks_before_after"] = [count_before, CLICKS["count"]]
            entry["state_before"], entry["state_after"] = state_before, state_after
            changed = {k: [state_before.get(k), state_after.get(k)] for k in state_after if state_before.get(k) != state_after.get(k)}
            entry["state_changed"] = changed
            if kind != "precondition":
                entry["observed"] = CLICKS["count"] > count_before or (bool(entry["delivered"]) and bool(changed))
            entry["detail"] = (entry.get("detail") or "no detail") + "; log line CLICKED count %d to %d; state changed %s" % (count_before, CLICKS["count"], json.dumps(changed))
            write_report()
    for item in shot(world, "after"):
        yield item


def guarded_value(fn):
    try:
        return fn()
    except Exception:
        return {"error": clean(traceback.format_exc()[-400:])}


def sequence():
    """A generator: each yield is a number of seconds to wait before the next piece of work."""
    world = game_world()
    controller = unreal.GameplayStatics.get_player_controller(world, 0)
    size = unreal.WidgetLayoutLibrary.get_viewport_size(world)
    report["steps"]["viewport"] = {"width": size.x, "height": size.y, "controller": controller.get_class().get_name() if controller else None}
    yield 3.0
    if MODE == "input":
        for item in input_sequence(world, controller):
            yield item
        return
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
    if MODE == "rpc":
        return
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


def rpc_poll():
    """Run <UMG_RPC>/request.py once if it is there (the code sees this module's names and may set `result`), and write <UMG_RPC>/result.json. Used by the runner to call
    editor Python from node while an MCP session is open (mode "rpc") or while a Play-In-Editor session waits."""
    if not RPC_DIR:
        return
    request = os.path.join(RPC_DIR, "request.py")
    if not os.path.exists(request):
        return
    out = {"ok": True}
    try:
        with open(request, "r", encoding="utf-8") as fh:
            code = fh.read()
        os.remove(request)
        namespace = dict(globals())
        namespace["result"] = None
        exec(compile(code, "request.py", "exec"), namespace)
        out["result"] = namespace.get("result")
    except Exception:
        out = {"ok": False, "error": clean(traceback.format_exc()[-1800:])}
    target = os.path.join(RPC_DIR, "result.json")
    with open(target + ".tmp", "w") as fh:
        json.dump(out, fh, default=str)
    os.replace(target + ".tmp", target)


def tick(dt):
    if state["done"] or state["busy"]:
        return
    state["busy"] = True
    try:
        rpc_poll()
        step_tick(dt)
    except Exception:
        report["events"].append(clean(traceback.format_exc()[-700:]))
        finish()
    finally:
        state["busy"] = False


if MODE != "rpc":
    guarded("asset", asset_step)
if MODE in ("commonui", "input"):
    guarded("settings", settings_step)
try:
    if MODE != "rpc":
        # a blank map: nothing in the scene, so the frame without the widget is black and does not move (a template level has a sky that drifts between two frames)
        unreal.EditorAssetLibrary.make_directory("/Game/Maps")
        unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
        unreal.EditorLoadingAndSavingUtils.save_map(unreal.EditorLevelLibrary.get_editor_world(), MAP)
except Exception:
    report["events"].append("blank map: " + clean(traceback.format_exc()[-300:]))
write_report()
unreal.register_slate_post_tick_callback(tick)
unreal.log("[umg_stage] tick callback registered (%s)" % MODE)
