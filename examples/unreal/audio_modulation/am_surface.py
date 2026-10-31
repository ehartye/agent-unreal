"""List complete live class surfaces and documentation without guessing calls."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from am_common import *
NAMES = ["AudioModulationStatics", "SoundControlBusFactory", "SoundControlBusMixFactory", "SoundModulationPatchFactory", "SoundControlBus", "SoundControlBusMix", "SoundControlBusMixStage", "SoundModulationMixValue", "SoundModulationPatch", "SoundModulationPatchSettings", "SoundControlModulationPatch", "SoundModulationInput", "SoundControlModulationInput", "SoundModulationTransform", "SoundModulationParameter", "SoundModulationParameterVolume", "QuartzSubsystem", "QuartzClockHandle", "QuartzClockSettings", "QuartzTimeSignature", "QuartzCommandQuantization", "QuartzTimeSignatureQuantization", "QuartzQuantizationBoundary", "OnQuartzMetronomeEventBP", "OnQuartzCommandEventBP", "EditorPerformanceSettings", "EditorLevelLibrary", "LevelEditorSubsystem", "UnrealEditorSubsystem", "SubsystemBlueprintLibrary", "AssetTools", "EditorAssetLibrary"]
result = {"classes": {}, "functions": {}}
for name in NAMES:
    cls = getattr(unreal, name, None)
    item = {"present": cls is not None, "members": {}, "doc": getattr(cls, "__doc__", None)}
    if cls is not None:
        for member in dir(cls):
            try:
                item["members"][member] = getattr(getattr(cls, member), "__doc__", None)
            except Exception as exc:
                item["members"][member] = str(exc)
    result["classes"][name] = item
for name in ["new_object", "create_package", "get_default_object", "get_editor_subsystem", "get_world_subsystem", "register_slate_post_tick_callback", "unregister_slate_post_tick_callback"]:
    obj = getattr(unreal, name, None)
    result["functions"][name] = {"present": obj is not None, "doc": getattr(obj, "__doc__", None)}
write(result)
