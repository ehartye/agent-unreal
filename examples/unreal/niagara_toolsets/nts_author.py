"""Author a Niagara system through Epic's Niagara toolsets and record every call shape (Unreal 5.8, Experimental NiagaraToolsets).

Run headless (assets only, no rendering):
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: NTS_REPORT (JSON report path). The project needs PythonScriptPlugin, EditorScriptingUtilities, Niagara and NiagaraToolsets.

The flow is the worked example in unreal-niagara-toolsets.md:
  1 create an empty system with NiagaraSystemFactoryNew
  2 AddEmitter from two Epic template emitters (asset refs are {"refPath": "/Package/Path.Name"})
  3 read a stack input (GetStackInputData), change its value, write it back (SetStackInputData), read it again
  4 set the sprite renderer's Material and SubImageSize with SetRendererData, whose propertyValues is a JSON string
  5 save, so nts_readback.py can read the values in a new process
  6 add all fourteen template emitters to one system and record what each is made of (which effect it covers)
  7 bound inputs: a linked input and a dynamic input are replaced as a whole (set_input below), and edited in place for contrast
  8 a hidden input is refused with the toolset's own message; the gating input is found and flipped
  9 local space (SetEmitterData with emitter and emitterData), sort order hint and the ribbon material flag
"""
import json
import os
import traceback

import unreal

TOOLSET = "NiagaraToolsets.NiagaraToolset_System"
FX = "/Game/FX"
SYSTEM, MATERIAL = "NS_Worked", "M_Worked"
TEMPLATES = "/Niagara/DefaultAssets/Templates/Emitters/"

report = {"engine": unreal.SystemLibrary.get_engine_version(), "steps": []}


def ref(package_path):
    """Asset ref: {"refPath": "/Package/Path.Name"}."""
    return {"refPath": package_path + "." + package_path.rsplit("/", 1)[-1]}


def call(tool, args):
    """Run one tool; return {complete, error, value} where value is the decoded {"returnValue": ...} JSON."""
    result = unreal.ToolsetRegistry.execute_tool(TOOLSET, tool, json.dumps(args))
    error = str(result.get_editor_property("error"))
    value = None
    if result.is_complete and not error:
        value = json.loads(str(result.get_editor_property("value")))["returnValue"]
    return {"complete": result.is_complete, "error": error, "value": value}


def step(name, **fields):
    report["steps"].append(dict(step=name, **fields))


STRUCT = "/Script/NiagaraEditor.NiagaraExt_StackInputData_"   # + Enum for an enum input
BOUND = ("NiagaraExt_StackInputData_Linked", "NiagaraExt_StackInputData_DynamicInput", "NiagaraExt_StackInputData_HlslExpression",
         "NiagaraExt_StackInputData_DataInterface", "NiagaraExt_StackInputData_Unsupported")


def kind_of(data):
    """The short struct name of stack-input data: NiagaraFloat, LinearColor, NiagaraExt_StackInputData_Linked, ..."""
    return data["struct"]["refPath"].rsplit(".", 1)[-1]


def is_empty_link(data):
    """True for a linked input whose link is gone (the toolset reads it back as Module.None)."""
    if kind_of(data) != "NiagaraExt_StackInputData_Linked":
        return False
    name = ((data.get("value") or {}).get("linkedVariable") or {}).get("name", "")
    return name in ("", "None") or name.endswith(".None")


def set_input(stack_ref, value, struct=None):
    """Set a stack input to `value`, the JSON object that goes under "value" ({"value": 2.5}, {"r": 1, "g": 0, "b": 0, "a": 1}).

    The data is replaced as a whole, {"struct": {"refPath": <type>}, "value": value}. An input that is linked to a variable or
    bound to a dynamic input is not edited in place: changing "value" inside the data that GetStackInputData returned leaves a
    dynamic input as it was and empties a linked one. The struct is the one the input already holds when that is a plain value;
    for a linked, dynamic or hidden input it is the input's own type from GetStackInputTopology, or `struct` when the caller
    passes it (an enum input needs struct STRUCT + "Enum" and enum, enumName, displayName in `value`).
    Returns {ok, error, was, stored}. `error` is the toolset's message exactly as returned, never shortened: a refusal says
    which input refused and which kind of switch to adjust. `ok` is False for a refusal, and also when the read-back is not the
    type that was written or is an empty link.
    """
    before = call("GetStackInputData", {"stackInputRef": stack_ref})
    if before["error"]:
        return {"ok": False, "error": before["error"], "was": None, "stored": None}
    was = kind_of(before["value"])
    if struct is None:
        if was not in BOUND:
            struct = before["value"]["struct"]["refPath"]
        else:
            topology = call("GetStackInputTopology", {"stackInputRef": stack_ref})
            if topology["error"]:
                return {"ok": False, "error": topology["error"], "was": was, "stored": None}
            struct = topology["value"]["type"]["classStructOrEnum"]["refPath"]
    written = call("SetStackInputData", {"stackInputRef": stack_ref, "inputData": {"struct": {"refPath": struct}, "value": value}})
    if written["error"]:
        return {"ok": False, "error": written["error"], "was": was, "stored": None}
    stored = call("GetStackInputData", {"stackInputRef": stack_ref})["value"]
    ok = stored is not None and kind_of(stored) == struct.rsplit(".", 1)[-1] and not is_empty_link(stored)
    return {"ok": ok, "error": "", "was": was, "stored": stored}


def input_at(system, emitter, script, module, name):
    return {"system": system, "emitterName": emitter, "scriptName": script, "moduleName": module, "inputNameStack": [name]}


def emitter_flag(system, emitter, key):
    """One field of the emitter's property blob (bLocalSpace, SimTarget, ...)."""
    out = call("GetEmitterData", {"emitterRef": {"system": system, "emitterName": emitter}})
    return json.loads(out["value"]["propertyValues"]).get(key)


try:
    report["toolset_registered"] = unreal.ToolsetRegistry.is_toolset_registered(TOOLSET)
    report["agent_skill_class"] = hasattr(unreal, "AgentSkill")
    skills = json.loads(str(unreal.ToolsetRegistry.execute_tool("ToolsetRegistry.AgentSkillToolset", "ListSkills", "{}").get_editor_property("value")))["returnValue"]
    report["niagara_skills"] = sorted(k.rsplit(".", 1)[-1] for k in skills if "NiagaraToolsets" in k)
    report["system_tool_count"] = len(json.loads(unreal.ToolsetRegistry.get_toolset_json_schema(unreal.NiagaraToolset_System))["tools"])
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    unreal.EditorAssetLibrary.make_directory(FX)
    tools = unreal.AssetToolsHelpers.get_asset_tools()

    # 1 create: an empty system from the factory, and a material the sprite renderer can use
    system = tools.create_asset(SYSTEM, FX, unreal.NiagaraSystem, unreal.NiagaraSystemFactoryNew())
    material = tools.create_asset(MATERIAL, FX, unreal.Material, unreal.MaterialFactoryNew())
    material.set_editor_property("used_with_niagara_sprites", True)
    sys_ref = ref(f"{FX}/{SYSTEM}")
    summary = call("GetSystemSummary", {"system": sys_ref})
    step("create", system=bool(system), material=bool(material), emitters=[e["emitterName"] for e in summary["value"]["emitters"]])

    # 2 AddEmitter from template emitters
    added = {}
    for name, template in (("Dust", "RecycleParticlesInView"), ("Motes", "HangingParticulates")):
        out = call("AddEmitter", {"system": sys_ref, "templateEmitter": ref(TEMPLATES + template), "emitterName": name})
        added[name] = {"error": out["error"], "emitterName": (out["value"] or {}).get("emitterName"), "topology_keys": sorted((out["value"] or {}).keys())}
    summary = call("GetSystemSummary", {"system": sys_ref})
    step("add_emitters", added=added, emitters=[e["emitterName"] for e in summary["value"]["emitters"]],
         summary_emitter_keys=sorted(summary["value"]["emitters"][0].keys()))

    # 3 stack input: reference, read, modify, write, read again
    input_ref = {"system": sys_ref, "emitterName": "Motes", "scriptName": "ParticleSpawnScript", "moduleName": "InitializeParticle",
                 "inputNameStack": ["Lifetime Min"]}
    got = call("GetStackInputData", {"stackInputRef": input_ref})
    data = got["value"]
    before = data["value"]["value"]
    data["value"]["value"] = 2.5
    written = call("SetStackInputData", {"stackInputRef": input_ref, "inputData": data})
    again = call("GetStackInputData", {"stackInputRef": input_ref})
    other = lambda name: call("GetStackInputData", {"stackInputRef": dict(input_ref, inputNameStack=[name])})["value"]
    color, mode = other("Color"), other("Lifetime Mode")
    wrong = call("GetStackInputData", {"stackInputRef": dict(input_ref, inputNameStack=["No Such Input"])})
    step("stack_input", get_error=got["error"], struct=data["struct"], value_keys=sorted(data.keys()), before=before,
         set_error=written["error"], after=again["value"]["value"]["value"], unknown_input_error=wrong["error"],
         unknown_input_complete=wrong["complete"], color_struct=color["struct"], color_value=color["value"],
         enum_struct=mode["struct"], enum_keys=sorted(mode["value"].keys()))

    # 4 renderer: propertyValues is a JSON string. An object in its place is accepted and changes nothing.
    renderer_ref = {"system": sys_ref, "emitterName": "Motes", "rendererIndex": 0}
    read = lambda: json.loads(call("GetRendererData", {"rendererRef": renderer_ref})["value"]["propertyValues"])
    default_material = read()["Material"]
    wanted = ref(f"{FX}/{MATERIAL}")
    as_object = call("SetRendererData", {"renderer": renderer_ref, "rendererData": {"propertyValues": {"Material": wanted}}})
    after_object = read()["Material"]
    as_string = call("SetRendererData", {"renderer": renderer_ref, "rendererData": {"propertyValues": json.dumps({"Material": wanted, "SubImageSize": {"x": 4, "y": 4}})}})
    after_string = read()
    step("renderer", default_material=default_material, object_error=as_object["error"], after_object=after_object,
         string_error=as_string["error"], after_string=after_string["Material"], sub_image_size=after_string["SubImageSize"],
         wanted=wanted, renderers=[r["rendererIndex"] for r in call("GetEmitterTopology", {"emitterRef": {"system": sys_ref, "emitterName": "Motes"}})["value"]["renderers"]])

    # 5 save
    step("save", system=unreal.EditorAssetLibrary.save_asset(f"{FX}/{SYSTEM}"), material=unreal.EditorAssetLibrary.save_asset(f"{FX}/{MATERIAL}"))

    # 6 the template emitters: add all fourteen to one system and record what each is made of
    names = ["BlowingParticles", "ConfettiBurst", "DirectionalBurst", "DynamicBeam", "Fountain", "HangingParticulates", "LocationBasedRibbon",
             "Minimal", "OmnidirectionalBurst", "RecycleParticlesInView", "SimpleSpriteBurst", "SingleLoopingParticle", "StaticBeam", "UpwardMeshBurst"]
    tools.create_asset("NS_Templates", FX, unreal.NiagaraSystem, unreal.NiagaraSystemFactoryNew())
    tref = ref(f"{FX}/NS_Templates")
    made = {}
    for name in names:
        topo = call("AddEmitter", {"system": tref, "templateEmitter": ref(TEMPLATES + name), "emitterName": name})["value"]
        spawn = [m["moduleName"] for key in ("emitterUpdateScript", "particleSpawnScript") for m in topo[key]["modules"] if m["moduleName"].startswith("Spawn")]
        life = call("GetStackInputData", {"stackInputRef": input_at(tref, name, "ParticleSpawnScript", "InitializeParticle", "Lifetime")})["value"]
        count = call("GetStackInputData", {"stackInputRef": input_at(tref, name, "EmitterUpdateScript", "SpawnBurst_Instantaneous", "Spawn Count")})["value"]
        loop = call("GetStackInputData", {"stackInputRef": input_at(tref, name, "EmitterUpdateScript", "EmitterState", "Loop Behavior")})["value"]
        rate = call("GetStackInputData", {"stackInputRef": input_at(tref, name, "EmitterUpdateScript", "SpawnRate", "SpawnRate")})["value"]
        beam_end = call("GetStackInputData", {"stackInputRef": input_at(tref, name, "EmitterUpdateScript", "BeamEmitterSetup", "Beam End")})["value"]
        beam_start = call("GetStackInputData", {"stackInputRef": input_at(tref, name, "EmitterUpdateScript", "BeamEmitterSetup", "Beam Start")})["value"]
        modules = [m["moduleName"] for key in ("emitterSpawnScript", "emitterUpdateScript", "particleSpawnScript", "particleUpdateScript") for m in topo[key]["modules"]]
        try:   # the text Epic ships on the template emitter, when the asset exposes it
            description = " ".join(str(unreal.EditorAssetLibrary.load_asset(TEMPLATES + name).get_editor_property("template_asset_description")).split())
        except Exception as exc:
            description = "unavailable: " + str(exc)[:80]
        made[name] = {"description": description, "renderer": topo["rendererClasses"][0]["refPath"].rsplit(".", 1)[-1], "sim_target": topo["simTarget"], "spawn_modules": spawn, "modules": modules,
                      "spawn_rate": rate["value"]["value"] if rate and kind_of(rate) == "NiagaraFloat" else None,
                      "beam_end": beam_end["value"] if beam_end and kind_of(beam_end).startswith("Vector") else None,
                      "beam_start": beam_start["value"]["dynamicInputAsset"]["refPath"].rsplit(".", 1)[-1] if beam_start and kind_of(beam_start) == BOUND[1] else None,
                      "local_space": emitter_flag(tref, name, "bLocalSpace"),
                      "burst_count": count["value"]["value"] if count and kind_of(count) == "NiagaraInt32" else None,
                      "lifetime_link": life["value"]["linkedVariable"]["name"] if life and kind_of(life) == BOUND[0] else None,
                      "loop_behavior": loop["value"].get("displayName") if loop else None}
    step("templates", made=made)

    # 7 bound inputs: a linked input and a dynamic input are replaced as a whole
    mat_ribbon = tools.create_asset("M_Beam", FX, unreal.Material, unreal.MaterialFactoryNew())
    mat_ribbon.set_editor_property("used_with_niagara_ribbons", True)
    mat_none = tools.create_asset("M_NoFlag", FX, unreal.Material, unreal.MaterialFactoryNew())
    for asset_name in ("NS_Linked", "NS_Broken"):
        tools.create_asset(asset_name, FX, unreal.NiagaraSystem, unreal.NiagaraSystemFactoryNew())
    good, bad = ref(f"{FX}/NS_Linked"), ref(f"{FX}/NS_Broken")
    for system_ref, emitter, template in ((good, "Orb", "SingleLoopingParticle"), (good, "Orb2", "SingleLoopingParticle"), (good, "Beam", "StaticBeam"),
                                          (bad, "OrbAddKey", "SingleLoopingParticle"), (bad, "OrbEmpty", "SingleLoopingParticle"), (bad, "OrbZero", "SingleLoopingParticle"),
                                          (bad, "BeamNaive", "StaticBeam"), (bad, "BeamNoFlag", "StaticBeam")):
        call("AddEmitter", {"system": system_ref, "templateEmitter": ref(TEMPLATES + template), "emitterName": emitter})
    lifetime = lambda s, e: input_at(s, e, "ParticleSpawnScript", "InitializeParticle", "Lifetime")
    width = lambda s, e: input_at(s, e, "ParticleSpawnScript", "BeamWidth", "Beam Width")
    read = lambda r: call("GetStackInputData", {"stackInputRef": r})["value"]

    # edits in place of the data that was read: a key added to a linked value changes nothing; a replaced value empties the link
    start = read(lifetime(bad, "OrbAddKey"))
    edited = read(lifetime(bad, "OrbAddKey")); edited["value"]["value"] = 3.0
    added = call("SetStackInputData", {"stackInputRef": lifetime(bad, "OrbAddKey"), "inputData": edited})
    after_added = read(lifetime(bad, "OrbAddKey"))
    emptied = read(lifetime(bad, "OrbEmpty")); emptied["value"] = {"value": 3.0}
    set_emptied = call("SetStackInputData", {"stackInputRef": lifetime(bad, "OrbEmpty"), "inputData": emptied})
    after_emptied = read(lifetime(bad, "OrbEmpty"))
    dynamic = read(width(bad, "BeamNaive")); dynamic["value"]["value"] = 12.0
    set_dynamic = call("SetStackInputData", {"stackInputRef": width(bad, "BeamNaive"), "inputData": dynamic})
    after_dynamic = read(width(bad, "BeamNaive"))
    # the helper: the same inputs replaced as a whole
    fixed = set_input(lifetime(good, "Orb"), {"value": 3.0})
    fixed_width = set_input(width(good, "Beam"), {"value": 12.0})
    zero = set_input(lifetime(bad, "OrbZero"), {"value": 0.0})
    summary = lambda r: {"ok": r["ok"], "error": r["error"], "was": r["was"], "kind": kind_of(r["stored"]), "value": r["stored"]["value"].get("value")}
    step("bound_inputs", linked_before=start["value"]["linkedVariable"]["name"], add_key_error=added["error"], add_key_kind=kind_of(after_added),
         add_key_link=after_added["value"]["linkedVariable"]["name"], emptied_error=set_emptied["error"], emptied_kind=kind_of(after_emptied),
         emptied_link=after_emptied["value"]["linkedVariable"]["name"], emptied_is_empty=is_empty_link(after_emptied),
         dynamic_error=set_dynamic["error"], dynamic_kind=kind_of(after_dynamic),
         helper_lifetime=summary(fixed), helper_width=summary(fixed_width), zero_lifetime=summary(zero))

    # 8 hidden inputs: the refusal, then the gating input
    color = input_at(good, "Orb2", "ParticleSpawnScript", "InitializeParticle", "Color")
    mode = input_at(good, "Orb2", "ParticleSpawnScript", "InitializeParticle", "Color Mode")
    topology = lambda r: call("GetStackInputTopology", {"stackInputRef": r})["value"]
    hidden_topology, mode_topology = topology(color), topology(mode)
    paint = {"r": 1, "g": 0.2, "b": 0.1, "a": 1}
    refused = set_input(color, paint)
    direct_set = read(input_at(tref, "Fountain", "ParticleSpawnScript", "InitializeParticle", "Color Mode"))
    flipped = call("SetStackInputData", {"stackInputRef": mode, "inputData": direct_set})
    painted = set_input(color, paint)
    duration = input_at(good, "Orb2", "EmitterUpdateScript", "EmitterState", "Loop Duration")
    duration_visible = topology(duration)["bIsVisible"]
    duration_refused = set_input(duration, {"value": 6.0})
    own_cycle = read(input_at(tref, "Fountain", "EmitterUpdateScript", "EmitterState", "Life Cycle Mode"))
    flipped_cycle = call("SetStackInputData", {"stackInputRef": input_at(good, "Orb2", "EmitterUpdateScript", "EmitterState", "Life Cycle Mode"), "inputData": own_cycle})
    duration_set = set_input(duration, {"value": 6.0})
    step("hidden_input", color_visible=hidden_topology["bIsVisible"], mode_is_static_switch=mode_topology["bIsStaticSwitch"],
         refused_ok=refused["ok"], refused_error=refused["error"], flip_error=flipped["error"], painted_ok=painted["ok"], painted_value=(painted["stored"] or {}).get("value"),
         duration_visible=duration_visible, duration_error=duration_refused["error"], cycle_error=flipped_cycle["error"], duration_ok=duration_set["ok"],
         duration_value=(duration_set["stored"] or {}).get("value"))

    # 9 local space: the arguments are emitter and emitterData, and propertyValues is a JSON string
    orb = {"system": good, "emitterName": "Orb"}
    local_before = emitter_flag(good, "Orb", "bLocalSpace")
    wrong_name = call("SetEmitterData", {"emitterRef": orb, "emitterData": {"propertyValues": json.dumps({"bLocalSpace": True})}})
    local_after_wrong = emitter_flag(good, "Orb", "bLocalSpace")
    as_object = call("SetEmitterData", {"emitter": orb, "emitterData": {"propertyValues": {"bLocalSpace": True}}})
    local_after_object = emitter_flag(good, "Orb", "bLocalSpace")
    as_string = call("SetEmitterData", {"emitter": orb, "emitterData": {"propertyValues": json.dumps({"bLocalSpace": True})}})
    local_after_string = emitter_flag(good, "Orb", "bLocalSpace")
    step("local_space", before=local_before, wrong_name_error=wrong_name["error"], after_wrong=local_after_wrong, object_error=as_object["error"],
         after_object=local_after_object, string_error=as_string["error"], after_string=local_after_string)

    # 10 sort order hint on a sprite and a ribbon renderer, and the ribbon material
    props = lambda r: json.loads(call("GetRendererData", {"rendererRef": r})["value"]["propertyValues"])
    sprite_renderer = {"system": good, "emitterName": "Orb", "rendererIndex": 0}
    ribbon_renderer = {"system": good, "emitterName": "Beam", "rendererIndex": 0}
    flagless_renderer = {"system": bad, "emitterName": "BeamNoFlag", "rendererIndex": 0}
    sort_before = props(sprite_renderer)["SortOrderHint"]
    sort_sprite = call("SetRendererData", {"renderer": sprite_renderer, "rendererData": {"propertyValues": json.dumps({"SortOrderHint": 7})}})
    sort_ribbon = call("SetRendererData", {"renderer": ribbon_renderer, "rendererData": {"propertyValues": json.dumps({"SortOrderHint": 3, "Material": ref(f"{FX}/M_Beam")})}})
    flagless = call("SetRendererData", {"renderer": flagless_renderer, "rendererData": {"propertyValues": json.dumps({"Material": ref(f"{FX}/M_NoFlag")})}})
    flags = lambda m: {k: m.get_editor_property(k) for k in ("used_with_niagara_sprites", "used_with_niagara_ribbons")}
    step("renderer_hints", sort_before=sort_before, sort_sprite_error=sort_sprite["error"], sort_sprite_after=props(sprite_renderer)["SortOrderHint"],
         sort_ribbon_error=sort_ribbon["error"], sort_ribbon_after=props(ribbon_renderer)["SortOrderHint"], ribbon_material=props(ribbon_renderer)["Material"],
         flagless_error=flagless["error"], flagless_material=props(flagless_renderer)["Material"], flags_flagged=flags(mat_ribbon), flags_default=flags(mat_none))
    step("save_inputs", **{n: unreal.EditorAssetLibrary.save_asset(f"{FX}/{n}") for n in ("NS_Linked", "NS_Broken", "NS_Templates", "M_Beam", "M_NoFlag")})
except Exception:
    report["error"] = traceback.format_exc()[-900:]

path = os.environ.get("NTS_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "nts-author.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[nts_author] wrote " + path)
