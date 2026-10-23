"""Copy the Open World template into the project so ep_ground.py can edit it (Unreal 5.8, headless commandlet).

  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: EP_REPORT (JSON report path). The project needs PythonScriptPlugin and EditorScriptingUtilities.

Python has no function that creates a Landscape, so the Landscape comes from the engine's Open World template map, which is a World
Partition map. The copy is "load the map, then Save As" into /Game/Maps/OpenWorldCopy (the same approach as world/world_maps.py).
"""
import json
import os

import unreal

REPORT = os.environ.get("EP_REPORT", "ep-ground-map.json").replace("\\", "/")
SOURCE, TARGET = "/Engine/Maps/Templates/OpenWorld", "/Game/Maps/OpenWorldCopy"
report = {"engine": unreal.SystemLibrary.get_engine_version(), "source": SOURCE, "target": TARGET}

unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
unreal.EditorAssetLibrary.make_directory("/Game/Maps")
report["loaded"] = unreal.EditorLoadingAndSavingUtils.load_map(SOURCE) is not None
report["actor_descs"] = len(unreal.WorldPartitionBlueprintLibrary.get_actor_descs() or [])
world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
report["saved"] = bool(unreal.EditorLoadingAndSavingUtils.save_map(world, TARGET))

os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
with open(REPORT, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[ep_ground_map] wrote " + REPORT)
