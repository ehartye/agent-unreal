"""Read back a saved Niagara system through Epic's Niagara toolsets (Unreal 5.8, Experimental NiagaraToolsets).

Run it through probe.mjs (headless editor), or directly:
  UnrealEditor.exe Project.uproject -ExecutePythonScript=<this file> -nullrhi -unattended -nosplash -nosound -notraceserver
The project needs PythonScriptPlugin, EditorScriptingUtilities, Niagara and NiagaraToolsets.
Environment:
  PROBE_SYSTEMS  system asset paths, separated by commas or spaces: /Game/FX/NS_Example (the object path /Game/FX/NS_Example.NS_Example works too)
  PROBE_MODULES  optional modules whose current input values to read: "Module" (in every emitter that has it) or "Emitter:Module"
  PROBE_REPORT   absolute path of the JSON report to write

The report is one object keyed by each requested system path. A system entry is {"status": "found", "summary", "system_data", "emitters",
"modules", "problems"}, or {"status": "missing" | "unavailable", "reason"}. "emitters" maps each emitter name to its summary, its
property values (GetEmitterData, parsed), the module names of its four script stacks and its renderers' property values. "modules" maps
"Emitter:Script:Module" to {"status": "found", "inputs": [...]} (GetModuleInputValues: the value each input has now, as saved), or a
requested name that matched nothing to {"status": "missing", "reason"}. A part the toolset could not return holds the string
"unavailable" and its error is listed in "problems".
"""
import json
import os
import re
import traceback

import unreal

TOOLSET = "NiagaraToolsets.NiagaraToolset_System"
SCRIPTS = ("emitterSpawnScript", "emitterUpdateScript", "particleSpawnScript", "particleUpdateScript")


def names_from(text, pattern=r"[,;\s]+"):
    seen = []
    for part in re.split(pattern, text or ""):
        if part and part not in seen:
            seen.append(part)
    return seen


class Failed(Exception):
    pass


def call(tool, args):
    """Run one toolset tool and return its decoded returnValue; raise Failed with the toolset's error text."""
    result = unreal.ToolsetRegistry.execute_tool(TOOLSET, tool, json.dumps(args))
    error = str(result.get_editor_property("error"))
    if error:
        raise Failed("%s: %s" % (tool, error[:300]))
    if not result.is_complete:
        raise Failed("%s: not complete (it waits for an editor tick)" % tool)
    return json.loads(str(result.get_editor_property("value")))["returnValue"]


def object_path(path):
    return path if "." in path.rsplit("/", 1)[-1] else path + "." + path.rsplit("/", 1)[-1]


def describe(path, wanted_modules):
    package = path.split(".")[0]
    if not unreal.EditorAssetLibrary.does_asset_exist(package):
        return {"status": "missing", "reason": "no asset at %s" % package}
    asset = unreal.EditorAssetLibrary.load_asset(package)
    if not isinstance(asset, unreal.NiagaraSystem):
        return {"status": "unavailable", "reason": "%s is a %s, not a NiagaraSystem" % (package, type(asset).__name__)}
    system = {"refPath": object_path(path)}
    problems = []

    def safe(label, tool, args, parse=None):
        try:
            value = call(tool, args)
            return parse(value) if parse else value
        except Exception as exc:
            problems.append("%s: %s" % (label, exc))
            return "unavailable"

    summary = call("GetSystemSummary", {"system": system})
    entry = {"status": "found", "summary": summary, "emitters": {}, "modules": {}, "problems": problems}
    entry["system_data"] = safe("GetSystemData", "GetSystemData", {"system": system})
    parse_values = lambda v: json.loads(v["propertyValues"]) if isinstance(v.get("propertyValues"), str) else v
    topologies = {}
    for emitter in summary.get("emitters", []):
        name = emitter["emitterName"]
        ref = {"system": system, "emitterName": name}
        topology = safe("%s GetEmitterTopology" % name, "GetEmitterTopology", {"emitterRef": ref})
        topologies[name] = topology
        scripts = {}
        renderers = []
        if isinstance(topology, dict):
            for key in SCRIPTS:
                stack = topology.get(key) or {}
                scripts[stack.get("scriptName", key[0].upper() + key[1:])] = [m["moduleName"] for m in stack.get("modules", [])]
            for index, renderer in enumerate(topology.get("renderers", [])):
                number = renderer.get("rendererIndex", index) if isinstance(renderer, dict) else index
                renderers.append(safe("%s renderer %s" % (name, number), "GetRendererData",
                                      {"rendererRef": dict(ref, rendererIndex=number)}, parse_values))
        entry["emitters"][name] = {
            "summary": emitter,
            "data": safe("%s GetEmitterData" % name, "GetEmitterData", {"emitterRef": ref}, parse_values),
            "modules": scripts or "unavailable",
            "renderers": renderers,
        }

    for spec in wanted_modules:
        want_emitter, _, want_module = spec.rpartition(":")
        hits = 0
        for name, info in entry["emitters"].items():
            if want_emitter and want_emitter != name:
                continue
            if not isinstance(info["modules"], dict):
                continue
            for script, modules in info["modules"].items():
                if want_module not in modules:
                    continue
                hits += 1
                key = "%s:%s:%s" % (name, script, want_module)
                ref = {"system": system, "emitterName": name, "scriptName": script, "moduleName": want_module}
                try:
                    values = call("GetModuleInputValues", {"moduleRef": ref})
                    entry["modules"][key] = {"status": "found", "inputs": values.get("inputs", [])}
                except Exception as exc:
                    entry["modules"][key] = {"status": "unavailable", "reason": str(exc)}
        if not hits:
            entry["modules"][spec] = {"status": "missing", "reason": "no emitter in this system has a module named %s%s"
                                      % (want_module, " in emitter " + want_emitter if want_emitter else "")}
    return entry


report = {}
systems = names_from(os.environ.get("PROBE_SYSTEMS"))
modules = names_from(os.environ.get("PROBE_MODULES"))
try:
    if not systems:
        raise ValueError("PROBE_SYSTEMS is empty")
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    registered = unreal.ToolsetRegistry.is_toolset_registered(TOOLSET)
    for path in systems:
        if not registered:
            report[path] = {"status": "unavailable", "reason": "%s is not registered: enable the NiagaraToolsets plugin" % TOOLSET}
            continue
        try:
            report[path] = describe(path, modules)
        except Exception as exc:
            report[path] = {"status": "unavailable", "reason": "%s: %s" % (type(exc).__name__, str(exc)[:300])}
except Exception:
    unreal.log_error("[inspect_system] " + traceback.format_exc())

path = os.environ.get("PROBE_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "probe-system.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w", encoding="utf-8") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[inspect_system] %d systems, wrote %s" % (len(report), path))
