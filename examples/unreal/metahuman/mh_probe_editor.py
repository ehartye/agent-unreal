"""MetaHuman probe, in-editor half (Unreal 5.8). Prepared 2026-10-29; four engine runs found and fixed the faults named in README.md.

Two modes, chosen by MH_MODE.

  MH_MODE=names (headless, UnrealEditor-Cmd -run=pythonscript -nullrhi): checks that every class, method, field and enum member this script uses exists in
      the installed engine, builds the three pose animation sequences on the MetaHuman face skeleton in memory (nothing is saved) and reads their keys back.
      No cloud request, no sign-in, no character is created. mh_probe.mjs --names runs it.

  default (a RENDERING editor with a visible window; mh_probe.mjs starts it, or a person opens the prepared project): the throwaway project's start-up script
      runs this file. It reads <project>/Saved/mh-plan.json, takes launch number N (MH_LAUNCH, or the count of Saved/mh-launch-*.json files plus one) and runs
      the stages the plan lists for that launch, then quits the editor:
        create    a MetaHuman Character asset from a preset (a copy of an installed preset asset; the editor's own preset call is not exposed to Python), registered with
                  MetaHumanCharacterEditorSubsystem.try_add_object_to_edit, a small landmark edit, commit_face_state and commit_body_state, request_auto_rigging and
                  request_texture_sources with blocking=True (the first cloud request starts the editor's sign-in, which a person completes), a read-back, remove_object_to_edit
        assemble  build_meta_human (the pipelines of the plan in order, the optimized pipeline first), the assembled assets counted, the Blueprint spawned in a new level with a camera and lights,
                  Play-In-Editor, a control frame with the actor hidden and a frame with it shown
        drive     one animation sequence per pose on the face skeleton, each writing the control curves of the plan, played on the Face component in Play-In-Editor, one frame per pose
        repeat    the create stage again on a second character, in a launch that starts from a closed and reopened editor (the question: does the sign-in come back)
      The report is written after every step to MH_REPORT (default Saved/mh-launch-N.json) with a "progress" line and a "trace" of what the flow is doing, so a quiet stage can be told from a
      stuck one. Screenshots go to Saved/Screenshots under the names mh_<phase>; each frame is waited for (bounded) and recorded under "shots".
      Cloud calls block the editor while they run, by design (blocking=True is Epic's pattern for scripts); every other wait is bounded, and a launch always ends with done true and an
      "end_reason" (completed, launch budget exceeded, exception, start-up failure), even when a stage ran out of time.

Environment: MH_MODE, MH_REPORT, MH_LAUNCH. Plan: see mh-probe-checks.mjs buildPlan.
Nothing here reads or writes credentials, a GPU name or a home folder; error texts have the project folder replaced.
"""
import glob
import json
import os
import re
import time
import traceback

import unreal

PROJECT = unreal.SystemLibrary.get_project_directory().replace("\\", "/")
SAVED = PROJECT.rstrip("/") + "/Saved"
MODE = os.environ.get("MH_MODE", "run")

# the names this script uses; the names mode reports the ones the engine does not have
REQUIRED = {
    "classes": [
        "MetaHumanCharacter", "MetaHumanCharacterFactoryNew", "MetaHumanCharacterEditorSubsystem", "MetaHumanCharacterAutoRiggingRequestParams",
        "MetaHumanCharacterTextureRequestParams", "MetaHumanCharacterEditorBuildParameters", "MetaHumanRigType", "MetaHumanDefaultPipelineType", "MetaHumanQualityLevel",
        "AnimationLibrary", "AnimSequenceFactory", "AnimSequence", "SkeletalMeshComponent", "AssetToolsHelpers", "AssetRegistryHelpers", "EditorAssetLibrary",
        "LevelEditorSubsystem", "EditorActorSubsystem", "UnrealEditorSubsystem", "GameplayStatics", "MathLibrary", "AutomationLibrary", "Paths", "SystemLibrary",
        "CameraActor", "DirectionalLight", "SkyLight", "StaticMeshActor", "EditorPythonScripting", "FrameRate",
    ],
    "methods": {
        "MetaHumanCharacterEditorSubsystem": [
            "try_add_object_to_edit", "is_object_added_for_editing", "remove_object_to_edit", "commit_face_state", "commit_body_state", "get_face_landmarks", "translate_face_landmarks",
            "request_auto_rigging", "request_texture_sources", "can_build_meta_human", "build_meta_human",
        ],
        "AnimationLibrary": ["add_curve", "add_float_curve_key", "get_float_keys", "get_animation_curve_names"],
        "SkeletalMeshComponent": ["play_animation", "get_curve_value", "get_skeletal_mesh_asset"],
        "LevelEditorSubsystem": ["new_level", "save_current_level", "editor_request_begin_play", "editor_request_end_play"],
        "EditorActorSubsystem": ["spawn_actor_from_class"],
        "EditorAssetLibrary": ["load_asset", "load_blueprint_class", "duplicate_asset", "save_asset", "does_asset_exist"],
        "AutomationLibrary": ["take_high_res_screenshot"],
        "UnrealEditorSubsystem": ["get_game_world", "get_editor_world"],
        "GameplayStatics": ["get_all_actors_of_class", "get_player_controller"],
        "MathLibrary": ["find_look_at_rotation"],
        "EditorPythonScripting": ["set_keep_python_script_alive"],
        "MetaHumanCharacter": ["has_high_resolution_textures", "synthesized_face_textures_info", "high_res_body_textures_info"],
        "AnimSequence": ["controller"],
        "SystemLibrary": ["execute_console_command", "get_project_directory"],
        "Paths": ["project_saved_dir"],
    },
    "fields": {
        "MetaHumanCharacterAutoRiggingRequestParams": ["blocking", "report_progress", "rig_type"],
        "MetaHumanCharacterTextureRequestParams": ["blocking", "report_progress"],
        "MetaHumanCharacterEditorBuildParameters": ["pipeline_type", "pipeline_quality", "absolute_build_path", "common_folder_path", "enable_wardrobe_item_validation"],
    },
    "enums": {
        "MetaHumanRigType": ["JOINTS_ONLY", "JOINTS_AND_BLEND_SHAPES"],
        "MetaHumanDefaultPipelineType": ["CINEMATIC", "OPTIMIZED"],
        "MetaHumanQualityLevel": ["CINEMATIC", "HIGH", "MEDIUM", "LOW"],
    },
    "functions": ["register_slate_post_tick_callback", "unregister_slate_post_tick_callback", "load_asset", "new_object"],
}
FACE_SKELETON = "/MetaHumanCharacter/Face/Face_Archetype_Skeleton"
PRESET_DIR = "/MetaHumanCharacter/Optional/Presets"


def clean(text):
    """Keep an error text whole, but never write the project folder into a report."""
    return str(text).replace("\\", "/").replace(PROJECT.rstrip("/"), "<project>")


def tail(limit=700):
    return clean(traceback.format_exc()[-limit:])


def load_plan():
    path = SAVED + "/mh-plan.json"
    if not os.path.exists(path):
        return {}
    with open(path) as fh:
        return json.load(fh)


def has_member(owner, name):
    """True when `name` is a class attribute, a Python property, or an editor property of a struct or object class."""
    if hasattr(owner, name):
        return True
    try:
        return name in dir(owner)
    except Exception:
        return False


def make_pose_sequence(skeleton, asset_name, package_path, curves):
    """An animation sequence on `skeleton` that writes the float control curves in `curves` at time 0.
    AnimationLibrary.add_curve and add_float_curve_key are the calls the 5.8 install exposes; the controller resize is tried and recorded, not required."""
    factory = unreal.AnimSequenceFactory()
    factory.set_editor_property("target_skeleton", skeleton)
    sequence = unreal.AssetToolsHelpers.get_asset_tools().create_asset(asset_name, package_path, unreal.AnimSequence, factory)
    if sequence is None:
        raise RuntimeError("create_asset returned None for " + asset_name)
    note = ""
    try:
        controller = sequence.controller
        controller.open_bracket("mh probe length", False)
        controller.set_frame_rate(unreal.FrameRate(30, 1), False)
        controller.set_number_of_frames(unreal.FrameNumber(30), False)
        controller.close_bracket(False)
    except Exception as exc:
        note = "length not changed: " + clean(exc)[:160]
    for name, value in curves.items():
        unreal.AnimationLibrary.add_curve(sequence, name, unreal.RawCurveTrackTypes.RCT_FLOAT)
        unreal.AnimationLibrary.add_float_curve_key(sequence, name, 0.0, float(value))
    read = {}
    for name in curves:
        times, values = unreal.AnimationLibrary.get_float_keys(sequence, name)
        read[name] = [round(float(v), 4) for v in values]
    return sequence, {"path": sequence.get_path_name(), "keys": read, "play_length": round(float(sequence.get_play_length()), 4), "note": note}


# ---------------------------------------------------------------- names mode (headless)
def run_names():
    report = {"mode": "names", "engine": unreal.SystemLibrary.get_engine_version(), "missing": {"classes": [], "methods": [], "fields": [], "enums": [], "functions": []}, "errors": []}
    for name in REQUIRED["classes"]:
        if not hasattr(unreal, name):
            report["missing"]["classes"].append(name)
    for owner, names in REQUIRED["methods"].items():
        cls = getattr(unreal, owner, None)
        for name in names:
            if cls is None or not has_member(cls, name):
                report["missing"]["methods"].append(owner + "." + name)
    for owner, names in REQUIRED["fields"].items():
        cls = getattr(unreal, owner, None)
        for name in names:
            try:
                present = cls is not None and (has_member(cls, name) or name in dir(cls()))
            except Exception:
                present = False
            if not present:
                report["missing"]["fields"].append(owner + "." + name)
    for owner, names in REQUIRED["enums"].items():
        cls = getattr(unreal, owner, None)
        for name in names:
            if cls is None or not hasattr(cls, name):
                report["missing"]["enums"].append(owner + "." + name)
    for name in REQUIRED["functions"]:
        if not hasattr(unreal, name):
            report["missing"]["functions"].append(name)
    report["pipeline_members"] = sorted(n for n in dir(unreal.MetaHumanDefaultPipelineType) if n.isupper()) if hasattr(unreal, "MetaHumanDefaultPipelineType") else []
    report["rig_members"] = sorted(n for n in dir(unreal.MetaHumanRigType) if n.isupper()) if hasattr(unreal, "MetaHumanRigType") else []
    report["subsystem_methods"] = sorted(n for n in dir(unreal.MetaHumanCharacterEditorSubsystem) if not n.startswith("_")) if hasattr(unreal, "MetaHumanCharacterEditorSubsystem") else []
    # the installed plugin's optional content (presets, texture synthesis model): a folder the editor itself checks
    content = str(unreal.PluginBlueprintLibrary.get_plugin_content_dir("MetaHumanCharacter")) if hasattr(unreal, "PluginBlueprintLibrary") else ""
    report["optional_content"] = bool(content) and os.path.isdir(os.path.join(content, "Optional"))
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    report["preset_assets"] = [str(a.package_name) for a in registry.get_assets_by_path(PRESET_DIR, recursive=True)][:20]
    plan = load_plan()
    poses = plan.get("poses", [])
    report["pose_sequences"] = {}
    try:
        skeleton = unreal.load_asset(FACE_SKELETON)
        if skeleton is None:
            raise RuntimeError("face skeleton not found: " + FACE_SKELETON)
        for pose in poses:
            _, info = make_pose_sequence(skeleton, "AS_Names_" + pose["name"], "/Game/MhNames", pose["curves"])
            report["pose_sequences"][pose["name"]] = info
    except Exception:
        report["errors"].append(tail())
    return report


# ---------------------------------------------------------------- run mode (rendering editor)
def run_flow():
    plan = load_plan()
    launch = int(os.environ.get("MH_LAUNCH") or (len(glob.glob(SAVED + "/mh-launch-*.json")) + 1))
    launches = plan.get("launches", [])
    if launch < 1 or launch > len(launches):
        unreal.log("[mh_probe] launch %d is not in the plan (%d launches); nothing to do" % (launch, len(launches)))
        return
    stages = launches[launch - 1]
    report_path = os.environ.get("MH_REPORT") or (SAVED + "/mh-launch-%d.json" % launch)
    report = {"launch": launch, "stages_requested": stages, "engine": unreal.SystemLibrary.get_engine_version(), "errors": [], "stages": {}, "done": False, "end_reason": "", "seconds": 0.0,
              "progress": "starting", "trace": [], "shots": []}
    clock = {"t": 0.0, "wait": float(plan.get("settle_seconds", 20)), "gen": None, "handle": None, "pie": False, "finished": False}
    began_at = time.time()
    budgets = plan.get("launch_budget_seconds") or []
    launch_budget = float(budgets[launch - 1]) if len(budgets) >= launch else 0.0   # 0: no budget
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    subsystem = unreal.get_editor_subsystem(unreal.MetaHumanCharacterEditorSubsystem)
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    state = {"character": None, "blueprint": None, "actor": None, "camera": None, "face_name": None, "sequences": {}}

    def now():
        return time.time() - began_at

    def write_report():
        report["seconds"] = round(now(), 1)
        os.makedirs(os.path.dirname(report_path) or ".", exist_ok=True)
        with open(report_path, "w") as fh:
            json.dump(report, fh, indent=2, default=str)

    def stage(name):
        return report["stages"].setdefault(name, {"errors": []})

    def note(message, save=False):
        """What the flow is doing now: a line in the editor log and the report (progress and trace), so a quiet stage can be told from a stuck one."""
        report["progress"] = "%.0f s: %s" % (now(), message)
        report["trace"].append(report["progress"])
        del report["trace"][:-150]
        unreal.log("[mh_probe] " + message)
        if save:
            write_report()

    def stage_error(stage_name, message):
        stage(stage_name)["errors"].append(message)
        report["errors"].append(stage_name + ": " + message)
        note("ERROR " + message, True)

    def pause(seconds, reason, slice_seconds=10.0):
        """A generator: wait `seconds` in slices of at most 10 s, each one logged and written to the report. The launch budget (see tick) ends the flow if it runs out meanwhile."""
        total, spent = float(seconds), 0.0
        while spent < total:
            step = min(slice_seconds, total - spent)
            note("waiting for %s (%.0f of %.0f s)" % (reason, spent, total), save=total >= 15)
            yield step
            spent += step

    def timed(fn):
        began = time.time()
        error = ""
        try:
            fn()
        except Exception:
            error = tail()
        return round(time.time() - began, 1), error

    # ---------- create
    def find_preset():
        registry.scan_paths_synchronous([PRESET_DIR], True)
        names = sorted(str(a.package_name) for a in registry.get_assets_by_path(PRESET_DIR, recursive=True))
        wanted = plan.get("preset")
        if wanted:
            names = [n for n in names if n.rsplit("/", 1)[-1] == wanted] or names
        return names

    def stage_create(stage_name):
        out = stage(stage_name)
        suffix = "Repeat" if stage_name == "repeat" else ""
        name = plan.get("character", "MhProbeChar") + suffix
        folder = "/Game/MhProbe"
        out["optional_content"] = os.path.isdir(os.path.join(str(unreal.PluginBlueprintLibrary.get_plugin_content_dir("MetaHumanCharacter")), "Optional"))
        presets = find_preset()
        out["presets_found"] = len(presets)
        character = None
        if presets:
            try:
                target = "%s/%s" % (folder, name)
                if unreal.EditorAssetLibrary.does_asset_exist(target):
                    unreal.EditorAssetLibrary.delete_asset(target)
                character = unreal.EditorAssetLibrary.duplicate_asset(presets[0], target)
                out["source"], out["preset"] = "preset", presets[0].rsplit("/", 1)[-1]
            except Exception:
                out["errors"].append("preset copy: " + tail())
        if character is None:
            factory = unreal.new_object(type=unreal.MetaHumanCharacterFactoryNew)
            character = unreal.AssetToolsHelpers.get_asset_tools().create_asset(asset_name=name, package_path=folder, asset_class=unreal.MetaHumanCharacter, factory=factory)
            out["source"], out["preset"] = "factory", None
        out["created"] = character is not None
        if character is None:
            out["errors"].append("no character asset")
            return
        out["asset"] = character.get_path_name()
        state["character"] = character
        write_report()
        added = subsystem.try_add_object_to_edit(character)
        out["add_for_edit"] = bool(added)
        if not added:
            out["errors"].append("try_add_object_to_edit returned False (is the asset already open for edit?)")
            return
        try:
            out["edit"] = {"landmarks": 0, "error": ""}
            landmarks = subsystem.get_face_landmarks(character=character)
            out["edit"]["landmarks"] = len(landmarks)
            if len(landmarks) > 0:
                deltas = [unreal.Vector(v.x * 0.02, v.y * 0.02, v.z * 0.02) for v in landmarks]
                subsystem.translate_face_landmarks(character=character, landmark_indices=list(range(len(landmarks))), deltas=deltas)
        except Exception:
            out["edit"]["error"] = tail()
        try:
            subsystem.commit_face_state(character=character)
            subsystem.commit_body_state(character=character)
            out["committed"] = True
        except Exception:
            out["committed"] = False
            out["errors"].append("commit: " + tail())
        write_report()
        rig = unreal.MetaHumanCharacterAutoRiggingRequestParams()
        rig.blocking = True
        rig.report_progress = False
        rig.rig_type = getattr(unreal.MetaHumanRigType, plan.get("rig_type", "JOINTS_ONLY"))
        out["rig_request"] = {"blocking": True, "report_progress": False, "rig_type": plan.get("rig_type", "JOINTS_ONLY"), "seconds": 0.0, "error": ""}
        note("request_auto_rigging (blocking: the editor does not answer until it returns, and the first one waits for the sign-in)", True)
        out["rig_request"]["seconds"], out["rig_request"]["error"] = timed(lambda: subsystem.request_auto_rigging(character, rig))
        write_report()
        if not out["rig_request"]["error"]:
            tex = unreal.MetaHumanCharacterTextureRequestParams()
            tex.blocking = True
            tex.report_progress = False
            out["texture_request"] = {"blocking": True, "report_progress": False, "seconds": 0.0, "error": ""}
            note("request_texture_sources (blocking)", True)
            out["texture_request"]["seconds"], out["texture_request"]["error"] = timed(lambda: subsystem.request_texture_sources(character, tex))
        write_report()
        readback = {"has_high_resolution_textures": None, "can_build": None, "face_texture_infos": None, "body_texture_infos": None}
        try:
            readback["has_high_resolution_textures"] = bool(character.has_high_resolution_textures)
            readback["can_build"] = bool(subsystem.can_build_meta_human(character))
            readback["face_texture_infos"] = len(character.synthesized_face_textures_info)
            readback["body_texture_infos"] = len(character.high_res_body_textures_info)
        except Exception:
            out["errors"].append("read back: " + tail())
        out["readback"] = readback
        try:
            if subsystem.is_object_added_for_editing(character):
                subsystem.remove_object_to_edit(character)
            out["removed"] = not subsystem.is_object_added_for_editing(character)
        except Exception:
            out["removed"] = False
            out["errors"].append("remove: " + tail())
        try:
            out["saved"] = bool(unreal.EditorAssetLibrary.save_asset(out["asset"].split(".")[0], only_if_is_dirty=False))
        except Exception:
            out["saved"] = False
        write_report()

    # ---------- assemble
    def list_assets(path):
        registry.scan_paths_synchronous([path], True)
        found = []
        for a in registry.get_assets_by_path(path, recursive=True):
            try:
                cls = str(a.asset_class_path.asset_name)
            except Exception:
                cls = str(a.asset_class)
            found.append((str(a.package_name), cls))
        return found

    def stage_assemble_build():
        out = stage("assemble")
        character = state["character"] or unreal.EditorAssetLibrary.load_asset("/Game/MhProbe/" + plan.get("character", "MhProbeChar"))
        if character is None:
            out["errors"].append("no character asset: run the create group first")
            return
        state["character"] = character
        out["attempts"] = []
        out["order_reason"] = plan.get("pipeline_order_reason", "")
        build_path = plan.get("build_path", "/Game/MetaHumans")
        previous_error = ""
        for number, attempt in enumerate(plan.get("pipelines", []), 1):
            record = {"attempt": number, "pipeline": attempt["pipeline"], "quality": attempt["quality"], "error": "", "seconds": 0.0, "blueprint": None, "waited_seconds": 0.0, "skipped": ""}
            out["attempts"].append(record)
            # a retry attempt runs only after the error it names (a retry built in runs 2 and 4 after a first attempt failed with it; why is not established); after any other outcome it is skipped
            wanted = attempt.get("retry_after")
            if wanted and wanted.lower() not in previous_error.lower():
                record["skipped"] = "retry only after '%s'; the previous attempt's error was %s" % (wanted, "'" + previous_error.strip().splitlines()[-1][:80] + "'" if previous_error.strip() else "none")
                note("build_meta_human attempt %d (%s) skipped: %s" % (number, attempt["pipeline"], record["skipped"]), True)
                continue
            if not subsystem.try_add_object_to_edit(character):
                record["error"] = "try_add_object_to_edit returned False"
                continue
            try:
                record["can_build"] = bool(subsystem.can_build_meta_human(character))
                params = unreal.MetaHumanCharacterEditorBuildParameters()
                params.pipeline_type = getattr(unreal.MetaHumanDefaultPipelineType, attempt["pipeline"])
                params.pipeline_quality = getattr(unreal.MetaHumanQualityLevel, attempt["quality"])
                params.absolute_build_path = build_path
                params.common_folder_path = build_path + "/Common"
                params.enable_wardrobe_item_validation = False
                note("build_meta_human attempt %d, %s/%s (blocking: the editor does not answer for minutes)" % (number, attempt["pipeline"], attempt["quality"]), True)
                record["seconds"], record["error"] = timed(lambda: subsystem.build_meta_human(character=character, params=params))
            finally:
                if subsystem.is_object_added_for_editing(character):
                    subsystem.remove_object_to_edit(character)
            write_report()
            previous_error = record["error"]
            if record["error"]:
                continue
            # the build may finish its asset work after the call returns: poll the registry on the tick
            waited = 0.0
            while waited <= float(plan.get("build_wait_seconds", 600)):
                blueprints = [p for p, c in list_assets(build_path) if c == "Blueprint"]
                if blueprints:
                    record["blueprint"] = sorted(blueprints)[0]
                    break
                if waited % 30 == 0:
                    note("waiting for the Blueprint of the %s build (%.0f of %.0f s)" % (attempt["pipeline"], waited, float(plan.get("build_wait_seconds", 600))), True)
                yield 5.0
                waited += 5.0
            record["waited_seconds"] = waited
            write_report()
            if record["blueprint"]:
                out["pipeline"], state["blueprint"] = attempt["pipeline"], record["blueprint"]
                break
        found = list_assets(build_path)
        by_class = {}
        for _, cls in found:
            by_class[cls] = by_class.get(cls, 0) + 1
        out["assets"] = {"total": len(found), "by_class": by_class, "sample": sorted(p for p, _ in found)[:40]}
        out["blueprint"] = state["blueprint"]
        write_report()

    def face_component(actor):
        comps = list(actor.get_components_by_class(unreal.SkeletalMeshComponent))
        for comp in comps:
            if comp.get_name().lower().startswith("face"):
                return comp
        for comp in comps:
            mesh = comp.get_skeletal_mesh_asset()
            if mesh is not None and "face" in mesh.get_name().lower():
                return comp
        return None

    def stage_level():
        out = stage("assemble")
        if not state["blueprint"]:
            out["errors"].append("no assembled Blueprint to spawn")
            return
        level = plan.get("level", "/Game/Maps/MhProbe")
        les.new_level(level)
        out["level"] = level
        blueprint_class = unreal.EditorAssetLibrary.load_blueprint_class(state["blueprint"])
        actor = eas.spawn_actor_from_class(blueprint_class, unreal.Vector(0, 0, 0), unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0))
        actor.set_actor_label("MhProbeActor")
        state["actor"] = actor
        comps = []
        for comp in actor.get_components_by_class(unreal.SkeletalMeshComponent):
            mesh = comp.get_skeletal_mesh_asset()
            comps.append({"name": comp.get_name(), "mesh": mesh.get_name() if mesh else None})
        face = face_component(actor)
        out["spawned"] = {"class": actor.get_class().get_name(), "components": comps, "face_component": face.get_name() if face else None}
        state["face_name"] = face.get_name() if face else None
        if face is None:
            out["errors"].append("no Face skeletal mesh component on the spawned actor")
            return
        # camera: in front of the head, along the actor's forward axis (flip with camera_flip in the plan), a wall behind it so exposure stays steady
        mesh = face.get_skeletal_mesh_asset()
        bounds = mesh.get_bounds()
        origin = face.get_world_transform().transform_location(bounds.origin)
        forward = actor.get_actor_forward_vector()
        sign = -1.0 if plan.get("camera_flip") else 1.0
        dist = float(plan.get("camera_distance", 80))
        cam_loc = unreal.Vector(origin.x + sign * forward.x * dist, origin.y + sign * forward.y * dist, origin.z + sign * forward.z * dist)
        cam_rot = unreal.MathLibrary.find_look_at_rotation(cam_loc, origin)
        camera = eas.spawn_actor_from_class(unreal.CameraActor, cam_loc, cam_rot)
        camera.set_actor_label("MhProbeCamera")
        camera.get_component_by_class(unreal.CameraComponent).set_field_of_view(float(plan.get("camera_fov", 45)))
        state["camera"] = camera
        light_rot = unreal.MathLibrary.find_look_at_rotation(unreal.Vector(cam_loc.x, cam_loc.y, cam_loc.z + 60), origin)
        sun = eas.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(0, 0, 400), light_rot)
        sun.set_actor_label("MhProbeSun")
        sky = eas.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0, 0, 300))
        sky.set_actor_label("MhProbeSky")
        wall = eas.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(origin.x - sign * forward.x * 60, origin.y - sign * forward.y * 60, origin.z))
        wall.set_actor_label("MhProbeWall")
        wall.static_mesh_component.set_static_mesh(unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cube"))
        wall.set_actor_scale3d(unreal.Vector(0.05, 6.0, 4.0))
        wall.set_actor_rotation(unreal.Rotator(roll=0.0, pitch=0.0, yaw=cam_rot.yaw), False)
        out["camera"] = {"location": [round(cam_loc.x, 1), round(cam_loc.y, 1), round(cam_loc.z, 1)], "target": [round(origin.x, 1), round(origin.y, 1), round(origin.z, 1)], "fov": plan.get("camera_fov", 45), "resolution": plan.get("resolution", [1280, 720])}
        les.save_current_level()
        write_report()

    # ---------- drive (animation sequences, made before Play-In-Editor)
    def stage_drive_prepare():
        out = stage("drive")
        out.setdefault("poses", [])
        out["route"] = None
        out["routes_not_run"] = ["arkit_pose_asset", "live_link_pose", "sequencer_control_rig", "morph_targets"]
        actor = state["actor"]
        face = face_component(actor) if actor else None
        if face is None:
            out["errors"].append("no spawned Face component to take the skeleton from: run the assemble group first")
            return
        skeleton = face.get_skeletal_mesh_asset().get_editor_property("skeleton")
        out["skeleton"] = skeleton.get_path_name() if skeleton else None
        for pose in plan.get("poses", []):
            record = {"name": pose["name"], "curves": pose["curves"], "frame": "mh_" + pose["name"], "created": False, "applied": False, "readback": {}, "error": ""}
            out["poses"].append(record)
            try:
                sequence, info = make_pose_sequence(skeleton, "AS_" + pose["name"], "/Game/MhProbe/Anim", pose["curves"])
                state["sequences"][pose["name"]] = sequence
                record["created"], record["sequence"] = True, info
            except Exception:
                record["error"] = tail()
        write_report()

    # ---------- Play-In-Editor session: control frame, assembled frame, one frame per pose
    def game_world():
        return ues.get_game_world()

    def shot_file(name):
        """The saved file of a frame: the engine may add a number to the name it was asked for, so mh_empty matches mh_empty.png and mh_empty00000.png, and not mh_empty_again.png."""
        pattern = re.compile(r"^%s\d*\.png$" % re.escape(name))
        for path in glob.glob(SAVED + "/Screenshots/**/*.png", recursive=True):
            try:
                if pattern.match(os.path.basename(path)) and os.path.getsize(path) > 0:
                    return path
            except OSError:
                pass
        return None

    def shoot(name):
        """A generator: take one frame and wait, bounded, for its file; returns True when the file exists. The call is recorded before it is made (it can tick Slate again from inside),
        take_high_res_screenshot is tried first (the viewport at the plan's resolution, as the Niagara and rendering probes do) and the Shot console command next (it saves the whole
        editor window), and the record says which method produced the file, how long it took and what else appeared under Saved/Screenshots."""
        width, height = plan.get("resolution", [1280, 720])
        limit = float(plan.get("shot_wait_seconds", 20))
        info = {"name": name, "method": "", "found": False, "file": None, "seconds": 0.0, "error": "", "tried": [], "recent_files": []}
        report["shots"].append(info)
        began = now()
        for old in glob.glob(SAVED + "/Screenshots/**/*.png", recursive=True):   # a file of an earlier run of this project must not stand in for this frame
            if re.match(r"^%s\d*\.png$" % re.escape(name), os.path.basename(old)):
                try:
                    os.remove(old)
                except OSError:
                    pass
        for method in ("take_high_res_screenshot", "Shot showui"):
            info["method"] = method
            info["tried"].append(method)
            note("frame %s with %s (up to %.0f s for the file)" % (name, method, limit), True)
            try:
                if method == "take_high_res_screenshot":
                    unreal.AutomationLibrary.take_high_res_screenshot(width, height, name + ".png")
                else:
                    unreal.SystemLibrary.execute_console_command(game_world(), "Shot showui filename=" + name)
            except Exception:
                info["error"] += method + ": " + tail(300) + " "
                continue
            waited = 0.0
            while waited < limit:
                yield 1.0
                waited += 1.0
                path = shot_file(name)
                if path:
                    info["found"], info["file"] = True, clean(path).replace(clean(SAVED), "<saved>")
                    break
            if info["found"]:
                break
        info["seconds"] = round(now() - began, 1)
        if not info["found"]:
            try:
                info["recent_files"] = sorted(os.path.relpath(p, SAVED).replace("\\", "/") for p in glob.glob(SAVED + "/Screenshots/**/*.png", recursive=True) if os.path.getmtime(p) >= time.time() - (now() - began) - 5)[:12]
            except Exception:
                pass
        write_report()
        return info["found"]

    def pie_actor(world, label):
        for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
            if actor.get_actor_label() == label:
                return actor
        return None

    def end_pie():
        if clock["pie"]:
            clock["pie"] = False
            try:
                les.editor_request_end_play()
            except Exception:
                report["errors"].append("end play: " + tail())

    def anim_state(face):
        """The animation mode and class of a component, read by their editor property names; an unreadable one is recorded as the error text."""
        state_now = {}
        for prop in ("animation_mode", "anim_class"):
            try:
                value = face.get_editor_property(prop)
                state_now[prop] = None if value is None else str(value)
            except Exception as exc:
                state_now[prop] = "unreadable: " + clean(exc)[:120]
        return state_now

    def capture_body():
        want_assemble = "assemble" in stages
        want_drive = "drive" in stages
        out_a, out_d = stage("assemble"), stage("drive")
        where = "assemble" if want_assemble else "drive"
        if state["actor"] is None:
            stage_error(where, "capture skipped: no spawned actor")
            return
        budget = float(plan.get("capture_budget_seconds", 600))
        deadline = now() + budget

        def late(step):
            if now() <= deadline:
                return False
            stage_error(where, "the capture budget of %.0f s ran out before %s" % (budget, step))
            return True

        pie_limit = float(plan.get("pie_wait_seconds", 120))
        pie_began = now()
        les.editor_request_begin_play()
        clock["pie"] = True
        note("Play-In-Editor requested (up to %.0f s to start)" % pie_limit, True)
        while game_world() is None and now() - pie_began < pie_limit:
            yield 2.0
        world = game_world()
        if world is None:
            stage_error(where, "Play-In-Editor did not start within %.0f s" % pie_limit)
            return
        note("Play-In-Editor world is up after %.0f s" % (now() - pie_began), True)
        yield from pause(float(plan.get("shader_wait_seconds", 90)), "shaders to compile before the first frame")
        if late("the first frame"):
            return
        actor, camera = pie_actor(world, "MhProbeActor"), pie_actor(world, "MhProbeCamera")
        if actor is None or camera is None:
            stage_error(where, "the Play-In-Editor world lacks the actor or the camera")
            return
        unreal.GameplayStatics.get_player_controller(world, 0).set_view_target_with_blend(camera)
        yield from pause(3.0, "the camera to take over")
        if want_assemble:
            actor.set_actor_hidden_in_game(True)
            yield from pause(2.0, "the hidden-actor frame to settle")
            empty = yield from shoot("mh_empty")
            actor.set_actor_hidden_in_game(False)
            yield from pause(3.0, "the shown-actor frame to settle")
            shown = yield from shoot("mh_assembled")
            out_a["frames"] = {"control": "mh_empty", "assembled": "mh_assembled"}
            for name, ok in (("mh_empty", empty), ("mh_assembled", shown)):
                if not ok:
                    stage_error("assemble", "frame %s was not saved within %.0f s with either method (see shots in the report)" % (name, float(plan.get("shot_wait_seconds", 20))))
            write_report()
        if want_drive:
            face = None
            for comp in actor.get_components_by_class(unreal.SkeletalMeshComponent):
                if comp.get_name() == state["face_name"]:
                    face = comp
            if face is None:
                stage_error("drive", "no Face component on the Play-In-Editor actor")
            else:
                out_d["face_anim"] = {"members": sorted(n for n in dir(face) if not n.startswith("_") and re.search(r"anim|curve|morph|post_process", n))[:80], "before": anim_state(face)}
            order = [p["name"] for p in plan.get("poses", [])]
            records = {p["name"]: p for p in out_d.get("poses", [])}
            sequence_order = order + ["neutral"]   # the neutral pose once more: the noise control
            for index, pose_name in enumerate(sequence_order):
                record = records.get(pose_name)
                again = index >= len(order)
                if record is None or face is None or pose_name not in state["sequences"]:
                    continue
                if late("pose " + pose_name):
                    break
                shot = "mh_neutral_again" if again else record["frame"]
                note("pose %s: play_animation on %s" % (pose_name, state["face_name"]), True)
                try:
                    face.play_animation(state["sequences"][pose_name], True)
                    record["applied"] = True
                except Exception:
                    record["error"] = tail()
                    write_report()
                    continue
                if "after" not in out_d["face_anim"]:
                    out_d["face_anim"]["after"] = anim_state(face)
                yield from pause(3.0, "pose %s to evaluate" % pose_name)
                try:
                    for curve in record["curves"]:
                        value = face.get_curve_value(curve, -1.0)
                        if isinstance(value, tuple):
                            value = value[-1]
                        record["readback"][curve] = None if value is None else round(float(value), 4)
                except Exception:
                    record["readback_error"] = tail(400)
                saved = yield from shoot(shot)
                if not saved:
                    record["shot_error"] = "frame %s was not saved within %.0f s with either method" % (shot, float(plan.get("shot_wait_seconds", 20)))
                if again:
                    out_d["control_frame"] = shot
                yield from pause(2.0, "pose %s to finish" % pose_name)
                write_report()
            applied = [p for p in out_d.get("poses", []) if p["applied"] and not p["error"]]
            if len(applied) == len(order) and order:
                out_d["route"] = "anim_sequence_curves"
            write_report()

    def stage_capture():
        try:
            yield from capture_body()
        finally:
            end_pie()
        yield from pause(3.0, "Play-In-Editor to end")

    def flow():
        yield 0.0
        for name in stages:
            if name in ("create", "repeat"):
                try:
                    stage_create(name)
                except Exception:
                    stage(name)["errors"].append(tail())
                    report["errors"].append(name + ": " + tail())
                write_report()
        if "assemble" in stages or "drive" in stages:
            try:
                if "assemble" in stages:
                    yield from stage_assemble_build()
                else:
                    blueprints = [p for p, c in list_assets(plan.get("build_path", "/Game/MetaHumans")) if c == "Blueprint"]
                    state["blueprint"] = sorted(blueprints)[0] if blueprints else None
                stage_level()
                if "drive" in stages:
                    stage_drive_prepare()
                yield from stage_capture()
            except Exception:
                report["errors"].append("assemble/drive: " + tail())
                write_report()

    def finish(reason="completed"):
        if clock["finished"]:
            return
        clock["finished"] = True
        report["done"] = True
        report["end_reason"] = reason
        report["progress"] = "finished (%s)" % reason
        write_report()
        if clock["handle"] is not None:
            unreal.unregister_slate_post_tick_callback(clock["handle"])
            clock["handle"] = None
        unreal.log("[mh_probe] launch %d finished (%s), wrote %s" % (launch, reason, clean(report_path)))
        unreal.EditorPythonScripting.set_keep_python_script_alive(False)
        try:
            unreal.SystemLibrary.quit_editor()
        except Exception:
            unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")

    def expire():
        """The launch budget ran out while the flow was waiting: record where, close the flow (its finally blocks end Play-In-Editor), write the final report and quit."""
        where = report["progress"]
        report["errors"].append("the launch budget of %.0f s ran out; the flow was at: %s" % (launch_budget, where))
        if clock["gen"] is not None:
            try:
                clock["gen"].close()
            except Exception:
                report["errors"].append("closing the flow: " + tail())
        end_pie()
        finish("launch budget exceeded")

    def tick(delta_seconds):
        # A blocking cloud request ticks Slate while the flow is inside it, which re-enters this callback:
        # without the guard the second entry raises "generator already executing" and ends the launch.
        if clock.get("busy"):
            return
        if clock["finished"]:
            return
        clock["t"] += delta_seconds
        clock["wait"] -= delta_seconds
        if launch_budget and now() > launch_budget:
            clock["busy"] = True
            try:
                expire()
            finally:
                clock["busy"] = False
            return
        if clock["wait"] > 0:
            return
        clock["busy"] = True
        try:
            if clock["gen"] is None:
                clock["gen"] = flow()
            clock["wait"] = float(next(clock["gen"]))
        except StopIteration:
            finish("completed")
        except Exception:
            report["errors"].append(tail())
            end_pie()
            finish("exception")
        finally:
            clock["busy"] = False

    unreal.EditorPythonScripting.set_keep_python_script_alive(True)
    clock["handle"] = unreal.register_slate_post_tick_callback(tick)
    unreal.log("[mh_probe] launch %d (%s) starts in %.0f s" % (launch, ", ".join(stages), clock["wait"]))


def main():
    if MODE == "names":
        report = run_names()
        path = os.environ.get("MH_REPORT") or (SAVED + "/mh-names.json")
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w") as fh:
            json.dump(report, fh, indent=2, default=str)
        unreal.log("[mh_probe] names report written to " + clean(path))
    else:
        run_flow()


try:
    main()
except Exception:
    text = tail(2000)
    path = os.environ.get("MH_REPORT") or (SAVED + "/mh-startup-error.json")
    try:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path + ".error.txt", "w") as fh:
            fh.write(text)
        if MODE != "names":
            # a start-up failure still leaves a final report, so the runner judges it at once instead of waiting for its timeout
            with open(path, "w") as fh:
                json.dump({"done": True, "end_reason": "start-up failure", "errors": [text], "stages": {}, "progress": "start-up failure", "trace": [], "shots": []}, fh, indent=2)
    except Exception:
        pass
    unreal.log_error("[mh_probe] failed: " + tail(500))
    if MODE != "names":
        try:
            unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")
        except Exception:
            pass
