"""Create/save and, in a second process, read back three modulation assets."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from am_common import *
result = {"phase": os.environ["AM_PHASE"], "routes": {}, "docs": {}}
try:
    definitions = [("Bus", "SoundControlBus", "SoundControlBusFactory"), ("Mix", "SoundControlBusMix", "SoundControlBusMixFactory"), ("Patch", "SoundModulationPatch", "SoundModulationPatchFactory")]
    assets = []
    for name, clsname, factoryname in definitions:
        cls = getattr(unreal, clsname)
        result["docs"][clsname] = cls.__doc__
        if result["phase"] == "readback":
            obj = unreal.load_asset("/Game/AudioProbe/" + name)
        else:
            factory = getattr(unreal, factoryname, None)
            if factory is not None:
                result["routes"][name] = factoryname
                obj = unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, "/Game/AudioProbe", cls, factory())
            else:
                result["routes"][name] = "new_object into created package"
                create_package = getattr(unreal, "create_package", None)
                if create_package is None:
                    raise RuntimeError(factoryname + " absent; package-creation API absent, new_object package route unavailable")
                package = create_package("/Game/AudioProbe/" + name)
                obj = unreal.new_object(cls, outer=package, name=name)
        if obj is None:
            raise RuntimeError(name + " creation/load returned None")
        assets.append(obj)
    bus, mix, patch = assets
    if result["phase"] != "readback":
        stage = unreal.SoundControlBusMixStage()
        stage.set_editor_property("bus", bus)
        value = unreal.SoundModulationMixValue()
        value.set_editor_property("target_value", 0.25)
        value.set_editor_property("attack_time", 0.1)
        value.set_editor_property("release_time", 0.1)
        stage.set_editor_property("value", value)
        mix.set_editor_property("mix_stages", [stage])
        result["saved_each"] = [unreal.EditorAssetLibrary.save_loaded_asset(x, only_if_is_dirty=False) for x in assets]
        result["saved"] = all(result["saved_each"])
    settings = patch.get_editor_property("patch_settings")
    result["docs"][type(settings).__name__] = type(settings).__doc__
    inputs = list(settings.get_editor_property("inputs"))
    transforms = [x.get_editor_property("transform") for x in inputs]
    result["snapshot"] = {"classes": [x.get_class().get_name() for x in assets], "bus": path(bus), "parameter": path(bus.get_editor_property("parameter")), "stages": [{"bus": path(x.get_editor_property("bus")), "value": x.get_editor_property("value").get_editor_property("target_value")} for x in mix.get_editor_property("mix_stages")], "inputs": len(inputs), "transforms": len(transforms)}
except Exception:
    result["error"] = error()
write(result)
