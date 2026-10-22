"""Explore the Niagara showcase level yourself: fly a free camera with a keyboard and mouse or a gamepad.

  As a standalone game (set NIAGARA_SHOWCASE_GAME=1; a game process has no editor, so any EditorLevelLibrary call would crash it):
    UnrealEditor.exe Project.uproject /Game/Maps/NiagaraShowcase -game -windowed -ResX=1600 -ResY=900 -ExecCmds="py <absolute-path-to-this-file>"
  In the editor (starts Play-In-Editor itself; click the viewport so it has focus):
    UnrealEditor.exe Project.uproject /Game/Maps/NiagaraShowcase -ExecCmds="py <absolute-path-to-this-file>"
(in Git Bash set MSYS_NO_PATHCONV=1, or /Game/... is rewritten into a Windows path). Build the level first with showcase_build.py.

Controls (the on-screen help line repeats them; H or Y hides it):
  move        W A S D                  left stick
  look        mouse, arrow keys        right stick
  up / down   Space / C                right trigger / left trigger
  boost       hold Shift               hold B or press the left stick in
  station     Q previous, E next, 1-8  left bumper previous, right bumper next
  restart     F (the nearest station)  A
  quit        Esc

A station switches on when you come within ACTIVATE_RADIUS of it and off again beyond RELEASE_RADIUS, with at most MAX_ACTIVE running at
once (the fluids are heavy), so walk up to the ones you want to see. Stations that restart (explosion, burst) replay on their own timer
while you are near. The first time a system switches on, the editor compiles it and the window freezes for a moment, up to about a minute
for the fluids; the result is cached.

Self-test, no input device needed: NIAGARA_SHOWCASE_SELFTEST=1 drives the camera with scripted input, glides to every station, checks the
switching rules and logs "[showcase_explore] selftest PASS" or "FAIL ..."; in a game process it then quits. NIAGARA_SHOWCASE_SHOTS=1 (editor
only) also saves one screenshot per station under Saved/Screenshots after NIAGARA_SHOWCASE_SETTLE seconds (default 4; an offscreen
editor runs a few frames per second, so the fluids need about 12).
"""
import math
import os

import unreal

GAME = os.environ.get("NIAGARA_SHOWCASE_GAME") == "1"
SELFTEST = os.environ.get("NIAGARA_SHOWCASE_SELFTEST") == "1"
SHOTS = os.environ.get("NIAGARA_SHOWCASE_SHOTS") == "1"
SETTLE = float(os.environ.get("NIAGARA_SHOWCASE_SETTLE") or ("4" if SHOTS else "0.3"))   # self-test seconds at a station before it is checked

SPEED = 700.0              # cm/s at full stick
BOOST = 3.0
STICK_LOOK = 110.0         # degrees/s at full stick
MOUSE_LOOK = 0.09          # degrees per mouse count
DEADZONE = 0.18
ACTIVATE_RADIUS = 1000.0   # a station switches on inside this distance (ground plane)
RELEASE_RADIUS = 1300.0    # and off again beyond this one
MAX_ACTIVE = 3
DISTANCE = 700.0           # where "go to station" parks the camera, toward the ring's centre
HEIGHT = 260.0
LOOK_Z = 280.0
GLIDE_RATE = 3.0

HELP = ("Move WASD / left stick   Look mouse / right stick   Up Space RT   Down C LT   Boost Shift / B   "
        "Stations Q E 1-8 / LB RB   Restart F / A   Help H / Y   Quit Esc")

state = {"t": 0.0, "pie": False, "pie_t": 0.0, "ready": False, "cam": None, "goal": None, "active": set(), "since": {},
         "down": {}, "help": True, "hud_t": 0.0, "failed": False, "busy": False}
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


def station_name(actor):
    return actor.get_actor_label().split("_", 2)[2]


# ---- input: devices become one plain snapshot, so the same motion code runs from a device or from the self-test ----

def key(name):
    """An unreal.Key from its engine name. A bare name through import_text works in a game process, where set_editor_property('key_name') does not."""
    if name not in cache:
        k = unreal.Key()
        k.import_text(name)
        if not unreal.InputLibrary.key_is_valid(k):
            raise ValueError("not an engine key name: " + name)
        cache[name] = k
    return cache[name]


def shape(value):
    """Dead zone, then a gentle curve so small stick movements stay fine."""
    magnitude = abs(value)
    if magnitude < DEADZONE:
        return 0.0
    return math.copysign(((magnitude - DEADZONE) / (1.0 - DEADZONE)) ** 1.5, value)


def clamp1(value):
    return max(-1.0, min(1.0, value))


def read_input(pc):
    def held(*names):
        return any(pc.is_input_key_down(key(n)) for n in names)

    def axis(name):
        return pc.get_input_analog_key_state(key(name))

    def pressed(*names):
        now = held(*names)
        before = state["down"].get(names[0], False)
        state["down"][names[0]] = now
        return now and not before

    mouse_x, mouse_y = pc.get_input_mouse_delta()
    digits = ("One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight")
    jumps = [i for i, name in enumerate(digits) if pressed(name)]
    return {
        "forward": clamp1(shape(axis("Gamepad_LeftY")) + held("W") - held("S")),
        "right": clamp1(shape(axis("Gamepad_LeftX")) + held("D") - held("A")),
        "rise": clamp1(shape(axis("Gamepad_RightTriggerAxis")) - shape(axis("Gamepad_LeftTriggerAxis")) + held("SpaceBar") - held("C", "LeftControl")),
        "yaw": clamp1(shape(axis("Gamepad_RightX")) + held("Right") - held("Left")),
        "pitch": clamp1(shape(axis("Gamepad_RightY")) + held("Up") - held("Down")),
        "mouse": (mouse_x, mouse_y),
        "boost": held("LeftShift", "Gamepad_FaceButton_Right", "Gamepad_LeftThumbstick"),
        "next": pressed("E", "Gamepad_RightShoulder"),
        "prev": pressed("Q", "Gamepad_LeftShoulder"),
        "restart": pressed("F", "Gamepad_FaceButton_Bottom"),
        "help": pressed("H", "Gamepad_FaceButton_Top"),
        "quit": held("Escape"),
        "jump": jumps[0] if jumps else None,
    }


def idle():
    return {"forward": 0.0, "right": 0.0, "rise": 0.0, "yaw": 0.0, "pitch": 0.0, "mouse": (0.0, 0.0), "boost": False, "next": False,
            "prev": False, "restart": False, "help": False, "quit": False, "jump": None}


# ---- motion: plain numbers in, plain numbers out ----

def station_pose(location, centre=(0.0, 0.0)):
    """Camera pose (x, y, z, yaw, pitch) in front of a station, looking at it from the centre of all stations."""
    ox, oy = location.x - centre[0], location.y - centre[1]
    radius = math.hypot(ox, oy)
    if radius < 1.0:   # a single station at the centre: look at it along +X
        ux, uy, park = 1.0, 0.0, DISTANCE
    else:
        ux, uy = ox / radius, oy / radius
        park = min(DISTANCE, 0.6 * radius)   # stay nearer to this station than to the others
    x, y = location.x - ux * park, location.y - uy * park
    dx, dy, dz = location.x - x, location.y - y, LOOK_Z - HEIGHT
    return {"x": x, "y": y, "z": HEIGHT, "yaw": math.degrees(math.atan2(dy, dx)), "pitch": math.degrees(math.atan2(dz, math.hypot(dx, dy)))}


def wrap(angle):
    return (angle + 180.0) % 360.0 - 180.0


def fly(cam, goal, inp, dt):
    """Advance the camera by one frame. Returns the glide goal that is still active (any movement or look input cancels a glide)."""
    steering = any(abs(inp[k]) > 0.0 for k in ("forward", "right", "rise", "yaw", "pitch")) or inp["mouse"] != (0.0, 0.0)
    if steering:
        goal = None
    cam["yaw"] = wrap(cam["yaw"] + inp["yaw"] * STICK_LOOK * dt + inp["mouse"][0] * MOUSE_LOOK)
    cam["pitch"] = max(-85.0, min(85.0, cam["pitch"] + inp["pitch"] * STICK_LOOK * dt + inp["mouse"][1] * MOUSE_LOOK))
    yaw, pitch = math.radians(cam["yaw"]), math.radians(cam["pitch"])
    forward = (math.cos(pitch) * math.cos(yaw), math.cos(pitch) * math.sin(yaw), math.sin(pitch))
    right = (-math.sin(yaw), math.cos(yaw), 0.0)
    speed = SPEED * (BOOST if inp["boost"] else 1.0) * dt
    cam["x"] += (forward[0] * inp["forward"] + right[0] * inp["right"]) * speed
    cam["y"] += (forward[1] * inp["forward"] + right[1] * inp["right"]) * speed
    cam["z"] = max(40.0, cam["z"] + (forward[2] * inp["forward"] + inp["rise"]) * speed)
    if goal is not None:
        k = 1.0 - math.exp(-dt * GLIDE_RATE)
        for name in ("x", "y", "z", "pitch"):
            cam[name] += (goal[name] - cam[name]) * k
        cam["yaw"] = wrap(cam["yaw"] + wrap(goal["yaw"] - cam["yaw"]) * k)
        close = abs(goal["x"] - cam["x"]) + abs(goal["y"] - cam["y"]) + abs(goal["z"] - cam["z"]) + abs(wrap(goal["yaw"] - cam["yaw"]))
        if close < 2.0:
            goal = None
    return goal


# ---- stations ----

def stations(w):
    if "stations" not in cache:
        actors = [a for a in unreal.GameplayStatics.get_all_actors_of_class(w, unreal.NiagaraActor) if a.get_actor_label().startswith("Station_")]
        actors.sort(key=lambda a: a.get_actor_label())
        cache["stations"] = actors
    return cache["stations"]


def pose_for(w, index):
    """Camera pose in front of station `index`, seen from the centroid of all stations (the ring's centre for the arena)."""
    locs = [a.get_actor_location() for a in stations(w)]
    centre = (sum(l.x for l in locs) / len(locs), sum(l.y for l in locs) / len(locs))
    return station_pose(locs[index], centre)


def distances(w):
    cam = state["cam"]
    result = []
    for index, actor in enumerate(stations(w)):
        loc = actor.get_actor_location()
        result.append((math.hypot(loc.x - cam["x"], loc.y - cam["y"]), index))
    return sorted(result)


def switch(w, dt):
    """Switch stations on near the camera and off away from it; restart the ones that replay."""
    actors = stations(w)
    near = []
    for distance, index in distances(w):
        limit = RELEASE_RADIUS if index in state["active"] else ACTIVATE_RADIUS
        if distance <= limit and len(near) < MAX_ACTIVE:
            near.append(index)
    for index in sorted(set(near) - state["active"]):
        comp(actors[index]).activate(True)
        tidy(actors[index])
        state["since"][index] = 0.0
        unreal.log("[showcase_explore] on  %s" % actors[index].get_actor_label())
    for index in sorted(state["active"] - set(near)):
        comp(actors[index]).deactivate()
        unreal.log("[showcase_explore] off %s" % actors[index].get_actor_label())
    state["active"] = set(near)
    for index in state["active"]:
        every = replay_seconds(actors[index])
        state["since"][index] = state["since"].get(index, 0.0) + dt
        if every > 0.0 and state["since"][index] >= every:
            state["since"][index] = 0.0
            comp(actors[index]).activate(True)
            tidy(actors[index])


def nearest(w):
    return distances(w)[0][1]


def go_to(w, index):
    state["goal"] = pose_for(w, index)


def hud(w, dt):
    state["hud_t"] += dt
    if state["hud_t"] < 0.4:
        return
    state["hud_t"] = 0.0
    actors = stations(w)
    distance, index = distances(w)[0]
    running = ", ".join(station_name(actors[i]) for i in sorted(state["active"])) or "none (fly toward a station)"
    white = unreal.LinearColor(1, 1, 1, 1)
    unreal.SystemLibrary.print_string(w, "NEAREST %s  %d m   RUNNING %s" % (station_name(actors[index]).upper(), round(distance / 100.0), running),
                                      True, False, white, 1.0, "showcase_where")
    if state["help"]:
        unreal.SystemLibrary.print_string(w, HELP, True, False, unreal.LinearColor(0.7, 0.8, 1, 1), 1.0, "showcase_help")


# ---- frame loop ----

def setup(w):
    controller = unreal.GameplayStatics.get_player_controller(w, 0)
    for pawn in unreal.GameplayStatics.get_all_actors_of_class(w, unreal.DefaultPawn):
        pawn.set_actor_hidden_in_game(True)
        pawn.disable_input(controller)
    cameras = unreal.GameplayStatics.get_all_actors_of_class(w, unreal.CameraActor)
    if not cameras or not controller:
        return False
    cache["camera"], cache["pc"] = cameras[0], controller
    controller.set_view_target_with_blend(cameras[0], 0.0)
    controller.set_editor_property("show_mouse_cursor", False)
    for actor in stations(w):
        comp(actor).deactivate()
    state["cam"] = pose_for(w, 0)
    state["ready"] = True
    return True


def apply_camera():
    cam = state["cam"]
    cache["camera"].set_actor_location_and_rotation(unreal.Vector(cam["x"], cam["y"], cam["z"]), unreal.Rotator(0, cam["pitch"], cam["yaw"]), False, False)


def frame(w, dt, inp):
    if inp["help"]:
        state["help"] = not state["help"]
        if not state["help"]:
            unreal.SystemLibrary.print_string(w, " ", True, False, unreal.LinearColor(0, 0, 0, 0), 0.01, "showcase_help")
    count = len(stations(w))
    if inp["next"] or inp["prev"]:
        go_to(w, (nearest(w) + (1 if inp["next"] else -1)) % count)
    if inp["jump"] is not None and inp["jump"] < count:
        go_to(w, inp["jump"])
    if inp["restart"]:
        index = nearest(w)
        comp(stations(w)[index]).activate(True)
        tidy(stations(w)[index])
    state["goal"] = fly(state["cam"], state["goal"], inp, dt)
    apply_camera()
    switch(w, dt)
    hud(w, dt)
    if inp["quit"]:
        unreal.SystemLibrary.quit_game(w, cache["pc"], unreal.QuitPreference.QUIT, False)


# ---- self-test: scripted input in place of a device ----

selftest = {"phase": 0, "t": 0.0, "applied": 0.0, "pause": 0.0, "mark": None, "problems": [], "visited": 0, "shot": False, "done": False}


def check(ok, message):
    unreal.log(("[showcase_explore] selftest ok:   " if ok else "[showcase_explore] selftest FAIL: ") + message)
    if not ok:
        selftest["problems"].append(message)


def run_selftest(w, dt):
    """Phases 0-3 check the motion maths (forward, strafe, turn, boost); phase 4 glides to each station and checks the switching rules."""
    st = selftest
    if st["done"]:
        return idle()
    st["t"] += dt
    cam, inp, phase = state["cam"], idle(), st["phase"]
    if st["phase"] == 0:
        if st["mark"] is None:
            read_input(cache["pc"])      # the device path must run without raising, even with nothing plugged in
            state["goal"] = None
            cam.update({"yaw": 0.0, "pitch": 0.0, "x": 0.0, "y": 0.0, "z": 300.0})
            st["mark"] = dict(cam)
        inp["forward"] = 1.0
        if st["t"] >= 1.0:
            check(abs(cam["x"] - SPEED * st["applied"]) < SPEED * 0.05 and abs(cam["y"]) < 1.0, "full stick forward moves %d per second along the heading (%.2f s: x=%.0f y=%.0f)" % (SPEED, st["applied"], cam["x"], cam["y"]))
            st["phase"], st["t"], st["applied"], st["mark"] = 1, 0.0, 0.0, dict(cam)
    elif st["phase"] == 1:
        inp["right"] = 1.0
        if st["t"] >= 1.0:
            check(abs(cam["y"] - st["mark"]["y"] - SPEED * st["applied"]) < SPEED * 0.05, "strafe right moves %d per second to the right (%.2f s: dy=%.0f)" % (SPEED, st["applied"], cam["y"] - st["mark"]["y"]))
            st["phase"], st["t"], st["applied"], st["mark"] = 2, 0.0, 0.0, dict(cam)
    elif st["phase"] == 2:
        inp["yaw"], inp["pitch"] = 1.0, -1.0
        if st["t"] >= 1.0:
            check(abs(wrap(cam["yaw"] - STICK_LOOK * st["applied"])) < 2.0 and abs(cam["pitch"] + 85.0) < 0.01, "right stick turns %d deg/s and the pitch stops at -85 (%.2f s: yaw=%.1f pitch=%.1f)" % (STICK_LOOK, st["applied"], cam["yaw"], cam["pitch"]))
            cam.update({"yaw": 0.0, "pitch": 0.0})
            st["phase"], st["t"], st["applied"], st["mark"] = 3, 0.0, 0.0, dict(cam)
    elif st["phase"] == 3:
        inp["forward"], inp["boost"] = 1.0, True
        if st["t"] >= 1.0:
            check(abs(cam["x"] - st["mark"]["x"] - SPEED * BOOST * st["applied"]) < SPEED * BOOST * 0.05, "boost multiplies the speed by %.0f (%.2f s: dx=%.0f)" % (BOOST, st["applied"], cam["x"] - st["mark"]["x"]))
            st["phase"], st["t"] = 4, 0.0
            inp = idle()
            inp["jump"] = 0
    else:
        index = st["visited"]
        if st["pause"] > 0.0:   # a screenshot is written a few frames after it is requested; do not move the camera until then
            st["pause"] -= dt
            if st["pause"] <= 0.0:
                inp["jump"] = st["visited"]
        elif state["goal"] is None and st["t"] >= SETTLE:
            actors = stations(w)
            names = ", ".join(station_name(actors[i]) for i in sorted(state["active"]))
            check(nearest(w) == index and index in state["active"] and 1 <= len(state["active"]) <= MAX_ACTIVE,
                  "station %d (%s) is the nearest and running; %d running (%s); camera yaw=%.1f pitch=%.1f actor=%s" % (
                      index + 1, station_name(actors[index]), len(state["active"]), names, cam["yaw"], cam["pitch"], cache["camera"].get_actor_rotation()))
            if SHOTS and not GAME:
                unreal.AutomationLibrary.take_high_res_screenshot(1600, 900, "explore_%02d.png" % (index + 1))
            st["visited"], st["t"] = index + 1, 0.0
            if st["visited"] >= len(actors):
                st["done"] = True
                unreal.log("[showcase_explore] selftest %s" % ("PASS" if not st["problems"] else "FAIL " + "; ".join(st["problems"])))
                if GAME:
                    unreal.SystemLibrary.quit_game(w, cache["pc"], unreal.QuitPreference.QUIT, False)
            elif SHOTS and not GAME:
                st["pause"] = 2.5
            else:
                inp["jump"] = st["visited"]
    if st["phase"] != phase and st["phase"] < 4:
        inp = idle()   # the input of the frame that ended a phase would otherwise be applied inside the next one
    if st["phase"] == phase and phase < 4:
        st["applied"] += dt
    return inp


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
        if setup(w):
            unreal.log("[showcase_explore] ready: %d stations, selftest=%s" % (len(stations(w)), SELFTEST))
        return
    frame(w, dt, run_selftest(w, dt) if SELFTEST else read_input(cache["pc"]))


def tick(dt):
    if state["busy"]:
        return   # activating a system blocks on its compile and Slate keeps ticking meanwhile, which re-enters this callback
    state["busy"] = True
    try:
        step(dt)
    except Exception as exc:  # a raising tick callback repeats every frame
        if not state["failed"]:
            state["failed"] = True
            unreal.log_error("[showcase_explore] " + repr(exc))
    finally:
        state["busy"] = False


unreal.register_slate_post_tick_callback(tick)
unreal.log("[showcase_explore] tick callback registered")
