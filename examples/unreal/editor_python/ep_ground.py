"""Place a camera above terrain with a line trace and compare it with a fixed world Z (Unreal 5.8, rendering editor).

  UnrealEditor.exe Project.uproject -RenderOffScreen -ExecCmds="py <absolute-path-to-this-file>" -unattended -nosplash -nosound -notraceserver
Environment: EP_REPORT (JSON path), EP_SHOT_DIR (folder for the two PNGs). Run ep_ground_map.py first: it copies the Open World
template, which holds a Landscape, to /Game/Maps/OpenWorldCopy. A script started with -ExecCmds keeps the editor alive, so the work is a
generator that run_stages drives one editor tick at a time.

It traces the ground height on a grid, takes the highest grid point, stands a pillar on the ground 3000 cm away, and captures two
views of the pillar from that point with a SceneCapture2D: once at a fixed world Z (the lowest grid height plus 200 cm) and once at
place_above_ground(x, y, 200). It reports the ground height under each camera and whether a trace from the camera to the pillar's top is
blocked by terrain, and over the whole grid how many fixed-Z cameras are under the ground and whether every traced camera is 200 cm up. Quits the editor when done.
"""
import hashlib
import json
import os
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import editor_python_helpers as H  # noqa: E402

REPORT = os.environ.get("EP_REPORT", "ep-ground.json").replace("\\", "/")
SHOT_DIR = os.environ.get("EP_SHOT_DIR", os.path.dirname(REPORT) or ".").replace("\\", "/")
MAP = "/Game/Maps/OpenWorldCopy"
GRID = [(x, y) for x in range(-40000, 40001, 10000) for y in range(-40000, 40001, 10000)]
HEIGHT, DISTANCE = 200.0, 3000.0
report = {"engine": unreal.SystemLibrary.get_engine_version(), "map": MAP}
ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
RL = unreal.RenderingLibrary


def ground(world, x, y):
    p = H.place_above_ground(world, x, y, 0.0)
    return None if p is None else p.z


def blocked(world, a, b, ignore):
    """True when something other than the `ignore` actors is on the straight line from a to b."""
    hit = unreal.SystemLibrary.line_trace_single(world, a, b, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, ignore,
                                                 unreal.DrawDebugTrace.NONE, True)
    return hit is not None


def capture(world, location, target, name):
    rt = RL.create_render_target2d(world, 960, 540, unreal.TextureRenderTargetFormat.RTF_RGBA8)
    cam = eas.spawn_actor_from_class(unreal.SceneCapture2D, location, H.look_at_rotation(location, target))
    cap = cam.get_editor_property("capture_component2d")
    cap.set_editor_property("fov_angle", 70.0)
    cap.set_editor_property("texture_target", rt)
    cap.set_editor_property("capture_source", unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR)
    cap.set_editor_property("capture_every_frame", True)
    return cam, cap, rt


def stages():
    yield 3
    les.load_level(MAP)
    world = ues.get_editor_world()
    report["world"] = world.get_path_name()
    # the Landscape collision is part of the world only after the proxies have loaded: wait until a trace at the origin hits
    ready = yield from H.wait_until(lambda: ground(world, 0, 0) is not None, 3000)
    report["ground_ready"] = ready
    yield 120
    heights = {"%d,%d" % xy: ground(world, *xy) for xy in GRID}
    report["grid_hits"] = sum(v is not None for v in heights.values())
    report["grid_total"] = len(GRID)
    hit = {k: v for k, v in heights.items() if v is not None}
    high_key = max(hit, key=hit.get)
    low = min(hit.values())
    x, y = [float(v) for v in high_key.split(",")]
    report["highest_ground"] = {"xy": [x, y], "z": hit[high_key]}
    report["lowest_ground_z"] = low
    # a pillar on the ground DISTANCE cm away in +X
    px = x + DISTANCE
    pz = ground(world, px, y)
    target = unreal.Vector(px, y, pz + 580.0)   # near the pillar's top: it is 600 cm tall and stands on the ground
    pillar = eas.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(px, y, pz + 300.0))
    pillar.static_mesh_component.set_static_mesh(unreal.load_asset("/Engine/BasicShapes/Cylinder"))
    pillar.set_actor_scale3d(unreal.Vector(2.0, 2.0, 6.0))
    report["pillar"] = {"xy": [px, y], "ground_z": pz}
    fixed = unreal.Vector(x, y, low + HEIGHT)
    traced_all = {k: H.place_above_ground(world, *[float(v) for v in k.split(",")], HEIGHT) for k in hit}
    report["grid_traced_height_ok"] = all(abs(traced_all[k].z - hit[k] - HEIGHT) < 1.0 for k in hit)
    report["grid_fixed_inside_terrain"] = sum(1 for v in hit.values() if low + HEIGHT < v)
    traced = H.place_above_ground(world, x, y, HEIGHT)
    report["fixed"] = {"camera_z": fixed.z, "ground_z_below": ground(world, x, y), "inside_terrain": fixed.z < hit[high_key],
                       "terrain_blocks_view": blocked(world, fixed, target, [pillar])}
    report["traced"] = {"camera_z": traced.z, "ground_z_below": ground(world, x, y), "inside_terrain": traced.z < hit[high_key],
                        "terrain_blocks_view": blocked(world, traced, target, [pillar]),
                        "height_above_ground": round(traced.z - ground(world, x, y), 2)}
    shots = {}
    for label, loc in (("fixed", fixed), ("traced", traced)):
        cam, cap, rt = capture(world, loc, target, label)
        yield 20   # let exposure and the Landscape material settle before the capture
        cap.capture_scene()
        yield 5
        RL.export_render_target(world, rt, SHOT_DIR, "ep-ground-%s.png" % label)
        shots[label] = os.path.join(SHOT_DIR, "ep-ground-%s.png" % label)
        cam.destroy_actor()
        yield 2
    report["shots"] = {k: {"path": v, "exists": os.path.exists(v), "sha256": hashlib.sha256(open(v, "rb").read()).hexdigest() if os.path.exists(v) else None}
                       for k, v in shots.items()}


def done(error):
    report["error"] = error
    os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=2, default=str)
    unreal.log("[ep_ground] wrote " + REPORT)
    unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")


H.run_stages(stages, done)
