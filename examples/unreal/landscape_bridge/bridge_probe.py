"""Create a Landscape from a height array through the LandscapeBridge C++ module and read it back (Unreal 5.8, editor).

  UnrealEditor.exe Project.uproject -nullrhi -ExecCmds="py <absolute-path-to-this-file>" -unattended -nosplash -nosound -notraceserver
Environment: LB_REPORT (JSON path), LB_MAP (default /Game/Maps/BridgeMap), LB_PARTITIONED (1 for a World Partition map, default 0),
LB_GRID (components per streaming proxy side, default 0 = engine default).
The module must be built first (landscape_bridge.mjs does that). The script creates a new empty map with
LevelEditorSubsystem.new_level(path, is_partitioned_world), calls the bridge function with a smooth test surface, then reads back from the
Landscape actors: component count, quad size (actor scale), component size in quads and the height at sampled vertices.
It runs inside a Slate tick so the editor is fully started, and quits the editor when it is done.
"""
import json
import math
import os
import re
import traceback

import unreal

REPORT = os.environ.get("LB_REPORT", "landscape-bridge.json").replace("\\", "/")
MAP = os.environ.get("LB_MAP", "/Game/Maps/BridgeMap")
PARTITIONED = os.environ.get("LB_PARTITIONED", "0") == "1"
GRID = int(os.environ.get("LB_GRID", "0"))
QUADS, SECTIONS, COMPONENTS = 63, 2, 4
SIZE = COMPONENTS * QUADS * SECTIONS + 1          # vertices per side
SCALE = unreal.Vector(100.0, 100.0, 100.0)         # quad size 100 cm, height scale 100 %
LOCATION = unreal.Vector(-25200.0, -25200.0, 0.0)  # centres the 50400 cm square on the origin
report = {"engine": unreal.SystemLibrary.get_engine_version(), "map": MAP, "partitioned_requested": PARTITIONED,
          "size_vertices": SIZE, "expected_components": COMPONENTS * COMPONENTS}


def surface(i, j):
    """Height in centimetres at vertex (i, j): a smooth wave plus a slope, within +-2000 cm."""
    return 1500.0 * math.sin(i / 80.0) * math.cos(j / 60.0) + 500.0 * (i / (SIZE - 1))


def flush():
    os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=2, default=str)


def run():
    lib = getattr(unreal, "LandscapeBridgeLibrary", None)
    report["bridge_class_found"] = lib is not None
    if lib is None:
        return
    report["bridge_members"] = [m for m in dir(lib) if not m.startswith("_") and ("landscape" in m or "height" in m)]

    plain = set(dir(unreal.Actor))
    report["python_creation_members"] = sorted({m for cls in (unreal.Landscape, unreal.LandscapeProxy) for m in dir(cls)
                                                if m not in plain and not m.startswith("_") and re.search(r"create|import|export|spawn|new_|build", m)})
    sub = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    report["new_level_doc"] = (unreal.LevelEditorSubsystem.new_level.__doc__ or "").strip().splitlines()[:3]
    report["new_level_ok"] = bool(sub.new_level(MAP, PARTITIONED))
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    report["world"] = world.get_path_name()

    heights = [surface(i, j) for j in range(SIZE) for i in range(SIZE)]   # row-major: index = j * SIZE + i
    landscape = lib.create_landscape_from_heights(world, heights, SIZE, SIZE, QUADS, SECTIONS, LOCATION, SCALE, GRID)
    report["created"] = landscape is not None
    if landscape is None:
        return
    report["landscape_class"] = type(landscape).__name__

    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
    landscapes = [a for a in actors if isinstance(a, unreal.Landscape)]
    proxies = [a for a in actors if isinstance(a, unreal.LandscapeStreamingProxy)]
    holders = proxies if proxies else landscapes
    components = [c for h in holders for c in h.get_components_by_class(unreal.LandscapeComponent)]
    xs = sorted({c.section_base_x for c in components})
    scale = landscape.get_actor_scale3d()
    report["readback"] = {
        "landscape_actors": len(landscapes), "streaming_proxies": len(proxies), "components_total": len(components),
        "components_on_landscape_actor": len(landscape.get_components_by_class(unreal.LandscapeComponent)),
        "components_per_holder": sorted({len(h.get_components_by_class(unreal.LandscapeComponent)) for h in holders}),
        "component_step_quads": min((b - a for a, b in zip(xs, xs[1:])), default=None),
        "quad_size_cm": [scale.x, scale.y], "height_scale": scale.z,
        "landscape_component_members": sorted(m for m in dir(unreal.LandscapeComponent) if "size" in m or "quad" in m or "section" in m),
    }

    try:   # informational: Landmass brushes need edit layers
        report["readback"]["edit_layers"] = [str(e.get_name_bp()) for e in landscape.get_edit_layers_bp()]
    except Exception as exc:
        report["readback"]["edit_layers_error"] = str(exc)[:200]

    samples = []
    for i, j in [(0, 0), (SIZE - 2, SIZE - 2), (252, 252), (126, 126), (100, 300), (333, 77), (420, 15)]:
        expected = surface(i, j) + LOCATION.z
        location = unreal.Vector(LOCATION.x + i * SCALE.x, LOCATION.y + j * SCALE.y, 0.0)
        result = lib.get_landscape_height_at(landscape, location)
        entry = {"vertex": [i, j], "expected_cm": round(expected, 3), "call_result": str(result)}
        if isinstance(result, tuple):
            entry["found"], entry["height_cm"] = bool(result[0]), (round(result[1], 3) if len(result) > 1 else None)
        samples.append(entry)
    report["samples"] = samples
    report["height_step_cm"] = SCALE.z / 128.0

    report["save_level_ok"] = bool(sub.save_current_level())
    descs = list(unreal.WorldPartitionBlueprintLibrary.get_actor_descs() or [])
    report["actor_descs"] = len(descs)
    report["partitioned_after_save"] = len(descs) > 0
    report["actor_desc_classes"] = sorted({(re.search(r"[.](\w+)'", str(d.native_class)) or [None, str(d.native_class)])[1] for d in descs})


state = {"t": 0.0, "done": False}


def tick(dt):
    if state["done"]:
        return
    state["t"] += dt
    if state["t"] < 3.0:
        return
    state["done"] = True
    try:
        run()
    except Exception:
        report["error"] = traceback.format_exc()[-1200:]
    flush()
    unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")


unreal.register_slate_post_tick_callback(tick)
