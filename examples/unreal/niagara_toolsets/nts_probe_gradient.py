"""Probe: the tool surface of the Niagara toolset, and whether a gradient or curve input is set and read back like the float case.
Prepared 2026-10-26; not yet run on an engine. A first run tests the probe before it tests the engine.

Run headless (assets only, no rendering), through nts_probe.mjs --only gradient, or by hand:
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: NTS_PROBE_DIR, NTS_REPORT. Project plugins as nts_validate.mjs. Meant for both 5.8.2 and 5.8.3 (the engine string is in the report).

Steps:
  surface    the names of the System toolset's tools, the Niagara skills ToolsetRegistry lists, and whether the toolset registered; compare the
             lists between engine versions
  inventory  add all 14 template emitters to a scratch system and read every stack input (GetScriptStackInputValues, four scripts per
             emitter); count the input kinds; list the data-interface inputs whose value text mentions a curve or gradient. When none turns up,
             add the ScaleColor module to a scratch emitter and look there
  attempt    for the first candidate: read it, change one number in its property JSON, write it back as a whole
             (FNiagaraExt_StackInputData_DataInterface.PropertyValues is a JSON string; the setter applies it with SetAllObjectProperties and
             refuses an input whose type is not a data interface), read it again, and compare
A data-interface input is the case the float-only 5.8.2 runs never reached. Inputs held by a dynamic input chain (GetDynamicInputChain) are not scanned.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.environ.get("NTS_PROBE_DIR", ""))
import nts_probe_common as c  # noqa: E402
import unreal  # noqa: E402

FOLDER = "/Game/Probe/Gradient"
NAMES = ["BlowingParticles", "ConfettiBurst", "DirectionalBurst", "DynamicBeam", "Fountain", "HangingParticulates", "LocationBasedRibbon",
         "Minimal", "OmnidirectionalBurst", "RecycleParticlesInView", "SimpleSpriteBurst", "SingleLoopingParticle", "StaticBeam", "UpwardMeshBurst"]
SCALE_COLOR = "/Niagara/Modules/Update/Color/ScaleColor"   # Engine/Plugins/FX/Niagara/Content/Modules/Update/Color/ScaleColor.uasset
WORDS = re.compile(r"curve|gradient", re.I)
PREFERRED_KEYS = ("Value", "R", "G", "B", "A", "Time")
probe = c.Probe("gradient", "nts-probe-gradient.json")
system_path = FOLDER + "/NS_Gradient"
kinds, candidates, scanned = {}, [], [0]


def surface():
    schema = json.loads(unreal.ToolsetRegistry.get_toolset_json_schema(unreal.NiagaraToolset_System))["tools"]
    tools = sorted(schema.keys()) if isinstance(schema, dict) else sorted(t.get("name", "") for t in schema)
    skills = json.loads(str(unreal.ToolsetRegistry.execute_tool("ToolsetRegistry.AgentSkillToolset", "ListSkills", "{}").get_editor_property("value")))["returnValue"]
    return {"registered": unreal.ToolsetRegistry.is_toolset_registered(c.TOOLSET), "tool_count": len(tools), "tools": tools,
            "niagara_skills": sorted(k.rsplit(".", 1)[-1] for k in skills if "NiagaraToolsets" in k)}


def scan(emitter):
    for script in c.SCRIPTS:
        got = c.call("GetScriptStackInputValues", {"scriptRef": c.at(system_path, emitter, script)})
        for module in got["value"] or []:
            for item in module["inputs"]:
                data = item["value"]
                scanned[0] += 1
                kind = data["struct"]["refPath"].rsplit(".", 1)[-1]
                kinds[kind] = kinds.get(kind, 0) + 1
                text = str((data.get("value") or {}).get("propertyValues", "")) if kind.endswith("DataInterface") else ""
                if kind.endswith("DataInterface") and (WORDS.search(text) or WORDS.search(item["name"])):
                    candidates.append({"emitter": emitter, "script": script, "module": module["moduleName"], "input": item["name"], "kind": kind, "preview": text[:160]})


def inventory():
    c.create_system("NS_Gradient", FOLDER)
    for name in NAMES:
        c.add_emitter(system_path, c.EMITTERS + name, name)
        scan(name)
    fallback = None
    if not candidates:
        c.add_emitter(system_path, c.EMITTERS + "SimpleSpriteBurst", "ScaleColorProbe")
        added = c.call("AddModule", {"moduleLocationRef": c.at(system_path, "ScaleColorProbe", "ParticleUpdateScript"), "moduleAsset": c.ref(SCALE_COLOR)})
        fallback = {"add_error": added["error"]}
        scan("ScaleColorProbe")
    return {"scanned_inputs": scanned[0], "kinds": kinds, "candidates": candidates, "fallback": fallback}


def mutate(node, path=()):
    """Change the first number in a parsed JSON tree (preferring keys that hold a curve value); return (path, old, new) or None."""
    found = []

    def walk(value, trail):
        if isinstance(value, bool):
            return
        if isinstance(value, (int, float)):
            found.append(trail)
        elif isinstance(value, dict):
            for key, inner in value.items():
                walk(inner, trail + (key,))
        elif isinstance(value, list):
            for index, inner in enumerate(value):
                walk(inner, trail + (index,))

    walk(node, path)
    if not found:
        return None
    trail = next((t for t in found if t and t[-1] in PREFERRED_KEYS), found[0])
    holder = node
    for key in trail[:-1]:
        holder = holder[key]
    old = holder[trail[-1]]
    holder[trail[-1]] = old + 0.25 if isinstance(old, float) or not isinstance(old, int) else old + 1
    return list(trail), old, holder[trail[-1]]


def digging(node, trail):
    for key in trail:
        node = node[key]
    return node


def attempt():
    if not candidates:
        return {"error": "no data-interface input mentions a curve or gradient in the template emitters or the ScaleColor module"}
    target = next((cand for cand in candidates if "color" in cand["input"].lower()), candidates[0])
    ref = c.at(system_path, target["emitter"], target["script"], target["module"], [target["input"]])
    before = c.get_input(ref)
    props = json.loads(before["value"]["value"]["propertyValues"])
    changed = json.loads(json.dumps(props))
    mutation = mutate(changed)
    if mutation is None:
        return {"target": target, "error": "the property JSON holds no number to change", "properties": json.dumps(props)[:400]}
    path, old, new = mutation
    written = c.call("SetStackInputData", {"stackInputRef": ref, "inputData": {"struct": {"refPath": c.DATA_INTERFACE}, "value": {"propertyValues": json.dumps(changed)}}})
    after = c.get_input(ref)
    after_props = json.loads(after["value"]["value"]["propertyValues"]) if after["value"] and c.kind_of(after["value"]).endswith("DataInterface") else None
    got = digging(after_props, path) if after_props is not None else None
    return {"target": target, "path": path, "old": old, "new": new, "set_error": written["error"], "read_error": after["error"],
            "kind_before": c.kind_of(before["value"]), "kind_after": c.kind_of(after["value"]) if after["value"] else None,
            "value_after": got, "stored": isinstance(got, (int, float)) and abs(got - new) < 1e-4,
            "same_keys": after_props is not None and sorted(after_props.keys()) == sorted(props.keys()), "properties_before": json.dumps(props)[:400]}


try:
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    unreal.EditorAssetLibrary.make_directory(FOLDER)
except Exception as exc:
    probe.step("setup", error=str(exc)[:300])
for name, fn in (("surface", surface), ("inventory", inventory), ("attempt", attempt)):
    probe.guarded(name, fn)
    probe.write()
