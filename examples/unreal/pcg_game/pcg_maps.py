"""Copy a small engine Landscape map into the project and list its Landscape (Unreal 5.8, headless commandlet).

  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: PCG_REPORT (JSON report path), PCG_SOURCE_MAP (default /Water/FluidSimulation/Fluidsim_Terrain, a Water plugin sample map
with one Landscape; set /Engine/Maps/Templates/OpenWorld to use the World Partition template instead). The project needs
PythonScriptPlugin, EditorScriptingUtilities and PCG, plus Water for the default source map.

The copy is "load the map, then Save As" into /Game/Maps/PcgBase. Python has no function that creates a Landscape, so a map that
already has one is the starting point. The loaded world is not kept in a Python variable.
"""
import json
import os
import traceback

import unreal

REPORT = os.environ.get("PCG_REPORT", "pcg-maps.json").replace("\\", "/")
SOURCE = os.environ.get("PCG_SOURCE_MAP", "/Water/FluidSimulation/Fluidsim_Terrain")
TARGET = "/Game/Maps/PcgBase"
report = {"engine": unreal.SystemLibrary.get_engine_version(), "source": SOURCE, "target": TARGET}

try:
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    unreal.EditorAssetLibrary.make_directory("/Game/Maps")
    report["loaded"] = unreal.EditorLoadingAndSavingUtils.load_map(SOURCE) is not None
    lands = [a for a in unreal.EditorLevelLibrary.get_all_level_actors() if isinstance(a, unreal.LandscapeProxy)]
    report["landscapes"] = []
    for land in lands:
        origin, extent = land.get_actor_bounds(False)
        report["landscapes"].append({"class": land.get_class().get_name(), "origin": [round(origin.x), round(origin.y), round(origin.z)],
                                     "extent": [round(extent.x), round(extent.y), round(extent.z)]})
    report["saved"] = bool(unreal.EditorLoadingAndSavingUtils.save_map(unreal.EditorLevelLibrary.get_editor_world(), TARGET))
except Exception:
    report["error"] = traceback.format_exc()[-900:]

os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
with open(REPORT, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[pcg_maps] wrote " + REPORT)
