"""Show that PCG generation is asynchronous and what a script has to do about it (Unreal 5.8, editor).

  UnrealEditor.exe Project.uproject /Game/Maps/PcgBase -nullrhi -ExecCmds="py <absolute-path-to-this-file>" -unattended -nosplash -nosound -notraceserver
  UnrealEditor.exe Project.uproject /Game/Maps/PcgBase -nullrhi -ExecutePythonScript="<absolute-path-to-this-file>" -unattended -nosplash -nosound -notraceserver
Environment: PCG_REPORT (JSON path), PCG_ASYNC_MODE: "same_tick" or "staged" (default staged). PCG_ASYNC_SAVE_AS: map path to save to.

Both modes spawn a PCG volume with a sampler and spawner graph, call generate(), and save the map:
  same_tick  saves in the same tick as generate(): no instances exist yet, so the saved map holds none (the report reloads it and counts)
  staged     waits for the generated event, then saves: the saved map holds the instances
The report is written by a Slate post-tick callback. Started with -ExecutePythonScript the editor quits when the script returns,
before any tick, so no report appears; -ExecCmds keeps the editor running until the stages end.
"""
import os
import sys
import time

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pcg_common as pc  # noqa: E402

MODE = os.environ.get("PCG_ASYNC_MODE", "staged")
SAVE_AS = os.environ.get("PCG_ASYNC_SAVE_AS", "/Game/Maps/PcgAsync_" + MODE)
report = pc.Report("pcg-async.json")
report["mode"] = MODE
EL = unreal.EditorLevelLibrary


def volume_instances():
    vols = [a for a in EL.get_all_level_actors() if isinstance(a, unreal.PCGVolume)]
    return sum(pc.instance_count(v) for v in vols)


def stages():
    yield 40
    cube = unreal.load_asset("/Engine/BasicShapes/Cube")
    steps = [(unreal.PCGSurfaceSamplerSettings, {"points_per_squared_meter": 0.04, "point_extents": unreal.Vector(50, 50, 50)})]
    graph = pc.build_variant("PCG_Async", steps, spawner=(cube, None))[0]
    vol, comp = pc.spawn_volume("async", unreal.Vector(0, 0, -900), 1200.0, 1200.0, 3000, graph)
    done = {"flag": False}
    comp.on_pcg_graph_generated_external.add_callable(lambda _c: done.update(flag=True))
    comp.generate(True)
    t0 = time.time()
    report["instances_right_after_generate"] = volume_instances()
    if MODE == "staged":
        yield from pc.wait_for(lambda: done["flag"], 60)
        yield 2
        report["seconds_to_generated_event"] = round(time.time() - t0, 2)
    report["instances_when_saved"] = volume_instances()
    report["saved"] = bool(unreal.EditorLoadingAndSavingUtils.save_map(EL.get_editor_world(), SAVE_AS))
    yield from pc.wait_for(lambda: done["flag"], 60)   # same_tick: the generation finishes after the save
    yield 2
    report["instances_after_generation_finished"] = volume_instances()
    unreal.EditorLoadingAndSavingUtils.load_map(SAVE_AS)
    yield 20
    report["instances_in_saved_map"] = volume_instances()
    report["volumes_in_saved_map"] = len([a for a in EL.get_all_level_actors() if isinstance(a, unreal.PCGVolume)])


pc.run_stages(stages, report)
unreal.log("[pcg_async] stages registered")
