"""Shared fixture for landmass_probe.py, pcg_partition_probe.py and wp_unload_probe.py (Unreal 5.8, editor).

Import it from a sibling script with:  sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  then  import landscape_fixture as fx
It makes a map with a new_level call, creates a 505 by 505 vertex Landscape through the LandscapeBridge module (module/LandscapeBridge,
built by landscape_world.mjs; the Landscape that Import makes carries one default edit layer), and holds the smooth test surface so a
script can compare any height it reads back against a known value. Reports are written with pcg_common.Report from ../pcg_game, whose
output path comes from LW_REPORT here.
"""
import math
import os
import sys

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pcg_game"))
import pcg_common as pc  # noqa: E402  (stage runner, soft setter, graph helpers, point and instance readers)

QUADS, SECTIONS, COMPONENTS = 63, 2, 4
SIZE = COMPONENTS * QUADS * SECTIONS + 1           # vertices per side (505)
SCALE = unreal.Vector(100.0, 100.0, 100.0)         # quad size 100 cm, height scale 100 percent
LOCATION = unreal.Vector(-25200.0, -25200.0, 0.0)  # centres the 50400 cm square on the origin
EXTENT_CM = 25200.0                                # half the side of the Landscape


def surface(i, j):
    """Height in centimetres at vertex (i, j): a smooth wave plus a slope, within +-2000 cm (the surface bridge_probe.py uses)."""
    return 1500.0 * math.sin(i / 80.0) * math.cos(j / 60.0) + 500.0 * (i / (SIZE - 1))


def expected_height_cm(x, y):
    """The height the input array gives at world (x, y): bilinear between the four vertices around it."""
    u = min(max((x - LOCATION.x) / SCALE.x, 0.0), SIZE - 1.0)
    v = min(max((y - LOCATION.y) / SCALE.y, 0.0), SIZE - 1.0)
    i0, j0 = min(int(math.floor(u)), SIZE - 2), min(int(math.floor(v)), SIZE - 2)
    fu, fv = u - i0, v - j0
    low = surface(i0, j0) * (1 - fu) + surface(i0 + 1, j0) * fu
    high = surface(i0, j0 + 1) * (1 - fu) + surface(i0 + 1, j0 + 1) * fu
    return low * (1 - fv) + high * fv + LOCATION.z


def make_report(default_name):
    """A pcg_common.Report that writes to LW_REPORT (absolute path) and carries the engine version."""
    report = pc.Report(default_name)
    report.path = os.environ.get("LW_REPORT", default_name).replace("\\", "/")
    report["errors"] = []
    return report


def bridge():
    """unreal.LandscapeBridgeLibrary, or None when the module is not built into the project."""
    return getattr(unreal, "LandscapeBridgeLibrary", None)


def bridge_members():
    lib = bridge()
    return sorted(m for m in dir(lib) if not m.startswith("_")) if lib is not None else []


def new_map(path, partitioned):
    sub = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ok = bool(sub.new_level(path, partitioned))
    return ok, unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()


def create_landscape(world, grid_size_in_components):
    """Landscape from the test surface. grid_size_in_components 2 in a partitioned map gives 4 streaming proxies of 2 by 2 components."""
    heights = [surface(i, j) for j in range(SIZE) for i in range(SIZE)]   # row-major: index = j * SIZE + i
    return bridge().create_landscape_from_heights(world, heights, SIZE, SIZE, QUADS, SECTIONS, LOCATION, SCALE, grid_size_in_components)


def actors():
    return list(unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors())


def loaded_landscapes():
    """(main Landscape actors, streaming proxies) loaded in the editor world."""
    found = actors()
    return ([a for a in found if isinstance(a, unreal.Landscape)], [a for a in found if isinstance(a, unreal.LandscapeStreamingProxy)])


def edit_layer_names(landscape):
    try:
        return [str(e.get_name_bp()) for e in landscape.get_edit_layers_bp()]
    except Exception as exc:
        return ["error: " + str(exc)[:160]]


def path_of(obj):
    return obj.get_path_name() if obj is not None else None


def height_at(landscape, x, y):
    """The engine's own height query (collision heightfield) at world (x, y) in cm, or None on a miss. Needs the bridge module."""
    result = bridge().get_landscape_height_at(landscape, unreal.Vector(x, y, 0.0))
    if isinstance(result, tuple):
        return round(result[1], 3) if result and result[0] else None
    return None if result is None else round(float(result), 3)


def snapshot_world(report, key):
    """Record the counts a map-making step is judged on."""
    lands, proxies = loaded_landscapes()
    report[key] = {"landscape_actors": len(lands), "streaming_proxies": len(proxies),
                   "components": sum(len(h.get_components_by_class(unreal.LandscapeComponent)) for h in (proxies or lands)),
                   "edit_layers": edit_layer_names(lands[0]) if lands else []}
    return lands, proxies


def ensure_wp2_map(path, report):
    """Make the partitioned map with four streaming proxies (grid size 2) and save it; True when it exists afterwards."""
    ok, world = new_map(path, True)
    report["map_created"] = ok
    if not ok or bridge() is None:
        return None
    landscape = create_landscape(world, 2)
    report["landscape_created"] = landscape is not None
    report["map_saved"] = bool(unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level())
    return landscape
