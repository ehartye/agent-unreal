"""Mutable probe, headless half (question 3): load the saved Customizable Object and compile it in a commandlet.
Prepared 2026-10-29.

  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<abs path to this file> -abslog=<log> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
Environment: MU_PROBE_DIR, MU_REPORT, MU_CO, MU_COMPILE_TIMEOUT_S (see mu_probe_common.py). The compile is blocking here (MU_COMPILE_MODE=sync): a commandlet
runs no Slate tick, so an asynchronous compile and its callback would never be serviced. The wall-clock limit is therefore the runner's process limit
(compile timeout plus a margin); a hang shows up as a killed process and no report, and the check names that.
"""
import os
import sys
import traceback

import unreal

sys.path.insert(0, os.environ["MU_PROBE_DIR"])
os.environ["MU_COMPILE_MODE"] = "sync"
import mu_probe_common as c  # noqa: E402

probe = c.Probe("headless")
probe.write()   # the report exists from the start, so a later hang still leaves the loaded state; it is rewritten at the end
co = None
try:
    co = c.eal.load_asset(c.CO_PATH)
    probe.step("load", loaded=co is not None, is_compiled_on_load=bool(co.is_compiled()) if co else None, parameters_on_load=int(co.get_parameter_count()) if co else None)
except Exception:
    probe.step("load", loaded=False, error=traceback.format_exc()[-600:])
probe.write()
if co is not None:
    record = {}
    probe.step("compile", mode=c.COMPILE_MODE, deadline_s=c.COMPILE_TIMEOUT_S, started=True, finished=False, timed_out=False, note="written before the call; replaced when it returns")
    probe.write()
    probe.report["steps"].pop()
    try:
        for _ in c.run_compile(co, record):
            pass
    except Exception:
        record["error"] = traceback.format_exc()[-700:]
    probe.step("compile", **record)
    probe.write()
    probe.guarded("readback", lambda: c.read_back(co))
probe.write()
