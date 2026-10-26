"""MegaLights tracing-route probe, run inside a RENDERING editor (Unreal 5.8): read the ray tracing and MegaLights settings back, light a small scene, and ask for a GPU profile.

  UnrealEditor.exe Project.uproject -ExecutePythonScript=<this file> -unattended -nosplash -nosound -notraceserver -abslog=<log path>
Environment: RP_REPORT (JSON report path), RP_MAP (a new map path under /Game/Maps, one per launch), RP_WARMUP_SECONDS (default 120: viewport time before the profile, so shader
compiles can finish), RP_PROFILE_SECONDS (default 20: how long to wait for the profile to reach the log). The project needs PythonScriptPlugin and EditorScriptingUtilities.
Prepared 2026-10-26; not yet run on an engine. A first run tests this script before it tests the engine.

What it does, over several frames (an editor run with -ExecutePythonScript quits when the script returns unless it asks to be kept alive, so it keeps itself alive and lets go at the end):
  1. new level, a floor, a cube and four movable point lights, so MegaLights has something to light
  2. after the warm-up, ProfileGPU (a console command that prints a frame's GPU statistics to the log); the log lines between the two [rp_rt] markers are what rp-rt-checks.mjs searches for a MegaLights pass
  3. after the wait, the console variables below are read and the report is written; the editor then quits

The report is {engine, cvars, seconds, errors}. A console variable name that is not registered logs "Failed to find console variable" and reads 0, so every name below was found in the
5.8 source first (each comment names the file). Nothing here reads or writes a GPU name.
"""
import json
import os
import traceback

import unreal

REPORT = os.environ.get("RP_REPORT", "rp-rt.json").replace("\\", "/")
MAP = os.environ.get("RP_MAP", "/Game/Maps/RpRt")
WARMUP = float(os.environ.get("RP_WARMUP_SECONDS", "120"))
PROFILE_WAIT = float(os.environ.get("RP_PROFILE_SECONDS", "20"))

# source: each name is registered in the file noted; all are read as integers.
CVARS = [
    "r.RayTracing",                              # Renderer/Private/DeferredShadingRenderer.cpp (read-only)
    "r.SkinCache.CompileShaders",                # Engine/Private/GPUSkinCache.cpp
    "r.GenerateMeshDistanceFields",              # Engine/Private/DistanceFieldAtlas.cpp (read-only; the project setting is in RendererSettings.h)
    "r.MegaLights.EnableForProject",             # Renderer/Private/MegaLights/MegaLights.cpp
    "r.MegaLights.Allowed",                      # same file
    "r.MegaLights.HardwareRayTracing",           # Renderer/Private/MegaLights/MegaLightsRayTracing.cpp
    "r.MegaLights.HardwareRayTracing.Inline",    # same file
    "r.MegaLights.SoftwareRayTracing.Allow",     # same file
    "r.RayTracing.EnableOnDemand",               # RenderCore/Private/RenderUtils.cpp (default 1, so ray tracing starts as Dynamic)
    "r.ForwardShading",                          # RenderCore/Private/RenderUtils.cpp
]

state = {"seconds": 0.0, "phase": "build", "handle": None, "errors": []}
report = {"engine": unreal.SystemLibrary.get_engine_version(), "cvars": {}, "errors": state["errors"]}
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def build_scene():
    les.new_level(MAP)
    floor = eas.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(0, 0, 0))
    floor.static_mesh_component.set_static_mesh(unreal.load_asset("/Engine/BasicShapes/Plane"))
    floor.set_actor_scale3d(unreal.Vector(20, 20, 1))
    cube = eas.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(0, 0, 100))
    cube.static_mesh_component.set_static_mesh(unreal.load_asset("/Engine/BasicShapes/Cube"))
    for i, (x, y) in enumerate(((300, 300), (-300, 300), (300, -300), (-300, -300))):
        light = eas.spawn_actor_from_class(unreal.PointLight, unreal.Vector(x, y, 250))
        component = light.get_component_by_class(unreal.PointLightComponent)
        component.set_mobility(unreal.ComponentMobility.MOVABLE)
        component.set_intensity(5000.0)
        light.set_actor_label("RpRtLight%d" % i)


def read_cvars():
    lib = unreal.SystemLibrary
    return {name: lib.get_console_variable_int_value(name) for name in CVARS}


def finish():
    try:
        report["cvars"] = read_cvars()
    except Exception:
        state["errors"].append(traceback.format_exc()[-900:])
    report["seconds"] = round(state["seconds"], 1)
    os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=2, default=str)
    unreal.log("[rp_rt] wrote " + REPORT)
    if state["handle"] is not None:
        unreal.unregister_slate_post_tick_callback(state["handle"])
        state["handle"] = None
    les.editor_request_end_play()
    # source: Plugins/Experimental/PythonScriptPlugin/.../EditorPythonScriptingLibrary.h SetKeepPythonScriptAlive; false lets the executer quit the editor on its next tick
    unreal.EditorPythonScripting.set_keep_python_script_alive(False)


def tick(delta_seconds):
    try:
        state["seconds"] += delta_seconds
        if state["phase"] == "build" and state["seconds"] >= 5.0:
            # a rendering editor with no visible window draws no level viewport (a 5.8.3 run showed only Slate frames in ProfileGPU), so the scene is drawn by a Play-In-Editor viewport, as nts_probe_sim.py does
            les.editor_request_begin_play()
            state["phase"], state["seconds"] = "warmup", 0.0
        elif state["phase"] == "warmup" and state["seconds"] >= WARMUP:
            unreal.log("[rp_rt] ProfileGPU requested")
            # source: RHI/Private/GPUProfiler.cpp FAutoConsoleCommand "ProfileGPU" (prints a frame's GPU statistics to the log)
            unreal.SystemLibrary.execute_console_command(None, "ProfileGPU")
            state["phase"] = "profiling"
            state["profile_at"] = state["seconds"]
        elif state["phase"] == "profiling" and state["seconds"] >= state["profile_at"] + PROFILE_WAIT:
            unreal.log("[rp_rt] ProfileGPU wait done")
            state["phase"] = "done"
            finish()
    except Exception:
        state["errors"].append(traceback.format_exc()[-900:])
        state["phase"] = "done"
        finish()


# source: Plugins/Experimental/PythonScriptPlugin/.../EditorPythonExecuter.cpp: the editor quits on the next tick unless this is true
unreal.EditorPythonScripting.set_keep_python_script_alive(True)
try:
    build_scene()
except Exception:
    state["errors"].append(traceback.format_exc()[-900:])
# source: Plugins/Experimental/PythonScriptPlugin/.../PySlate.cpp register_slate_post_tick_callback
state["handle"] = unreal.register_slate_post_tick_callback(tick)
unreal.log("[rp_rt] scene built, waiting %.0f s for the viewport" % WARMUP)
