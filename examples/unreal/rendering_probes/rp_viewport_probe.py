"""Directional-light probes for the parts rp_probe.py cannot reach (Unreal 5.8). Two modes, chosen by RP_MODE. Prepared 2026-10-26; not yet run on an engine.

RP_MODE=extras (default): HEADLESS, the same commandlet launch as rp_probe.py (-run=pythonscript -nullrhi). Nothing here needs a viewport.
  existing_level  spawns a sun and a moon, then finds them the way a script would in a saved level (EditorActorSubsystem.get_all_level_actors filtered to DirectionalLight)
                  and sets the priority on each light's component
  unregistered    calls set_forward_shading_priority on a DirectionalLightComponent made with unreal.new_object, which the world has never registered
  renderer        r.ForwardShading, so the report says which renderer it ran under

RP_MODE=interactive: INTERACTIVE, needs a RENDERING editor with a visible window and a person looking at the viewport.
  UnrealEditor.exe Project.uproject -ExecutePythonScript=<this file> -unattended -nosplash -nosound -notraceserver -abslog=<log path>
  The renderer draws its "Multiple directional lights are competing..." message only in a rendering editor viewport (LightGridInjection.cpp, under WITH_EDITOR), and a script cannot
  read the screen, so this mode steps a sun and a moon through the phases below, holds each for RP_PHASE_SECONDS, and writes the report after every phase start. A person watches the
  viewport and records, per phase, whether the orange message is on screen (rp_viewport.mjs prints each phase as it starts and writes a sheet to fill in).
  Phases (rp-viewport-checks.mjs PHASES is the same list): tie, raise_setter, back_to_tie, raise_property, back_property, moon_component_hidden, moon_zero_intensity,
  moon_actor_hidden_in_editor. The editor quits by itself after the last phase.

Environment: RP_REPORT (JSON report path), RP_MAP (a new map path under /Game/Maps), RP_MODE, RP_PHASE_SECONDS (default 30), RP_SETTLE_SECONDS (default 20: viewport time before the first
phase). The project needs PythonScriptPlugin and EditorScriptingUtilities. Nothing here reads or writes a GPU name.
"""
import json
import os
import traceback

import unreal

REPORT = os.environ.get("RP_REPORT", "rp-viewport.json").replace("\\", "/")
MAP = os.environ.get("RP_MAP", "/Game/Maps/RpViewport")
MODE = os.environ.get("RP_MODE", "extras")
PHASE_SECONDS = float(os.environ.get("RP_PHASE_SECONDS", "30"))
OFFSCREEN = os.environ.get("RP_OFFSCREEN") == "1"   # a session with no desktop: the phases run in a Play-In-Editor viewport and each phase takes a screenshot for someone to read
SETTLE_SECONDS = float(os.environ.get("RP_SETTLE_SECONDS", "20"))
PROJECT = unreal.SystemLibrary.get_project_directory().replace("\\", "/")
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
report = {"engine": unreal.SystemLibrary.get_engine_version(), "mode": MODE, "errors": []}


def clean(text):
    """Keep an error text whole, but never write the project folder into a report."""
    return str(text).replace("\\", "/").replace(PROJECT.rstrip("/"), "<project>")


def write_report():
    os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=2, default=str)


def spawn_light(label, intensity):
    actor = eas.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(0, 0, 0))
    actor.set_actor_label(label)
    component = actor.get_component_by_class(unreal.DirectionalLightComponent)
    component.set_intensity(intensity)
    return actor, component


def priority(component):
    return component.get_editor_property("forward_shading_priority")


def forward_shading():
    # source: RenderCore/Private/RenderUtils.cpp r.ForwardShading (read-only; 0 is the deferred renderer)
    return unreal.SystemLibrary.get_console_variable_int_value("r.ForwardShading")


# ---------------------------------------------------------------- extras (headless)
def existing_level():
    spawn_light("RpSun", 10.0)
    spawn_light("RpMoon", 1.0)
    # the form a script uses in a saved level: find every DirectionalLight, then the component of each
    found = [a for a in eas.get_all_level_actors() if isinstance(a, unreal.DirectionalLight)]
    ours = {a.get_actor_label(): a.get_component_by_class(unreal.DirectionalLightComponent) for a in found if a.get_actor_label() in ("RpSun", "RpMoon")}
    out = {"found_total": len(found), "found": sorted(ours), "before": {k: priority(c) for k, c in ours.items()}}
    ours["RpSun"].set_forward_shading_priority(1)
    out["after"] = {k: priority(c) for k, c in ours.items()}
    return out


def unregistered():
    actor, _ = spawn_light("RpHost", 1.0)
    try:
        # source: Engine/Classes/Components/ActorComponent.h: new_object makes the component; RegisterComponent is not exposed to Python, so it stays unregistered
        component = unreal.new_object(unreal.DirectionalLightComponent, actor)
        component.set_forward_shading_priority(3)
        return {"ok": True, "value": priority(component)}
    except Exception as exc:
        return {"ok": False, "error": clean(exc)}


def run_extras():
    les.new_level(MAP)
    for name, fn in (("existing_level", existing_level), ("unregistered", unregistered)):
        try:
            report[name] = fn()
        except Exception:
            report[name] = {"traceback": clean(traceback.format_exc()[-900:])}
    report["renderer"] = {"forward_shading": forward_shading()}
    write_report()
    unreal.log("[rp_viewport] wrote " + REPORT)


# ---------------------------------------------------------------- interactive (rendering editor)
def run_interactive():
    les.new_level(MAP)
    sun_actor, sun = spawn_light("RpSun", 10.0)
    moon_actor, moon = spawn_light("RpMoon", 1.0)

    def state(name, action):
        entry = {"name": name, "action": action, "started_seconds": round(clock["seconds"], 1), "lights": []}
        for label, component in (("RpSun", sun), ("RpMoon", moon)):
            light = {"label": label, "priority": priority(component), "intensity": component.get_editor_property("intensity")}
            try:
                light["visible"] = component.get_editor_property("visible")
            except Exception as exc:
                light["visible"] = "unavailable: " + clean(exc)
            entry["lights"].append(light)
        entry["moon_actor_hidden_in_editor"] = clock["moon_hidden"]
        return entry

    def hide_moon_actor():
        # source: Engine/Classes/GameFramework/Actor.h SetIsTemporarilyHiddenInEditor (BlueprintCallable)
        moon_actor.set_is_temporarily_hidden_in_editor(True)
        clock["moon_hidden"] = True

    # (name, action text, what to do at the start of the phase); the names are rp-viewport-checks.mjs PHASES
    phases = [
        ("tie", "sun and moon both at ForwardShadingPriority 0", lambda: None),
        ("raise_setter", "sun.set_forward_shading_priority(1)", lambda: sun.set_forward_shading_priority(1)),
        ("back_to_tie", "sun.set_forward_shading_priority(0)", lambda: sun.set_forward_shading_priority(0)),
        ("raise_property", "sun.set_editor_property('forward_shading_priority', 1)", lambda: sun.set_editor_property("forward_shading_priority", 1)),
        ("back_property", "sun.set_editor_property('forward_shading_priority', 0)", lambda: sun.set_editor_property("forward_shading_priority", 0)),
        ("moon_component_hidden", "both at 0, the moon component set invisible with set_visibility(False)", lambda: moon.set_visibility(False)),
        ("moon_zero_intensity", "both at 0, the moon visible again with intensity 0", lambda: (moon.set_visibility(True), moon.set_intensity(0.0))),
        ("moon_actor_hidden_in_editor", "both at 0, the moon at intensity 1 with its actor hidden in the editor", lambda: (moon.set_intensity(1.0), hide_moon_actor())),
    ]
    clock = {"seconds": 0.0, "index": -1, "phase_start": 0.0, "handle": None, "moon_hidden": False, "pie": False, "pie_at": 0.0, "pie_ready": not OFFSCREEN, "shot_at": None}

    def game_world():
        return unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_game_world()

    def adopt_game_lights(world):
        """The Play-In-Editor world holds copies of the two lights; the phases must change those."""
        nonlocal sun, moon, moon_actor
        lights = {a.get_actor_label(): a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.DirectionalLight)}
        moon_actor = lights["RpMoon"]
        sun = lights["RpSun"].get_component_by_class(unreal.DirectionalLightComponent)
        moon = moon_actor.get_component_by_class(unreal.DirectionalLightComponent)
    report["renderer"] = {"forward_shading": forward_shading()}
    report["phases"] = []
    report["done"] = False
    report["phase_seconds"] = PHASE_SECONDS

    def finish():
        try:
            moon_actor.set_is_temporarily_hidden_in_editor(False)
        except Exception:
            pass
        report["done"] = True
        write_report()
        if OFFSCREEN:
            les.editor_request_end_play()
        if clock["handle"] is not None:
            unreal.unregister_slate_post_tick_callback(clock["handle"])
            clock["handle"] = None
        unreal.log("[rp_viewport] all phases shown, wrote " + REPORT)
        # source: Plugins/Experimental/PythonScriptPlugin/.../EditorPythonScriptingLibrary.h SetKeepPythonScriptAlive; false lets the executer quit the editor on its next tick
        unreal.EditorPythonScripting.set_keep_python_script_alive(False)

    def tick(delta_seconds):
        try:
            clock["seconds"] += delta_seconds
            if not clock["pie_ready"]:
                if not clock["pie"] and clock["seconds"] >= 5.0:
                    les.editor_request_begin_play()
                    clock["pie"], clock["pie_at"] = True, clock["seconds"]
                elif clock["pie"] and game_world() is not None and clock["seconds"] >= clock["pie_at"] + 5.0:
                    adopt_game_lights(game_world())
                    clock["pie_ready"], clock["seconds"] = True, 0.0
                return
            if clock["shot_at"] is not None and clock["seconds"] >= clock["shot_at"]:
                shot = "rpv_%s.png" % report["phases"][-1]["name"]
                report["phases"][-1]["screenshot"] = shot
                write_report()   # recorded first: take_high_res_screenshot can run the Slate tick again from inside the call
                clock["shot_at"] = None
                # take_high_res_screenshot asks for a shot without UI, and FScreenshotRequest::RequestScreenshot then turns the renderer's on-screen messages off for it (UnrealClient.cpp);
                # the Shot console command with showui keeps them (GameViewportClient.cpp HandleScreenshotCommand)
                unreal.SystemLibrary.execute_console_command(game_world(), "Shot showui nosuffix filename=" + shot[:-4])
            due = SETTLE_SECONDS if clock["index"] < 0 else clock["phase_start"] + PHASE_SECONDS
            if clock["seconds"] < due:
                return
            clock["index"] += 1
            if clock["index"] >= len(phases):
                finish()
                return
            name, action, do = phases[clock["index"]]
            do()
            clock["phase_start"] = clock["seconds"]
            report["phases"].append(state(name, action))
            write_report()
            if OFFSCREEN:
                clock["shot_at"] = clock["seconds"] + PHASE_SECONDS / 2
            unreal.log("[rp_viewport] PHASE %d %s: %s" % (clock["index"] + 1, name, action))
        except Exception:
            report["errors"].append(clean(traceback.format_exc()[-900:]))
            finish()

    # source: Plugins/Experimental/PythonScriptPlugin/.../EditorPythonExecuter.cpp: the editor quits on the next tick unless this is true
    unreal.EditorPythonScripting.set_keep_python_script_alive(True)
    # source: Plugins/Experimental/PythonScriptPlugin/.../PySlate.cpp register_slate_post_tick_callback
    clock["handle"] = unreal.register_slate_post_tick_callback(tick)
    unreal.log("[rp_viewport] sun and moon placed; the first phase starts in %.0f s" % SETTLE_SECONDS)


try:
    if MODE == "interactive":
        run_interactive()
    else:
        run_extras()
except Exception:
    report["errors"].append(clean(traceback.format_exc()[-900:]))
    write_report()
    if MODE == "interactive":
        unreal.EditorPythonScripting.set_keep_python_script_alive(False)
