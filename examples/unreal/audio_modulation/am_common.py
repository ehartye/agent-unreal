"""Shared report IO for the Audio Modulation probe."""
import json, os, traceback
import unreal
REPORT = os.environ["AM_REPORT"]
def write(data):
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)
def path(obj):
    return obj.get_path_name() if obj else None
def error():
    return traceback.format_exc()

import time
class Worlds:
    """Advance editor then PIE independently; report exceptions and always quit."""
    def __init__(self, start, tick, finish, result):
        self.start_fn, self.tick_fn, self.finish_fn, self.result = start, tick, finish, result
        self.route, self.state, self.deadline = "editor", "wait", time.monotonic() + 3
        self.level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
        self.editor = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
        self.busy = False
        self.handle = unreal.register_slate_post_tick_callback(self.tick)
    def next(self):
        write(self.result)
        if self.route == "editor":
            self.route, self.state = "pie", "wait"
            self.level.editor_request_begin_play()
            self.deadline = time.monotonic() + 5
        else:
            self.level.editor_request_end_play()
            unreal.unregister_slate_post_tick_callback(self.handle)
            unreal.SystemLibrary.quit_editor()
    def tick(self, delta):
        if self.busy: return
        self.busy = True
        try:
            now = time.monotonic()
            if self.state == "wait" and now >= self.deadline:
                self.world = self.editor.get_editor_world() if self.route == "editor" else self.editor.get_game_world()
                self.data = {"world": path(self.world), "deltas": []}
                self.result["routes"][self.route] = self.data
                if self.world is None: raise RuntimeError("world unavailable")
                self.start_fn(self.world, self.route, self.data)
                self.started, self.state = now, "run"
            elif self.state == "run":
                self.data["deltas"].append(float(delta))
                if self.tick_fn(now-self.started, self.world, self.route, self.data):
                    self.finish_fn(self.world, self.route, self.data)
                    ds = self.data.pop("deltas")
                    self.data["mean_frame_delta"] = sum(ds)/len(ds) if ds else None
                    self.next()
        except Exception:
            self.result["routes"].setdefault(self.route, {})["error"] = error()
            self.next()
        finally:
            self.busy = False
