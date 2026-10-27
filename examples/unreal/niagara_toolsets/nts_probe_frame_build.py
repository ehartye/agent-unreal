"""Probe, build half: a flipbook emitter whose Direct Frame Index is linked to a user parameter set from Python.
Prepared 2026-10-26; not yet run on an engine. A first run tests the probe before it tests the engine.

Run headless (assets and level only, no rendering), through nts_probe.mjs --only frame, or by hand:
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: NTS_PROBE_DIR, NTS_REPORT (build report), NTS_MANIFEST (what nts_probe_sim.py samples). Project plugins as nts_validate.mjs.

The reference says linking Direct Frame Index to a user parameter is not verified (the frame stayed age-driven). Steps:
  texture    a procedural 4x4 flipbook (cell n holds a white disc whose radius grows with n, so the area on screen tells the cell), imported
             as a point-filtered texture (the import pattern of stylized_build.py)
  material   an unlit, masked material with a Texture Sample Parameter SubUV, flagged for Niagara sprites (as stylized_build.py)
  system     a template system, the SubUVAnimation behaviour-example emitter as Sprite, the template emitters removed, the material and a
             4x4 Sub Image Size set, SubUV Animation Mode set to Direct Index (all as stylized_build.py, which ran them on 5.8.2)
  user_variable  AddUserVariables adds a float user parameter; GetUserVariables reads it back
  link       SetStackInputData links Direct Frame Index to it (FNiagaraExt_StackInputData_Linked: linkedVariable {name, type}); up to three
             attempts that differ in the type JSON and the name, each read back with GetStackInputData
nts_probe_sim.py then sets the parameter to 2 and 9 from Python, reads Particles.SubImageIndex from a simulation cache and takes a screenshot at
each value, after a baseline screenshot with the actor hidden.
"""
import json
import math
import os
import struct
import sys
import zlib

sys.path.insert(0, os.environ.get("NTS_PROBE_DIR", ""))
import nts_probe_common as c  # noqa: E402
import unreal  # noqa: E402

FOLDER, MAP = "/Game/Probe/Frame", "/Game/Maps/NtsProbeFrame"
SYSTEM, MATERIAL, TEXTURE = FOLDER + "/NS_Flip", FOLDER + "/M_Flip", FOLDER + "/T_Flip"
VARIABLE = "User.FrameIndex"
VARIANT = os.environ.get("NTS_FRAME_VARIANT", "link")   # "const": write 5.0 into Direct Frame Index instead of linking it (separates the mode from the link)
USER_DEFAULT = float(os.environ.get("NTS_FRAME_DEFAULT", "0"))   # the user parameter default; a non-zero default shows whether the link is read at all
SET_NAME = os.environ.get("NTS_FRAME_SETNAME", VARIABLE)   # the name the sim passes to set_variable_float
SHORT_NAME = "FrameIndex"
VALUES = (0.0, 2.0, 9.0)   # 0 is the user parameter default: the sim values at 0, 2 and 9 show whether they move with the parameter or with the particle age
GRID, CELL = 4, 128
ENUM_DIRECT = {"struct": {"refPath": "/Script/NiagaraEditor.NiagaraExt_StackInputData_Enum"},
               "value": {"enum": {"refPath": "/Niagara/Enums/ENiagara_SubUVLookupModeV2.ENiagara_SubUVLookupModeV2"}, "enumName": "ENiagara_SubUVLookupModeV2::NewEnumerator5", "displayName": "Direct Index"}}   # as stylized_build.py (a 5.8.2 value)
mel, eal = unreal.MaterialEditingLibrary, unreal.EditorAssetLibrary
probe = c.Probe("frame-build", "nts-probe-frame-build.json")


def write_png(path, width, height, rgba):
    raw = b"".join(b"\x00" + bytes(rgba[y * width * 4:(y + 1) * width * 4]) for y in range(height))

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def texture():
    size = GRID * CELL
    px = bytearray(size * size * 4)
    areas = []
    for frame in range(GRID * GRID):
        radius = 8 + 3.6 * frame
        cx0, cy0 = (frame % GRID) * CELL, (frame // GRID) * CELL
        area = 0
        for y in range(CELL):
            for x in range(CELL):
                if math.hypot(x - CELL / 2, y - CELL / 2) <= radius:
                    i = ((cy0 + y) * size + cx0 + x) * 4
                    px[i:i + 4] = b"\xff\xff\xff\xff"
                    area += 1
        areas.append(area)
    work = os.path.join(unreal.SystemLibrary.get_project_saved_directory(), "nts_probe").replace("\\", "/")
    os.makedirs(work, exist_ok=True)
    png = work + "/flip.png"
    write_png(png, size, size, px)
    task = unreal.AssetImportTask()
    for key, value in (("filename", png), ("destination_path", FOLDER), ("destination_name", "T_Flip"), ("automated", True), ("replace_existing", True), ("save", True)):
        task.set_editor_property(key, value)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    tex = eal.load_asset(TEXTURE)
    tex.set_editor_property("filter", unreal.TextureFilter.TF_NEAREST)
    tex.set_editor_property("mip_gen_settings", unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS)
    eal.save_asset(TEXTURE)
    return {"cell_areas": areas, "imported": tex is not None}


def material():
    mat = unreal.AssetToolsHelpers.get_asset_tools().create_asset("M_Flip", FOLDER, unreal.Material, unreal.MaterialFactoryNew())
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
    sample = mel.create_material_expression(mat, unreal.MaterialExpressionTextureSampleParameterSubUV, -400, 0)
    sample.set_editor_property("parameter_name", "Flipbook")
    sample.set_editor_property("texture", eal.load_asset(TEXTURE))
    mel.connect_material_property(sample, "RGB", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.connect_material_property(sample, "A", unreal.MaterialProperty.MP_OPACITY_MASK)
    mat.set_editor_property("used_with_niagara_sprites", True)
    mel.recompile_material(mat)
    eal.save_asset(MATERIAL)
    return {"outputs": [str(n) for n in mel.get_material_expression_output_names(sample)]}


def system():
    c.create_system("NS_Flip", FOLDER, c.SYSTEMS + "DirectionalBurst")
    c.add_emitter(SYSTEM, c.BEHAVIOR + "SubUVAnimation", "Sprite")
    for old in c.emitter_names(SYSTEM):
        if old != "Sprite":
            c.tool("RemoveEmitter", {"emitterToRemove": c.at(SYSTEM, old)})
    renderer = {"Material": c.ref(MATERIAL), "bSubImageBlend": False, "SubImageSize": {"x": GRID, "y": GRID}}
    c.tool("SetRendererData", {"renderer": c.at(SYSTEM, "Sprite", renderer=0), "rendererData": {"propertyValues": json.dumps(renderer)}})
    c.set_float(c.at(SYSTEM, "Sprite", "ParticleSpawnScript", "InitializeParticle", ["Lifetime"]), 8.0)
    c.set_float(c.at(SYSTEM, "Sprite", "ParticleSpawnScript", "InitializeParticle", ["Uniform Sprite Size"]), 300.0)
    c.set_float(c.at(SYSTEM, "Sprite", "EmitterUpdateScript", "EmitterState", ["Loop Duration"]), 8.0)
    mode = c.call("SetStackInputData", {"stackInputRef": c.at(SYSTEM, "Sprite", "ParticleUpdateScript", "SubUVAnimation", ["SubUV Animation Mode"]), "inputData": ENUM_DIRECT})
    return {"emitters": c.emitter_names(SYSTEM), "direct_mode_error": mode["error"]}


def user_variable():
    float_type = {"classStructOrEnum": {"refPath": c.FLOAT}}
    added = c.call("AddUserVariables", {"system": c.ref(SYSTEM), "variablesToAdd": [
        {"name": VARIABLE, "type": float_type, "defaultValue": {"struct": {"refPath": c.FLOAT}, "value": {"value": USER_DEFAULT}}, "description": "Frame chosen from Python"}]})
    listed = c.call("GetUserVariables", {"system": c.ref(SYSTEM)})
    names = [v.get("name") for v in ((listed["value"] or {}).get("userVariables") or [])]
    return {"add_error": added["error"], "list_error": listed["error"], "names": names, "present": VARIABLE in names or SHORT_NAME in names}


def link():
    target = c.at(SYSTEM, "Sprite", "ParticleUpdateScript", "SubUVAnimation", ["Direct Frame Index"])
    topology = c.call("GetStackInputTopology", {"stackInputRef": target})
    topology_type = (topology["value"] or {}).get("type")
    explicit = {"classStructOrEnum": {"refPath": c.FLOAT}}
    attempts = []
    for source, variable_type, name in (("topology", topology_type, VARIABLE), ("explicit", explicit, VARIABLE), ("explicit", explicit, SHORT_NAME)):
        if variable_type is None:
            attempts.append({"type_source": source, "name": name, "skipped": "no type from GetStackInputTopology: " + topology["error"]})
            continue
        written = c.call("SetStackInputData", {"stackInputRef": target, "inputData": {"struct": {"refPath": c.LINKED}, "value": {"linkedVariable": {"name": name, "type": variable_type}}}})
        read = c.get_input(target)
        data = read["value"]
        attempt = {"type_source": source, "name": name, "set_error": written["error"], "read_error": read["error"], "kind_after": c.kind_of(data) if data else None,
                   "link_after": ((data or {}).get("value") or {}).get("linkedVariable", {}).get("name") if data else None}
        attempts.append(attempt)
        if attempt["kind_after"] == "NiagaraExt_StackInputData_Linked" and str(attempt["link_after"]).endswith(SHORT_NAME):
            break
    return {"input_type": topology_type, "topology_error": topology["error"], "attempts": attempts,
            "linked": any(a.get("kind_after") == "NiagaraExt_StackInputData_Linked" and str(a.get("link_after")).endswith(SHORT_NAME) for a in attempts)}


def link_other():
    """Link Direct Frame Index to Emitter.Age instead of the user parameter: whether any link takes effect in this module."""
    target = c.at(SYSTEM, "Sprite", "ParticleUpdateScript", "SubUVAnimation", ["Direct Frame Index"])
    written = c.call("SetStackInputData", {"stackInputRef": target, "inputData": {"struct": {"refPath": c.LINKED}, "value": {"linkedVariable": {"name": "Emitter.Age", "type": {"classStructOrEnum": {"refPath": c.FLOAT}}}}}})
    read = c.get_input(target)
    return {"set_error": written["error"], "read": read["value"]}


def diagnostics():
    """What the emitter holds after the link: its scripts and modules (so a second SubUV module or a later writer of SubImageIndex would show), and the two SubUV inputs read back."""
    topology = c.call("GetEmitterTopology", {"emitterRef": {"system": c.ref(SYSTEM), "emitterName": "Sprite"}})
    mode = c.get_input(c.at(SYSTEM, "Sprite", "ParticleUpdateScript", "SubUVAnimation", ["SubUV Animation Mode"]))
    frame = c.get_input(c.at(SYSTEM, "Sprite", "ParticleUpdateScript", "SubUVAnimation", ["Direct Frame Index"]))
    return {"topology_error": topology["error"], "topology": json.dumps(topology["value"])[:3500], "mode_error": mode["error"], "mode": json.dumps(mode["value"])[:600],
            "frame_error": frame["error"], "frame": json.dumps(frame["value"])[:600]}


try:
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    eal.make_directory(FOLDER)
    probe.step("setup", toolset_registered=unreal.ToolsetRegistry.is_toolset_registered(c.TOOLSET))
except Exception as exc:
    probe.step("setup", error=str(exc)[:300])

steps = (("texture", texture), ("material", material), ("system", system), ("user_variable", user_variable), ("link", link) if VARIANT in ("link", "modelast") else ("link_other", link_other) if VARIANT == "emitterage" else ("const", lambda: c.set_float(c.at(SYSTEM, "Sprite", "ParticleUpdateScript", "SubUVAnimation", ["Direct Frame Index"]), 5.0)))
if VARIANT == "modelast":   # the mode is written again after the link, to see whether the order decides the compiled behaviour
    steps += (("mode_again", lambda: {"error": c.call("SetStackInputData", {"stackInputRef": c.at(SYSTEM, "Sprite", "ParticleUpdateScript", "SubUVAnimation", ["SubUV Animation Mode"]), "inputData": ENUM_DIRECT})["error"]}),)
steps += (("diagnostics", diagnostics),)
for name, fn in steps:
    probe.guarded(name, fn)
probe.guarded("save", lambda: {"system": bool(eal.save_asset(SYSTEM))})
probe.write()

probe.manifest.update({"map": MAP, "settle_seconds": 8, "systems": [{"id": "Flip", "asset": SYSTEM}], "samples": [{
    "id": "Flip", "actor": "Fx_Flip", "camera": "Cam_Flip", "metric_emitter": "Sprite",
    "sequence": [{"name": "base", "hidden": True, "shot": "base", "live_seconds": 0.5}] + [
        {"name": "v%d" % int(v), "frames": 30, "attributes": ["SubImageIndex", "NormalizedAge"], "set": [{"type": "float", "name": SET_NAME, "value": v}], "shot": "v%d" % int(v), "live_seconds": 1.5}
        for v in VALUES]}]})
probe.guarded("level", lambda: c.build_level(MAP, [{"id": "Flip", "asset": SYSTEM, "location": (0, 0, 100)}]))
probe.write()
probe.write_manifest()
