"""Create the throwaway assets the lock test uses: a material and a static mesh for each of three actors (Unreal 5.8, editor).

  UnrealEditor-Cmd.exe Project.uproject -ExecutePythonScript="<absolute-path-to-this-file>" -nullrhi -unattended -nosplash -nosound -notraceserver
Writes /Game/Lock/M_Ctor, M_Post, M_Soft (empty materials) and SM_Ctor, SM_Post, SM_Soft (copies of the engine cube), saves them and
writes a JSON report to LOCK_REPORT. Run it on a project that has no code module, so no class refers to the assets yet.
"""
import json
import os

import unreal

REPORT = os.environ.get("LOCK_REPORT", "lock-setup.json").replace("\\", "/")
report = {"engine": unreal.SystemLibrary.get_engine_version(), "assets": []}
tools = unreal.AssetToolsHelpers.get_asset_tools()
lib = unreal.EditorAssetLibrary
for key in ("Ctor", "Post", "Soft"):
    material = tools.create_asset("M_" + key, "/Game/Lock", unreal.Material, unreal.MaterialFactoryNew())
    mesh = lib.duplicate_asset("/Engine/BasicShapes/Cube.Cube", "/Game/Lock/SM_" + key)
    for asset in (material, mesh):
        report["assets"].append({"path": asset.get_path_name() if asset else None, "saved": bool(asset and lib.save_loaded_asset(asset))})
os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
with open(REPORT, "w") as fh:
    json.dump(report, fh, indent=2)
