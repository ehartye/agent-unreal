"""Show that a water body cannot be placed from a commandlet (Unreal 5.8). Expected result: the process stops, exit code is not 0.

  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -nullrhi -unattended -nosplash -nopause -nosound -notraceserver
Environment: WORLD_REPORT (JSON path). It opens /Game/Maps/WorldLarge, places a Water Zone (this works), then a River. The River
spawn raises a Slate assertion (CurrentBaseApplication.IsValid) from LandscapeEditor, because the Water editor module adds its brush manager to
the Landscape and that code needs the Slate application. The report is written before the River spawn; "river_spawned" never appears.
world_place.py does the same work in UnrealEditor.exe with -nullrhi, where it succeeds.
"""
import json
import os

import unreal

REPORT = os.environ.get("WORLD_REPORT", "world-place-commandlet.json").replace("\\", "/")
report = {"engine": unreal.SystemLibrary.get_engine_version()}


def flush():
    os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=2)


unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
unreal.EditorLoadingAndSavingUtils.load_map("/Game/Maps/WorldLarge")
zone = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.WaterZone, unreal.Vector(0, 0, 0))
report["zone_spawned"] = zone is not None
flush()
river = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.WaterBodyRiver, unreal.Vector(0, 0, 0))
report["river_spawned"] = river is not None
flush()
