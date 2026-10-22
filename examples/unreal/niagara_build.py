"""Build a Niagara probe level in Unreal 5.8 through the editor Python API.

Run headless (assets and level only, no rendering):
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound
The project needs the PythonScriptPlugin, EditorScriptingUtilities and Niagara plugins. Set NIAGARA_PROBE_REPORT to the
path of the JSON report to write (default: Saved/niagara-build.json under the project directory).

It duplicates engine template systems into /Game/FX, saves them, places one NiagaraActor per system in a new map and saves
the map as /Game/Maps/NiagaraProbe. Claims nothing about rendering: niagara_verify.py checks the running systems.

Steps it follows:
  - Call AssetRegistry.search_all_assets(True) first: a commandlet has not scanned engine content yet.
  - Pass duplicate_asset the source as an object path (Package.Name).
  - Save each duplicate before saving the map that places it.
  - Assign the system through the placed actor's `asset` editor property.
"""
import json
import os
import traceback

import unreal

TEMPLATES = {
    "Stateful": "/Niagara/DefaultAssets/Templates/Systems/SimpleExplosion",
    "Lightweight": "/Niagara/DefaultAssets/Templates/Systems/FountainLightweight",
}
FX_DIR = "/Game/FX"
MAP_PATH = "/Game/Maps/NiagaraProbe"

report = {"engine": unreal.SystemLibrary.get_engine_version(), "steps": []}


def default_report_path():
    project = unreal.SystemLibrary.get_project_directory()
    return os.environ.get("NIAGARA_PROBE_REPORT") or os.path.join(project, "Saved", "niagara-build.json")


def step(name, **info):
    report["steps"].append(dict(step=name, **info))


try:
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    unreal.EditorAssetLibrary.make_directory(FX_DIR)
    unreal.EditorAssetLibrary.make_directory("/Game/Maps")
    unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
    x = 0
    for label, source in TEMPLATES.items():
        target = f"{FX_DIR}/NS_{label}"
        if unreal.EditorAssetLibrary.does_asset_exist(target):
            unreal.EditorAssetLibrary.delete_asset(target)
        duplicate = unreal.EditorAssetLibrary.duplicate_asset(f"{source}.{source.rsplit('/', 1)[-1]}", target)
        saved = bool(duplicate) and unreal.EditorAssetLibrary.save_asset(target)
        step("duplicate", template=source, target=target, ok=bool(duplicate), saved=saved)
        if not duplicate:
            continue
        actor = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.NiagaraActor, unreal.Vector(x, 0, 120))
        actor.set_actor_label("Fx" + label)
        actor.get_editor_property("niagara_component").set_editor_property("asset", duplicate)
        actor.get_editor_property("niagara_component").set_editor_property("auto_activate", True)
        x += 500
    # A camera that niagara_view.py makes the view target. Actors cannot be spawned from Python once Play-In-Editor has started.
    camera = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.CameraActor, unreal.Vector(500, -1700, 380))
    camera.set_actor_label("ViewCamera")
    camera.set_actor_rotation(unreal.MathLibrary.find_look_at_rotation(unreal.Vector(500, -1700, 380), unreal.Vector(500, 0, 150)), False)
    step("save_map", ok=bool(unreal.EditorLoadingAndSavingUtils.save_map(unreal.EditorLevelLibrary.get_editor_world(), MAP_PATH)))
except Exception:
    step("error", traceback=traceback.format_exc()[-900:])

path = default_report_path()
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[niagara_build] wrote " + path)
