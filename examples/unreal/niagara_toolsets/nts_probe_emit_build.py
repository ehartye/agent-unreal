"""Probe, build half: systems that may or may not emit, authored through the Niagara toolsets, for the sim-cache count in nts_probe_sim.py.
Prepared 2026-10-26; not yet run on an engine. A first run tests the probe before it tests the engine.

Run headless (assets and level only, no rendering), through nts_probe.mjs --only emit, or by hand:
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: NTS_PROBE_DIR, NTS_REPORT (build report), NTS_MANIFEST (what nts_probe_sim.py samples). Project plugins as nts_validate.mjs.

Question: a system built by removing a template's emitters and adding a Fountain emitter compiled but never emitted, and a stack-authored
emitter from a sprite-burst template counted 0 particles. Which authoring step is responsible? The variants differ one step at a time:
  CtlTemplate         CreateNiagaraSystem from a template system, untouched (the control: it must emit)
  FactoryFountain     NiagaraSystemFactoryNew (no template system) + a Fountain emitter
  FactoryBurst        NiagaraSystemFactoryNew + a SimpleSpriteBurst emitter
  Keep90 / 15 / 0     template system + a Fountain emitter named Probe, template emitters kept; SpawnRate set through SetStackInputData to
                      90, 15 and 0 (0 is the negative control: the count must be 0 while the cache itself is valid)
  SwapFountain        template system, the template emitters removed, a Fountain emitter added
  SwapBurst           the same with SimpleSpriteBurst
  SwapFountainModules SwapFountain plus three modules added to the particle update stack (stand-ins: the modules of the original
                      finding were not recorded)
The emitter under test is named Probe in every variant but the control, and the sim-cache count is read for that emitter.
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

probe = c.Probe("emit-build", "nts-probe-emit-build.json")
positions = {}


def brief(data):
    try:
        value = data.get("value") or {}
        return {"kind": c.kind_of(data), "text": value.get("displayName") or json.dumps(value, sort_keys=True)[:80]}
    except Exception:
        return {"kind": "unreadable", "text": str(data)[:80]}


def dump(system, emitter):
    """Raw facts for a human reading why a system does not emit: the emitter's EmitterState inputs, its stacks, the system summary."""
    out = {}
    values = c.call("GetScriptStackInputValues", {"scriptRef": c.at(system, emitter, "EmitterUpdateScript")})
    state = [m for m in (values["value"] or []) if m.get("moduleName") == "EmitterState"]
    out["emitter_state"] = {i["name"]: brief(i["value"]) for m in state for i in m["inputs"]} if state else values["error"]
    topology = c.tool("GetEmitterTopology", {"emitterRef": c.at(system, emitter)})
    out["stacks"] = {key: [m["moduleName"] for m in topology[key]["modules"]] for key in ("emitterSpawnScript", "emitterUpdateScript", "particleSpawnScript", "particleUpdateScript")}
    out["enabled"] = topology.get("bEnabled")
    out["sim_target"] = topology.get("simTarget")
    return out


def finish(name, system, probe_emitter, note):
    unreal.EditorAssetLibrary.save_asset(system)
    index = len(positions)
    positions[name] = (index * 1500, 0, 100)
    summary = c.call("GetSystemSummary", {"system": c.ref(system)})
    fields = {"id": name, "note": note, "emitters": c.emitter_names(system), "system_summary": json.dumps(summary["value"], sort_keys=True)[:1500] if summary["value"] else summary["error"]}
    if probe_emitter:
        fields["dump"] = dump(system, probe_emitter)
    probe.manifest["samples"].append({"id": name, "actor": "Fx_" + name, "metric_emitter": probe_emitter, "sequence": [{"name": "run", "frames": FRAMES}]})
    probe.manifest["systems"].append({"id": name, "asset": system})
    return fields


def system_for(name, template):
    return c.create_system("NS_" + name, FOLDER, template)


def remove_template_emitters(system):
    for old in c.emitter_names(system):
        if old != "Probe":
            c.tool("RemoveEmitter", {"emitterToRemove": c.at(system, old)})


def rate(system, value):
    c.set_float(c.at(system, "Probe", "EmitterUpdateScript", "SpawnRate", ["SpawnRate"]), value)   # input path as in nts_author.py (templates step)


def ctl_template():
    system = system_for("CtlTemplate", TEMPLATE_SYSTEM)
    return finish("CtlTemplate", system, None, "template system as created")


def factory(name, template):
    system = system_for(name, None)
    c.add_emitter(system, c.EMITTERS + template, "Probe")
    return finish(name, system, "Probe", "NiagaraSystemFactoryNew + " + template)


def keep(name, value):
    system = system_for(name, TEMPLATE_SYSTEM)
    c.add_emitter(system, c.EMITTERS + "Fountain", "Probe")
    rate(system, value)
    return finish(name, system, "Probe", "template system kept, Fountain added, SpawnRate %s" % value)


def swap(name, template, modules=False):
    system = system_for(name, TEMPLATE_SYSTEM)
    c.add_emitter(system, c.EMITTERS + template, "Probe")
    remove_template_emitters(system)
    added = []
    if modules:
        for path in MODULES:
            c.tool("AddModule", {"moduleLocationRef": c.at(system, "Probe", "ParticleUpdateScript"), "moduleAsset": c.ref(path)})
            added.append(path.rsplit("/", 1)[-1])
    fields = finish(name, system, "Probe", "template emitters removed, %s added%s" % (template, " + modules " + ",".join(added) if modules else ""))
    fields["modules_added"] = added
    return fields


try:
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    unreal.EditorAssetLibrary.make_directory(FOLDER)
    probe.step("setup", toolset_registered=unreal.ToolsetRegistry.is_toolset_registered(c.TOOLSET))
except Exception as exc:
    probe.step("setup", error=str(exc)[:300])

PLAN = (("CtlTemplate", ctl_template), ("FactoryFountain", lambda: factory("FactoryFountain", "Fountain")), ("FactoryBurst", lambda: factory("FactoryBurst", "SimpleSpriteBurst")),
        ("Keep90", lambda: keep("Keep90", 90)), ("Keep15", lambda: keep("Keep15", 15)), ("Keep0", lambda: keep("Keep0", 0)),
        ("SwapFountain", lambda: swap("SwapFountain", "Fountain")), ("SwapBurst", lambda: swap("SwapBurst", "SimpleSpriteBurst")),
        ("SwapFountainModules", lambda: swap("SwapFountainModules", "Fountain", modules=True)))
for variant, builder in PLAN:
    probe.guarded("variant_" + variant, builder)
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
