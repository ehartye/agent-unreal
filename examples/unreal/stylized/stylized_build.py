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
"""
import json
import math
import os
import re
import struct
import traceback
import zlib

import unreal

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
    return normal, mask


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
    for index, station in enumerate(STATIONS):
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
    for actor in unreal.GameplayStatics.get_all_actors_of_class(unreal.EditorLevelLibrary.get_editor_world(), unreal.CameraActor):
        actor.set_actor_rotation(unreal.Rotator(0, 0, 0), False)
    return {"saved": bool(unreal.EditorLoadingAndSavingUtils.save_map(unreal.EditorLevelLibrary.get_editor_world(), MAP_PATH))}


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
    guarded("flipbook", import_flipbook)
    guarded("toon_profile", build_profile)
    guarded("toon_lit", build_toon_lit)
    guarded("toon_sprite_masked", lambda: build_toon_sprite("M_ToonSprite_Masked", False))
    guarded("toon_sprite_translucent", lambda: build_toon_sprite("M_ToonSprite_Translucent", True))
    guarded("drawn_material", build_drawn)
    guarded("stepped_material", lambda: build_ramp("M_Stepped", True))
    guarded("smooth_material", lambda: build_ramp("M_Smooth", False))
    guarded("backdrops", lambda: (build_backdrop("M_BG_Dark", (0.02, 0.025, 0.04)), build_backdrop("M_BG_Light", (0.9, 0.9, 0.85)), {})[2])
    guarded("toon_instance", build_instance)
    sprites = "/Niagara/DefaultAssets/Templates/Emitters/SingleLoopingParticle"
    guarded("ns_toon_masked", lambda: make_system("NS_ToonMasked", sprites, D + "/M_ToonSprite_Masked", 600.0, 500.0))
    guarded("ns_toon_translucent", lambda: make_system("NS_ToonTranslucent", sprites, D + "/M_ToonSprite_Translucent", 600.0, 500.0))
    guarded("ns_drawn", lambda: make_system("NS_Drawn", "/Niagara/DefaultAssets/Templates/BehaviorExamples/SubUVAnimation", D + "/M_Drawn", 2.0, 500.0, sub_image=(4, 4)))
    for frame in FRAME_STATIONS.values():
        guarded(f"ns_drawn_{frame}", lambda f=frame: make_system(f"NS_Drawn{f}", "/Niagara/DefaultAssets/Templates/BehaviorExamples/SubUVAnimation", D + "/M_Drawn", 2.0, 500.0, sub_image=(4, 4), direct_frame=f))
    guarded("ns_stepped", lambda: make_system("NS_Stepped", sprites, D + "/M_Stepped", 600.0, 500.0, dynamic_param=3.0))
    guarded("ns_smooth", lambda: make_system("NS_Smooth", sprites, D + "/M_Smooth", 600.0, 500.0))
    guarded("level", build_level)
except Exception:
    step("error", ok=False, error=traceback.format_exc()[-900:])

path = report_path()
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[stylized_build] wrote " + path)
