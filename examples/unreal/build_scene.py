"""Build the agent-engine sample scene in Unreal 5.7 and 5.8 through the editor Python API.

Run headless (assets + level only, no rendering):
  UnrealEditor-Cmd.exe SampleScene.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound
Writes unreal/report-build.json describing every step. Nothing here claims the scene renders or plays:
that is checked separately by run_scene.ps1.
"""
import json
import os
import traceback

import unreal

ROOT = os.environ.get("AGENT_ENGINE_SCENES")
if not ROOT:
    raise RuntimeError("set AGENT_ENGINE_SCENES to the scenes workspace folder (it holds assets/ and unreal/)")
ROOT = ROOT.replace("\\", "/").rstrip("/")
REPORT = ROOT + "/unreal/report-build.json"
report = {"engine": unreal.SystemLibrary.get_engine_version(), "steps": []}


def step(name, fn):
    try:
        detail = fn()
        report["steps"].append({"name": name, "ok": True, "detail": detail})
        unreal.log("[build] ok   " + name)
        return detail
    except Exception as exc:  # report and keep going so one failure shows the rest
        report["steps"].append({"name": name, "ok": False, "error": str(exc), "trace": traceback.format_exc()})
        unreal.log_error("[build] FAIL " + name + ": " + str(exc))
        return None


tools = unreal.AssetToolsHelpers.get_asset_tools()


def combine_by_skeleton_pipeline():
    """A saved pipeline asset that merges the skins of one skeleton into one SkeletalMesh.

    The default glTF stack in 5.8.3 splits the 48-skin fox into 48 skeletal meshes; 5.7.3 produced one. Interchange takes
    pipelines as asset paths, so the configured pipeline is saved in the project. Returns None where the engine has no such option.
    """
    try:
        behavior = unreal.InterchangeCombineSkeletalMeshesBehavior.BY_SKELETON
        folder, name = "/Game/Pipelines", "P_combine_by_skeleton"
        unreal.EditorAssetLibrary.make_directory(folder)
        if not unreal.EditorAssetLibrary.does_asset_exist(folder + "/" + name):
            asset = unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, folder, unreal.InterchangeGenericAssetsPipeline, None)
            asset.get_editor_property("mesh_pipeline").set_editor_property("combine_skeletal_meshes_behavior", behavior)
            unreal.EditorAssetLibrary.save_asset(folder + "/" + name)
        return unreal.SoftObjectPath(folder + "/" + name + "." + name)
    except Exception as exc:
        unreal.log_warning("[build] no combine pipeline, using the default stack: " + str(exc))
        return None


def import_file(src, dest, pipeline=None):
    # InterchangeManager with is_automated skips the Content Browser sync that crashes a headless run
    # (AssetTools.import_asset_tasks asserts on a missing Slate application).
    manager = unreal.InterchangeManager.get_interchange_manager_scripted()
    source = unreal.InterchangeManager.create_source_data(src)
    params = unreal.ImportAssetParameters()
    params.is_automated = True
    if pipeline is not None:
        params.override_pipelines = [pipeline]
    returned = bool(manager.import_asset(dest, source, params))
    # 5.7.3 saved the assets of an automated import; 5.8.3 leaves them in memory only, so the saved map pointed at nothing
    unreal.EditorAssetLibrary.save_directory(dest, only_if_is_dirty=False, recursive=True)
    made = [str(p) for p in unreal.EditorAssetLibrary.list_assets(dest, recursive=True, include_folder=False)]
    return {"returned": returned, "assets_in_dest": made}


def fresh(name, folder, cls, factory):
    """create_asset returns None when the asset exists, and a deleted asset cannot be recreated in the same run,
    so reuse an existing asset (every property is set again below) to keep the script re-runnable."""
    path = folder + "/" + name
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        return unreal.EditorAssetLibrary.load_asset(path)
    asset = tools.create_asset(name, folder, cls, factory)
    if asset is None:
        raise RuntimeError("could not create " + path)
    return asset


def load(path):
    asset = unreal.EditorAssetLibrary.load_asset(path)
    if asset is None:
        raise RuntimeError("could not load " + path)
    return asset


# ---------------------------------------------------------------- imports
fox_paths = step("import fox.glb", lambda: import_file(ROOT + "/assets/meshes/fox.glb", "/Game/Fox", combine_by_skeleton_pipeline()))
step("import courier.png", lambda: import_file(ROOT + "/assets/sprites/courier.png", "/Game/Sprites"))
step("import campfire.png", lambda: import_file(ROOT + "/assets/sprites/campfire.png", "/Game/Sprites"))
audio_files = ["survey-drone.wav"] + ["relic-discovered.%d.wav" % i for i in range(4)]
def import_wavs():
    # WAV is not an Interchange format in 5.7: AssetTools handles it (and does not hit the Slate assert headless).
    tasks = []
    for f in audio_files:
        task = unreal.AssetImportTask()
        task.filename = ROOT + "/assets/audio/" + f
        task.destination_path = "/Game/Audio"
        task.automated = True
        task.save = True
        task.replace_existing = True
        tasks.append(task)
    tools.import_asset_tasks(tasks)
    return [str(p) for task in tasks for p in task.imported_object_paths]


audio_paths = step("import audio", import_wavs)


def find_assets(folder, cls):
    out = []
    for p in unreal.EditorAssetLibrary.list_assets(folder, recursive=True, include_folder=False):
        a = unreal.EditorAssetLibrary.load_asset(p)
        if a is not None and isinstance(a, cls):
            out.append(a)
    return out


# ---------------------------------------------------------------- sprites (Paper2D flipbooks from the atlases)
def make_flipbook(atlas_file, tex_name, tag_name, prefix):
    atlas = json.load(open(ROOT + "/assets/sprites/" + atlas_file))
    tag = [x for x in atlas["meta"]["frameTags"] if x["name"] == tag_name][0]
    pivot = [s for s in atlas["meta"]["slices"] if s["name"] == "pivot"][0]["keys"][0]["pivot"]
    tex = load("/Game/Sprites/" + tex_name)
    tex.set_editor_property("filter", unreal.TextureFilter.TF_NEAREST)
    tex.set_editor_property("mip_gen_settings", unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS)
    tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_EDITOR_ICON)
    unreal.EditorAssetLibrary.save_loaded_asset(tex)
    # The atlas is Aseprite "array" form: frames is a list, and the tag's from/to index INTO that list.
    # Frame index is not cell index: agent-sprites also lists raw and named cell copies in the same array.
    sprites, frames, keys = [], atlas["frames"], []
    for n, i in enumerate(range(tag["from"], tag["to"] + 1)):
        fr = frames[i]["frame"]
        sprite = fresh("SP_%s_%d" % (prefix, n), "/Game/Sprites", unreal.PaperSprite, unreal.PaperSpriteFactory())
        sprite.set_editor_property("source_texture", tex)
        sprite.set_editor_property("source_uv", unreal.Vector2D(fr["x"], fr["y"]))
        sprite.set_editor_property("source_dimension", unreal.Vector2D(fr["w"], fr["h"]))
        sprite.set_editor_property("pivot_mode", unreal.SpritePivotMode.CUSTOM)
        # Paper2D pivots are in SHEET pixels, not relative to the frame rectangle. The atlas pivot slice is relative
        # to the cell, so add the frame origin or every frame but the first is drawn displaced by its sheet offset.
        sprite.set_editor_property("custom_pivot_point", unreal.Vector2D(fr["x"] + pivot["x"], fr["y"] + pivot["y"]))
        unreal.EditorAssetLibrary.save_loaded_asset(sprite)
        sprites.append(sprite)
        kf = unreal.PaperFlipbookKeyFrame()
        kf.set_editor_property("sprite", sprite)
        kf.set_editor_property("frame_run", 1)
        keys.append(kf)
    fb = fresh("FB_" + prefix, "/Game/Sprites", unreal.PaperFlipbook, unreal.PaperFlipbookFactory())
    fb.set_editor_property("key_frames", keys)
    # Atlas durations are milliseconds and can differ per frame; a flipbook has one rate, so use the tag's first.
    durations = sorted(set(frames[i]["duration"] for i in range(tag["from"], tag["to"] + 1)))
    fps = 1000.0 / frames[tag["from"]]["duration"]
    fb.set_editor_property("frames_per_second", fps)
    unreal.EditorAssetLibrary.save_loaded_asset(fb)
    return {"frames": len(keys), "fps": fps, "durations_ms": durations, "pivot": pivot}


step("courier flipbook", lambda: make_flipbook("courier.atlas.json", "courier", "walk", "courier_walk"))
step("campfire flipbook", lambda: make_flipbook("campfire.atlas.json", "campfire", "burn", "campfire_burn"))


# ---------------------------------------------------------------- audio assets
def tune_audio():
    waves = find_assets("/Game/Audio", unreal.SoundWave)
    info = {}
    for w in waves:
        name = w.get_name()
        looping = name == "survey-drone"
        w.set_editor_property("looping", looping)
        unreal.EditorAssetLibrary.save_loaded_asset(w)
        info[name] = {"looping": looping, "duration": w.get_editor_property("duration")}
    return info


step("tune audio", tune_audio)

# ---------------------------------------------------------------- level
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def spawn(cls, loc=(0, 0, 0), rot=(0, 0, 0), label=None):
    actor = subsys.spawn_actor_from_class(cls, unreal.Vector(*loc), unreal.Rotator(roll=rot[2], pitch=rot[0], yaw=rot[1]))
    if label:
        actor.set_actor_label(label)
    return actor


def make_level():
    unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
    placed = {}
    floor = spawn(unreal.StaticMeshActor, label="Floor")
    floor.static_mesh_component.set_static_mesh(load("/Engine/BasicShapes/Plane"))
    floor.set_actor_scale3d(unreal.Vector(30, 30, 1))
    placed["floor"] = True

    skel = find_assets("/Game/Fox", unreal.SkeletalMesh)
    anims = find_assets("/Game/Fox", unreal.AnimSequence)
    fox = spawn(unreal.SkeletalMeshActor, loc=(0, -300, 0), rot=(0, 0, 0), label="Fox")
    comp = fox.skeletal_mesh_component
    fox_mesh = ([m for m in skel if m.get_name() == "fox"] or skel)[0]   # an import that splits the skins would put "back_mantle" first
    comp.set_skeletal_mesh_asset(fox_mesh)
    walk_anim = [a for a in anims if a.get_name().lower().endswith("walk")][0]
    data = unreal.SingleAnimationPlayData()
    data.set_editor_property("anim_to_play", walk_anim)
    comp.set_editor_property("animation_mode", unreal.AnimationMode.ANIMATION_SINGLE_NODE)
    comp.set_editor_property("animation_data", data)
    placed["fox"] = {"mesh": fox_mesh.get_name(), "skeletal_meshes_found": len(skel), "anim": walk_anim.get_name(), "anims": [a.get_name() for a in anims]}

    courier = spawn(unreal.PaperFlipbookActor, loc=(0, 190, 0), rot=(0, -90, 0), label="Courier")
    rc = courier.get_editor_property("render_component")
    rc.set_flipbook(load("/Game/Sprites/FB_courier_walk"))
    rc.set_looping(True)
    courier.set_actor_scale3d(unreal.Vector(6, 6, 6))
    placed["courier"] = True

    fire = spawn(unreal.PaperFlipbookActor, loc=(0, 0, 0), rot=(0, -90, 0), label="Campfire")
    frc = fire.get_editor_property("render_component")
    frc.set_flipbook(load("/Game/Sprites/FB_campfire_burn"))
    frc.set_looping(True)
    fire.set_actor_scale3d(unreal.Vector(8, 8, 8))
    fire_light = spawn(unreal.PointLight, loc=(-20, 0, 60), label="FireLight")
    fire_light.get_component_by_class(unreal.PointLightComponent).set_editor_property("light_color", unreal.Color(r=255, g=140, b=50, a=255))
    fire_light.get_component_by_class(unreal.PointLightComponent).set_editor_property("intensity", 700.0)
    placed["campfire"] = True

    sun = spawn(unreal.DirectionalLight, rot=(-50, 30, 0), label="Sun")
    sun_c = sun.get_component_by_class(unreal.DirectionalLightComponent)
    sun_c.set_editor_property("light_color", unreal.Color(r=140, g=165, b=255, a=255))
    sun_c.set_editor_property("intensity", 1.2)
    sky = spawn(unreal.SkyLight, loc=(0, 0, 200), label="Sky")
    sky.get_component_by_class(unreal.SkyLightComponent).set_editor_property("intensity", 0.6)

    cam = spawn(unreal.CameraActor, loc=(-900, 0, 230), rot=(-10, 0, 0), label="SceneCamera")
    cam.set_editor_property("auto_activate_for_player", unreal.AutoReceiveInput.PLAYER0)
    placed["camera"] = True

    music = spawn(unreal.AmbientSound, loc=(0, 0, 50), label="MusicBed")
    music.get_editor_property("audio_component").set_editor_property("sound", load("/Game/Audio/survey-drone"))
    placed["music"] = True
    pickup = spawn(unreal.AmbientSound, loc=(0, 0, 60), label="PickupVariant0")
    pc = pickup.get_editor_property("audio_component")
    pc.set_editor_property("sound", load("/Game/Audio/relic-discovered_0"))
    pc.set_editor_property("auto_activate", False)
    placed["pickup"] = "variant 0 only, not auto-playing"

    return placed


step("level", make_level)


def save_level_as():
    world = unreal.EditorLevelLibrary.get_editor_world()
    ok = unreal.EditorLoadingAndSavingUtils.save_map(world, "/Game/Maps/SampleScene")
    return {"saved": bool(ok)}


step("save map", save_level_as)

with open(REPORT, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log("[build] report written: " + REPORT)
