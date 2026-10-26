"""Probe, build half: systems that may or may not emit, authored through the Niagara toolsets, for the sim-cache count in nts_probe_sim.py.
Run on 5.8.2 on 2026-10-26 and again on 5.8.4 with the same result (the checks in nts-probe-checks.mjs state what it showed).

Run headless (assets and level only, no rendering), through nts_probe.mjs --only emit, or by hand:
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: NTS_PROBE_DIR, NTS_REPORT (build report), NTS_MANIFEST (what nts_probe_sim.py samples). Project plugins as nts_validate.mjs.

Question: a system built by removing a template system's emitters and adding a Fountain emitter compiled but never emitted, and a
stack-authored emitter from a sprite-burst template counted 0 particles. Which authoring step is responsible? Each variant is a list of
steps (VARIANTS below), and the variants differ one step at a time. Base "template" is CreateNiagaraSystem with a template system,
"factory" is NiagaraSystemFactoryNew. The emitter under test is named Probe, the sim-cache count is read for that emitter, and the system
is saved after the last step.
"""
import json
import os
import sys

sys.path.insert(0, os.environ.get("NTS_PROBE_DIR", ""))
import nts_probe_common as c  # noqa: E402
import unreal  # noqa: E402

FOLDER, MAP = "/Game/Probe/Emit", "/Game/Maps/NtsProbeEmit"
TEMPLATE_SYSTEM = c.SYSTEMS + "DirectionalBurst"   # the template stylized_build.py and niagara_toolset_author.py use
MODULES = ("/Niagara/Modules/Update/Forces/GravityForce", "/Niagara/Modules/Update/Forces/DragForce", "/Niagara/Modules/Update/Color/ScaleColor")   # files under Engine/Plugins/FX/Niagara/Content/Modules/Update
FRAMES = 40
BOOL = "/Script/Niagara.NiagaraBool"

probe = c.Probe("emit-build", "nts-probe-emit-build.json")
positions = {}


def state(system, name):
    """A SystemState input of the system update stack."""
    return c.at(system, None, "SystemUpdateScript", "SystemState", [name])


def rate_ref(system, emitter="Probe"):
    return c.at(system, emitter, "EmitterUpdateScript", "SpawnRate", ["SpawnRate"])   # input path as in nts_author.py (templates step)


def write(system, ref, struct, value):
    c.tool("SetStackInputData", {"stackInputRef": ref, "inputData": {"struct": {"refPath": struct}, "value": {"value": value}}})


def brief(data):
    try:
        value = data.get("value") or {}
        return {"kind": c.kind_of(data), "text": value.get("displayName") or json.dumps(value, sort_keys=True)[:80]}
    except Exception:
        return {"kind": "unreadable", "text": str(data)[:80]}


def inputs_of(system, emitter, script):
    got = c.call("GetScriptStackInputValues", {"scriptRef": c.at(system, emitter, script)})
    if got["error"] or got["value"] is None:
        return got["error"][:300]
    return {m["moduleName"]: {i["name"]: brief(i["value"]) for i in m["inputs"]} for m in got["value"]}


def dump(system, emitter):
    """Raw facts for a human reading why a system does not emit: the emitter's stacks and input values, the system's state module and properties."""
    out = {}
    topology = c.tool("GetEmitterTopology", {"emitterRef": c.at(system, emitter)})
    out["stacks"] = {key: [m["moduleName"] for m in topology[key]["modules"]] for key in ("emitterSpawnScript", "emitterUpdateScript", "particleSpawnScript", "particleUpdateScript")}
    out["emitter_update_inputs"] = inputs_of(system, emitter, "EmitterUpdateScript")
    out["system_update_inputs"] = inputs_of(system, None, "SystemUpdateScript")
    data = c.call("GetSystemData", {"system": c.ref(system)})
    try:
        props = json.loads(data["value"]["propertyValues"])
        out["system_properties"] = {k: props.get(k) for k in ("bDeterminism", "bFixedBounds", "EffectType", "bAllowSystemStateFastPath", "WarmupTime", "bInitialOwnerVelocityFromActor")}
    except Exception:
        out["system_properties"] = data["error"][:300] or "unreadable"
    return out


def build(name, base, steps):
    """Run the steps in order, save, and register the system for the sim phase. Returns the build-report fields."""
    system = c.create_system("NS_" + name, FOLDER, TEMPLATE_SYSTEM if base == "template" else None)
    original = c.emitter_names(system)
    done = []
    for step in steps:
        kind, args = step[0], step[1:]
        if kind == "add":                  # (template emitter, emitter name)
            c.add_emitter(system, c.EMITTERS + args[0], args[1])
        elif kind == "remove_original":    # the emitters the template system came with
            for old in original:
                c.tool("RemoveEmitter", {"emitterToRemove": c.at(system, old)})
        elif kind == "rate":               # (emitter, value): a float stack input
            write(system, rate_ref(system, args[0]), c.FLOAT, float(args[1]))
        elif kind == "duration":           # (value): a float stack input of the system's own SystemState
            write(system, state(system, "Loop Duration"), c.FLOAT, float(args[0]))
        elif kind == "count":              # (value): an int stack input of the burst module
            write(system, c.at(system, "Probe", "EmitterUpdateScript", "SpawnBurst_Instantaneous", ["Spawn Count"]), c.INT32, int(args[0]))
        elif kind == "bool":               # a bool stack input of the emitter's own EmitterState
            write(system, c.at(system, "Probe", "EmitterUpdateScript", "EmitterState", ["Recalculate Duration Each Loop"]), BOOL, True)
        elif kind == "enum":               # the system's Loop Behavior, copied from a factory system, where it reads Infinite
            reference = c.get_input(state(FOLDER + "/NS_FactoryFountain", "Loop Behavior"))
            c.tool("SetStackInputData", {"stackInputRef": state(system, "Loop Behavior"), "inputData": reference["value"]})
        elif kind == "toggle":             # the SpawnRate module off and on again
            for flag in (False, True):
                c.tool("SetModuleEnabled", {"moduleRef": c.at(system, "Probe", "EmitterUpdateScript", "SpawnRate"), "bEnabled": flag})
        elif kind == "modules":            # three modules at the end of the particle update stack (stand-ins: the modules of the original finding were not recorded)
            for path in MODULES:
                c.tool("AddModule", {"moduleLocationRef": c.at(system, "Probe", "ParticleUpdateScript"), "moduleAsset": c.ref(path)})
        else:
            raise RuntimeError("unknown step " + kind)
        done.append(":".join(str(a) for a in step))
    unreal.EditorAssetLibrary.save_asset(system)
    positions[name] = (len(positions) * 1500, 0, 100)
    fields = {"id": name, "base": base, "steps": done, "emitters": c.emitter_names(system)}
    fields["dump"] = dump(system, "Probe") if "Probe" in fields["emitters"] else None
    probe.manifest["samples"].append({"id": name, "actor": "Fx_" + name, "metric_emitter": "Probe", "sequence": [{"name": "run", "frames": FRAMES}]})
    probe.manifest["systems"].append({"id": name, "asset": system})
    return fields


# id -> (base, steps). The Fountain template reads SpawnRate 90 by default; SimpleSpriteBurst reads Spawn Count 1.
FOUNTAIN, BURST = ("add", "Fountain", "Probe"), ("add", "SimpleSpriteBurst", "Probe")
VARIANTS = {
    "CtlTemplate": ("template", []),                                                      # the control: the template system as created
    "FactoryFountain": ("factory", [FOUNTAIN]),
    "FactoryBurst": ("factory", [BURST]),
    "KeepUntouched": ("template", [FOUNTAIN]),                                            # template emitters kept, Fountain added, nothing written
    "Keep90": ("template", [FOUNTAIN, ("rate", "Probe", 90)]),                            # 90 is the value the input already holds
    "Keep60": ("template", [FOUNTAIN, ("rate", "Probe", 60)]),
    "Keep30": ("template", [FOUNTAIN, ("rate", "Probe", 30)]),
    "Keep15": ("template", [FOUNTAIN, ("rate", "Probe", 15)]),
    "Keep0": ("template", [FOUNTAIN, ("rate", "Probe", 0)]),                              # the negative control
    "SwapFountain": ("template", [FOUNTAIN, ("remove_original",)]),
    "SwapBurst": ("template", [BURST, ("remove_original",)]),
    "SwapFountainModules": ("template", [FOUNTAIN, ("remove_original",), ("modules",)]),
    "SwapSameValue": ("template", [FOUNTAIN, ("remove_original",), ("duration", 1)]),     # 1 is the value the system's Loop Duration already holds
    "SwapEnum": ("template", [FOUNTAIN, ("remove_original",), ("enum",)]),
    "SwapBool": ("template", [FOUNTAIN, ("remove_original",), ("bool",)]),
    "SwapToggle": ("template", [FOUNTAIN, ("remove_original",), ("toggle",)]),
    "SwapWriteFirst": ("template", [("duration", 5), FOUNTAIN, ("remove_original",)]),    # the write comes before the add
    "SwapRateTouched": ("template", [FOUNTAIN, ("remove_original",), ("rate", "Probe", 91), ("rate", "Probe", 90)]),   # ends at the default value
    "SwapDurationTouched": ("template", [FOUNTAIN, ("remove_original",), ("duration", 5)]),
    "SwapBurstTouched": ("template", [BURST, ("remove_original",), ("count", 5)]),
    "LateAdded": ("template", [FOUNTAIN, ("remove_original",), ("rate", "Probe", 91), ("add", "Fountain", "Late")]),   # a second emitter added after the write
    "LateTouched": ("template", [FOUNTAIN, ("remove_original",), ("add", "Fountain", "Late"), ("rate", "Late", 91)]),   # the write is on the second emitter only
    "TouchedThenRemoved": ("template", [FOUNTAIN, ("rate", "Probe", 91), ("remove_original",)]),   # the template emitters are removed after the write
}

try:
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    unreal.EditorAssetLibrary.make_directory(FOLDER)
    probe.step("setup", toolset_registered=unreal.ToolsetRegistry.is_toolset_registered(c.TOOLSET))
except Exception as exc:
    probe.step("setup", error=str(exc)[:300])

for variant, (base, steps) in VARIANTS.items():
    probe.guarded("variant_" + variant, lambda variant=variant, base=base, steps=steps: build(variant, base, steps))
probe.write()   # the assets are saved; the level step below can take the editor down without losing the steps above

# a variant that failed to build has no manifest entry for the sim; leave out any whose asset does not exist
built = [s for s in probe.manifest["systems"] if unreal.EditorAssetLibrary.does_asset_exist(s["asset"])]
probe.manifest["samples"] = [s for s in probe.manifest["samples"] if any(b["id"] == s["id"] for b in built)]
probe.manifest["systems"] = built
probe.manifest["map"] = MAP
probe.manifest["settle_seconds"] = 8
entries = [{"id": s["id"], "asset": s["asset"], "location": positions[s["id"]]} for s in built]
probe.guarded("level", lambda: c.build_level(MAP, entries, sun=False))
probe.write()
probe.write_manifest()
