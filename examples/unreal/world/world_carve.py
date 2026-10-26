"""Place a river on a World Partition Landscape and read the heightmap before and after (Unreal 5.8, rendering editor).

  UnrealEditor.exe Project.uproject -RenderOffScreen -ExecCmds="py <absolute-path-to-this-file>" -unattended -nosplash -nosound -notraceserver
Environment: WORLD_MAP (map to open, default /Game/Maps/WorldLarge), WORLD_REPORT (JSON report path), WORLD_SHOT (PNG path).
The map must be a partitioned map with a Landscape that has edit layers and no water yet. Needs a rendering editor: render targets
do not draw under -nullrhi. Stages run on editor ticks because the Landscape updates its edit layers on tick.

It reads the final heightmap with Landscape.render_heightmap into an 8-bit render target (the 16-bit height is stored in R and G;
the 32-bit float formats make render_heightmap return False), places a Water Zone and a River, writes the river's depth and width,
forces an edit-layer update, and reads the same strip again. Then it captures an overhead image with a SceneCapture2D.
Not covered: carving proxies that are not loaded. The editor loads every Landscape proxy of these maps at open, and
this script's run unloaded none. The bridge runs on 5.8.4 (examples/unreal/landscape_bridge) loaded four proxies with
load_actors and then unloaded them with unload_actors; unload_actors alone changed nothing.
"""
import json
import os
import traceback

import unreal

MAP = os.environ.get("WORLD_MAP", "/Game/Maps/WorldLarge")
REPORT = os.environ.get("WORLD_REPORT", "world-carve.json").replace("\\", "/")
SHOT = os.environ.get("WORLD_SHOT", "world-overview.png").replace("\\", "/")
EL = unreal.EditorLevelLibrary
WPL = unreal.WorldPartitionBlueprintLibrary
RL = unreal.RenderingLibrary
X0, X1, Y0, Y1 = -30000.0, 30000.0, -4000.0, 4000.0   # strip along the river, world cm
W, H = 256, 32                                           # render target size for the strip
RIVER_POINTS = [(-30000, 0), (-10000, 2000), (10000, -2000), (30000, 0)]
RIVER_DEPTH, RIVER_WIDTH = 400.0, 3000.0
report = {"engine": unreal.SystemLibrary.get_engine_version(), "map": MAP}
ctx = {}


def flush():
    os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=2, default=str)


def landscape_descs():
    return [d for d in WPL.get_actor_descs() if "Landscape" in str(d.native_class)]


def loaded_proxies():
    return [a for a in EL.get_all_level_actors() if isinstance(a, unreal.LandscapeProxy)]


def strip():
    """Final heights (world cm) along y = 0 between X0 and X1: 16 samples, plus the raw R and G bytes of the first."""
    main = ctx["main"]
    box = unreal.Box2D(unreal.Vector2D(X0, Y0), unreal.Vector2D(X1, Y1))
    ok = main.render_heightmap(unreal.Transform(), box, ctx["rt"])
    z0, sz = main.get_actor_location().z, main.get_actor_scale3d().z
    heights = []
    for x in range(0, W, 16):
        c = RL.read_render_target_raw_pixel(ctx["w"], ctx["rt"], x, H // 2)
        h16 = round(c.r) * 256 + round(c.g)
        heights.append(round(z0 + (h16 - 32768) / 128.0 * sz, 1))
    return {"render_ok": bool(ok), "heights": heights}


def s_open():
    unreal.EditorLoadingAndSavingUtils.load_map(MAP)
    ctx["w"] = EL.get_editor_world()
    ctx["main"] = [a for a in EL.get_all_level_actors() if isinstance(a, unreal.Landscape)][0]
    ctx["rt"] = RL.create_render_target2d(ctx["w"], W, H, unreal.TextureRenderTargetFormat.RTF_RGBA8)
    report["landscape_proxies_total"] = len(landscape_descs()) - 1
    report["landscape_proxies_loaded_at_open"] = len(loaded_proxies()) - 1
    report["edit_layers_before"] = [str(e.get_name_bp()) for e in ctx["main"].get_edit_layers_bp()]
    ctx["main"].force_layers_full_update()


def s_before():
    float_rt = RL.create_render_target2d(ctx["w"], W, H, unreal.TextureRenderTargetFormat.RTF_RGBA32F)
    report["float_target_render_ok"] = bool(ctx["main"].render_heightmap(unreal.Transform(), unreal.Box2D(unreal.Vector2D(X0, Y0), unreal.Vector2D(X1, Y1)), float_rt))
    report["before"] = strip()
    heights = report["before"]["heights"]
    z = round(sum(heights) / len(heights) - 600)
    zone = EL.spawn_actor_from_class(unreal.WaterZone, unreal.Vector(0, 0, 0))
    zone.set_editor_property("zone_extent", unreal.Vector2D(201600, 201600))
    river = EL.spawn_actor_from_class(unreal.WaterBodyRiver, unreal.Vector(0, 0, z))
    spline = river.get_water_spline()
    spline.clear_spline_points(True)
    for x, y in RIVER_POINTS:
        spline.add_spline_point(unreal.Vector(x, y, z), unreal.SplineCoordinateSpace.WORLD, True)
    comp = river.get_water_body_component()
    for i in range(spline.get_number_of_spline_points()):
        comp.set_river_width_at_spline_input_key(float(i), RIVER_WIDTH)
        comp.set_river_depth_at_spline_input_key(float(i), RIVER_DEPTH)
    spline.k2_synchronize_and_broadcast_data_change()
    report["river"] = {"z": z, "depth": RIVER_DEPTH, "width": RIVER_WIDTH, "expected_bed": z - RIVER_DEPTH,
                       "spatially_loaded": bool(river.get_editor_property("is_spatially_loaded"))}
    report["edit_layers_after"] = [str(e.get_name_bp()) for e in ctx["main"].get_edit_layers_bp()]
    ctx["main"].force_layers_full_update()


def s_after():
    report["after"] = strip()


def s_cam():
    rt = RL.create_render_target2d(ctx["w"], 1024, 1024, unreal.TextureRenderTargetFormat.RTF_RGBA8)
    cam = EL.spawn_actor_from_class(unreal.SceneCapture2D, unreal.Vector(0, 0, 50000))
    cam.set_actor_rotation(unreal.Rotator(0, -90, 0), False)
    cap = cam.get_editor_property("capture_component2d")
    cap.set_editor_property("fov_angle", 90.0)
    cap.set_editor_property("texture_target", rt)
    cap.set_editor_property("capture_source", unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR)
    cap.set_editor_property("capture_every_frame", True)   # lets exposure and the water tiles settle before the export
    ctx["shot_rt"], ctx["cap"] = rt, cap


def s_shot():
    ctx["cap"].capture_scene()
    folder, name = os.path.split(SHOT)
    os.makedirs(folder, exist_ok=True)
    RL.export_render_target(ctx["w"], ctx["shot_rt"], folder, name)
    report["shot"] = {"requested": SHOT, "exists": os.path.exists(SHOT)}


STAGES = [(3.0, s_open), (25.0, s_before), (50.0, s_after), (51.0, s_cam), (90.0, s_shot)]
state = {"t": 0.0, "i": 0}


def tick(dt):
    state["t"] += dt
    if state["i"] >= len(STAGES):
        return
    when, fn = STAGES[state["i"]]
    if state["t"] < when:
        return
    state["i"] += 1
    try:
        fn()
    except Exception:
        report["error_" + fn.__name__] = traceback.format_exc()[-900:]
    flush()
    if state["i"] >= len(STAGES):
        unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")


unreal.register_slate_post_tick_callback(tick)
