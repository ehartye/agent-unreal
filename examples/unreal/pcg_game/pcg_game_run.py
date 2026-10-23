"""Generate PCG in a game process and report what happened (Unreal 5.8, the editor binary started with -game).

  UnrealEditor.exe Project.uproject /Game/Maps/PcgCacheOn -game -windowed -ResX=1280 -ResY=720 -RenderOffScreen -ExecCmds="py <absolute-path-to-this-file>"
      -abslog=<log file> -unattended -nosplash -nosound -notraceserver     (in Git Bash set MSYS_NO_PATHCONV=1)
Environment: PCG_REPORT (JSON path), PCG_SHOT (absolute PNG path for the engine screenshot; default: none), PCG_SETTLE (seconds to wait after
generation before the screenshot, default 40; shaders for the two materials compile in this time).

A game process has no editor, so nothing here uses EditorLevelLibrary. The script finds the world with ObjectIterator, asks every PCG
volume to generate (the volumes are on-demand, so nothing is generated until this call), waits for the generated event of each, counts
the spawned instances, reads the PCGWorldActor and its Landscape cache mode, and reads the usage flag of the two materials. When
instances exist it looks through the map's camera, waits PCG_SETTLE seconds and writes an engine screenshot with the HighResShot
console command. The log lines the checks look for (the Landscape cache errors) are read from the log file by pcg_validate.mjs.
"""
import os
import sys
import time

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pcg_common as pc  # noqa: E402

report = pc.Report("pcg-game.json")
SHOT = os.environ.get("PCG_SHOT", "").replace("\\", "/")
SETTLE = float(os.environ.get("PCG_SETTLE", "40"))


def find_world():
    for w in unreal.ObjectIterator(unreal.World):
        if w.get_name() != "Default__World" and unreal.GameplayStatics.get_all_actors_of_class(w, unreal.PCGVolume):
            return w
    return None


def stages():
    started = time.time()
    world = None
    ok = yield from pc.wait_for(lambda: find_world() is not None, 90)
    world = find_world()
    report["world_found"] = ok
    if world is None:
        return
    report["world"] = world.get_name()
    yield 60   # let BeginPlay settle
    gp = unreal.GameplayStatics
    wa = gp.get_all_actors_of_class(world, unreal.PCGWorldActor)
    report["pcg_world_actors"] = len(wa)
    if wa:
        cache = wa[0].get_editor_property("landscape_cache_object")
        report["cache_mode"] = str(cache.get_editor_property("serialization_mode"))
    report["materials"] = {}
    for name in ("M_Flagged", "M_Unflagged"):
        mat = unreal.load_asset("/Game/Pcg/" + name)
        report["materials"][name] = bool(mat.get_editor_property("used_with_instanced_static_meshes"))
    report["volumes"] = {}
    for vol in gp.get_all_actors_of_class(world, unreal.PCGVolume):
        comp = vol.get_editor_property("pcg_component")
        entry = {"instances_before": pc.instance_count(vol)}
        res = yield from pc.generate_and_count(vol, comp, seconds=25)
        entry.update({"completed": res["completed"], "instances": res["instances"], "points": len(res["points"])})
        report["volumes"][vol.get_actor_label()] = entry
        report.flush()
    report["total_instances"] = sum(v["instances"] for v in report["volumes"].values())
    if report["total_instances"] > 0 and SHOT:
        cams = [c for c in gp.get_all_actors_of_class(world, unreal.CameraActor) if c.get_actor_label() == "ShotCam"]
        controller = gp.get_player_controller(world, 0)
        if cams and controller:
            controller.set_view_target_with_blend(cams[0], 0.0)
            for pawn in gp.get_all_actors_of_class(world, unreal.DefaultPawn):
                pawn.set_actor_hidden_in_game(True)
        report["camera_set"] = bool(cams and controller)
        report.flush()
        yield from pc.wait_for(lambda: False, SETTLE)
        unreal.SystemLibrary.execute_console_command(world, 'HighResShot 1280x720 filename="%s"' % SHOT)
        yield from pc.wait_for(lambda: os.path.exists(SHOT), 30)
        yield from pc.wait_for(lambda: False, 2)
        report["screenshot_written"] = os.path.exists(SHOT)
    report["seconds"] = round(time.time() - started, 1)


pc.run_stages(stages, report, quit_command="quit")
unreal.log("[pcg_game_run] stages registered")
