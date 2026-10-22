"""Build a plain stage for looking at any Niagara systems (Unreal 5.8, engine content only).

Run headless (assets and level only, no rendering), in a project with PythonScriptPlugin, EditorScriptingUtilities and Niagara
(plus NiagaraFluids for the default systems):
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Then fly it with showcase_explore.py on the map it prints (default /Game/Maps/NiagaraStage); the explorer finds the stage's centre
from the systems, so any number of systems works, one included.

The stage is a single flat plane with a plain material, a very dim directional light, a point light at each system and a camera.
Systems start inactive and the explorer switches them on as the camera approaches. They stand on a ring around the centre, far
enough apart that a few are in view at once; a single system stands at the centre.

Environment (all optional):
  NIAGARA_STAGE_SYSTEMS  semicolon-separated systems, each "asset path", "asset path@r,g,b" (its light colour) or
                         "asset path@r,g,b@seconds" (restart it every N seconds). Default: the 2D and 3D fluid fire and smoke.
  NIAGARA_STAGE_MAP      map to write (default /Game/Maps/NiagaraStage)
  NIAGARA_STAGE_MOON     directional light in lux, 0 for none (default 0.4)
  NIAGARA_STAGE_LIGHT    point light at each system in candela, 0 for none (default 300)
  NIAGARA_STAGE_REPORT   JSON report path (default Saved/niagara-stage-build.json in the project)
"""
import json
import math
import os
import traceback

import unreal

MAP_PATH = os.environ.get("NIAGARA_STAGE_MAP") or "/Game/Maps/NiagaraStage"
MOON = float(os.environ.get("NIAGARA_STAGE_MOON") or "0.4")
LIGHT = float(os.environ.get("NIAGARA_STAGE_LIGHT") or "300")
DEFAULT_SYSTEMS = ";".join([
    "/NiagaraFluids/Templates/Gas/2D/Systems/Grid2D_Gas_MovingFire@255,120,40",
    "/NiagaraFluids/Templates/Gas/3D/Systems/Grid3D_Gas_Fire@255,120,40",
    "/NiagaraFluids/Templates/Gas/2D/Systems/Grid2D_Gas_Smoke@150,190,255",
    "/NiagaraFluids/Templates/Gas/3D/Systems/Grid3D_Gas_Smoke@150,190,255",
])
NEUTRAL = (255, 220, 190)
LIGHT_HEIGHT = 300.0
report = {"engine": unreal.SystemLibrary.get_engine_version(), "steps": []}


def step(name, **info):
    report["steps"].append(dict(step=name, **info))


def rgb(color):
    """unreal.Color takes its positional arguments as (b, g, r, a), so name them."""
    return unreal.Color(r=color[0], g=color[1], b=color[2], a=255)


def parse(spec):
    """'path', 'path@r,g,b' or 'path@r,g,b@seconds' -> (path, colour, replay seconds)."""
    parts = spec.strip().split("@")
    color = tuple(int(v) for v in parts[1].split(",")) if len(parts) > 1 and parts[1] else NEUTRAL
    return parts[0], color, int(parts[2]) if len(parts) > 2 and parts[2] else 0


def spawn(cls, location, rotation=None):
    return unreal.EditorLevelLibrary.spawn_actor_from_class(cls, location, rotation or unreal.Rotator(0, 0, 0))


def positions(count):
    """A single system at the centre; otherwise a ring wide enough to keep neighbours about 7 m apart or more."""
    if count == 1:
        return [(0.0, 0.0)]
    radius = max(700.0, 175.0 * count)
    return [(radius * math.cos(i * 2 * math.pi / count), radius * math.sin(i * 2 * math.pi / count)) for i in range(count)]


try:
    specs = [parse(s) for s in (os.environ.get("NIAGARA_STAGE_SYSTEMS") or DEFAULT_SYSTEMS).split(";") if s.strip()]
    unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
    unreal.EditorAssetLibrary.make_directory(MAP_PATH.rsplit("/", 1)[0])
    unreal.EditorLoadingAndSavingUtils.new_blank_map(False)

    plane = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Plane")
    material = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/BasicShapeMaterial")
    ground = spawn(unreal.StaticMeshActor, unreal.Vector(0, 0, 0))
    ground.set_actor_label("Ground")
    ground.static_mesh_component.set_static_mesh(plane)
    if material:
        ground.static_mesh_component.set_material(0, material)
    ground.set_actor_scale3d(unreal.Vector(400, 400, 1))   # the plane is 100 units a side: 400 m square
    step("ground", material=bool(material))

    if MOON > 0:
        moon = spawn(unreal.DirectionalLight, unreal.Vector(0, 0, 1000), unreal.Rotator(0, -35, 40))
        moon.set_actor_label("Moon")
        mc = moon.get_component_by_class(unreal.DirectionalLightComponent)
        mc.set_mobility(unreal.ComponentMobility.MOVABLE)   # no baked lighting in this level
        mc.set_editor_property("intensity", MOON)
        mc.set_editor_property("light_color", rgb((120, 150, 255)))

    for index, ((path, color, replay), (x, y)) in enumerate(zip(specs, positions(len(specs)))):
        system = unreal.EditorAssetLibrary.load_asset(path)
        name = path.rsplit("/", 1)[-1]
        actor = spawn(unreal.NiagaraActor, unreal.Vector(x, y, 20))
        actor.set_actor_label(f"Station_{index + 1:02d}_{name}")
        comp = actor.get_editor_property("niagara_component")
        comp.set_editor_property("asset", system)
        comp.set_editor_property("auto_activate", False)
        actor.set_editor_property("tags", [unreal.Name("niagara_showcase"), unreal.Name(f"replay_{replay}")])
        if LIGHT > 0:
            light = spawn(unreal.PointLight, unreal.Vector(x, y, LIGHT_HEIGHT))
            light.set_actor_label(f"Light_{index + 1:02d}")
            lc = light.get_component_by_class(unreal.PointLightComponent)
            lc.set_mobility(unreal.ComponentMobility.MOVABLE)
            lc.set_editor_property("intensity", LIGHT)
            lc.set_editor_property("attenuation_radius", 1800.0)
            lc.set_editor_property("light_color", rgb(color))
        step("system", path=path, loaded=bool(system), at=[round(x), round(y)], light=list(color), replay=replay)

    ppv = spawn(unreal.PostProcessVolume, unreal.Vector(0, 0, 0))
    ppv.set_actor_label("Look")
    ppv.set_editor_property("unbound", True)
    settings = ppv.get_editor_property("settings")
    for pname, value in (("bloom_intensity", 1.0), ("auto_exposure_min_brightness", 1.0), ("auto_exposure_max_brightness", 1.0),
                         ("vignette_intensity", 0.4)):
        try:
            settings.set_editor_property("override_" + pname, True)
            settings.set_editor_property(pname, value)
        except Exception as exc:
            step("post_process_skip", setting=pname, error=str(exc)[:100])
    ppv.set_editor_property("settings", settings)

    camera = spawn(unreal.CameraActor, unreal.Vector(-700, 0, 240))
    camera.set_actor_label("ShowcaseCamera")   # showcase_explore.py moves it from the first system's pose
    step("save_map", map=MAP_PATH, ok=bool(unreal.EditorLoadingAndSavingUtils.save_map(unreal.EditorLevelLibrary.get_editor_world(), MAP_PATH)))
except Exception:
    step("error", traceback=traceback.format_exc()[-900:])

out = os.environ.get("NIAGARA_STAGE_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "niagara-stage-build.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[stage_build] map %s, wrote %s" % (MAP_PATH, out))
