"""MegaLights tracing-route probe, run inside a RENDERING editor (Unreal 5.8): read the ray tracing and MegaLights settings back, light a small scene, and ask for a GPU profile.

  UnrealEditor.exe Project.uproject -ExecutePythonScript=<this file> -unattended -nosplash -nosound -notraceserver -abslog=<log path>
Environment: RP_REPORT (JSON report path), RP_MAP (a new map path under /Game/Maps, one per launch), RP_WARMUP_SECONDS (default 120: viewport time before the profile, so shader
compiles can finish), RP_PROFILE_SECONDS (default 20: how long to wait for the profile to reach the log). The project needs PythonScriptPlugin and EditorScriptingUtilities.
Prepared 2026-10-26; not yet run on an engine. A first run tests this script before it tests the engine.

RP_MODE picks the job (default "rt"): "rt" is the tracing-route probe above; "lights-build" is run as a commandlet (UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -nullrhi)
and saves a Niagara system whose Light renderer has both MegaLights switches on; "lights-render" is run like "rt" and draws that system, counts its live particles with a simulation cache and
asks for the GPU profile. Its report adds {particles}; the log lines between the two [rp_rt] markers hold the "CullLights ... NumLights n" line that rp-rt-checks.mjs reads.

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
MODE = os.environ.get("RP_MODE", "rt")   # rt | lights-build | lights-render
LIGHTS_FOLDER, LIGHTS_SYSTEM, LIGHTS_EMITTER = "/Game/Lights", "NS_RpLights", "Lights"

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
if MODE == "lights-render":
    CVARS.append("r.MegaLights.SimpleLightMode")   # Renderer/Private/LightRendering.cpp: 0 none, 1 simple lights that allow MegaLights (default), 2 all

state = {"seconds": 0.0, "phase": "build", "handle": None, "errors": []}
report = {"engine": unreal.SystemLibrary.get_engine_version(), "cvars": {}, "errors": state["errors"]}
les = eas = None
if MODE != "lights-build":   # the commandlet build step needs neither subsystem
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

TOOLSET = "NiagaraToolsets.NiagaraToolset_System"
FOUNTAIN = "/Niagara/DefaultAssets/Templates/Emitters/Fountain"   # a factory-made system with this emitter added emits (nts_probe_emit_build.py FactoryFountain)
LIGHT_CLASS = "/Script/Niagara.NiagaraLightRendererProperties"


def tool(name, args):
    """One Niagara toolset call (as nts_probe_common.py): the decoded returnValue, or RuntimeError on an error."""
    result = unreal.ToolsetRegistry.execute_tool(TOOLSET, name, json.dumps(args))
    error = str(result.get_editor_property("error"))
    if error or not result.is_complete:
        raise RuntimeError("%s: %s" % (name, error or "incomplete"))
    text = str(result.get_editor_property("value"))
    return json.loads(text).get("returnValue") if text else None


def build_lights_system():
    """lights-build: a factory-made system, a Fountain emitter, a Light renderer with both MegaLights switches set through SetRendererData and read back, saved."""
    out = {"engine": unreal.SystemLibrary.get_engine_version(), "mode": MODE, "system": "%s/%s" % (LIGHTS_FOLDER, LIGHTS_SYSTEM), "errors": []}
    try:
        unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
        unreal.EditorAssetLibrary.make_directory(LIGHTS_FOLDER)
        if unreal.AssetToolsHelpers.get_asset_tools().create_asset(LIGHTS_SYSTEM, LIGHTS_FOLDER, unreal.NiagaraSystem, unreal.NiagaraSystemFactoryNew()) is None:
            raise RuntimeError("could not create " + out["system"])
        system = {"refPath": "%s.%s" % (out["system"], LIGHTS_SYSTEM)}
        tool("AddEmitter", {"system": system, "templateEmitter": {"refPath": FOUNTAIN + ".Fountain"}, "emitterName": LIGHTS_EMITTER})
        added = tool("AddRenderer", {"newRendererLocation": {"system": system, "emitterName": LIGHTS_EMITTER}, "rendererClass": {"refPath": LIGHT_CLASS}})
        ref = {"system": system, "emitterName": LIGHTS_EMITTER, "rendererIndex": added["rendererIndex"]}
        tool("SetRendererData", {"renderer": ref, "rendererData": {"propertyValues": json.dumps({"bAllowMegaLights": True, "bMegaLightsCastShadows": True})}})
        data = json.loads(tool("GetRendererData", {"rendererRef": ref})["propertyValues"])
        out["switches"] = {k: data.get(k) for k in ("bAllowMegaLights", "bMegaLightsCastShadows")}
        topology = tool("GetEmitterTopology", {"emitterRef": {"system": system, "emitterName": LIGHTS_EMITTER}})
        out["renderers"] = [r["rendererClass"]["refPath"].rsplit(".", 1)[-1] for r in sorted(topology["renderers"], key=lambda r: r["rendererIndex"])]
        out["saved"] = bool(unreal.EditorAssetLibrary.save_asset(out["system"]))
    except Exception:
        out["errors"].append(traceback.format_exc()[-900:])
    path = REPORT
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as fh:
        json.dump(out, fh, indent=2, default=str)
    unreal.log("[rp_rt] wrote " + path)


def build_lights_scene():
    """lights-render: a floor, the saved Niagara system 450 units in front of a camera, and no other light (the CullLights count is then the Niagara lights)."""
    les.new_level(MAP)
    floor = eas.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(0, 0, 0))
    floor.static_mesh_component.set_static_mesh(unreal.load_asset("/Engine/BasicShapes/Plane"))
    floor.set_actor_scale3d(unreal.Vector(20, 20, 1))
    system = unreal.load_asset("%s/%s" % (LIGHTS_FOLDER, LIGHTS_SYSTEM))
    if system is None:
        raise RuntimeError("the saved Niagara system did not load")
    fx = eas.spawn_actor_from_class(unreal.NiagaraActor, unreal.Vector(450, 0, 20))
    fx.set_actor_label("RpRtFx")
    component = fx.get_editor_property("niagara_component")
    component.set_editor_property("asset", system)
    component.set_editor_property("auto_activate", True)
    eye = unreal.Vector(-250, 0, 220)
    camera = eas.spawn_actor_from_class(unreal.CameraActor, eye)
    camera.set_actor_label("RpRtCam")
    camera.set_actor_rotation(unreal.MathLibrary.find_look_at_rotation(eye, unreal.Vector(450, 0, 120)), False)


def game_world():
    try:
        return unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_game_world()
    except Exception:
        return None


def by_label(world, cls, label):
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, cls):
        if actor.get_actor_label() == label:
            return actor
    raise RuntimeError("no actor labelled " + label)


def look_through_camera():
    """In the Play-In-Editor world, make the camera the view, so the Niagara actor is in front of the viewport."""
    world = game_world()
    controller = unreal.GameplayStatics.get_player_controller(world, 0)
    controller.set_view_target_with_blend(by_label(world, unreal.CameraActor, "RpRtCam"), 0.0)


def count_particles():
    """Live particles per emitter of the Play-In-Editor Niagara actor, from a one-frame simulation cache (as nts_probe_sim.py)."""
    world = game_world()
    component = by_label(world, unreal.NiagaraActor, "RpRtFx").get_editor_property("niagara_component")
    lib = unreal.NiagaraSimCacheFunctionLibrary
    cache = lib.create_niagara_sim_cache(world)
    got = lib.capture_niagara_sim_cache_immediate(cache, unreal.NiagaraSimCacheCreateParameters(), component, True, 1.0 / 60.0)
    if got is None:
        raise RuntimeError("the simulation cache capture was refused")
    last = got.get_num_frames() - 1
    return {str(name): len(got.read_position_attribute("Position", name, last)) for name in got.get_emitter_names()}


def build_scene():
    if MODE == "lights-render":
        return build_lights_scene()
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
        elif state["phase"] == "warmup" and MODE == "lights-render" and not state.get("camera") and state["seconds"] >= 10.0:
            state["camera"] = True
            try:
                look_through_camera()
            except Exception:
                state["errors"].append("camera: " + traceback.format_exc()[-500:])
        elif state["phase"] == "warmup" and state["seconds"] >= WARMUP:
            if MODE == "lights-render":
                try:
                    report["particles"] = count_particles()   # the frame before the profile: the lights drawn should match this to within a frame's spawns and deaths
                except Exception:
                    report["particles"] = None
                    state["errors"].append("particles: " + traceback.format_exc()[-500:])
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
if MODE == "lights-build":
    build_lights_system()   # a commandlet: no keep-alive, no tick; the script returning ends the process
else:
    unreal.EditorPythonScripting.set_keep_python_script_alive(True)
    try:
        build_scene()
    except Exception:
        state["errors"].append(traceback.format_exc()[-900:])
    # source: Plugins/Experimental/PythonScriptPlugin/.../PySlate.cpp register_slate_post_tick_callback
    state["handle"] = unreal.register_slate_post_tick_callback(tick)
    unreal.log("[rp_rt] scene built, waiting %.0f s for the viewport" % WARMUP)
