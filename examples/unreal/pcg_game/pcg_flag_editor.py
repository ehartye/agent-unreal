"""Show that the rendering editor sets used_with_instanced_static_meshes by itself on first use (Unreal 5.8, editor with rendering).

  UnrealEditor.exe Project.uproject /Game/Maps/PcgBase -RenderOffScreen -ExecCmds="py <absolute-path-to-this-file>" -unattended -nosplash -nosound -notraceserver
      (in Git Bash set MSYS_NO_PATHCONV=1 or /Game/... is rewritten)
Environment: PCG_REPORT (JSON path). It makes a material without the flag, spawns cubes with it through PCG in the editor world, and polls
the flag. Material::SetMaterialUsage sets a missing flag only when GIsEditor is true and the session is not play (Material.cpp): a game
process, and Play-In-Editor, use the default material instead (pcg_game_run.py shows that case). The log line "needed to set usage flag" is
the evidence the validator reads. -nullrhi creates no scene proxies, so this script needs a rendering editor.
"""
import os
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pcg_common as pc  # noqa: E402

report = pc.Report("pcg-flag-editor.json")
EL = unreal.EditorLevelLibrary


def stages():
    yield 60
    cube = unreal.load_asset("/Engine/BasicShapes/Cube")
    mat = pc.make_material("M_Auto", (0.0, 0.0, 1.0), False)
    flag = lambda: bool(mat.get_editor_property("used_with_instanced_static_meshes"))
    report["flag_before_use"] = flag()
    steps = [(unreal.PCGSurfaceSamplerSettings, {"points_per_squared_meter": 0.04, "point_extents": unreal.Vector(50, 50, 50)})]
    graph = pc.build_variant("PCG_Auto", steps, spawner=(cube, mat))[0]
    vol, comp = pc.spawn_volume("auto", unreal.Vector(0, 0, -900), 1200.0, 1200.0, 3000, graph)
    res = yield from pc.generate_and_count(vol, comp)
    report["instances"] = res["instances"]
    report["flag_right_after_generation"] = flag()
    set_in_time = yield from pc.wait_for(flag, 90)
    report["flag_set_by_editor"] = set_in_time
    report["flag_after_wait"] = flag()
    report.flush()


pc.run_stages(stages, report)
unreal.log("[pcg_flag_editor] stages registered")
