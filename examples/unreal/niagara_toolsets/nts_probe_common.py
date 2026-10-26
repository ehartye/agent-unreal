"""Shared helpers of the opt-in Niagara toolset probes (nts_probe_*.py). Prepared 2026-10-26; not yet run on an engine.

The probe scripts import this module. The runner (nts_probe.mjs) sets NTS_PROBE_DIR to this folder, and each script adds it to
sys.path first; `__file__` is not relied on, because a script started with -run=pythonscript or "py <path>" may not define it.

Every call below that reaches the engine is one the 5.8.2 scripts in this folder or in examples/unreal already make, or is
checked against the install and noted next to it:
  unreal.ToolsetRegistry.execute_tool, AssetToolsHelpers.get_asset_tools().create_asset, EditorAssetLibrary.*,
  EditorLoadingAndSavingUtils.new_blank_map / save_map, EditorLevelLibrary.spawn_actor_from_class (nts_author.py, niagara_build.py).
"""
import json
import os
import sys
import traceback

import unreal

sys.dont_write_bytecode = True

TOOLSET = "NiagaraToolsets.NiagaraToolset_System"
EMITTERS = "/Niagara/DefaultAssets/Templates/Emitters/"
SYSTEMS = "/Niagara/DefaultAssets/Templates/Systems/"
BEHAVIOR = "/Niagara/DefaultAssets/Templates/BehaviorExamples/"
SCRIPTS = ("EmitterSpawnScript", "EmitterUpdateScript", "ParticleSpawnScript", "ParticleUpdateScript")
FLOAT = "/Script/Niagara.NiagaraFloat"
INT32 = "/Script/Niagara.NiagaraInt32"
LINKED = "/Script/NiagaraEditor.NiagaraExt_StackInputData_Linked"   # source: NiagaraExternalSystemEditorUtilities.h FNiagaraExt_StackInputData_Linked
DATA_INTERFACE = "/Script/NiagaraEditor.NiagaraExt_StackInputData_DataInterface"   # source: same header, FNiagaraExt_StackInputData_DataInterface


def ref(package_path):
    """Asset ref: {"refPath": "/Package/Path.Name"}."""
    return {"refPath": package_path + "." + package_path.rsplit("/", 1)[-1]}


def class_ref(path):
    """Class ref: {"refPath": "/Script/Module.ClassName"} (no repeated name)."""
    return {"refPath": path}


def short(class_or_asset_ref):
    return class_or_asset_ref["refPath"].rsplit(".", 1)[-1]


def call(tool_name, args):
    """Run one toolset tool; return {complete, error, value} where value is the decoded returnValue (None on an error)."""
    result = unreal.ToolsetRegistry.execute_tool(TOOLSET, tool_name, json.dumps(args))
    error = str(result.get_editor_property("error"))
    value = None
    if result.is_complete and not error:
        text = str(result.get_editor_property("value"))
        value = json.loads(text).get("returnValue") if text else None
    return {"complete": result.is_complete, "error": error, "value": value}


def tool(tool_name, args):
    """Like call, but raise RuntimeError on an error or an incomplete result, and return the value."""
    out = call(tool_name, args)
    if out["error"] or not out["complete"]:
        raise RuntimeError("%s: %s" % (tool_name, out["error"] or "incomplete"))
    return out["value"]


def at(system, emitter=None, script=None, module=None, names=None, renderer=None):
    """A stack item reference. Only the keys that are given are sent (a location without rendererIndex is accepted, see nts_author.py)."""
    out = {"system": system if isinstance(system, dict) else ref(system)}
    for key, value in (("emitterName", emitter), ("scriptName", script), ("moduleName", module), ("inputNameStack", names), ("rendererIndex", renderer)):
        if value is not None:
            out[key] = value
    return out


def kind_of(data):
    """The short struct name of stack-input data: NiagaraFloat, LinearColor, NiagaraExt_StackInputData_Linked, ..."""
    return data["struct"]["refPath"].rsplit(".", 1)[-1]


def emitter_names(system_path):
    summary = tool("GetSystemSummary", {"system": ref(system_path)})
    return [e["emitterName"] for e in summary["emitters"]]


def renderer_classes(system_path, emitter):
    """(renderers[] classes in order, rendererClasses[] classes) from GetEmitterTopology."""
    topology = tool("GetEmitterTopology", {"emitterRef": at(system_path, emitter)})
    ordered = [short(r["rendererClass"]) for r in sorted(topology["renderers"], key=lambda r: r["rendererIndex"])]
    return ordered, [short(c) for c in topology["rendererClasses"]]


def create_system(name, folder, template_system=None):
    """Make a system asset. Without a template: NiagaraSystemFactoryNew (as nts_author.py). With one: the CreateNiagaraSystem tool
    with templateSystem (as stylized_build.py and niagara_toolset_author.py). Returns the package path."""
    path = "%s/%s" % (folder, name)
    unreal.EditorAssetLibrary.make_directory(folder)
    if template_system:
        tool("CreateNiagaraSystem", {"assetName": name, "assetPath": folder, "templateSystem": ref(template_system)})
    else:
        made = unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, folder, unreal.NiagaraSystem, unreal.NiagaraSystemFactoryNew())
        if made is None:
            raise RuntimeError("could not create " + path)
    return path


def add_emitter(system_path, template_path, name):
    tool("AddEmitter", {"system": ref(system_path), "templateEmitter": ref(template_path), "emitterName": name})


def set_float(stack_ref, value):
    """Set a float stack input as a whole (the type with its value); see set_input in nts_author.py."""
    tool("SetStackInputData", {"stackInputRef": stack_ref, "inputData": {"struct": {"refPath": FLOAT}, "value": {"value": float(value)}}})


def get_input(stack_ref):
    return call("GetStackInputData", {"stackInputRef": stack_ref})


class Probe:
    """A report with a list of steps. A step that raises is recorded as {step, error} and the next step still runs."""

    def __init__(self, name, default_file):
        self.name = name
        self.default_file = default_file
        self.report = {"probe": name, "engine": unreal.SystemLibrary.get_engine_version(), "steps": []}
        self.manifest = {"samples": [], "systems": []}

    def step(self, name, **fields):
        self.report["steps"].append(dict(step=name, **fields))

    def guarded(self, name, fn):
        """Run fn (returns a dict of fields or None); record its fields, or the traceback tail as `error`."""
        try:
            fields = fn() or {}
            self.step(name, **fields)
            return fields
        except Exception:
            self.step(name, error=traceback.format_exc()[-700:])
            return None

    def write(self, extra_path_env="NTS_REPORT"):
        path = os.environ.get(extra_path_env) or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", self.default_file)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            json.dump(self.report, fh, indent=2, default=str)
        unreal.log("[nts_probe:%s] wrote %s" % (self.name, path))

    def write_manifest(self):
        path = os.environ.get("NTS_MANIFEST") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", self.default_file.replace(".json", "-manifest.json"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            json.dump(self.manifest, fh, indent=2, default=str)
        unreal.log("[nts_probe:%s] wrote %s" % (self.name, path))


def build_level(map_path, entries, sun=True):
    """A blank map with one NiagaraActor (label Fx_<id>) and one CameraActor (label Cam_<id>) per entry, a directional light and an
    unbound post-process volume with fixed exposure (the settings stylized_build.py uses, so a baseline and a live shot are comparable).

    entries: [{"id", "asset" (package path), "location": (x, y, z)}]. Each camera sits 700 units from its actor along -X, looking at it.
    Returns {"saved": bool}.
    """
    unreal.EditorAssetLibrary.make_directory("/Game/Maps")
    unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
    for entry in entries:
        x, y, z = entry["location"]
        asset = unreal.EditorAssetLibrary.load_asset(entry["asset"])
        actor = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.NiagaraActor, unreal.Vector(x, y, z))
        actor.set_actor_label("Fx_" + entry["id"])
        comp = actor.get_editor_property("niagara_component")
        comp.set_editor_property("asset", asset)
        comp.set_editor_property("auto_activate", True)
        eye = unreal.Vector(x - 700, y, z + 40)
        camera = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.CameraActor, eye)
        camera.set_actor_label("Cam_" + entry["id"])
        camera.set_actor_rotation(unreal.MathLibrary.find_look_at_rotation(eye, unreal.Vector(x, y, z + 40)), False)   # as niagara_build.py
    if sun:
        light = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(-2000, 0, 800), unreal.Rotator(0, -35, 25))
        light.set_actor_label("Sun")
        light.get_component_by_class(unreal.DirectionalLightComponent).set_mobility(unreal.ComponentMobility.MOVABLE)   # as stylized_build.py
        volume = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.PostProcessVolume, unreal.Vector(0, 0, 0))
        volume.set_actor_label("FixedLook")
        volume.set_editor_property("unbound", True)
        settings = volume.get_editor_property("settings")
        for key, value in (("auto_exposure_min_brightness", 1.0), ("auto_exposure_max_brightness", 1.0), ("bloom_intensity", 0.0),
                           ("vignette_intensity", 0.0), ("film_grain_intensity", 0.0), ("motion_blur_amount", 0.0)):
            settings.set_editor_property("override_" + key, True)
            settings.set_editor_property(key, value)
        volume.set_editor_property("settings", settings)
    world = unreal.EditorLevelLibrary.get_editor_world()
    return {"saved": bool(unreal.EditorLoadingAndSavingUtils.save_map(world, map_path))}
