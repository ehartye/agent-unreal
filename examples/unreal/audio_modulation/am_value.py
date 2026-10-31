"""Observe the same mix before, during and after activation in each world."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from am_common import *
result = {"routes": {}, "audio": os.environ["AM_AUDIO"], "settle_seconds": 2, "docs": {}}
api = unreal.AudioModulationStatics
for name in ["create_bus", "create_bus_mix_stage", "create_bus_mix", "get_modulator_value", "is_control_bus_mix_active", "activate_bus_mix", "deactivate_bus_mix"]:
    result["docs"][name] = getattr(api, name).__doc__
held = {}
def read(world):
    return {"value": api.get_modulator_value(world, held["bus"]), "active": api.is_control_bus_mix_active(world, held["mix"])}
def start(world, route, data):
    bus = unreal.load_asset("/Game/AudioProbe/Bus")
    mix = unreal.load_asset("/Game/AudioProbe/Mix")
    data["objects"] = "saved assets"
    if bus is None or mix is None:
        data["objects"] = "create_bus/create_bus_mix_stage/create_bus_mix"
        bus = api.create_bus(world, "ProbeBus_"+route, None, activate=False)
        stage = api.create_bus_mix_stage(world, bus, 0.25, attack_time=0.1, release_time=0.1)
        mix = api.create_bus_mix(world, "ProbeMix_"+route, [stage], activate=False)
    held.update(bus=bus, mix=mix)
    data["stage"] = 0
def tick(elapsed, world, route, data):
    if elapsed >= 2 and data["stage"] == 0:
        data["before"] = read(world)
        api.activate_bus_mix(world, held["mix"])
        data["matrix_command"] = "au.Debug.Modulation.Enable.Matrix 1"
        unreal.SystemLibrary.execute_console_command(world, data["matrix_command"])
        data["stage"] = 1
    if elapsed >= 4 and data["stage"] == 1:
        data["after"] = read(world)
        api.deactivate_bus_mix(world, held["mix"])
        data["stage"] = 2
    if elapsed >= 6:
        data["deactivated"] = read(world)
        return True
    return False
def finish(world, route, data):
    held.clear()
session = Worlds(start, tick, finish, result)
