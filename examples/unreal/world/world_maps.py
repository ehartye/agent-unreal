"""Copy two engine maps into the project so the rest of the world scenes can edit them (Unreal 5.8, headless commandlet).

  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: WORLD_REPORT (JSON report path). The project needs PythonScriptPlugin, EditorScriptingUtilities, Water and Landmass.

  /Game/Maps/WorldLarge  a copy of the engine Open World template, which is already a World Partition map
  /Game/Maps/WorldSmall  a copy of a Water plugin sample map, which is not partitioned (world_validate.mjs converts it)

The copy is "load the map, then Save As", which writes the external actor files (__ExternalActors__) under the new map name.
The loaded world is not kept in a Python variable: a Python reference keeps the old world alive and the next load_map fails.
"""
import json
import os
import traceback

import unreal

REPORT = os.environ.get("WORLD_REPORT", "world-maps.json").replace("\\", "/")
COPIES = [
    ("/Engine/Maps/Templates/OpenWorld", "/Game/Maps/WorldLarge"),
    ("/Water/FluidSimulation/Fluidsim_Terrain", "/Game/Maps/WorldSmall"),
]
report = {"engine": unreal.SystemLibrary.get_engine_version(), "steps": []}

try:
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    unreal.EditorAssetLibrary.make_directory("/Game/Maps")
    for source, target in COPIES:
        loaded = unreal.EditorLoadingAndSavingUtils.load_map(source)
        descs = unreal.WorldPartitionBlueprintLibrary.get_actor_descs() or []
        saved = unreal.EditorLoadingAndSavingUtils.save_map(unreal.EditorLevelLibrary.get_editor_world(), target)
        report["steps"].append({"step": "copy", "source": source, "target": target, "loaded": loaded is not None, "saved": bool(saved),
                                "actor_descs": len(descs)})
except Exception:
    report["steps"].append({"step": "error", "traceback": traceback.format_exc()[-900:]})

os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
with open(REPORT, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[world_maps] wrote " + REPORT)
