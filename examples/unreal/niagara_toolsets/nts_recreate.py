"""Delete a Niagara system and create one at the same path again, in one of five ways (Unreal 5.8, headless commandlet).

Run once per phase, each in its own process (a phase may crash the editor on purpose):
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: NTS_PHASE and NTS_NOTES (a progress file, one JSON line per step, flushed before the next step).
  make            create and save three systems (NS_Stale, NS_Rescan, NS_Fixed) so that a later process finds them on disk
  same_process    create NS_Same, save, delete it, create it again, add an emitter, save, in one process
  stale           NS_Stale from an earlier process: delete_asset, CreateNiagaraSystem over it, add an emitter, save
  rescan_only     NS_Rescan: delete_asset, scan_paths_synchronous (file left in place), create, add an emitter, save
  remove_rescan   NS_Fixed: delete_asset, remove the file, scan_paths_synchronous, create, add an emitter, save
The last step of every phase writes {"note": "done"}; a phase that ends without it crashed.
"""
import json
import os

import unreal

TOOLSET = "NiagaraToolsets.NiagaraToolset_System"
PHASE = os.environ["NTS_PHASE"]
NOTES = os.environ["NTS_NOTES"]
FX = "/Game/FX"
eal = unreal.EditorAssetLibrary
registry = unreal.AssetRegistryHelpers.get_asset_registry()
tools = unreal.AssetToolsHelpers.get_asset_tools()


def note(text, **fields):
    with open(NOTES, "a") as fh:
        fh.write(json.dumps(dict(note=text, **fields)) + "\n")
        fh.flush()
        os.fsync(fh.fileno())


def ref(path):
    return {"refPath": path + "." + path.rsplit("/", 1)[-1]}


def add_emitter(path):
    args = {"system": ref(path), "templateEmitter": ref("/Niagara/DefaultAssets/Templates/Emitters/HangingParticulates"), "emitterName": "Motes"}
    result = unreal.ToolsetRegistry.execute_tool(TOOLSET, "AddEmitter", json.dumps(args))
    return str(result.get_editor_property("error")) or "ok"


def create_with_toolset(name):
    """CreateNiagaraSystem, the toolset's own create call, from a template system."""
    args = {"assetName": name, "assetPath": FX, "templateSystem": ref("/Niagara/DefaultAssets/Templates/Systems/DirectionalBurst")}
    result = unreal.ToolsetRegistry.execute_tool(TOOLSET, "CreateNiagaraSystem", json.dumps(args))
    return str(result.get_editor_property("error")) or "ok"


def recreate(name, mode):
    path, disk = f"{FX}/{name}", unreal.SystemLibrary.get_project_directory() + f"Content/FX/{name}.uasset"
    note("start", asset=name, on_disk=os.path.exists(disk))
    note("delete_asset", returned=eal.delete_asset(path), file_on_disk=os.path.exists(disk), registry_has_it=eal.does_asset_exist(path))
    if mode == "remove_rescan" and os.path.exists(disk):
        os.remove(disk)
        note("file removed")
    if mode in ("remove_rescan", "rescan_only"):
        registry.scan_paths_synchronous([FX], True)
        note("rescanned", registry_has_it=eal.does_asset_exist(path))
    note("create", result=create_with_toolset(name))
    note("add_emitter", result=add_emitter(path))
    note("save_asset", returned=eal.save_asset(path))


registry.search_all_assets(True)
eal.make_directory(FX)
note("phase", phase=PHASE)
if PHASE == "make":
    for name in ("NS_Stale", "NS_Rescan", "NS_Fixed"):
        tools.create_asset(name, FX, unreal.NiagaraSystem, unreal.NiagaraSystemFactoryNew())
        note("saved", asset=name, returned=eal.save_asset(f"{FX}/{name}"))
elif PHASE == "same_process":
    tools.create_asset("NS_Same", FX, unreal.NiagaraSystem, unreal.NiagaraSystemFactoryNew())
    note("saved first", returned=eal.save_asset(FX + "/NS_Same"))
    recreate("NS_Same", "same_process")
elif PHASE == "stale":
    recreate("NS_Stale", "stale")
elif PHASE == "rescan_only":
    recreate("NS_Rescan", "rescan_only")
elif PHASE == "remove_rescan":
    recreate("NS_Fixed", "remove_rescan")
note("done")
