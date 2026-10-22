"""Open the Niagara probe level in a window and keep it playing so a person can look at it. It does not quit.

  As a standalone game (no editor UI). Set NIAGARA_VIEW_GAME=1: in a game process there is no editor, and any EditorLevelLibrary
  call (such as get_game_world) crashes it with an access violation, so this mode finds the world with ObjectIterator instead:
    UnrealEditor.exe Project.uproject /Game/Maps/NiagaraProbe -game -windowed -ResX=1280 -ResY=720 -ExecCmds="py <absolute-path-to-this-file>" -log=niagara-view.log
  In the editor (the script starts Play-In-Editor itself):
    UnrealEditor.exe Project.uproject /Game/Maps/NiagaraProbe -ExecCmds="py <absolute-path-to-this-file>" -log=niagara-view.log
(in Git Bash set MSYS_NO_PATHCONV=1, or /Game/... is rewritten into a Windows path). Build the level first with niagara_build.py and,
for the authored system, niagara_toolset_author.py. Close the window to stop (Alt+F4 in game mode). Set NIAGARA_VIEW_SHOT to a PNG name to also request one
high-resolution screenshot a few seconds after play starts (it lands under Saved/Screenshots).

Play-In-Editor starts after the map loads. The script then makes the level's ViewCamera (placed by niagara_build.py) the view, labels each system, hides the default pawn, and
restarts any system whose one-shot burst has finished (a burst is inactive a few seconds after play starts) every REPLAY_SECONDS.
Left to right: the stateful template (three burst emitters), the stateless fountain (loops), and the system authored through Epic's
toolsets (a ribbon, a burst and the added emitter).
"""
import os

import unreal

REPLAY_SECONDS = 4.0
GAME = os.environ.get("NIAGARA_VIEW_GAME") == "1"
state = {"t": 0.0, "pie": False, "setup": False, "since_replay": 0.0, "shot": False}


def game_world():
    if GAME:
        # No editor in a game process: pick the loaded map's world (not the class default object) by iterating worlds.
        for w in unreal.ObjectIterator(unreal.World):
            if w.get_name() != "Default__World":
                return w
        return None
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


def niagara_actors(world):
    return list(unreal.GameplayStatics.get_all_actors_of_class(world, unreal.NiagaraActor))


def setup(world):
    for pawn in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.DefaultPawn):
        pawn.set_actor_hidden_in_game(True)
    cameras = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.CameraActor)
    controller = unreal.GameplayStatics.get_player_controller(world, 0)
    if cameras and controller:
        controller.set_view_target_with_blend(cameras[0], 0.0)


def draw_labels(world):
    for actor in niagara_actors(world):
        loc = actor.get_actor_location() + unreal.Vector(0, 0, -60)
        unreal.SystemLibrary.draw_debug_string(world, loc, actor.get_actor_label(), None, unreal.LinearColor(1, 1, 1, 1), 0.0)


def replay(world):
    for actor in niagara_actors(world):
        comp = actor.get_editor_property("niagara_component")
        if not comp.is_active():
            comp.activate(True)


def tick(dt):
    try:
        step(dt)
    except Exception as exc:  # never raise from a tick callback: it repeats every frame
        if not state.get("failed"):
            state["failed"] = True
            unreal.log_error("[niagara_view] " + repr(exc))


def step(dt):
    state["t"] += dt
    if GAME and not state["pie"]:
        state["pie"], state["pie_t"] = True, state["t"]
        return
    if not state["pie"]:
        if state["t"] > 5.0:
            unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_begin_play()
            state["pie"], state["pie_t"] = True, state["t"]
        return
    rel = state["t"] - state["pie_t"]
    world = game_world()
    if world is None or rel < 2.0:
        return
    if not state["setup"]:
        setup(world)
        state["setup"] = True
    draw_labels(world)
    state["since_replay"] += dt
    if state["since_replay"] >= REPLAY_SECONDS:
        state["since_replay"] = 0.0
        replay(world)
    shot = os.environ.get("NIAGARA_VIEW_SHOT")
    if shot and not state["shot"] and rel > 8.0:
        state["shot"] = True
        unreal.AutomationLibrary.take_high_res_screenshot(1280, 720, shot)


unreal.register_slate_post_tick_callback(tick)
unreal.log("[niagara_view] tick callback registered")
