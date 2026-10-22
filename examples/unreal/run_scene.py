"""Run the sample scene with the real renderer, sample state, take a screenshot and quit.

  UnrealEditor.exe SampleScene.uproject /Game/Maps/SampleScene -RenderOffScreen -ExecCmds="py <absolute-path-to-this-file>"
      -log=run.log -notraceserver   (in Git Bash set MSYS_NO_PATHCONV=1 or /Game/... is rewritten)
Writes unreal/report-run.json. It claims only what it measures: actor counts, whether the music component
reports playing, whether the courier flipbook position and the fox animation position advance, and a screenshot path.
The callback must keep the editor alive. Do not use -ExecutePythonScript: that mode exits when the script ends.
"""
import json
import os
import time

import unreal

ROOT = os.environ.get("AGENT_ENGINE_SCENES")
if not ROOT:
    raise RuntimeError("set AGENT_ENGINE_SCENES to the scenes workspace folder (it holds assets/ and unreal/)")
REPORT = ROOT.replace("\\", "/").rstrip("/") + "/unreal/report-run.json"
SETTLE_SECONDS = 20.0   # let shaders compile and the first frames render before sampling
SAMPLE_GAP = 2.0
state = {"t": 0.0, "samples": [], "shot_requested": False, "done": False, "start": time.time()}


def world():
    for getter in ("get_game_world", "get_editor_world"):
        fn = getattr(unreal.EditorLevelLibrary, getter, None)
        if fn:
            try:
                w = fn()
                if w:
                    return w
            except Exception:
                pass
    return None


def sample():
    w = world()
    out = {"t": round(state["t"], 2), "world": str(w)}
    if w is None:
        return out
    gp = unreal.GameplayStatics
    flip = gp.get_all_actors_of_class(w, unreal.PaperFlipbookActor)
    out["flipbooks"] = []
    for fa in flip:
        rc = fa.get_editor_property("render_component")
        out["flipbooks"].append({"label": fa.get_actor_label(), "playing": rc.is_playing(), "pos_frames": rc.get_playback_position_in_frames(),
                                 "length_frames": rc.get_flipbook_length_in_frames(), "fps": rc.get_flipbook_framerate()})
    skel = gp.get_all_actors_of_class(w, unreal.SkeletalMeshActor)
    if skel:
        comp = skel[0].skeletal_mesh_component
        out["fox"] = {"anim_position": comp.get_editor_property("global_anim_rate") if False else None}
        try:
            out["fox"]["playing"] = comp.is_playing()
            out["fox"]["position"] = comp.get_position()
        except Exception as exc:
            out["fox"]["error"] = str(exc)
    amb = gp.get_all_actors_of_class(w, unreal.AmbientSound)
    out["ambient"] = []
    for a in amb:
        ac = a.get_editor_property("audio_component")
        snd = ac.get_editor_property("sound")
        out["ambient"].append({"label": a.get_actor_label(), "sound": snd.get_name() if snd else None, "playing": ac.is_playing()})
    actors = gp.get_all_actors_of_class(w, unreal.Actor)
    out["actors"] = len(actors)
    layout = []
    for act in actors:
        try:
            origin, extent = act.get_actor_bounds(False)
            loc = act.get_actor_location()
            layout.append({"label": act.get_actor_label(), "class": act.get_class().get_name(),
                           "loc": [round(loc.x), round(loc.y), round(loc.z)],
                           "extent": [round(extent.x), round(extent.y), round(extent.z)]})
        except Exception as exc:
            layout.append({"label": str(act), "error": str(exc)})
    out["layout"] = layout
    return out


def finish():
    state["done"] = True
    report = {"engine": unreal.SystemLibrary.get_engine_version(), "wall_seconds": round(time.time() - state["start"], 1),
              "samples": state["samples"], "screenshot_requested": state["shot_requested"]}
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=2, default=str)
    unreal.log("[run] report written")
    unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")


def tick(dt):
    if state["done"]:
        return
    state["t"] += dt
    # The ExecCmds callback runs in the editor; start Play-In-Editor after the map loads.
    if not state.get("pie"):
        if state["t"] > 5.0:
            unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_begin_play()
            state["pie"] = True
            state["pie_t"] = state["t"]
            unreal.log("[run] requested Play-In-Editor")
        return
    rel = state["t"] - state["pie_t"]
    if not state.get("pawn_hidden") and rel > 2.0:
        # the GameMode spawns a DefaultPawn whose visible sphere sits at the origin
        w = world()
        if w:
            for pawn in unreal.GameplayStatics.get_all_actors_of_class(w, unreal.DefaultPawn):
                pawn.set_actor_hidden_in_game(True)
            state["pawn_hidden"] = True
    n = len(state["samples"])
    if rel >= SETTLE_SECONDS + n * SAMPLE_GAP and n < 3:
        s = sample()
        s["t"] = round(rel, 2)
        state["samples"].append(s)
        unreal.log("[run] sample %d at t=%.1f" % (n, rel))
        if n == 1 and not state["shot_requested"]:
            state["shot_requested"] = True
            try:
                unreal.AutomationLibrary.take_high_res_screenshot(1280, 720, "agent_engine_sample_scene.png")
                unreal.log("[run] screenshot requested")
            except Exception as exc:
                unreal.log_error("[run] screenshot failed: " + str(exc))
    elif n >= 3 and rel >= SETTLE_SECONDS + 3 * SAMPLE_GAP + 3.0:
        finish()


unreal.register_slate_post_tick_callback(tick)
unreal.log("[run] tick callback registered")
