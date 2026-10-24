"""Probe ForwardShadingPriority on directional lights headless (Unreal 5.8, commandlet), and two console variable lookups.

  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound
      -notraceserver -abslog=<log path>
Environment: RP_REPORT (JSON report path). The project needs PythonScriptPlugin and EditorScriptingUtilities.

  lights   two DirectionalLight actors: read forward_shading_priority on both, call set_forward_shading_priority(1) on one, read both
  routes   four other ways to the property, each on a fresh light and in its own try/except with the whole error text kept:
           set_editor_property, attribute assignment, the setter with a negative value, the setter on a Static-mobility component
  cvars    get_console_variable_int_value for r.MegaLights.Allow (no such variable) and r.MegaLights.Allowed (the real one)

Nothing here needs a rendering editor, and nothing here shows the renderer's on-screen message: that is drawn only by a rendering
editor viewport. The commandlet may exit with 1 when it logs a warning on purpose; the results are in the report.
"""
import json
import os
import traceback

import unreal

REPORT = os.environ.get("RP_REPORT", "rp-probe.json").replace("\\", "/")
PROJECT = unreal.SystemLibrary.get_project_directory().replace("\\", "/")
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
report = {"engine": unreal.SystemLibrary.get_engine_version()}


def clean(text):
    """Keep an error text whole, but never write the project folder into a report."""
    return str(text).replace("\\", "/").replace(PROJECT.rstrip("/"), "<project>")


def spawn_light(name):
    actor = eas.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(0, 0, 0))
    actor.set_actor_label(name)
    return actor.get_component_by_class(unreal.DirectionalLightComponent)


def priority(component):
    return component.get_editor_property("forward_shading_priority")


def route(fn):
    """{ok: True, ...read-back} or {ok: False, error: whole error text}."""
    try:
        return dict(fn(), ok=True)
    except Exception as exc:
        return {"ok": False, "error": clean(exc)}


# ---------------------------------------------------------------- 1 two lights, the setter
def lights():
    sun, moon = spawn_light("RpSun"), spawn_light("RpMoon")
    out = {"before": [priority(sun), priority(moon)], "mobility": str(sun.get_editor_property("mobility"))}
    out["attribute_before"] = route(lambda: {"value": sun.forward_shading_priority})
    out["setter_returned"] = str(sun.set_forward_shading_priority(1))
    out["after"] = [priority(sun), priority(moon)]
    return out


# ---------------------------------------------------------------- 2 the other routes
def routes():
    out = {}

    def by_property():
        light = spawn_light("RpPropertyRoute")
        light.set_editor_property("forward_shading_priority", 2)
        return {"value": priority(light)}

    def by_attribute():
        light = spawn_light("RpAttributeRoute")
        light.forward_shading_priority = 3
        return {"value": priority(light)}

    def negative():
        light = spawn_light("RpNegativeRoute")
        light.set_forward_shading_priority(2)
        before = priority(light)
        light.set_forward_shading_priority(-3)
        return {"before": before, "value": priority(light)}

    def on_static():
        light = spawn_light("RpStaticRoute")
        light.set_forward_shading_priority(4)            # accepted while the component is Stationary
        before = priority(light)
        light.set_mobility(unreal.ComponentMobility.STATIC)
        mobility = str(light.get_editor_property("mobility"))
        light.set_forward_shading_priority(5)
        return {"before": before, "mobility": mobility, "value": priority(light)}

    for name, fn in (("set_editor_property", by_property), ("attribute_assignment", by_attribute),
                     ("setter_negative", negative), ("setter_on_static", on_static)):
        out[name] = route(fn)
    return out


# ---------------------------------------------------------------- 3 console variable lookups
def cvars():
    lib = unreal.SystemLibrary
    return {"allow": lib.get_console_variable_int_value("r.MegaLights.Allow"),
            "allowed": lib.get_console_variable_int_value("r.MegaLights.Allowed")}


les.new_level("/Game/Maps/RpProbe")
for name, fn in (("lights", lights), ("routes", routes), ("cvars", cvars)):
    try:
        report[name] = fn()
    except Exception:
        report[name] = {"traceback": clean(traceback.format_exc()[-900:])}

os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
with open(REPORT, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[rp_probe] wrote " + REPORT)
