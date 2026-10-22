"""Fly a camera tour through the Niagara showcase level and keep it playing. It does not quit.

  In the editor (starts Play-In-Editor itself):
    UnrealEditor.exe Project.uproject /Game/Maps/NiagaraShowcase -ExecCmds="py <absolute-path-to-this-file>" -log=showcase.log
  As a standalone game (set NIAGARA_SHOWCASE_GAME=1; a game process has no editor, so any EditorLevelLibrary call would crash it):
    UnrealEditor.exe Project.uproject /Game/Maps/NiagaraShowcase -game -windowed -ResX=1600 -ResY=900 -ExecCmds="py <path>"
(in Git Bash set MSYS_NO_PATHCONV=1, or /Game/... is rewritten into a Windows path). Build the level first with showcase_build.py.

The tour visits each station in turn: the camera glides to it, drifts around it, and moves on. A station is switched on a few seconds
before the camera arrives (the fluids need time to develop) and off after it leaves, so about two systems run at once; stations that
restart (explosion, splash, burst) are reactivated on their own timer. Tuning, all optional environment variables:
  NIAGARA_SHOWCASE_HOLD (seconds at a station, default 12), NIAGARA_SHOWCASE_TRANSIT (default 4),
  NIAGARA_SHOWCASE_SHOTS=1 (editor only: one screenshot per station near the end of its hold, station_NN.png under Saved/Screenshots).
"""
import math
import os

import unreal

HOLD = float(os.environ.get("NIAGARA_SHOWCASE_HOLD", "12"))
TRANSIT = float(os.environ.get("NIAGARA_SHOWCASE_TRANSIT", "4"))
SHOTS = os.environ.get("NIAGARA_SHOWCASE_SHOTS") == "1"
FIRST = int(os.environ.get("NIAGARA_SHOWCASE_FIRST", "1")) - 1   # 1-based station to start from
COUNT = int(os.environ.get("NIAGARA_SHOWCASE_COUNT", "0"))       # 0 = every station; otherwise stop after this many
GAME = os.environ.get("NIAGARA_SHOWCASE_GAME") == "1"
DISTANCE = float(os.environ.get("NIAGARA_SHOWCASE_DISTANCE", "700"))   # camera distance from a station, toward the ring's centre
SHOT_AT = [float(x) for x in os.environ.get("NIAGARA_SHOWCASE_SHOT_AT", "0.8").split(",")]   # fractions of the hold
DIAG = os.environ.get("NIAGARA_SHOWCASE_DIAG") == "1"
HEIGHT = 260.0
LOOK_Z = 170.0

state = {"t": 0.0, "pie": False, "ready": False, "stage": -1, "stage_t": 0.0, "phase": "transit", "next_on": False,
         "since_replay": 0.0, "shots_taken": 0, "diag": None, "cam_pos": None, "look": None}
cache = {}


def world():
    if GAME:
        for w in unreal.ObjectIterator(unreal.World):
            if w.get_name() != "Default__World":
                return w
        return None
    fn = getattr(unreal.EditorLevelLibrary, "get_game_world", None)
    try:
        return fn() if fn else None
    except Exception:
        return None


def stations(w):
    if "stations" not in cache:
        actors = [a for a in unreal.GameplayStatics.get_all_actors_of_class(w, unreal.NiagaraActor) if a.get_actor_label().startswith("Station_")]
        actors.sort(key=lambda a: a.get_actor_label())
        if COUNT:
            actors = (actors[FIRST:] + actors[:FIRST])[:COUNT]
        else:
            actors = actors[FIRST:] + actors[:FIRST]
        cache["stations"] = actors
    return cache["stations"]


def comp(actor):
    return actor.get_editor_property("niagara_component")


def tidy(actor):
    """Fluid templates draw their grid bounds through the User.DrawBounds variable; switch it off. Systems without it ignore the call."""
    try:
        comp(actor).set_variable_bool(unreal.Name("User.DrawBounds"), False)
    except Exception:
        pass


def replay_seconds(actor):
    for tag in actor.get_editor_property("tags"):
        text = str(tag)
        if text.startswith("replay_"):
            return float(text.split("_")[1])
    return 0.0


def vec(x, y, z):
    return unreal.Vector(x, y, z)


def lerp_vec(a, b, k):
    return vec(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k)


def target_pose(actor, stage_t):
    s = actor.get_actor_location()
    radius = math.hypot(s.x, s.y)
    ux, uy = s.x / radius, s.y / radius                      # outward from the ring's centre
    drift = math.radians(16.0) * math.sin(stage_t * 0.35)    # slow arc around the station
    cx = ux * math.cos(drift) - uy * math.sin(drift)
    cy = ux * math.sin(drift) + uy * math.cos(drift)
    cam = vec(s.x - cx * DISTANCE, s.y - cy * DISTANCE, HEIGHT + 40.0 * math.sin(stage_t * 0.5))
    return cam, vec(s.x, s.y, LOOK_Z)


def setup(w):
    for pawn in unreal.GameplayStatics.get_all_actors_of_class(w, unreal.DefaultPawn):
        pawn.set_actor_hidden_in_game(True)
    cameras = unreal.GameplayStatics.get_all_actors_of_class(w, unreal.CameraActor)
    controller = unreal.GameplayStatics.get_player_controller(w, 0)
    if cameras and controller:
        cache["camera"] = cameras[0]
        controller.set_view_target_with_blend(cameras[0], 0.0)
    for actor in stations(w):
        comp(actor).deactivate()
    state["ready"] = True


def announce(w, text):
    unreal.SystemLibrary.print_string(w, text, True, False, unreal.LinearColor(1, 1, 1, 1), TRANSIT + HOLD)


def advance(w):
    actors = stations(w)
    if not actors:
        return
    state["stage"] = (state["stage"] + 1) % len(actors)
    state["stage_t"], state["phase"], state["next_on"], state["shots_taken"], state["since_replay"] = 0.0, "transit", False, 0, 0.0
    current = actors[state["stage"]]
    comp(current).activate(True)
    tidy(current)
    announce(w, current.get_actor_label().split("_", 2)[2].upper())
    unreal.log("[showcase_run] stage %d %s activated, active=%s" % (state["stage"], current.get_actor_label(), comp(current).is_active()))
    if state["cam_pos"] is None:
        state["cam_pos"], state["look"] = target_pose(current, 0.0)


def update(w, dt):
    actors = stations(w)
    state["stage_t"] += dt
    stage = state["stage"]
    current = actors[stage]
    cam_goal, look_goal = target_pose(current, state["stage_t"])
    k = 1.0 - math.exp(-dt * (1.4 if state["phase"] == "transit" else 3.0))
    state["cam_pos"] = lerp_vec(state["cam_pos"], cam_goal, k)
    state["look"] = lerp_vec(state["look"], look_goal, 1.0 - math.exp(-dt * 2.5))
    rot = unreal.MathLibrary.find_look_at_rotation(state["cam_pos"], state["look"])
    cache["camera"].set_actor_location_and_rotation(state["cam_pos"], rot, False, False)

    if state["phase"] == "transit" and state["stage_t"] >= TRANSIT:
        state["phase"], state["stage_t"] = "hold", 0.0
        previous = actors[(stage - 1) % len(actors)]
        if previous is not current:
            comp(previous).deactivate()
    if state["phase"] == "hold":
        if not state["next_on"] and state["stage_t"] >= HOLD * 0.35:
            state["next_on"] = True
            nxt = actors[(stage + 1) % len(actors)]
            if replay_seconds(nxt) == 0.0:
                comp(nxt).activate(True)               # lets a fluid develop before the camera arrives
                tidy(nxt)
        every = replay_seconds(current)
        state["since_replay"] += dt
        if every > 0.0 and state["since_replay"] >= every:
            state["since_replay"] = 0.0
            comp(current).activate(True)
            tidy(current)
        if SHOTS and state["shots_taken"] < len(SHOT_AT) and state["stage_t"] >= HOLD * SHOT_AT[state["shots_taken"]]:
            state["shots_taken"] += 1
            unreal.log("[showcase_run] shot %d: %s active=%s" % (stage + 1, current.get_actor_label(), comp(current).is_active()))
            unreal.AutomationLibrary.take_high_res_screenshot(1600, 900, "station_%02d_%d.png" % (stage + 1, state["shots_taken"]))
        if state["stage_t"] >= HOLD:
            advance(w)


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
    if state["t"] - state["pie_t"] < 2.0:
        return
    w = world()
    if w is None:
        return
    if not state["ready"]:
        setup(w)
        advance(w)
        return
    update(w, dt)


def start_diag():
    """Ask Epic's toolsets for compile state and stack issues of the authored system and log them (async: polled from the tick)."""
    import json
    registry = unreal.ToolsetRegistry
    arg = json.dumps({"system": {"refPath": "/Game/FX/NS_ShowcaseVortex.NS_ShowcaseVortex"}})
    tool = "NiagaraToolsets.NiagaraToolset_System"
    state["diag"] = {"compile": registry.execute_tool(tool, "GetSystemCompileState", arg), "issues": registry.execute_tool(tool, "GetStackIssues", arg)}


def poll_diag():
    for name, result in list(state["diag"].items()):
        if result is not None and result.is_complete:
            unreal.log("[showcase_run] diag %s: %s" % (name, str(result.get_editor_property("value"))[:1800] or str(result.get_editor_property("error"))))
            state["diag"][name] = None


def tick(dt):
    if state.get("busy"):
        return   # activating a system blocks on its compile and Slate keeps ticking meanwhile, which re-enters this callback
    state["busy"] = True
    try:
        if DIAG and state["diag"] is None and state["t"] > 1.0:
            start_diag()
        if state["diag"]:
            poll_diag()
        step(dt)
    except Exception as exc:  # a raising tick callback repeats every frame
        if not state.get("failed"):
            state["failed"] = True
            unreal.log_error("[showcase_run] " + repr(exc))
    finally:
        state["busy"] = False


unreal.register_slate_post_tick_callback(tick)
unreal.log("[showcase_run] tick callback registered")
