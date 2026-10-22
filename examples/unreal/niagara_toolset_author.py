"""Author a Niagara system from Python through Epic's Niagara toolsets (UE 5.8, Experimental) and place it in the probe level.

Run headless after niagara_build.py (assets and level only, no rendering):
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound
The project needs the NiagaraToolsets plugin on top of PythonScriptPlugin, EditorScriptingUtilities and Niagara. NiagaraToolsets
is Experimental and disabled by default; enabling it also loads ToolsetRegistry. Set NIAGARA_PROBE_REPORT for the JSON report
(default: Saved/niagara-author.json in the project).

The toolset functions carry meta=(AICallable) and are not Python members (dir(unreal.NiagaraToolset_System) is empty). The
Python entry point is unreal.ToolsetRegistry.execute_tool(toolset, tool, json_input), which runs a registered tool "as if
it was being executed by an AI assistant" and returns a result whose `value` is a JSON string {"returnValue": ...}. Object
arguments are {"refPath": "/Package/Path.Name"}. The tools used here complete synchronously in a commandlet. Tools that wait
for a compile (GetSystemCompileState, GetStackIssues) return an incomplete result there; niagara_verify.py polls them from the
editor tick instead.

Run it once per project. Deleting an existing NS_Authored and recreating it in a new commandlet run crashed the editor with an
access violation (exit code 3), so a rerun reports that the system exists and stops; delete the asset in the editor first.

Nothing here judges appearance or cost. niagara_verify.py counts particles per emitter in the running system.
"""
import json
import os
import traceback

import unreal

TOOLSET = "NiagaraToolsets.NiagaraToolset_System"
TEMPLATE_SYSTEM = "/Niagara/DefaultAssets/Templates/Systems/DirectionalBurst"
TEMPLATE_EMITTER = "/Niagara/DefaultAssets/Templates/Emitters/SimpleSpriteBurst"
FX_DIR = "/Game/FX"
SYSTEM_NAME = "NS_Authored"
MAP_PATH = "/Game/Maps/NiagaraProbe"

report = {"engine": unreal.SystemLibrary.get_engine_version(), "calls": []}


def ref(package_path):
    return {"refPath": package_path + "." + package_path.rsplit("/", 1)[-1]}


def call(tool, args):
    """Run one toolset tool; return the decoded returnValue (None while incomplete) and record the outcome."""
    result = unreal.ToolsetRegistry.execute_tool(TOOLSET, tool, json.dumps(args))
    entry = {"tool": tool, "complete": result.is_complete, "error": str(result.get_editor_property("error"))}
    value = None
    if result.is_complete and not entry["error"]:
        value = json.loads(str(result.get_editor_property("value"))).get("returnValue")
    report["calls"].append(entry)
    return value


def emitter_names(summary):
    return [e["emitterName"] for e in (summary or {}).get("emitters", [])]


def report_path():
    return os.environ.get("NIAGARA_PROBE_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "niagara-author.json")


try:
    if not unreal.ToolsetRegistry.is_toolset_registered(TOOLSET):
        raise RuntimeError("toolset not registered: enable the NiagaraToolsets plugin in the .uproject")
    base = set(dir(unreal.Object))
    report["python_members_of_toolset_class"] = sorted(n for n in dir(unreal.NiagaraToolset_System) if not n.startswith("_") and n not in base)
    schema = json.loads(unreal.ToolsetRegistry.get_toolset_json_schema(unreal.NiagaraToolset_System))
    report["system_tool_count"] = len(schema["tools"])
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    unreal.EditorAssetLibrary.make_directory(FX_DIR)
    target = f"{FX_DIR}/{SYSTEM_NAME}"
    if unreal.EditorAssetLibrary.does_asset_exist(target):
        raise RuntimeError(f"{target} already exists: delete it in the editor before rerunning")

    created = call("CreateNiagaraSystem", {"assetName": SYSTEM_NAME, "assetPath": FX_DIR, "templateSystem": ref(TEMPLATE_SYSTEM)})
    system = ref(target)
    before = call("GetSystemSummary", {"system": system})
    call("AddEmitter", {"system": system, "templateEmitter": ref(TEMPLATE_EMITTER), "emitterName": "ExtraBurst"})
    after = call("GetSystemSummary", {"system": system})
    report["created"] = created
    report["emitters_before"], report["emitters_after"] = emitter_names(before), emitter_names(after)
    report["saved"] = unreal.EditorAssetLibrary.save_asset(target)

    # Place it in the probe level next to the template copies, so niagara_verify.py counts its particles too.
    unreal.EditorLoadingAndSavingUtils.load_map(MAP_PATH)
    world = unreal.EditorLevelLibrary.get_editor_world()
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.NiagaraActor, unreal.Vector(1000, 0, 120))
    actor.set_actor_label("FxAuthored")
    comp = actor.get_editor_property("niagara_component")
    comp.set_editor_property("asset", unreal.EditorAssetLibrary.load_asset(target))
    comp.set_editor_property("auto_activate", True)
    report["map_saved"] = bool(unreal.EditorLoadingAndSavingUtils.save_map(world, MAP_PATH))
except Exception:
    report["error"] = traceback.format_exc()[-900:]

path = report_path()
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[niagara_toolset_author] wrote " + path)
