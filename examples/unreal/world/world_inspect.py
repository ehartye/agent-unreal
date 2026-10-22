"""Report how a map is partitioned and how its Landscape is built (Unreal 5.8, headless commandlet).

  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: WORLD_MAP (object path such as /Game/Maps/WorldLarge or /Engine/Maps/Templates/Template_Default), WORLD_REPORT (JSON path).

A World Partition map answers WorldPartitionBlueprintLibrary.get_actor_descs() with one descriptor per actor, including actors that
are not loaded; a map that is not partitioned answers an empty list. The descriptor carries is_spatially_loaded, runtime_grid and
data_layer_assets. In a commandlet only the actors that are not spatially loaded are in the world, so the script loads the Landscape
proxies with load_actors before it counts components. Component size and proxy grid are derived from component section bases and
proxy bounds, because Python does not expose the quad counts.
"""
import collections
import json
import os
import re
import traceback

import unreal

MAP = os.environ["WORLD_MAP"]
REPORT = os.environ.get("WORLD_REPORT", "world-inspect.json").replace("\\", "/")
WPL = unreal.WorldPartitionBlueprintLibrary
EL = unreal.EditorLevelLibrary
report = {"engine": unreal.SystemLibrary.get_engine_version(), "map": MAP}


def cls_name(desc):
    found = re.search(r"\.(\w+)'", str(desc.native_class))
    return found.group(1) if found else str(desc.native_class)


def vec(v):
    return [round(v.x), round(v.y), round(v.z)]


try:
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    unreal.EditorLoadingAndSavingUtils.load_map(MAP)
    descs = list(WPL.get_actor_descs() or [])
    report["partitioned"] = len(descs) > 0
    report["actor_descs"] = len(descs)
    if descs:
        box = WPL.get_editor_world_bounds()
        report["world_bounds_cm"] = [vec(box.min), vec(box.max)]
    by_class = collections.defaultdict(lambda: {"count": 0, "spatially_loaded": 0})
    for d in descs:
        entry = by_class[cls_name(d)]
        entry["count"] += 1
        entry["spatially_loaded"] += 1 if d.is_spatially_loaded else 0
    report["by_class"] = dict(by_class)
    report["data_layers_used"] = sorted({str(d.data_layer_assets) for d in descs} - {"[]"})
    report["runtime_grids"] = sorted({str(d.runtime_grid) for d in descs})

    proxy_descs = [d for d in descs if cls_name(d) == "LandscapeStreamingProxy"]
    report["proxies_in_world_before_load_actors"] = len([a for a in EL.get_all_level_actors() if isinstance(a, unreal.LandscapeStreamingProxy)])
    if proxy_descs:
        WPL.load_actors([d.guid for d in proxy_descs])
    actors = EL.get_all_level_actors()
    landscapes = [a for a in actors if isinstance(a, unreal.Landscape)]
    proxies = [a for a in actors if isinstance(a, unreal.LandscapeStreamingProxy)]
    if landscapes:
        main = landscapes[0]
        holders = proxies if proxies else [main]
        counts = [len(h.get_components_by_class(unreal.LandscapeComponent)) for h in holders]
        bases = sorted({(c.section_base_x, c.section_base_y) for h in holders for c in h.get_components_by_class(unreal.LandscapeComponent)})
        xs = sorted({b[0] for b in bases})
        step = min((b - a for a, b in zip(xs, xs[1:])), default=None)
        scale = main.get_actor_scale3d()
        actor_members = set(dir(unreal.Actor))
        verbs = re.compile(r"create|import|export|spawn|new_|build")
        info = {
            "landscape_actor_components": len(main.get_components_by_class(unreal.LandscapeComponent)),
            "python_creation_members": sorted({m for cls in (unreal.Landscape, unreal.LandscapeProxy) for m in dir(cls)
                                               if m not in actor_members and not m.startswith("_") and verbs.search(m)}),
            "landscape_actor_spatially_loaded": bool(main.get_editor_property("is_spatially_loaded")),
            "streaming_proxies": len(proxies),
            "streaming_proxies_spatially_loaded": sum(1 for p in proxies if p.get_editor_property("is_spatially_loaded")),
            "components_total": sum(counts),
            "components_per_holder": [min(counts), max(counts)],
            "component_size_quads": step,
            "scale_cm": [round(scale.x), round(scale.y), round(scale.z)],
            "edit_layers": [str(e.get_name_bp()) for e in main.get_edit_layers_bp()],
        }
        if proxy_descs:
            mins = sorted({(round(d.bounds.min.x), round(d.bounds.min.y)) for d in proxy_descs})
            first = proxy_descs[0].bounds
            info["proxy_grid"] = [len({m[0] for m in mins}), len({m[1] for m in mins})]
            info["proxy_size_cm"] = [round(first.max.x - first.min.x), round(first.max.y - first.min.y)]
        report["landscape"] = info
except Exception:
    report["error"] = traceback.format_exc()[-900:]

os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
with open(REPORT, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[world_inspect] wrote " + REPORT)
