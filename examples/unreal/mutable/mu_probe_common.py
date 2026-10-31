"""Shared helpers of the Mutable probe scripts (mu_probe_*.py). Prepared 2026-10-29.

The runner (mu_probe.mjs) sets MU_PROBE_DIR to this folder and each script adds it to sys.path first; `__file__` is not relied on, because a
script started with -run=pythonscript or "py <path>" may not define it. Environment: MU_REPORT (JSON report path), MU_CO (the object's package
path), MU_COMPILE_TIMEOUT_S (wall-clock limit of one compile), MU_COMPILE_MODE ("async" or "sync").

Python names used, all taken from the installed plugin's reflection (the unreal module lists them; see README "What the Python surface reaches"):
  unreal.CustomizableObjectEditorFunctionLibrary.new_customizable_object(NewCustomizableObjectParameters: package_path, asset_name)
  unreal.CustomizableObject: the compile method (takes CompileParams), .is_compiled(), .create_instance(), .get_parameter_count() ...
  unreal.CompileParams: async_, skip_if_compiled, skip_if_not_out_of_date, callback (a dynamic delegate)
  unreal.CompileCallbackParams: compiled, request_failed, skipped, errors, warnings
Every compile below sits behind a wall-clock limit (run_compile), so a hang is a recorded result.
"""
import json
import os
import sys
import time
import traceback

import unreal

sys.dont_write_bytecode = True

CO_PATH = os.environ.get("MU_CO", "/Game/Mu/CO_Person")
COMPILE_TIMEOUT_S = float(os.environ.get("MU_COMPILE_TIMEOUT_S", "240"))
COMPILE_MODE = os.environ.get("MU_COMPILE_MODE", "async")
eal = unreal.EditorAssetLibrary


class Probe:
    """A report with a list of steps. A step that raises is recorded as {step, error} and the next step still runs."""

    def __init__(self, name):
        self.name = name
        self.report = {"probe": name, "engine": unreal.SystemLibrary.get_engine_version(), "steps": []}

    def step(self, name, **fields):
        self.report["steps"].append(dict(step=name, **fields))

    def guarded(self, name, fn):
        """Run fn (returns a dict of fields or None); record its fields, or the traceback tail as `error`."""
        try:
            fields = fn() or {}
            self.step(name, **fields)
            return fields
        except Exception:
            self.step(name, error=traceback.format_exc()[-700:])
            return None

    def write(self):
        path = os.environ.get("MU_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "mu-%s.json" % self.name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            json.dump(self.report, fh, indent=2, default=str)
        unreal.log("[mu_probe:%s] wrote %s" % (self.name, path))


def new_compile_params(on_done=None):
    """CompileParams that always compile (skip flags off), asynchronously or not by MU_COMPILE_MODE. `on_done(callback_params)` is bound to the
    dynamic delegate when it can be; returns (params, bound, bind_error)."""
    params = unreal.CompileParams()
    params.set_editor_property("async_", COMPILE_MODE == "async")
    params.set_editor_property("skip_if_compiled", False)
    params.set_editor_property("skip_if_not_out_of_date", False)
    bound, bind_error = False, ""
    if on_done is not None:
        try:
            delegate = type(params.get_editor_property("callback"))()
            delegate.bind_callable(on_done)
            params.set_editor_property("callback", delegate)
            bound = True
        except Exception:
            bind_error = traceback.format_exc()[-400:]
    return params, bound, bind_error


def callback_fields(done):
    """The fields of a CompileCallbackParams the report keeps."""
    def texts(name):
        try:
            return [str(t) for t in done.get_editor_property(name)]
        except Exception:
            return []
    fields = {}
    for key in ("compiled", "request_failed", "skipped"):
        try:
            fields[key] = bool(done.get_editor_property(key))
        except Exception:
            fields[key] = None
    fields["errors"], fields["warnings"] = texts("errors"), texts("warnings")
    return fields


def run_compile(co, record, optimization_level=None):
    """Generator: compile `co`, filling `record` (started, mode, deadline_s, callback_bound, finished, timed_out, seconds, compiled, ...).
    Yields seconds to wait between polls (0.0 in sync mode). The wall-clock limit is COMPILE_TIMEOUT_S, measured from the call."""
    state = {"done": None}

    def on_done(done):
        state["done"] = done

    record.update(mode=COMPILE_MODE, deadline_s=COMPILE_TIMEOUT_S, started=False, finished=False, timed_out=False)
    params, bound, bind_error = new_compile_params(on_done)
    if optimization_level is not None:
        params.set_editor_property("optimization_level", optimization_level)
        record["optimization_level"] = str(optimization_level)
    record.update(callback_bound=bound, bind_error=bind_error)
    started = time.monotonic()
    record["started"] = True
    co.compile(params)      # source: CustomizableObject.h Compile(const FCompileParams&); a sync compile returns when it is done
    if COMPILE_MODE != "async":
        record["seconds"] = round(time.monotonic() - started, 2)
        yield 0.0
    else:
        while state["done"] is None and time.monotonic() - started < COMPILE_TIMEOUT_S:
            yield 0.5
        record["seconds"] = round(time.monotonic() - started, 2)
    if state["done"] is not None:
        record["finished"] = True
        record.update(callback_fields(state["done"]))
    elif COMPILE_MODE != "async":
        record["finished"] = True           # a blocking call that returned; the callback did not report
        record["compiled"] = None
        record.update(errors=[], warnings=[], request_failed=None, skipped=None)
    else:
        record["timed_out"] = True
        record.update(compiled=None, errors=[], warnings=[], request_failed=None, skipped=None)
    record["is_compiled_after"] = bool(co.is_compiled())


def read_parameters(co):
    """The parameters of a compiled object: [{name, type, options}] (options only for integer and enum parameters)."""
    out = []
    for i in range(int(co.get_parameter_count())):
        name = str(co.get_parameter_name(i))
        kind = str(co.get_parameter_type_by_name(name))
        options = []
        try:
            options = [str(co.get_enum_parameter_value(name, k)) for k in range(int(co.get_enum_parameter_num_values(name)))]
        except Exception:
            pass
        out.append({"name": name, "type": kind, "options": options})
    return out


def read_back(co):
    return {"is_compiled": bool(co.is_compiled()), "parameter_count": int(co.get_parameter_count()), "component_count": int(co.get_component_count()),
            "state_count": int(co.get_state_count()), "parameters": read_parameters(co)}


def drive(probe, make_task, finish_extra=None):
    """Run a generator of waits on the Slate post tick (a rendering editor), then write the report and quit. Used by the editor-mode scripts."""
    state = {"task": None, "wait": 0.0, "done": False, "busy": False, "t": 0.0}

    def finish():
        state["done"] = True
        if finish_extra:
            finish_extra()
        probe.write()
        unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")

    def tick(dt):
        if state["done"] or state["busy"]:
            return
        state["busy"] = True
        try:
            state["t"] += dt
            if state["t"] < 3.0:        # let the editor finish starting
                return
            if state["task"] is None:
                state["task"] = make_task()
            if state["wait"] > 0:
                state["wait"] -= dt
                return
            try:
                state["wait"] = next(state["task"])
            except StopIteration:
                finish()
        except Exception:
            probe.step("driver", error=traceback.format_exc()[-700:])
            finish()
        finally:
            state["busy"] = False

    unreal.register_slate_post_tick_callback(tick)
