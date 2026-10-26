"""Probe: AddRenderer into a list of renderers, other renderer classes, two renderers of one class, and renderer counts of the templates.
Prepared 2026-10-26; not yet run on an engine. A first run tests the probe before it tests the engine.

Run headless (assets only, no rendering), through nts_probe.mjs --only renderers, or by hand:
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: NTS_PROBE_DIR (the folder of nts_probe_common.py), NTS_REPORT (JSON report path). The project needs PythonScriptPlugin,
EditorScriptingUtilities, Niagara and NiagaraToolsets.

What the engine source says, so the checks can judge a result (Engine/Plugins/FX/Niagara/Source/NiagaraEditor/Private/
NiagaraExternalSystemEditorUtilities.cpp, UNiagaraExternalEditUtilities::AddRenderer; Engine/Plugins/FX/Niagara/Source/Niagara/Private/
NiagaraEmitter.cpp, UNiagaraEmitter::MoveRenderer): the renderer is appended, then, when the location's rendererIndex is not -1, moved
with MoveRenderer(renderer, index). MoveRenderer returns without moving when the index is not a valid index of the list that already
holds the new renderer, i.e. outside 0..count (count = renderers before the add). The returned ref carries the requested index
either way. So an index of count appends and the ref is right; count + 1 and a negative index other than -1 append and the ref is not.

Steps (each in its own emitter of one scratch system, which is not saved):
  insert     a Ribbon renderer is added to emitters that hold [Sprite, Light] at index 1 (between), 0 (front), 2 (= count), 3 (= count + 1)
             and -2; the order, the returned ref and GetRendererData on it are recorded
  classes    one of each other renderer class is appended to a sprite emitter; the property names GetRendererData returns are recorded
  duplicate  a second Sprite renderer is added to a sprite emitter; renderers[] and rendererClasses[] of GetEmitterTopology are compared
  templates  AddEmitter of each of the 14 template emitters; renderers[] and rendererClasses[] are recorded for each
"""
import json
import os
import sys

sys.path.insert(0, os.environ.get("NTS_PROBE_DIR", ""))
import nts_probe_common as c  # noqa: E402
import unreal  # noqa: E402

FOLDER, SYSTEM = "/Game/Probe/Renderers", "NS_Renderers"
NIAGARA = "/Script/Niagara."   # source: the renderer classes are declared in Engine/Plugins/FX/Niagara/Source/Niagara/Public/Niagara*RendererProperties.h
SPRITE, RIBBON, LIGHT = (NIAGARA + n for n in ("NiagaraSpriteRendererProperties", "NiagaraRibbonRendererProperties", "NiagaraLightRendererProperties"))
OTHER_CLASSES = ("NiagaraRibbonRendererProperties", "NiagaraMeshRendererProperties", "NiagaraLightRendererProperties",
                 "NiagaraComponentRendererProperties", "NiagaraDecalRendererProperties", "NiagaraVolumeRendererProperties")
INSERTS = (("Mid", 1), ("Front", 0), ("AtCount", 2), ("PastCount", 3), ("MinusTwo", -2))
TEMPLATE_NAMES = ["BlowingParticles", "ConfettiBurst", "DirectionalBurst", "DynamicBeam", "Fountain", "HangingParticulates", "LocationBasedRibbon",
                  "Minimal", "OmnidirectionalBurst", "RecycleParticlesInView", "SimpleSpriteBurst", "SingleLoopingParticle", "StaticBeam", "UpwardMeshBurst"]
OMITTED = "omitted"

probe = c.Probe("renderers", "nts-probe-renderers.json")
system_path = "%s/%s" % (FOLDER, SYSTEM)


def location(emitter, index=OMITTED):
    loc = c.at(system_path, emitter)
    if index != OMITTED:
        loc["rendererIndex"] = index
    return loc


def add_renderer(emitter, class_path, index=OMITTED):
    """AddRenderer, then re-read the order and the returned ref. Returns the record the checks judge."""
    before, _ = c.renderer_classes(system_path, emitter)
    out = c.call("AddRenderer", {"newRendererLocation": location(emitter, index), "rendererClass": c.class_ref(class_path)})
    after, listed = c.renderer_classes(system_path, emitter)
    value = out["value"] or {}
    returned = value.get("rendererIndex")
    in_range = isinstance(returned, int) and 0 <= returned < len(after)
    read = c.call("GetRendererData", {"rendererRef": c.at(system_path, emitter, renderer=returned)}) if returned is not None else {"error": "", "value": None}
    keys = []
    if read["value"]:
        try:
            keys = sorted(json.loads(read["value"]["propertyValues"]).keys())
        except Exception:
            keys = []
    return {"sent_index": index, "added_class": class_path.rsplit(".", 1)[-1], "error": out["error"], "before": before, "after": after, "renderer_classes": listed,
            "returned_index": returned, "returned_class": c.short(value["rendererClass"]) if value.get("rendererClass") else None,
            "ref_in_range": in_range, "ref_class": after[returned] if in_range else None, "read_error": read["error"], "property_keys": keys}


def new_emitter(name, template="SimpleSpriteBurst"):
    c.add_emitter(system_path, c.EMITTERS + template, name)


def insert():
    variants = {}
    for name, index in INSERTS:
        new_emitter(name)
        # the list the added renderer goes into: [Sprite, Light]
        first = add_renderer(name, LIGHT)
        if first["error"] or first["after"] != ["NiagaraSpriteRendererProperties", "NiagaraLightRendererProperties"]:
            variants[name] = {"setup_error": first["error"] or "unexpected list " + json.dumps(first["after"])}
            continue
        variants[name] = add_renderer(name, RIBBON, index)
    return {"variants": variants}


def classes():
    out = {}
    for class_name in OTHER_CLASSES:
        emitter = "Cls_" + class_name.replace("Niagara", "").replace("RendererProperties", "")
        new_emitter(emitter)
        out[class_name] = add_renderer(emitter, NIAGARA + class_name)
    return {"classes": out}


def duplicate():
    new_emitter("Twice")
    record = add_renderer("Twice", SPRITE)
    topology = c.tool("GetEmitterTopology", {"emitterRef": c.at(system_path, "Twice")})
    return {"record": record, "topology_renderer_count": len(topology["renderers"]), "topology_class_count": len(topology["rendererClasses"])}


def templates():
    made = {}
    # a second system, so the template emitters do not share names with the scratch emitters above
    other = c.create_system("NS_RendererTemplates", FOLDER)
    for name in TEMPLATE_NAMES:
        topology = c.tool("AddEmitter", {"system": c.ref(other), "templateEmitter": c.ref(c.EMITTERS + name), "emitterName": name})
        made[name] = {"renderers": [c.short(r["rendererClass"]) for r in sorted(topology["renderers"], key=lambda r: r["rendererIndex"])],
                      "renderer_classes": [c.short(k) for k in topology["rendererClasses"]]}
    return {"made": made}


try:
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    c.create_system(SYSTEM, FOLDER)
    probe.step("setup", toolset_registered=unreal.ToolsetRegistry.is_toolset_registered(c.TOOLSET))
except Exception:
    import traceback
    probe.step("setup", error=traceback.format_exc()[-700:])
probe.write()   # the setup is on disk before the first engine-side edit

for name, fn in (("insert", insert), ("classes", classes), ("duplicate", duplicate), ("templates", templates)):
    probe.guarded(name, fn)
    probe.write()
