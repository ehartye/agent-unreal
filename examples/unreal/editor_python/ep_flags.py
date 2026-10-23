"""Read the instancing usage flag back from saved materials (Unreal 5.8, headless commandlet, run after ep_probe.py and ep_stages.py).

  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: EP_REPORT (JSON report path). A new process loads each material from disk, so the value is what was saved.
  M_EpCmdPlain, M_EpCmdFlagged  built by ep_probe.py in a commandlet, which never draws; the second went through allow_instancing
  M_EpRock, M_EpRockAuto        built by ep_stages.py in a rendering editor; the second only had instances drawn with it
"""
import json
import os

import unreal

REPORT = os.environ.get("EP_REPORT", "ep-flags.json").replace("\\", "/")
report = {"engine": unreal.SystemLibrary.get_engine_version(), "flags": {}}
for name in ("M_EpCmdPlain", "M_EpCmdFlagged", "M_EpRock", "M_EpRockAuto"):
    mat = unreal.EditorAssetLibrary.load_asset("/Game/Mat/" + name)
    report["flags"][name] = None if mat is None else mat.get_editor_property("used_with_instanced_static_meshes")
os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
with open(REPORT, "w") as fh:
    json.dump(report, fh, indent=2)
unreal.log("[ep_flags] wrote " + REPORT)
