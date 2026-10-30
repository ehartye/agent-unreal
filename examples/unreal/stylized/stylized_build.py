"""Build the stylized-look probe project content in Unreal 5.8 through the editor Python API (no external art).

Run headless (assets and level only, no rendering):
  UnrealEditor-Cmd.exe <abs-path>/Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
The project needs PythonScriptPlugin, EditorScriptingUtilities, Niagara and NiagaraToolsets (Experimental), and Config/DefaultEngine.ini
with [/Script/Engine.RendererSettings] r.Substrate=True. Set STYLIZED_REPORT for the JSON report (default Saved/stylized-build.json).

It makes, under /Game/Stylized:
  - a procedural 4x4 ink-blob flipbook (512x512 PNG written with zlib, imported as a point-filtered texture),
  - a Toon Profile asset from ToonProfileFactory, and Substrate Toon BSDF materials (opaque mesh, masked sprite, translucent sprite),
  - an unlit flipbook sprite material, a stepped (floor-quantized) light-ramp sprite material and a smooth control,
  - one Niagara system per sprite station (built from Epic's SubUVAnimation and SingleLoopingParticle emitter templates through the toolsets;
    the flipbook is also built three times with SubUV Direct Index mode on a fixed frame: 2, 9 and 13),
  - a Toon Material Instance, and the level /Game/Maps/StylizedProbe with one station per look and a camera at each.
Each station is described in STATIONS; stylized_render.py visits them.

The ink-brush groups (stylized_ink.py: outline, ribbon, mesh, cost) add, for the groups named in STYLIZED_GROUPS (default all):
  - outline sprites: the drawn flipbook (a fixed frame) with a coverage-ramp outline in one material, a McGuire and Fein coverage flange (a second
    sprite renderer that draws the dilated coverage mask in the outline colour, pushed away from the camera by world position offset),
    and a stencil outline: a custom-depth stencil value on the Niagara component read by a post process material (r.CustomDepth=3),
  - a ribbon (StaticBeam) and a mesh particle (a mesh renderer on a one-particle emitter) with an unlit stepped-light material,
  - three cost scenes of COST_COUNT overlapping translucent sprites (plain unlit control, analytic ink look, drawn flipbook outline).
The project also needs r.CustomDepth=3 and, in [ConsoleVariables], fx.ForceCompileOnLoad=1 (stylized_validate.mjs writes both): a
system edited through the toolsets is not recompiled when another process loads it.
"""
import json
import math
import os
import re
import struct
import sys
import traceback
import zlib

import unreal

sys.path.insert(0, os.environ.get("STYLIZED_DIR", ""))
import stylized_ink as ink  # noqa: E402

GROUPS = ink.groups()
OUT = unreal.LinearColor(*ink.OUTLINE_COLOR, 1)
TOOLSET = "NiagaraToolsets.NiagaraToolset_System"
D = "/Game/Stylized"
MAP_PATH = "/Game/Maps/StylizedProbe"
SPACING = 2000.0
mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
report = {"engine": unreal.SystemLibrary.get_engine_version(), "steps": []}


def step(name, **info):
    report["steps"].append(dict(step=name, **info))


def guarded(name, fn):
    try:
        result = fn()
        step(name, ok=True, **(result or {}))
        return result
    except Exception:
        step(name, ok=False, error=traceback.format_exc()[-700:])
        return None


# ---------------------------------------------------------------- flipbook texture
def write_png(path, width, height, rgba):
    raw = b"".join(b"\x00" + bytes(rgba[y * width * 4:(y + 1) * width * 4]) for y in range(height))

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
                 + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def blob_radius(frame, theta):
    """Ink blob outline: radius in pixels at angle theta; every frame has a different silhouette."""
    base = 40 + 5 * math.sin(frame * 1.3)
    return base * (1 + 0.16 * math.sin(2 * theta + frame * 0.9) + 0.12 * math.sin(3 * theta + frame * 1.7) + 0.07 * math.sin(5 * theta + frame * 2.3))


def make_flipbook(path, grid=4, cell=128):
    size = grid * cell
    px = bytearray(size * size * 4)
    ink, fill, shine = (18, 18, 30), (240, 196, 64), (255, 246, 214)
    areas = []
    for frame in range(grid * grid):
        cx0, cy0 = (frame % grid) * cell, (frame // grid) * cell
        area = 0
        for y in range(cell):
            for x in range(cell):
                dx, dy = x - cell / 2, y - cell / 2
                dist = math.hypot(dx, dy)
                edge = blob_radius(frame, math.atan2(dy, dx))
                if dist > edge:
                    continue
                area += 1
                hx, hy = dx + 14 * math.cos(frame), dy + 14 * math.sin(frame)
                color = ink if dist > edge - 5 else (shine if math.hypot(hx, hy) < 7 else fill)
                i = ((cy0 + y) * size + cx0 + x) * 4
                px[i:i + 4] = bytes((*color, 255))
        areas.append(area)
    write_png(path, size, size, px)
    return areas


def import_flipbook():
    work = os.path.join(unreal.SystemLibrary.get_project_saved_directory(), "stylized").replace("\\", "/")
    os.makedirs(work, exist_ok=True)
    png = work + "/drawn_flipbook.png"
    areas = make_flipbook(png)
    task = unreal.AssetImportTask()
    for key, value in (("filename", png), ("destination_path", D), ("destination_name", "T_DrawnFlipbook"), ("automated", True),
                       ("replace_existing", True), ("save", True)):
        task.set_editor_property(key, value)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    tex = eal.load_asset(D + "/T_DrawnFlipbook")
    tex.set_editor_property("filter", unreal.TextureFilter.TF_NEAREST)
    tex.set_editor_property("mip_gen_settings", unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS)
    tex.set_editor_property("srgb", True)
    eal.save_asset(D + "/T_DrawnFlipbook")
    return {"png": png, "cell_areas": areas, "distinct_cell_areas": len(set(areas)), "texture": str(tex)}


# ---------------------------------------------------------------- material helpers
def new_material(name):
    return unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, D, unreal.Material, unreal.MaterialFactoryNew())


def ex(mat, cls, x, y, **props):
    e = mel.create_material_expression(mat, getattr(unreal, cls), x, y)
    for key, value in props.items():
        e.set_editor_property(key, value)
    return e


def link(src, dst, pin="", out=""):
    if not mel.connect_material_expressions(src, out, dst, pin):
        raise RuntimeError(f"connect failed: {src.get_name()}[{out}] -> {dst.get_name()}[{pin}] inputs={list(mel.get_material_expression_input_names(dst))}")


def finish(mat, usage_sprites=False):
    if usage_sprites:
        mat.set_editor_property("used_with_niagara_sprites", True)
    mel.recompile_material(mat)
    eal.save_asset(mat.get_path_name().split(".")[0])


def sphere_normal_and_mask(mat, x=-1400, y=0):
    """Sprite-space sphere normal and a circular mask built from the sprite's UVs."""
    normal, mask, _ = sphere_parts(mat, x, y)
    return normal, mask


def sphere_parts(mat, x=-1400, y=0):
    """The sphere normal, the circular mask and the squared distance from the sprite centre (0 at the centre, 1 at the mask edge)."""
    uv = ex(mat, "MaterialExpressionTextureCoordinate", x, y)
    centered = ex(mat, "MaterialExpressionSubtract", x + 160, y, const_b=0.5)
    link(uv, centered, "A")
    p = ex(mat, "MaterialExpressionMultiply", x + 320, y, const_b=2.0)
    link(centered, p, "A")
    px = ex(mat, "MaterialExpressionComponentMask", x + 480, y - 80, r=True, g=False, b=False, a=False)
    py = ex(mat, "MaterialExpressionComponentMask", x + 480, y + 40, r=False, g=True, b=False, a=False)
    link(p, px)
    link(p, py)
    pyn = ex(mat, "MaterialExpressionMultiply", x + 640, y + 40, const_b=-1.0)
    link(py, pyn, "A")
    r2 = ex(mat, "MaterialExpressionDotProduct", x + 480, y + 180)
    link(p, r2, "A")
    link(p, r2, "B")
    inside = ex(mat, "MaterialExpressionSaturate", x + 800, y + 180)
    one_minus = ex(mat, "MaterialExpressionOneMinus", x + 640, y + 180)
    link(r2, one_minus)
    link(one_minus, inside)
    z = ex(mat, "MaterialExpressionSquareRoot", x + 960, y + 180)
    link(inside, z)
    xy = ex(mat, "MaterialExpressionAppendVector", x + 800, y - 40)
    link(px, xy, "A")
    link(pyn, xy, "B")
    normal = ex(mat, "MaterialExpressionAppendVector", x + 1120, y)
    link(xy, normal, "A")
    link(z, normal, "B")
    mask = ex(mat, "MaterialExpressionCeil", x + 960, y + 300)
    link(inside, mask)
    return normal, mask, r2


def build_toon_lit():
    mat = new_material("M_ToonLit")
    color = ex(mat, "MaterialExpressionConstant3Vector", -700, 0, constant=unreal.LinearColor(0.9, 0.5, 0.2, 1))
    toon = ex(mat, "MaterialExpressionSubstrateToonBSDF", -400, 0, toon_profile=eal.load_asset(D + "/TP_Ink"))
    link(color, toon, "BaseColor")
    if not mel.connect_material_property(toon, "", unreal.MaterialProperty.MP_FRONT_MATERIAL):
        raise RuntimeError("front material connect failed")
    finish(mat)
    plain = new_material("M_PlainLit")
    color = ex(plain, "MaterialExpressionConstant3Vector", -400, 0, constant=unreal.LinearColor(0.9, 0.5, 0.2, 1))
    mel.connect_material_property(color, "", unreal.MaterialProperty.MP_BASE_COLOR)
    finish(plain)
    return {"toon_profile": str(eal.load_asset(D + "/TP_Ink")), "toon_inputs": [str(n) for n in mel.get_material_expression_input_names(toon)]}


def build_toon_sprite(name, translucent):
    mat = new_material(name)
    normal, mask = sphere_normal_and_mask(mat)
    color = ex(mat, "MaterialExpressionConstant3Vector", -400, -200, constant=unreal.LinearColor(0.9, 0.5, 0.2, 1))
    toon = ex(mat, "MaterialExpressionSubstrateToonBSDF", -300, 0, toon_profile=eal.load_asset(D + "/TP_Ink"))
    link(color, toon, "BaseColor")
    link(normal, toon, "Normal")
    if translucent:
        mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
        weight = ex(mat, "MaterialExpressionSubstrateWeight", -100, 0)
        link(toon, weight, "A")
        link(mask, weight, "Weight")
        mel.connect_material_property(weight, "", unreal.MaterialProperty.MP_FRONT_MATERIAL)
    else:
        mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
        mel.connect_material_property(toon, "", unreal.MaterialProperty.MP_FRONT_MATERIAL)
        mel.connect_material_property(mask, "", unreal.MaterialProperty.MP_OPACITY_MASK)
    finish(mat, usage_sprites=True)
    return {"blend": "translucent" if translucent else "masked"}


def build_drawn():
    mat = new_material("M_Drawn")
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
    sample = ex(mat, "MaterialExpressionTextureSampleParameterSubUV", -400, 0, parameter_name="Flipbook", texture=eal.load_asset(D + "/T_DrawnFlipbook"))
    mel.connect_material_property(sample, "RGB", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.connect_material_property(sample, "A", unreal.MaterialProperty.MP_OPACITY_MASK)
    finish(mat, usage_sprites=True)
    return {"outputs": list(mel.get_material_expression_output_names(sample))}


def build_ramp(name, stepped):
    mat = new_material(name)
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
    normal, mask = sphere_normal_and_mask(mat)
    light = ex(mat, "MaterialExpressionVectorParameter", -900, 400, parameter_name="LightDir", default_value=unreal.LinearColor(-0.5, 0.5, 0.7, 0))
    light_n = ex(mat, "MaterialExpressionNormalize", -700, 400)
    link(light, light_n)
    ndl = ex(mat, "MaterialExpressionDotProduct", -500, 300)
    link(normal, ndl, "A")
    link(light_n, ndl, "B")
    lit = ex(mat, "MaterialExpressionSaturate", -350, 300)
    link(ndl, lit)
    term = lit
    outs = {}
    if stepped:
        dyn = ex(mat, "MaterialExpressionDynamicParameter", -700, 560, default_value=unreal.LinearColor(4, 0, 0, 0))
        outs["dynamic_outputs"] = list(mel.get_material_expression_output_names(dyn))
        bands = ex(mat, "MaterialExpressionComponentMask", -500, 560, r=True, g=False, b=False, a=False)
        link(dyn, bands, "", outs["dynamic_outputs"][0])
        scaled = ex(mat, "MaterialExpressionMultiply", -200, 300)
        link(lit, scaled, "A")
        link(bands, scaled, "B")
        floored = ex(mat, "MaterialExpressionFloor", -50, 300)
        link(scaled, floored)
        levels = ex(mat, "MaterialExpressionSubtract", -200, 460, const_b=1.0)
        link(bands, levels, "A")
        divided = ex(mat, "MaterialExpressionDivide", 100, 300)
        link(floored, divided, "A")
        link(levels, divided, "B")
        term = ex(mat, "MaterialExpressionSaturate", 250, 300)
        link(divided, term)
    shadow = ex(mat, "MaterialExpressionConstant3Vector", 100, 100, constant=unreal.LinearColor(0.02, 0.02, 0.08, 1))
    bright = ex(mat, "MaterialExpressionConstant3Vector", 100, 200, constant=unreal.LinearColor(1.0, 0.6, 0.1, 1))
    mix = ex(mat, "MaterialExpressionLinearInterpolate", 450, 200)
    link(shadow, mix, "A")
    link(bright, mix, "B")
    link(term, mix, "Alpha")
    mel.connect_material_property(mix, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.connect_material_property(mask, "", unreal.MaterialProperty.MP_OPACITY_MASK)
    finish(mat, usage_sprites=True)
    return outs


def build_backdrop(name, color):
    mat = new_material(name)
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    c = ex(mat, "MaterialExpressionConstant3Vector", -400, 0, constant=unreal.LinearColor(*color, 1))
    mel.connect_material_property(c, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    finish(mat)


# ---------------------------------------------------------------- Niagara
def ref(package_path):
    return {"refPath": package_path + "." + package_path.rsplit("/", 1)[-1]}


def tool(name, args):
    result = unreal.ToolsetRegistry.execute_tool(TOOLSET, name, json.dumps(args))
    error = str(result.get_editor_property("error"))
    if not result.is_complete or error:
        raise RuntimeError(f"{name}: {error or 'incomplete'}")
    return json.loads(str(result.get_editor_property("value"))).get("returnValue")


def where(system, emitter, script="", module="", names=None):
    return {"system": ref(system), "emitterName": emitter, "scriptName": script, "moduleName": module, "rendererIndex": 0, "inputNameStack": names or []}


def set_input(system, emitter, script, module, name, kind, value):
    struct_path = {"float": "/Script/Niagara.NiagaraFloat", "int": "/Script/Niagara.NiagaraInt32", "bool": "/Script/Niagara.NiagaraBool"}[kind]
    tool("SetStackInputData", {"stackInputRef": where(system, emitter, script, module, [name]), "inputData": {"struct": {"refPath": struct_path}, "value": {"value": value}}})


def make_system(name, template_emitter, material, lifetime, size, sub_image=None, dynamic_param=None, direct_frame=None):
    path = f"{D}/{name}"
    system = path + "." + name
    tool("CreateNiagaraSystem", {"assetName": name, "assetPath": D, "templateSystem": ref("/Niagara/DefaultAssets/Templates/Systems/DirectionalBurst")})
    sysref = path
    tool("AddEmitter", {"system": ref(sysref), "templateEmitter": ref(template_emitter), "emitterName": "Sprite"})
    for old in ("LocationBasedRibbon", "DirectionalBurst"):
        tool("RemoveEmitter", {"emitterToRemove": where(sysref, old)})
    renderer = {"Material": {"refPath": material + "." + material.rsplit("/", 1)[-1]}, "bSubImageBlend": False}
    if sub_image:
        renderer["SubImageSize"] = {"x": sub_image[0], "y": sub_image[1]}
    tool("SetRendererData", {"renderer": where(sysref, "Sprite"), "rendererData": {"propertyValues": json.dumps(renderer)}})
    set_input(sysref, "Sprite", "ParticleSpawnScript", "InitializeParticle", "Lifetime", "float", lifetime)
    set_input(sysref, "Sprite", "ParticleSpawnScript", "InitializeParticle", "Uniform Sprite Size", "float", size)
    if sub_image:  # the flipbook restarts every lifetime; the other templates keep one long-lived particle
        set_input(sysref, "Sprite", "EmitterUpdateScript", "EmitterState", "Loop Duration", "float", lifetime)
    if dynamic_param is not None:
        tool("AddModule", {"moduleLocationRef": where(sysref, "Sprite", "ParticleUpdateScript"), "moduleAsset": ref("/Niagara/Modules/Update/Material/DynamicMaterialParameters")})
        set_input(sysref, "Sprite", "ParticleUpdateScript", "DynamicMaterialParameters", "Index 0 Param 1", "float", dynamic_param)
    if direct_frame is not None:  # show one fixed cell: SubUV Direct Index mode with a constant frame index
        mode = {"struct": {"refPath": "/Script/NiagaraEditor.NiagaraExt_StackInputData_Enum"},
                "value": {"enum": {"refPath": "/Niagara/Enums/ENiagara_SubUVLookupModeV2.ENiagara_SubUVLookupModeV2"}, "enumName": "ENiagara_SubUVLookupModeV2::NewEnumerator5", "displayName": "Direct Index"}}
        tool("SetStackInputData", {"stackInputRef": where(sysref, "Sprite", "ParticleUpdateScript", "SubUVAnimation", ["SubUV Animation Mode"]), "inputData": mode})
        set_input(sysref, "Sprite", "ParticleUpdateScript", "SubUVAnimation", "Direct Frame Index", "float", float(direct_frame))
    eal.save_asset(sysref)
    return {"system": name, "material": material}


# ---------------------------------------------------------------- ink-brush materials (outline, ribbon, mesh, cost)
SHADOW, BRIGHT = (0.02, 0.02, 0.08), (1.0, 0.6, 0.1)
SPRITES = "/Niagara/DefaultAssets/Templates/Emitters/SingleLoopingParticle"
SUBUV = "/Niagara/DefaultAssets/Templates/BehaviorExamples/SubUVAnimation"


def const3(mat, rgb, x, y):
    return ex(mat, "MaterialExpressionConstant3Vector", x, y, constant=unreal.LinearColor(*rgb, 1))


def lit_term(mat, normal, stepped, light, bands=4.0, x=-900, y=300):
    """saturate(normal . light), floor-quantized to `bands` levels when stepped (the same maths as M_Stepped, with a constant band count)."""
    param = ex(mat, "MaterialExpressionVectorParameter", x, y + 160, parameter_name="LightDir", default_value=unreal.LinearColor(*light, 0))
    light_n = ex(mat, "MaterialExpressionNormalize", x + 200, y + 160)
    link(param, light_n)
    ndl = ex(mat, "MaterialExpressionDotProduct", x + 400, y)
    link(normal, ndl, "A")
    link(light_n, ndl, "B")
    lit = ex(mat, "MaterialExpressionSaturate", x + 550, y)
    link(ndl, lit)
    if not stepped:
        return lit
    scaled = ex(mat, "MaterialExpressionMultiply", x + 700, y, const_b=bands)
    link(lit, scaled, "A")
    floored = ex(mat, "MaterialExpressionFloor", x + 850, y)
    link(scaled, floored)
    divided = ex(mat, "MaterialExpressionDivide", x + 1000, y, const_b=bands - 1.0)
    link(floored, divided, "A")
    term = ex(mat, "MaterialExpressionSaturate", x + 1150, y)
    link(divided, term)
    return term


def tone(mat, term, ring=None, x=450, y=200):
    """Shadow-to-bright colour by the lit term, with the outline colour over the ring (a 0/1 scalar) when there is one."""
    mix = ex(mat, "MaterialExpressionLinearInterpolate", x, y)
    link(const3(mat, SHADOW, x - 300, y - 100), mix, "A")
    link(const3(mat, BRIGHT, x - 300, y), mix, "B")
    link(term, mix, "Alpha")
    if ring is None:
        return mix
    final = ex(mat, "MaterialExpressionLinearInterpolate", x + 200, y)
    link(mix, final, "A")
    link(const3(mat, ink.OUTLINE_COLOR, x - 300, y + 100), final, "B")
    link(ring, final, "Alpha")
    return final


def edge_ramp(mat, value, edge=0.8, x=0, y=700):
    """1 where `value` (a scalar) is at least `edge`, 0 below: a hard ramp over the coverage field."""
    d = ex(mat, "MaterialExpressionSubtract", x, y, const_b=edge)
    link(value, d, "A")
    k = ex(mat, "MaterialExpressionMultiply", x + 150, y, const_b=1000.0)
    link(d, k, "A")
    s = ex(mat, "MaterialExpressionSaturate", x + 300, y)
    link(k, s)
    return s


def build_ink_sprite(name, look, translucent=False):
    """An unlit sprite on the sphere normal and mask: look 'swatch' (flat outline colour), 'flat' (flat fill) or 'ink' (stepped light and a ring outline from the coverage)."""
    mat = new_material(name)
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT if translucent else unreal.BlendMode.BLEND_MASKED)
    normal, mask, r2 = sphere_parts(mat)
    if look == "swatch":
        colour = const3(mat, ink.OUTLINE_COLOR, 100, 0)
    elif look == "flat":
        colour = const3(mat, BRIGHT, 100, 0)
    else:
        colour = tone(mat, lit_term(mat, normal, True, (-0.5, 0.5, 0.7)), edge_ramp(mat, r2))
    mel.connect_material_property(colour, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.connect_material_property(mask, "", unreal.MaterialProperty.MP_OPACITY if translucent else unreal.MaterialProperty.MP_OPACITY_MASK)
    finish(mat, usage_sprites=True)
    return {"look": look, "blend": "translucent" if translucent else "masked"}


def build_ribbon(name, stepped, edge):
    """An unlit opaque ribbon material: a cylinder normal across the ribbon width (V) lights it in steps; edge adds an outline ring at the two long edges."""
    mat = new_material(name)
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    uv = ex(mat, "MaterialExpressionTextureCoordinate", -1500, 0)
    v = ex(mat, "MaterialExpressionComponentMask", -1350, 0, r=False, g=True, b=False, a=False)
    link(uv, v)
    c2 = ex(mat, "MaterialExpressionMultiply", -1200, 0, const_b=2.0)
    link(v, c2, "A")
    c = ex(mat, "MaterialExpressionSubtract", -1050, 0, const_b=1.0)
    link(c2, c, "A")
    sq = ex(mat, "MaterialExpressionMultiply", -900, 100)
    link(c, sq, "A")
    link(c, sq, "B")
    rest = ex(mat, "MaterialExpressionOneMinus", -750, 100)
    link(sq, rest)
    clamped = ex(mat, "MaterialExpressionSaturate", -600, 100)
    link(rest, clamped)
    z = ex(mat, "MaterialExpressionSquareRoot", -450, 100)
    link(clamped, z)
    zero = ex(mat, "MaterialExpressionConstant", -900, -100, r=0.0)
    xy = ex(mat, "MaterialExpressionAppendVector", -600, -100)
    link(c, xy, "A")
    link(zero, xy, "B")
    normal = ex(mat, "MaterialExpressionAppendVector", -300, 0)
    link(xy, normal, "A")
    link(z, normal, "B")
    ring = None
    if edge:
        ring = edge_ramp(mat, ex_abs(mat, c))
    colour = tone(mat, lit_term(mat, normal, stepped, (-0.5, 0.5, 0.7)), ring)
    mel.connect_material_property(colour, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mat.set_editor_property("used_with_niagara_ribbons", True)
    finish(mat)
    return {"stepped": stepped, "edge": edge}


def ex_abs(mat, src):
    a = ex(mat, "MaterialExpressionAbs", -300, 700)
    link(src, a)
    return a


def build_mesh_ink(name, stepped):
    """An unlit opaque mesh-particle material lit in steps from the world normal; the light comes from the viewer's upper left."""
    mat = new_material(name)
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    normal = ex(mat, "MaterialExpressionVertexNormalWS", -900, 0)
    colour = tone(mat, lit_term(mat, normal, stepped, (-0.7, -0.5, 0.5)))
    mel.connect_material_property(colour, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mat.set_editor_property("used_with_niagara_mesh_particles", True)
    finish(mat)
    return {"stepped": stepped}


def build_drawn_outline(name, mode, translucent=False, frame=9):
    """The drawn flipbook's coverage (alpha) dilated by the largest of 16 taps around each pixel (radius 0.04 and 0.02 of the sprite).
    A SubUV sample node gave no ring (run 1), so the taps are plain texture samples at the fixed cell of `frame` in the 4 by 4 atlas:
    atlas UV = (sprite UV + offset + cell) / 4. The renderer must keep the default SubImageSize of 1 by 1: with a 4 by 4 size the
    sprite UV did not span 0 to 1 and the samples read a magnified part of the cell (run 2).
    mode 'ramp': one material, the ring between the dilated and the original coverage takes the outline colour.
    mode 'flange': the dilated coverage in the outline colour alone, pushed away from the camera by world position offset, for a second sprite renderer."""
    mat = new_material(name)
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT if translucent else unreal.BlendMode.BLEND_MASKED)
    tex = eal.load_asset(D + "/T_DrawnFlipbook")
    uv = ex(mat, "MaterialExpressionTextureCoordinate", -2000, 0)
    col, row = frame % 4, frame // 4

    def tap(dx, dy, i):
        off = ex(mat, "MaterialExpressionConstant2Vector", -1900, 150 + i * 130, r=dx + col, g=dy + row)
        shifted = ex(mat, "MaterialExpressionAdd", -1700, 150 + i * 130)
        link(uv, shifted, "A")
        link(off, shifted, "B")
        scaled = ex(mat, "MaterialExpressionMultiply", -1550, 150 + i * 130, const_b=0.25)
        link(shifted, scaled, "A")
        sample = ex(mat, "MaterialExpressionTextureSample", -1400, 150 + i * 130, texture=tex)
        link(scaled, sample, "UVs")
        return sample

    centre = tap(0.0, 0.0, 0)
    taps = []
    for radius in (0.04, 0.02):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (0.7071, 0.7071), (0.7071, -0.7071), (-0.7071, 0.7071), (-0.7071, -0.7071)):
            taps.append(tap(dx * radius, dy * radius, len(taps) + 1))
    dil = None
    for i, sample in enumerate(taps):
        mx = ex(mat, "MaterialExpressionMax", -1100 + i * 40, 150 + i * 130)
        if dil is None:
            link(centre, mx, "A", "A")
        else:
            link(dil, mx, "A")
        link(sample, mx, "B", "A")
        dil = mx
    if mode == "ramp":
        gap = ex(mat, "MaterialExpressionSubtract", -300, 300)
        link(dil, gap, "A")
        link(centre, gap, "B", "A")
        ring = ex(mat, "MaterialExpressionSaturate", -150, 300)
        link(gap, ring)
        colour = ex(mat, "MaterialExpressionLinearInterpolate", 100, 200)
        link(centre, colour, "A", "RGB")
        link(const3(mat, ink.OUTLINE_COLOR, -150, 450), colour, "B")
        link(ring, colour, "Alpha")
    else:
        colour = const3(mat, ink.OUTLINE_COLOR, 100, 200)
        # CameraVectorWS is not available in the vertex shader, so the direction away from the camera is (world position - camera position) normalized
        away = ex(mat, "MaterialExpressionSubtract", -500, 600)
        link(ex(mat, "MaterialExpressionWorldPosition", -700, 560), away, "A", "XYZ")
        link(ex(mat, "MaterialExpressionCameraPositionWS", -700, 660), away, "B")
        unit = ex(mat, "MaterialExpressionNormalize", -350, 600)
        link(away, unit)
        push = ex(mat, "MaterialExpressionMultiply", -200, 600, const_b=25.0)
        link(unit, push, "A")
        mel.connect_material_property(push, "", unreal.MaterialProperty.MP_WORLD_POSITION_OFFSET)
    mel.connect_material_property(colour, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.connect_material_property(dil, "", unreal.MaterialProperty.MP_OPACITY if translucent else unreal.MaterialProperty.MP_OPACITY_MASK)
    finish(mat, usage_sprites=True)
    return {"mode": mode, "taps": len(taps), "frame": frame, "blend": "translucent" if translucent else "masked"}


def build_stencil_pp():
    """A post process material (before bloom): an outline-coloured pixel where the custom stencil is 0 here and above 0 at one of 16 pixels around (radius 6 and 3)."""
    mat = new_material("M_StencilOutline")
    mat.set_editor_property("material_domain", unreal.MaterialDomain.MD_POST_PROCESS)
    mat.set_editor_property("blendable_location", unreal.BlendableLocation.BL_SCENE_COLOR_BEFORE_BLOOM)
    stencil, base = unreal.SceneTextureId.PPI_CUSTOM_STENCIL, unreal.SceneTextureId.PPI_POST_PROCESS_INPUT0

    def scene(texture_id, x, y, uv=None):
        node = ex(mat, "MaterialExpressionSceneTexture", x, y, scene_texture_id=texture_id)
        if uv is not None:
            link(uv, node, "UVs")
        return node

    def red(node, x, y):
        mask = ex(mat, "MaterialExpressionComponentMask", x, y, r=True, g=False, b=False, a=False)
        link(node, mask, "", "Color")
        return mask

    first = scene(stencil, -2000, 0)
    centre = red(first, -1800, 0)
    screen = ex(mat, "MaterialExpressionScreenPosition", -2000, 300)
    best, index = None, 0
    for radius in (6.0, 3.0):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (0.7071, 0.7071), (0.7071, -0.7071), (-0.7071, 0.7071), (-0.7071, -0.7071)):
            y = 300 + index * 140
            off = ex(mat, "MaterialExpressionConstant2Vector", -1900, y, r=dx * radius, g=dy * radius)
            pixels = ex(mat, "MaterialExpressionMultiply", -1700, y)
            link(off, pixels, "A")
            link(first, pixels, "B", "InvSize")
            shifted = ex(mat, "MaterialExpressionAdd", -1500, y)
            link(screen, shifted, "A", "ViewportUV")
            link(pixels, shifted, "B")
            sample = red(scene(stencil, -1300, y, shifted), -1100, y)
            if best is None:
                best = sample
            else:
                mx = ex(mat, "MaterialExpressionMax", -900 + index * 20, y)
                link(best, mx, "A")
                link(sample, mx, "B")
                best = mx
            index += 1
    gap = ex(mat, "MaterialExpressionSubtract", -500, 0)
    link(best, gap, "A")
    link(centre, gap, "B")
    outline = ex(mat, "MaterialExpressionSaturate", -350, 0)
    link(gap, outline)
    rgb = ex(mat, "MaterialExpressionComponentMask", -500, -300, r=True, g=True, b=True, a=False)
    link(scene(base, -700, -300), rgb, "", "Color")
    colour = ex(mat, "MaterialExpressionLinearInterpolate", -150, -100)
    link(rgb, colour, "A")
    link(const3(mat, ink.OUTLINE_COLOR, -350, -200), colour, "B")
    link(outline, colour, "Alpha")
    mel.connect_material_property(colour, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.recompile_material(mat)
    eal.save_asset(D + "/M_StencilOutline")
    return {"taps": index}


# ---------------------------------------------------------------- ink-brush Niagara systems
ENUM_ONCE = {"struct": {"refPath": "/Script/NiagaraEditor.NiagaraExt_StackInputData_Enum"},
             "value": {"enum": {"refPath": "/Niagara/Enums/ENiagara_EmitterStateOptions.ENiagara_EmitterStateOptions"},
                       "enumName": "ENiagara_EmitterStateOptions::NewEnumerator1", "displayName": "Once"}}


def new_system(name, template_emitter, emitter_name):
    path = f"{D}/{name}"
    tool("CreateNiagaraSystem", {"assetName": name, "assetPath": D, "templateSystem": ref("/Niagara/DefaultAssets/Templates/Systems/DirectionalBurst")})
    tool("AddEmitter", {"system": ref(path), "templateEmitter": ref(template_emitter), "emitterName": emitter_name})
    for old in ("LocationBasedRibbon", "DirectionalBurst"):
        tool("RemoveEmitter", {"emitterToRemove": where(path, old)})
    return path


def renderer_at(system, emitter, index):
    return dict(where(system, emitter), rendererIndex=index)


def make_ribbon_system(name, material):
    """A StaticBeam ribbon along the Y axis (RIBBON_LENGTH long, RIBBON_WIDTH wide, local space), one burst whose particles outlive the run."""
    path = new_system(name, "/Niagara/DefaultAssets/Templates/Emitters/StaticBeam", "Ribbon")
    tool("SetEmitterData", {"emitter": {"system": ref(path), "emitterName": "Ribbon"}, "emitterData": {"propertyValues": json.dumps({"bLocalSpace": True})}})
    tool("SetRendererData", {"renderer": renderer_at(path, "Ribbon", 0), "rendererData": {"propertyValues": json.dumps({"Material": ref(material)})}})
    tool("SetStackInputData", {"stackInputRef": where(path, "Ribbon", "EmitterUpdateScript", "BeamEmitterSetup", ["Beam End"]),
                               "inputData": {"struct": {"refPath": "/Script/CoreUObject.Vector3f"}, "value": {"x": 0.0, "y": ink.RIBBON_LENGTH, "z": 0.0}}})
    tool("SetStackInputData", {"stackInputRef": where(path, "Ribbon", "EmitterUpdateScript", "EmitterState", ["Loop Behavior"]), "inputData": ENUM_ONCE})
    set_input(path, "Ribbon", "ParticleSpawnScript", "BeamWidth", "Beam Width", "float", ink.RIBBON_WIDTH)
    set_input(path, "Ribbon", "ParticleSpawnScript", "InitializeParticle", "Lifetime", "float", 3600.0)
    eal.save_asset(path)
    return {"system": name, "material": material}


def make_mesh_system(name, material):
    """A one-particle emitter whose sprite renderer is switched off and whose mesh renderer draws a sphere (scale 3) with the material overriding the mesh's own."""
    path = new_system(name, SPRITES, "Mesh")
    tool("AddRenderer", {"newRendererLocation": {"system": ref(path), "emitterName": "Mesh"}, "rendererClass": {"refPath": "/Script/Niagara.NiagaraMeshRendererProperties"}})
    tool("SetRendererData", {"renderer": renderer_at(path, "Mesh", 0), "rendererData": {"propertyValues": json.dumps({"bIsEnabled": False})}})
    mesh = renderer_at(path, "Mesh", 1)
    slot = dict(json.loads(tool("GetRendererData", {"rendererRef": mesh})["propertyValues"])["Meshes"][0])
    slot["mesh"] = ref("/Engine/BasicShapes/Sphere")
    slot["scale"] = {"x": 3.0, "y": 3.0, "z": 3.0}
    tool("SetRendererData", {"renderer": mesh, "rendererData": {"propertyValues": json.dumps({"Meshes": [slot], "bOverrideMaterials": True, "OverrideMaterials": [{"explicitMat": ref(material)}]})}})
    set_input(path, "Mesh", "ParticleSpawnScript", "InitializeParticle", "Lifetime", "float", 3600.0)
    eal.save_asset(path)
    return {"system": name, "material": material}


def make_flange_system(name, body_material, flange_material):
    """The drawn flipbook on frame 9 with a second sprite renderer for the coverage flange (index 1, same particles)."""
    result = make_system(name, SUBUV, body_material, 2.0, 500.0, sub_image=(4, 4), direct_frame=9)
    path = f"{D}/{name}"
    tool("AddRenderer", {"newRendererLocation": {"system": ref(path), "emitterName": "Sprite"}, "rendererClass": {"refPath": "/Script/Niagara.NiagaraSpriteRendererProperties"}})
    tool("SetRendererData", {"renderer": renderer_at(path, "Sprite", 1), "rendererData": {"propertyValues": json.dumps({
        "Material": ref(flange_material), "bSubImageBlend": False})}})   # no SubImageSize: the sprite UV stays 0 to 1 across the quad for the plain texture samples
    eal.save_asset(path)
    return result


def make_cost_system(name, material, sub_image=False):
    """COST_COUNT overlapping sprites of COST_SIZE, alive for an hour (one burst; the template loops once)."""
    result = make_system(name, SPRITES, material, 3600.0, ink.COST_SIZE)
    path = f"{D}/{name}"
    if sub_image:
        tool("SetRendererData", {"renderer": renderer_at(path, "Sprite", 0), "rendererData": {"propertyValues": json.dumps({"SubImageSize": {"x": 4, "y": 4}})}})
    set_input(path, "Sprite", "EmitterUpdateScript", "SpawnBurst_Instantaneous", "Spawn Count", "int", ink.COST_COUNT)
    eal.save_asset(path)
    return result


def mat_path(name):
    return f"{D}/{name}"


INK_MATERIALS = {
    "M_Swatch": lambda: build_ink_sprite("M_Swatch", "swatch"),
    "M_DrawnRamp": lambda: build_drawn_outline("M_DrawnRamp", "ramp"),
    "M_DrawnFlange": lambda: build_drawn_outline("M_DrawnFlange", "flange"),
    "M_RibbonSmooth": lambda: build_ribbon("M_RibbonSmooth", False, False),
    "M_RibbonInk": lambda: build_ribbon("M_RibbonInk", True, False),
    "M_RibbonEdge": lambda: build_ribbon("M_RibbonEdge", True, True),
    "M_MeshSmooth": lambda: build_mesh_ink("M_MeshSmooth", False),
    "M_MeshInk": lambda: build_mesh_ink("M_MeshInk", True),
    "M_CostPlain": lambda: build_ink_sprite("M_CostPlain", "flat", True),
    "M_CostInk": lambda: build_ink_sprite("M_CostInk", "ink", True),
    "M_CostDrawn": lambda: build_drawn_outline("M_CostDrawn", "ramp", True),
    "M_StencilOutline": build_stencil_pp,
}
INK_SYSTEMS = {   # system -> (materials it needs, builder)
    "NS_Swatch": (["M_Swatch"], lambda: make_system("NS_Swatch", SPRITES, mat_path("M_Swatch"), 600.0, 500.0)),
    "NS_OutlineRamp": (["M_DrawnRamp"], lambda: make_system("NS_OutlineRamp", SPRITES, mat_path("M_DrawnRamp"), 600.0, 500.0)),
    "NS_OutlineFlange": (["M_DrawnFlange"], lambda: make_flange_system("NS_OutlineFlange", D + "/M_Drawn", mat_path("M_DrawnFlange"))),
    "NS_RibbonSmooth": (["M_RibbonSmooth"], lambda: make_ribbon_system("NS_RibbonSmooth", mat_path("M_RibbonSmooth"))),
    "NS_RibbonInk": (["M_RibbonInk"], lambda: make_ribbon_system("NS_RibbonInk", mat_path("M_RibbonInk"))),
    "NS_RibbonEdge": (["M_RibbonEdge"], lambda: make_ribbon_system("NS_RibbonEdge", mat_path("M_RibbonEdge"))),
    "NS_MeshSmooth": (["M_MeshSmooth"], lambda: make_mesh_system("NS_MeshSmooth", mat_path("M_MeshSmooth"))),
    "NS_MeshInk": (["M_MeshInk"], lambda: make_mesh_system("NS_MeshInk", mat_path("M_MeshInk"))),
    "NS_CostControl": (["M_CostPlain"], lambda: make_cost_system("NS_CostControl", mat_path("M_CostPlain"))),
    "NS_CostInk": (["M_CostInk"], lambda: make_cost_system("NS_CostInk", mat_path("M_CostInk"))),
    "NS_CostDrawn": (["M_CostDrawn"], lambda: make_cost_system("NS_CostDrawn", mat_path("M_CostDrawn"))),
}


def build_ink_assets():
    """The materials and systems the selected ink-brush stations need, each in its own guarded step."""
    wanted = [s for s in ink.systems(GROUPS) if s in INK_SYSTEMS]
    materials = []
    for system in wanted:
        materials += [m for m in INK_SYSTEMS[system][0] if m not in materials]
    if any(stencil for _, _, _, stencil in ink.stations(GROUPS)):
        materials.append("M_StencilOutline")
    for name in materials:
        guarded("ink_mat_" + name, INK_MATERIALS[name])
    for system in wanted:
        guarded("ink_ns_" + system, INK_SYSTEMS[system][1])


# ---------------------------------------------------------------- level
def spawn(cls, location, rotation=None):
    return unreal.EditorLevelLibrary.spawn_actor_from_class(cls, location, rotation or unreal.Rotator(0, 0, 0))


FRAME_STATIONS = {"frame_2": 2, "frame_9": 9, "frame_13": 13}
STATIONS = ["meshes", "toon_masked", "toon_translucent", "drawn", *FRAME_STATIONS, "stepped", "smooth"]
SYSTEMS = {"toon_masked": "NS_ToonMasked", "toon_translucent": "NS_ToonTranslucent", "drawn": "NS_Drawn", **{k: f"NS_Drawn{v}" for k, v in FRAME_STATIONS.items()}, "stepped": "NS_Stepped", "smooth": "NS_Smooth"}


def build_level():
    unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
    cube = eal.load_asset("/Engine/BasicShapes/Cube")
    sphere = eal.load_asset("/Engine/BasicShapes/Sphere")
    backdrop_mat = eal.load_asset(D + "/M_BG_Dark")
    base_stations = STATIONS if "base" in GROUPS else []
    for index, station in enumerate(base_stations):
        y = index * SPACING
        wall = spawn(unreal.StaticMeshActor, unreal.Vector(500, y, 100))
        wall.set_actor_label("Backdrop_" + station)
        wall.static_mesh_component.set_static_mesh(cube)
        wall.static_mesh_component.set_material(0, backdrop_mat)
        wall.set_actor_scale3d(unreal.Vector(0.1, 20, 14))
        cam = spawn(unreal.CameraActor, unreal.Vector(-700, y, 100))
        cam.set_actor_label("Cam_" + station)
        cam.get_editor_property("camera_component").set_editor_property("constrain_aspect_ratio", False)
        if station == "frame_9":  # a bright wall just in front of the dark one; stylized_render.py shows or hides it
            light = spawn(unreal.StaticMeshActor, unreal.Vector(490, y, 100))
            light.set_actor_label("Backdrop_frame_9_light")
            light.static_mesh_component.set_static_mesh(cube)
            light.static_mesh_component.set_material(0, eal.load_asset(D + "/M_BG_Light"))
            light.set_actor_scale3d(unreal.Vector(0.1, 20, 14))
        if station == "meshes":
            for label, dy, material in (("SphereToon", -150, "M_ToonLit"), ("SpherePlain", 150, "M_PlainLit")):
                actor = spawn(unreal.StaticMeshActor, unreal.Vector(0, y + dy, 100))
                actor.set_actor_label(label)
                actor.static_mesh_component.set_static_mesh(sphere)
                actor.static_mesh_component.set_material(0, eal.load_asset(f"{D}/{material}"))
                actor.set_actor_scale3d(unreal.Vector(2.4, 2.4, 2.4))
        else:
            fx = spawn(unreal.NiagaraActor, unreal.Vector(0, y, 100))
            fx.set_actor_label("Fx_" + station)
            comp = fx.get_editor_property("niagara_component")
            comp.set_editor_property("asset", eal.load_asset(f"{D}/{SYSTEMS[station]}"))
            comp.set_editor_property("auto_activate", True)
    placed = {}
    for offset, (station, _, system, stencil) in enumerate(ink.stations(GROUPS)):   # the ink-brush stations: a wider wall, the ribbons start half a length to the left
        y = (len(base_stations) + offset) * SPACING
        wall = spawn(unreal.StaticMeshActor, unreal.Vector(500, y, 100))
        wall.set_actor_label("Backdrop_" + station)
        wall.static_mesh_component.set_static_mesh(cube)
        wall.static_mesh_component.set_material(0, backdrop_mat)
        wall.set_actor_scale3d(unreal.Vector(0.1, 40, 14))
        cam = spawn(unreal.CameraActor, unreal.Vector(-700, y, 100))
        cam.set_actor_label("Cam_" + station)
        cam.get_editor_property("camera_component").set_editor_property("constrain_aspect_ratio", False)
        fx = spawn(unreal.NiagaraActor, unreal.Vector(0, y - (ink.RIBBON_LENGTH / 2 if station.startswith("r_") else 0), 100))
        fx.set_actor_label("Fx_" + station)
        comp = fx.get_editor_property("niagara_component")
        comp.set_editor_property("asset", eal.load_asset(f"{D}/{system}"))
        comp.set_editor_property("auto_activate", True)
        if stencil:   # the Niagara component writes custom depth and a stencil value of 1 (the project needs r.CustomDepth=3)
            comp.set_editor_property("render_custom_depth", True)
            comp.set_editor_property("custom_depth_stencil_value", 1)
        placed[station] = {"system": system, "stencil": stencil, "y": y}
    sun = spawn(unreal.DirectionalLight, unreal.Vector(-2000, 0, 800), unreal.Rotator(0, -35, 25))
    sun.set_actor_label("Sun")
    sun.get_component_by_class(unreal.DirectionalLightComponent).set_mobility(unreal.ComponentMobility.MOVABLE)
    sun.get_component_by_class(unreal.DirectionalLightComponent).set_editor_property("intensity", 2.5)
    ppv = spawn(unreal.PostProcessVolume, unreal.Vector(0, 0, 0))
    ppv.set_actor_label("FixedLook")
    ppv.set_editor_property("unbound", True)
    settings = ppv.get_editor_property("settings")
    for key, value in (("auto_exposure_min_brightness", 1.0), ("auto_exposure_max_brightness", 1.0), ("bloom_intensity", 0.0),
                       ("vignette_intensity", 0.0), ("film_grain_intensity", 0.0), ("motion_blur_amount", 0.0)):
        settings.set_editor_property("override_" + key, True)
        settings.set_editor_property(key, value)
    ppv.set_editor_property("settings", settings)
    stencil_pp = None
    if any(info["stencil"] for info in placed.values()):   # the outline post process lives in its own volume, off until stylized_render.py switches it on for a stencil shot
        pp = spawn(unreal.PostProcessVolume, unreal.Vector(0, 0, 0))
        pp.set_actor_label("StencilPP")
        pp.set_editor_property("unbound", True)
        pp.set_editor_property("priority", 1.0)
        pp_settings = pp.get_editor_property("settings")
        pp_settings.set_editor_property("weighted_blendables", unreal.WeightedBlendables(array=[unreal.WeightedBlendable(weight=1.0, object=eal.load_asset(D + "/M_StencilOutline"))]))
        pp.set_editor_property("settings", pp_settings)
        pp.set_editor_property("enabled", False)
        stencil_pp = str(pp.get_editor_property("settings").get_editor_property("weighted_blendables"))[:200]
    for actor in unreal.GameplayStatics.get_all_actors_of_class(unreal.EditorLevelLibrary.get_editor_world(), unreal.CameraActor):
        actor.set_actor_rotation(unreal.Rotator(0, 0, 0), False)
    return {"saved": bool(unreal.EditorLoadingAndSavingUtils.save_map(unreal.EditorLevelLibrary.get_editor_world(), MAP_PATH)), "ink_stations": placed, "stencil_pp": stencil_pp}


def build_instance():
    at = unreal.AssetToolsHelpers.get_asset_tools()
    mi = at.create_asset("MI_ToonLit", D, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    mel.set_material_instance_parent(mi, eal.load_asset(D + "/M_ToonLit"))
    eal.save_asset(D + "/MI_ToonLit")
    return {"instance": str(mi)}


def build_profile():
    tp = unreal.AssetToolsHelpers.get_asset_tools().create_asset("TP_Ink", D, unreal.ToonProfile, unreal.ToonProfileFactory())
    saved = eal.save_asset(D + "/TP_Ink")
    text = tp.get_editor_property("settings").get_editor_property("diffuse_ramp").export_text().split("ColorCurves[1]")[0]
    keys = [[float(t), float(v or 0)] for t, v in re.findall(r"Time=([0-9.]+)(?:,Value=([0-9.]+))?", text)]
    return {"profile": str(tp), "saved": saved, "default_diffuse_ramp_keys": keys}


def report_path():
    return os.environ.get("STYLIZED_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "stylized-build.json")


try:
    report["substrate_cvar"] = unreal.SystemLibrary.get_console_variable_int_value("r.Substrate")
    report["gbuffer_format_cvar"] = unreal.SystemLibrary.get_console_variable_int_value("r.Substrate.ProjectGBufferFormat")
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    eal.make_directory(D)
    eal.make_directory("/Game/Maps")
    report["groups"] = list(GROUPS)
    base = "base" in GROUPS
    guarded("flipbook", import_flipbook)
    if base:
        guarded("toon_profile", build_profile)
        guarded("toon_lit", build_toon_lit)
        guarded("toon_sprite_masked", lambda: build_toon_sprite("M_ToonSprite_Masked", False))
        guarded("toon_sprite_translucent", lambda: build_toon_sprite("M_ToonSprite_Translucent", True))
    guarded("drawn_material", build_drawn)
    if base:
        guarded("stepped_material", lambda: build_ramp("M_Stepped", True))
        guarded("smooth_material", lambda: build_ramp("M_Smooth", False))
    guarded("backdrops", lambda: (build_backdrop("M_BG_Dark", (0.02, 0.025, 0.04)), build_backdrop("M_BG_Light", (0.9, 0.9, 0.85)), {})[2])
    if base:
        guarded("toon_instance", build_instance)
    sprites = SPRITES
    if base:
        guarded("ns_toon_masked", lambda: make_system("NS_ToonMasked", sprites, D + "/M_ToonSprite_Masked", 600.0, 500.0))
        guarded("ns_toon_translucent", lambda: make_system("NS_ToonTranslucent", sprites, D + "/M_ToonSprite_Translucent", 600.0, 500.0))
        guarded("ns_drawn", lambda: make_system("NS_Drawn", SUBUV, D + "/M_Drawn", 2.0, 500.0, sub_image=(4, 4)))
    for frame in FRAME_STATIONS.values():
        if base or frame == 9:   # NS_Drawn9 is the unoutlined control and the stencil sprite of the outline group
            guarded(f"ns_drawn_{frame}", lambda f=frame: make_system(f"NS_Drawn{f}", SUBUV, D + "/M_Drawn", 2.0, 500.0, sub_image=(4, 4), direct_frame=f))
    if base:
        guarded("ns_stepped", lambda: make_system("NS_Stepped", sprites, D + "/M_Stepped", 600.0, 500.0, dynamic_param=3.0))
        guarded("ns_smooth", lambda: make_system("NS_Smooth", sprites, D + "/M_Smooth", 600.0, 500.0))
    build_ink_assets()
    guarded("level", build_level)
except Exception:
    step("error", ok=False, error=traceback.format_exc()[-900:])

path = report_path()
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[stylized_build] wrote " + path)
