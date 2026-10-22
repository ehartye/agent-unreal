"""Build a Niagara showcase level in Unreal 5.8 with the editor Python API (engine content only, no project assets).

Run headless (assets and level only, no rendering):
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
The project needs PythonScriptPlugin, EditorScriptingUtilities, Niagara, NiagaraFluids and NiagaraToolsets (Experimental). Set
NIAGARA_SHOWCASE_REPORT for the JSON report (default: Saved/niagara-showcase-build.json in the project).

It places eight stations in a ring on a dark stage: Epic's 2D fire and 3D fire (both Niagara Fluids gas templates), a 3D gas
explosion, a 3D FLIP liquid hose, sand, ribbon trails, a radial burst, and a system authored here through Epic's Niagara toolsets
(the radial-burst system with vortex, curl-noise and point-attraction modules added to its emitter's particle update). Each station
has a label, a pedestal and a coloured light; a post-process volume fixes exposure and adds bloom; a camera is placed for the run scripts.
Stations start inactive: showcase_explore.py (fly it yourself) and showcase_run.py (an automatic tour) switch them on as the camera
approaches, so only a few run at once.
"""
import json
import math
import os
import traceback

import unreal

TOOLSET = "NiagaraToolsets.NiagaraToolset_System"
FX = "/Game/FX"
MAP_PATH = "/Game/Maps/NiagaraShowcase"
RING = 1800.0
LIGHT_INTENSITY = float(os.environ.get("NIAGARA_SHOWCASE_LIGHT", "300"))  # candela; the stage is lit only by these and the effects

# id, label, system, replay seconds (0 = loops), light colour
STATIONS = [
    ("fire2d", "2D FIRE  -  GPU grid sprite", "/NiagaraFluids/Templates/Gas/2D/Systems/Grid2D_Gas_MovingFire", 0, (255, 130, 40)),
    ("fire3d", "3D FIRE  -  GPU grid volume", "/NiagaraFluids/Templates/Gas/3D/Systems/Grid3D_Gas_Fire", 0, (255, 130, 40)),
    ("explosion", "EXPLOSION  -  3D gas, restarts", "/NiagaraFluids/Templates/Gas/3D/Systems/Grid3D_Gas_Explosion", 10, (255, 170, 80)),
    ("hose", "LIQUID HOSE  -  3D FLIP", "/NiagaraFluids/Templates/Liquid/3D/Systems/Grid3D_Flip_Hose", 0, (80, 170, 255)),
    ("sand", "SAND  -  granular sim", "/NiagaraFluids/Templates/Sand/Systems/SandSystem", 0, (230, 190, 110)),
    ("trails", "RIBBON TRAILS  -  attribute reader", "/Niagara/DefaultAssets/Templates/Systems/AttributeReaderTrails", 0, (180, 110, 255)),
    ("burst", "RADIAL BURST  -  CPU sprites, restarts", "/Niagara/DefaultAssets/Templates/Systems/RadialBurst", 5, (255, 240, 200)),
    ("vortex", "AUTHORED HERE  -  swirl modules via toolsets", FX + "/NS_ShowcaseVortex", 5, (255, 80, 200)),
]

report = {"engine": unreal.SystemLibrary.get_engine_version(), "steps": []}


def step(name, **info):
    report["steps"].append(dict(step=name, **info))


def report_path():
    return os.environ.get("NIAGARA_SHOWCASE_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "niagara-showcase-build.json")


def ref(package_path):
    return {"refPath": package_path + "." + package_path.rsplit("/", 1)[-1]}


def tool(name, args):
    result = unreal.ToolsetRegistry.execute_tool(TOOLSET, name, json.dumps(args))
    error = str(result.get_editor_property("error"))
    if not result.is_complete or error:
        raise RuntimeError(f"{name}: {error or 'incomplete'}")
    return json.loads(str(result.get_editor_property("value"))).get("returnValue")


def author_vortex_system():
    """Create NS_ShowcaseVortex from Epic's RadialBurst system by adding vortex, curl-noise and point-attraction forces to its emitter.

    An earlier recipe (remove the template emitter, add a Fountain emitter, add the same modules) compiled but the system completed
    at once and never emitted. Starting from a system that already emits, and only adding modules, keeps it alive.
    """
    path = FX + "/NS_ShowcaseVortex"
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        step("vortex", note="exists, reused")
        return
    tool("CreateNiagaraSystem", {"assetName": "NS_ShowcaseVortex", "assetPath": FX, "templateSystem": ref("/Niagara/DefaultAssets/Templates/Systems/RadialBurst")})
    system = ref(path)
    emitters = [e["emitterName"] for e in tool("GetSystemSummary", {"system": system})["emitters"]]
    added = []
    for module in ("Update/Forces/VortexForce", "Update/Forces/CurlNoiseForce", "Update/Forces/PointAttractionForce"):
        try:
            where = {"system": system, "emitterName": emitters[0], "scriptName": "ParticleUpdateScript", "moduleName": "", "rendererIndex": 0, "inputNameStack": []}
            tool("AddModule", {"moduleLocationRef": where, "moduleAsset": ref("/Niagara/Modules/" + module)})
            added.append(module)
        except Exception as exc:
            added.append(f"{module}: {exc}")
    unreal.EditorAssetLibrary.save_asset(path)
    step("vortex", template="RadialBurst", emitter=emitters[0], added=added, saved=True)


def rgb(color):
    """unreal.Color takes its positional arguments as (b, g, r, a), so name them."""
    return unreal.Color(r=color[0], g=color[1], b=color[2], a=255)


def spawn(cls, location, rotation=None):
    return unreal.EditorLevelLibrary.spawn_actor_from_class(cls, location, rotation or unreal.Rotator(0, 0, 0))


try:
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    unreal.EditorAssetLibrary.make_directory(FX)
    unreal.EditorAssetLibrary.make_directory("/Game/Maps")
    try:
        author_vortex_system()
    except Exception:
        step("vortex_error", traceback=traceback.format_exc()[-600:])

    unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
    plane = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Plane")
    cylinder = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cylinder")
    grid = unreal.EditorAssetLibrary.load_asset("/Engine/EngineMaterials/WorldGridMaterial")

    floor = spawn(unreal.StaticMeshActor, unreal.Vector(0, 0, 0))
    floor.set_actor_label("Floor")
    floor.static_mesh_component.set_static_mesh(plane)
    floor.static_mesh_component.set_material(0, grid)
    floor.set_actor_scale3d(unreal.Vector(120, 120, 1))

    for index, (sid, label, system_path, replay, color) in enumerate(STATIONS):
        angle = index * 2 * math.pi / len(STATIONS)
        x, y = RING * math.cos(angle), RING * math.sin(angle)
        pedestal = spawn(unreal.StaticMeshActor, unreal.Vector(x, y, 12))
        pedestal.set_actor_label(f"Pedestal_{index + 1:02d}")
        pedestal.static_mesh_component.set_static_mesh(cylinder)
        pedestal.static_mesh_component.set_material(0, grid)
        pedestal.set_actor_scale3d(unreal.Vector(3.2, 3.2, 0.25))

        system = unreal.EditorAssetLibrary.load_asset(system_path)
        actor = spawn(unreal.NiagaraActor, unreal.Vector(x, y, 30))
        actor.set_actor_label(f"Station_{index + 1:02d}_{sid}")
        comp = actor.get_editor_property("niagara_component")
        comp.set_editor_property("asset", system)
        comp.set_editor_property("auto_activate", False)
        actor.set_editor_property("tags", [unreal.Name("niagara_showcase"), unreal.Name(f"replay_{replay}")])

        light = spawn(unreal.PointLight, unreal.Vector(x, y, 330))
        light.set_actor_label(f"Light_{index + 1:02d}")
        lc = light.get_component_by_class(unreal.PointLightComponent)
        lc.set_mobility(unreal.ComponentMobility.MOVABLE)
        lc.set_editor_property("intensity", LIGHT_INTENSITY)
        lc.set_editor_property("attenuation_radius", 900.0)
        lc.set_editor_property("light_color", rgb(color))

        # Rotator is (roll, pitch, yaw); the text front faces +X, so yaw = outward + 180 makes it face the ring's centre.
        text = spawn(unreal.TextRenderActor, unreal.Vector(x * 0.97, y * 0.97, 560), unreal.Rotator(0, 0, math.degrees(angle) + 180))
        text.set_actor_label(f"Label_{index + 1:02d}")
        tr = text.get_editor_property("text_render")
        tr.set_text(label)
        tr.set_editor_property("world_size", 40.0)
        tr.set_editor_property("text_render_color", rgb(color))
        tr.set_editor_property("horizontal_alignment", unreal.HorizTextAligment.EHTA_CENTER)
        step("station", id=sid, system=system_path, loaded=bool(system))

    ppv = spawn(unreal.PostProcessVolume, unreal.Vector(0, 0, 0))
    ppv.set_actor_label("Look")
    ppv.set_editor_property("unbound", True)
    settings = ppv.get_editor_property("settings")
    for name, value in (("bloom_intensity", 1.2), ("auto_exposure_min_brightness", 1.0), ("auto_exposure_max_brightness", 1.0),
                        ("vignette_intensity", 0.55), ("film_grain_intensity", 0.08)):
        try:
            settings.set_editor_property("override_" + name, True)
            settings.set_editor_property(name, value)
        except Exception as exc:
            step("post_process_skip", setting=name, error=str(exc)[:100])
    ppv.set_editor_property("settings", settings)

    camera = spawn(unreal.CameraActor, unreal.Vector(RING - 650, 0, 240))
    camera.set_actor_label("ShowcaseCamera")
    camera.set_actor_rotation(unreal.MathLibrary.find_look_at_rotation(camera.get_actor_location(), unreal.Vector(RING, 0, 150)), False)
    step("save_map", ok=bool(unreal.EditorLoadingAndSavingUtils.save_map(unreal.EditorLevelLibrary.get_editor_world(), MAP_PATH)))
except Exception:
    step("error", traceback=traceback.format_exc()[-900:])

path = report_path()
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[showcase_build] wrote " + path)
