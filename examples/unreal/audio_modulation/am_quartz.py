"""Observe Quartz metronome events with engine-log timestamps in two worlds."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from am_common import *
result = {"routes": {}, "audio": os.environ["AM_AUDIO"], "seconds": float(os.environ["AM_SECONDS"]), "docs": {}, "throttle": {"exposed": hasattr(unreal, "EditorPerformanceSettings")}}
if result["throttle"]["exposed"]:
    try:
        perf = unreal.get_default_object(unreal.EditorPerformanceSettings)
        result["throttle"]["before"] = perf.get_editor_property("throttle_cpu_when_not_foreground")
        perf.set_editor_property("throttle_cpu_when_not_foreground", False)
        result["throttle"]["after"] = perf.get_editor_property("throttle_cpu_when_not_foreground")
    except Exception:
        result["throttle"]["error"] = error()
for cls in [unreal.QuartzSubsystem, unreal.QuartzClockHandle]:
    for name in dir(cls):
        if any(x in name for x in ["clock", "subscribe", "minute", "quartz"]):
            result["docs"][cls.__name__+"."+name] = getattr(getattr(cls, name), "__doc__", None)
held = {}
def emit(clock_name, quantization_type, bars, beat, fraction):
    row = {"route": held["route"], "clock": str(clock_name), "quantization": str(quantization_type).split(".")[-1].split(':')[0].strip('<> '), "bar": int(bars), "beat": int(beat), "fraction": float(fraction)}
    unreal.log("AM_EVENT "+json.dumps(row))
    held["data"]["event_count"] += 1
def start(world, route, data):
    held.update(route=route, data=data)
    subsystems = list(unreal.ObjectIterator(unreal.QuartzSubsystem))
    data["subsystems"] = [{"path": path(x), "world": path(x.get_world())} for x in subsystems]
    sub = next((x for x in subsystems if x.get_world() == world), None)
    if sub is None: raise RuntimeError("no QuartzSubsystem instance for selected world")
    held["sub"] = sub
    data["is_quartz_enabled"] = sub.is_quartz_enabled()
    name = "AudioProbe_"+route
    held["name"] = name
    settings = unreal.QuartzClockSettings()
    signature = unreal.QuartzTimeSignature()
    signature.set_editor_property("num_beats", 4)
    signature.set_editor_property("beat_type", unreal.QuartzTimeSignatureQuantization.QUARTER_NOTE)
    settings.set_editor_property("time_signature", signature)
    clock = sub.create_new_clock(world, name, settings)
    held["clock"] = clock
    data["clock"] = path(clock)
    if clock is None: raise RuntimeError("create_new_clock returned None")
    boundary = unreal.QuartzQuantizationBoundary()
    data["quantization_members"] = [n for n in dir(unreal.QuartzCommandQuantization) if n.isupper()]
    boundary.set_editor_property("quantization", getattr(unreal.QuartzCommandQuantization, "NONE"))
    command = unreal.OnQuartzCommandEventBP()
    clock.set_beats_per_minute(world, boundary, command, beats_per_minute=120.0)
    delegate = unreal.OnQuartzMetronomeEventBP()
    try:
        delegate.bind_callable(emit)
        data["callable_route"] = "bind_callable"
    except Exception:
        data["bind_callable_error"] = error()
        @unreal.uclass()
        class AudioProbeReceiver(unreal.Object):
            @unreal.ufunction(params=[unreal.Name, unreal.QuartzCommandQuantization, int, int, float])
            def receive(self, clock_name, quantization_type, bars, beat, fraction):
                emit(clock_name, quantization_type, bars, beat, fraction)
        receiver = unreal.new_object(AudioProbeReceiver)
        held["receiver"] = receiver
        delegate.bind_function(receiver, "receive")
        data["callable_route"] = "ufunction bind_function"
    held.update(delegate=delegate, command=command)
    data["event_count"] = 0
    clock.subscribe_to_all_quantization_events(world, delegate)
    clock.start_clock(world)
    data["running_initial"] = clock.is_clock_running(world)
def tick(elapsed, world, route, data):
    return elapsed >= result["seconds"]
def finish(world, route, data):
    data["running_final"] = held["clock"].is_clock_running(world)
    data["bpm"] = held["clock"].get_beats_per_minute(world)
    data["estimated_runtime"] = held["sub"].get_estimated_clock_run_time(world, held["name"])
    held["clock"].stop_clock(world, cancel_pending_events=True)
    held["clock"].unsubscribe_from_all_time_divisions(world)
    held.clear()
session = Worlds(start, tick, finish, result)
