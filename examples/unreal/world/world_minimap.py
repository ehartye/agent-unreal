"""Report the minimap texture of a partitioned map (Unreal 5.8, headless commandlet).

  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: WORLD_MAP (object path of a partitioned map), WORLD_REPORT (JSON path).

The WorldPartitionMiniMap actor keeps the texture that WorldPartitionMiniMapBuilder renders. The report holds whether the actor has a
texture, its size in pixels and the world units per pixel, so a run of the builder can be compared with the state before it.
"""
import json
import os
import traceback

import unreal

MAP = os.environ["WORLD_MAP"]
REPORT = os.environ.get("WORLD_REPORT", "world-minimap.json").replace("\\", "/")
report = {"map": MAP}

try:
    unreal.EditorLoadingAndSavingUtils.load_map(MAP)
    wpl = unreal.WorldPartitionBlueprintLibrary
    wpl.load_actors([d.guid for d in wpl.get_actor_descs()])
    actors = [a for a in unreal.EditorLevelLibrary.get_all_level_actors() if a.get_class().get_name() == "WorldPartitionMiniMap"]
    report["minimap_actors"] = len(actors)
    if actors:
        texture = actors[0].get_editor_property("mini_map_texture")
        report["has_texture"] = texture is not None
        report["texture_size"] = [texture.blueprint_get_size_x(), texture.blueprint_get_size_y()] if texture else None
        report["world_units_per_pixel"] = actors[0].get_editor_property("world_units_per_pixel")
except Exception:
    report["error"] = traceback.format_exc()[-900:]

os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
with open(REPORT, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[world_minimap] wrote " + REPORT)
