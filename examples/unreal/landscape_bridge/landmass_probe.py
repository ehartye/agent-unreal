"""Attach a Landmass brush manager to a Landscape from Python, rung by rung, and read what each rung did (Unreal 5.8, editor).

  UnrealEditor.exe Project.uproject -nullrhi -ExecCmds="py <absolute-path-to-this-file>" -unattended -nosplash -nosound -notraceserver
      (in Git Bash set MSYS_NO_PATHCONV=1 or /Game/... is rewritten; add -RenderOffScreen instead of -nullrhi and LW_RENDER=1 to wait for heights)
Environment: LW_REPORT (JSON path), LW_RENDER (1 in a rendering editor: wait for the edit layer merge and compare heights).
Needs the LandscapeBridge module (landscape_world.mjs builds it) and the Landmass plugin.

Question: is there a Python-reachable route that puts a Landmass brush manager on a Landscape edit layer, so that the manager's
get_landscape() is not None and the brush changes the heightmap? Read from the install's sources before the run:
  - ALandmassManagerBase::SetTargetLandscape (Landmass/Source/Editor/Private/LandmassManagerBase.cpp) removes the manager from its old
    Landscape and returns; it has no call to ALandscape::AddBrushToLayer. It is a plain UFUNCTION, so a Blueprint cannot override it.
  - get_landscape() returns DetailPanelLandscape, which only SetOwningLandscape writes, and the Landscape calls that from AddBrushToLayer.
  - ALandscape::AddBrushToLayer (Landscape/Classes/Landscape.h) is not a UFUNCTION; the Landscape editor mode, the layer context menu
    and the layer drag and drop call it. The bridge function attach_brush_to_layer wraps it.
Rungs, each recorded the same way (manager.get_landscape(), the bridge's layer index and owner, brush counts per edit layer, heights):
  r0_spawn_only        the existing behaviour: spawn the brush, which finds or spawns its manager. The negative control.
  r1_set_target        manager.set_target_landscape(landscape). Expected not to attach.
  r2_property          manager.set_editor_property('detail_panel_landscape', landscape). Expected to mirror into get_landscape() without attaching.
  r3_bridge_attach     LandscapeBridgeLibrary.attach_brush_to_layer(landscape, 0, manager). Needs the module. Expected to attach.
  r4_nudge_*           only when r3 attached and no height changed in a rendering editor: request an update, move the brush, force a layer update.
  r5_detach            LandscapeBridgeLibrary.detach_brush. Expected to undo the attach; heights should return to the baseline.
Two stock brush classes are tried in turn: CustomBrush_Landmass, then LandmassBrush_ProceduralNoise when a rendering editor saw no height change.
"""
import os
import sys
import time
import traceback

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import landscape_fixture as fx  # noqa: E402

pc = fx.pc
report = fx.make_report("landmass.json")
RENDER = os.environ.get("LW_RENDER", "0") == "1"
EL = unreal.EditorLevelLibrary
LANDMASS = "/Landmass/Landscape/BlueprintBrushes/"
CANDIDATES = [("custom", LANDMASS + "CustomBrush_Landmass"), ("noise", LANDMASS + "Brushes/LandmassBrush_ProceduralNoise")]
SPOTS = [("centre", 0.0, 0.0), ("east", 1500.0, 0.0), ("north", 0.0, 1500.0), ("south_west", -1500.0, -1500.0), ("far", 18000.0, 18000.0)]
CHANGE_CM = 1.0          # a height step is 0.78 cm at height scale 100 percent, so one step is not a change
MERGE_SECONDS = 240      # the first merge compiles the brush materials
NUDGE_SECONDS = 60


def attempt(fn):
    """Run fn; return {"ok": True, "value": repr} or {"ok": False, "error": text}, never raise."""
    try:
        value = fn()
        return {"ok": True, "value": None if value is None else str(value)[:200]}
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:300]}


class Rig:
    def __init__(self, key, brush_class_path):
        self.key, self.class_path = key, brush_class_path
        self.landscape = self.brush = self.manager = self.world = None
        self.baseline = {}
        self.out = {"brush_class": brush_class_path, "rungs": []}
        self.lib = fx.bridge()
        self.rt = None

    def layer_count(self):
        return len(self.landscape.get_edit_layers_bp()) if self.landscape else 0

    def heights(self):
        """Collision-heightfield heights at the spots; plus the rendered heightmap in a rendering editor."""
        out = {name: fx.height_at(self.landscape, x, y) for name, x, y in SPOTS}
        if RENDER:
            out["rendered"] = self.rendered()
        return out

    def rendered(self):
        """Final heightmap at the spots, read with Landscape.render_heightmap into an 8 bit target (16 bit height in R and G)."""
        result = {}
        try:
            if self.rt is None:
                self.rt = unreal.RenderingLibrary.create_render_target2d(self.world, 8, 8, unreal.TextureRenderTargetFormat.RTF_RGBA8)
            for name, x, y in SPOTS:
                box = unreal.Box2D(unreal.Vector2D(x - 400.0, y - 400.0), unreal.Vector2D(x + 400.0, y + 400.0))
                if not self.landscape.render_heightmap(unreal.Transform(), box, self.rt):
                    result[name] = None
                    continue
                c = unreal.RenderingLibrary.read_render_target_raw_pixel(self.world, self.rt, 4, 4)
                h16 = round(c.r) * 256 + round(c.g)
                result[name] = round(self.landscape.get_actor_location().z + (h16 - 32768) / 128.0 * self.landscape.get_actor_scale3d().z, 1)
        except Exception as exc:
            result["error"] = str(exc)[:200]
        return result

    def changed(self):
        """Largest absolute height difference against the baseline over the spots, in cm (collision heightfield; rendered too when read)."""
        worst = 0.0
        now = self.heights()
        for group, base in (("collision", self.baseline), ("rendered", self.baseline.get("rendered"))):
            cur = now if group == "collision" else now.get("rendered")
            if not isinstance(cur, dict) or not isinstance(base, dict):
                continue
            for name, _x, _y in SPOTS:
                a, b = cur.get(name), base.get(name)
                if isinstance(a, (int, float)) and isinstance(b, (int, float)):
                    worst = max(worst, abs(a - b))
        return worst, now

    def snap(self, label, call=None):
        manager_landscape = None
        try:
            manager_landscape = fx.path_of(self.manager.get_landscape())
        except Exception as exc:
            manager_landscape = "error: " + str(exc)[:120]
        count = self.layer_count()
        delta, heights = self.changed()
        entry = {
            "rung": label, "call": call or {}, "manager_landscape": manager_landscape,
            "bridge_owner": fx.path_of(self.lib.get_brush_owning_landscape(self.manager)),
            "layer_index": self.lib.get_brush_layer_index(self.landscape, self.manager),
            "brush_counts": [self.lib.get_brush_count_for_layer(self.landscape, i) for i in range(count)],
            "edit_layers": fx.edit_layer_names(self.landscape), "heights": heights, "max_delta_cm": round(delta, 3),
        }
        self.out["rungs"].append(entry)
        report.flush()
        return entry

    def wait_change(self, seconds, back=False):
        """Wait up to `seconds` for a height change above CHANGE_CM (back=True: for the change to be gone); return the seconds it took, or None.
        The heights are read once a second, because a read in a rendering editor renders the heightmap."""
        start, last = time.time(), [0.0]

        def cond():
            if time.time() - last[0] < 1.0:
                return False
            last[0] = time.time()
            return (self.changed()[0] <= CHANGE_CM) if back else (self.changed()[0] > CHANGE_CM)

        ok = yield from pc.wait_for(cond, seconds)
        return round(time.time() - start, 1) if ok else None


def run_candidate(key, class_path):
    rig = Rig(key, class_path)
    report["candidates"][key] = rig.out
    ok, rig.world = fx.new_map("/Game/Maps/LandmassProbe_" + key, False)
    rig.out["map_created"] = ok
    yield 10
    rig.landscape = fx.create_landscape(rig.world, 0)
    rig.out["landscape_created"] = rig.landscape is not None
    if rig.landscape is None:
        return rig
    yield 60                                   # let the edit layer system initialise before the first read
    rig.out["edit_layers"] = fx.edit_layer_names(rig.landscape)
    rig.baseline = rig.heights()
    rig.out["baseline_heights"] = rig.baseline
    report.flush()

    cls = unreal.EditorAssetLibrary.load_blueprint_class(class_path)
    rig.out["brush_class_loaded"] = cls is not None
    if cls is None:
        return rig
    rig.brush = EL.spawn_actor_from_class(cls, unreal.Vector(0.0, 0.0, 0.0))
    rig.out["brush_spawned"] = rig.brush is not None
    if rig.brush is None:
        return rig
    rig.brush.set_actor_label("ProbeBrush_" + key)
    read = attempt(lambda: rig.brush.get_editor_property("brush_manager"))
    rig.out["brush_manager_property"] = read
    found = rig.brush.get_editor_property("brush_manager") if read["ok"] else None
    rig.out["manager_spawned_by_brush"] = found is not None
    if found is None:   # a brush class without a manager of its own: place the manager class the way world_place.py does
        found = EL.spawn_actor_from_class(unreal.EditorAssetLibrary.load_blueprint_class(LANDMASS + "LandmassBrushManager"), unreal.Vector(0.0, 0.0, 0.0))
    rig.manager = found
    rig.out["manager_class"] = rig.manager.get_class().get_path_name() if rig.manager else None
    if rig.manager is None:
        return rig
    yield 60

    rig.snap("r0_spawn_only")

    r1 = attempt(lambda: rig.manager.set_target_landscape(rig.landscape))
    yield 30
    rig.snap("r1_set_target", r1)

    r2 = attempt(lambda: rig.manager.set_editor_property("detail_panel_landscape", rig.landscape))
    yield 30
    rig.snap("r2_property", r2)
    rig.out["r2_reset"] = attempt(lambda: rig.manager.set_editor_property("detail_panel_landscape", None))   # a stale reference would hide the attach
    yield 10

    attached = attempt(lambda: rig.lib.attach_brush_to_layer(rig.landscape, 0, rig.manager))
    rig.out["attach_call"] = attached
    first = rig.snap("r3_bridge_attach", attached)
    if RENDER:
        first["seconds_to_change"] = yield from rig.wait_change(MERGE_SECONDS)
    else:
        yield 60
    last = rig.snap("r3_bridge_attach_after_wait")
    rig.out["attached"] = attached.get("value") == "True"

    if rig.out["attached"] and RENDER and last["max_delta_cm"] <= CHANGE_CM:
        nudges = [
            ("request_landscape_update", lambda: rig.manager.request_landscape_update(True)),
            ("move_brush", lambda: rig.brush.set_actor_location(unreal.Vector(0.0, 0.0, 100.0), False, False)),
            ("force_layers_full_update", lambda: rig.landscape.force_layers_full_update()),
        ]
        for name, fn in nudges:
            call = attempt(fn)
            seconds = yield from rig.wait_change(NUDGE_SECONDS)
            entry = rig.snap("r4_nudge_" + name, call)
            entry["seconds_to_change"] = seconds
            if entry["max_delta_cm"] > CHANGE_CM:
                break

    detach = attempt(lambda: rig.lib.detach_brush(rig.landscape, rig.manager))
    yield 30
    entry = rig.snap("r5_detach", detach)
    if RENDER:
        seconds = yield from rig.wait_change(120, back=True)
        entry = rig.snap("r5_detach_after_wait")
        entry["returned_to_baseline"] = seconds is not None
    rig.out["height_changed_by_attach"] = max((r["max_delta_cm"] for r in rig.out["rungs"] if r["rung"].startswith("r3") or r["rung"].startswith("r4")), default=0.0) > CHANGE_CM
    report.flush()
    return rig


def stages():
    yield 30
    report["render"] = RENDER
    report["candidates"] = {}
    lib = fx.bridge()
    report["bridge_members"] = fx.bridge_members()
    report["landmass_classes"] = {name: hasattr(unreal, name) for name in ("LandmassManagerBase", "LandmassActor", "LandscapeBlueprintBrushBase")}
    report["landscape_brush_members"] = [m for m in dir(unreal.Landscape) if "brush" in m.lower()]
    report.flush()
    if lib is None:
        report["errors"].append({"step": "bridge", "error": "unreal.LandscapeBridgeLibrary is missing: the module is not built"})
        return
    for key, class_path in CANDIDATES:
        try:
            rig = yield from run_candidate(key, class_path)
        except Exception:
            report["errors"].append({"step": key, "error": traceback.format_exc()[-1200:]})
            report.flush()
            continue
        attempt(lambda: unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level())   # new_level on a dirty map could prompt
        if not RENDER or rig.out.get("height_changed_by_attach"):
            break   # the second brush class is only tried when a rendering editor saw no height change from the first


pc.run_stages(stages, report)
unreal.log("[landmass_probe] stages registered")
