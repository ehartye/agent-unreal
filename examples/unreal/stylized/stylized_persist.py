"""Set a Toon Profile override on a Material Instance, save, and read it back in a new editor process.

Run twice in separate processes, headless, with the project from stylized_build.py (no rendering):
  STYLIZED_PERSIST=write UnrealEditor-Cmd.exe <abs-path>/Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
  STYLIZED_PERSIST=read  ...same command line...
Set STYLIZED_REPORT for the JSON report path (default Saved/stylized-persist-<mode>.json). The read run's console output
(GetAll lines) also goes to the editor log; stylized_validate.mjs starts both runs with -abslog.

MaterialInstance.ToonProfileOverride is a plain UPROPERTY (no Edit flag) and only bOverrideToonProfile is exposed, so Python cannot set or read the
profile reference by property name. The write run tries the property name (recorded as an error), then the engine's `Set` console
command with the instance's name (a class name changes the class default object as well, and a value equal to the class default is not
saved); the read run reads it back with `GetAll`. Both print to the log, so start the editor with -LogCmds="global Log".
"""
import json
import os
import traceback

import unreal

MI = "/Game/Stylized/MI_ToonLit"
PROFILE = "/Game/Stylized/TP_Ink"
mode = os.environ.get("STYLIZED_PERSIST", "write")
report = {"mode": mode, "engine": unreal.SystemLibrary.get_engine_version()}
eal = unreal.EditorAssetLibrary


def console(cmd):
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    unreal.log("[stylized_persist] console: " + cmd)
    unreal.SystemLibrary.execute_console_command(world, cmd)


try:
    mi = eal.load_asset(MI)
    if mode == "write":
        report["override_flag_before"] = mi.get_editor_property("override_toon_profile")
        try:
            mi.set_editor_property("toon_profile_override", eal.load_asset(PROFILE))
            report["set_by_property_name"] = True
        except Exception as exc:
            report["set_by_property_name"] = False
            report["property_name_error"] = str(exc)[:160]
        mi.set_editor_property("override_toon_profile", True)
        console(f"Set MI_ToonLit ToonProfileOverride {PROFILE}.TP_Ink")  # an object name: a class name would also change the class default, which then hides the value from the saved file
        console("GetAll MaterialInstanceConstant ToonProfileOverride Name=MI_ToonLit")
        report["saved"] = eal.save_asset(MI, only_if_is_dirty=False)  # Set writes by reflection and does not mark the package dirty
        report["override_flag_after"] = mi.get_editor_property("override_toon_profile")
    else:
        report["override_flag"] = mi.get_editor_property("override_toon_profile")
        console("GetAll MaterialInstanceConstant ToonProfileOverride Name=MI_ToonLit")
        console("GetAll MaterialInstanceConstant bOverrideToonProfile Name=MI_ToonLit")
        expected = eal.load_asset("/Game/Stylized/M_ToonLit").get_editor_property("blend_mode")
        report["parent_blend_mode"] = str(expected)
except Exception:
    report["error"] = traceback.format_exc()[-700:]

path = os.environ.get("STYLIZED_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", f"stylized-persist-{mode}.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as fh:
    json.dump(report, fh, indent=2, default=str)
unreal.log(f"[stylized_persist] {mode} wrote " + path)
