"""Which Python routes leave a Landscape streaming proxy unloaded in the editor? (Unreal 5.8, editor)

  UnrealEditor.exe Project.uproject -nullrhi -ExecCmds="py <absolute-path-to-this-file>" -unattended -nosplash -nosound -notraceserver
      (in Git Bash set MSYS_NO_PATHCONV=1 or /Game/... is rewritten)
Environment: LW_REPORT (JSON path), LW_MAP (default /Game/Maps/LandscapeWp2, made by pcg_partition_probe.py; this script makes it when
it is missing). Needs the LandscapeBridge module (landscape_world.mjs builds it).

Why it exists: the Water carve check found every Landscape proxy loaded after load_map, and WorldPartitionBlueprintLibrary.unload_actors
unloaded none. Read from the install before the run:
  - UnloadActors only removes guids from a loader adapter list that LoadActors filled in the same Python session
    (Engine/Private/WorldPartitionBlueprintLibrary.cpp, LoaderAdapterActorListMap); it cannot unload what the editor or anything else loaded.
  - On opening a World Partition map in the editor, UWorldPartition::Initialize loads the always-loaded actors, then (only when streaming
    is enabled, and not for a commandlet) the regions the user had loaded last time, unless the per-project user setting
    bDisableLoadingOfLastLoadedRegions is set (Engine/Private/WorldPartition/WorldPartition.cpp; the setting is
    UWorldPartitionEditorPerProjectUserSettings, config + EditAnywhere, so Python can write it).
  - Engine/Private/WorldPartition/WorldPartition.cpp forces actors non-spatially-loaded in the editor when streaming is off for the world.
Steps, each followed by a count of the loaded LandscapeStreamingProxy actors against the number of proxy descriptors:
  open                 load_map(MAP)
  unload_unowned       unload_actors(all proxy guids) without load_actors first
  load_then_unload     load_actors(all), then unload_actors(all)
  setting_off          bDisableLoadingOfLastLoadedRegions set, another map opened, then MAP opened again; the setting is put back
Nothing here asserts that a proxy can be unloaded; the report says which step, if any, left one unloaded. A carve test over an unloaded
proxy (the Water river over a partitioned Landscape) is the follow-up when a step does.
"""
import os
import sys
import traceback

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import landscape_fixture as fx  # noqa: E402

pc = fx.pc
report = fx.make_report("wp-unload.json")
MAP = os.environ.get("LW_MAP", "/Game/Maps/LandscapeWp2")
WPL = unreal.WorldPartitionBlueprintLibrary
steps = report.setdefault("steps", {})


def proxy_guids():
    return [d.guid for d in WPL.get_actor_descs() if "LandscapeStreamingProxy" in str(d.native_class)]


def count(label, guids):
    lands, proxies = fx.loaded_landscapes()
    steps[label] = {"loaded_proxies": len(proxies), "loaded_landscape_actors": len(lands), "proxy_descriptors": len(guids),
                    "unloaded_proxies": max(0, len(guids) - len(proxies))}
    report.flush()


def attempt(fn):
    try:
        value = fn()
        return {"ok": True, "value": None if value is None else str(value)[:160]}
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:240]}


def stages():
    yield 30
    if not unreal.EditorAssetLibrary.does_asset_exist(MAP):
        fx.ensure_wp2_map(MAP, report)
        yield 30
    attempt(lambda: unreal.EditorLoadingAndSavingUtils.new_blank_map(False))
    yield 20
    opened = attempt(lambda: unreal.EditorLoadingAndSavingUtils.load_map(MAP))
    report["load_map"] = opened
    yield 120
    guids = proxy_guids()
    count("open", guids)

    report["unload_unowned_call"] = attempt(lambda: WPL.unload_actors(guids))
    yield 60
    count("unload_unowned", guids)

    report["load_call"] = attempt(lambda: WPL.load_actors(guids))
    yield 60
    count("after_load_actors", guids)
    report["unload_call"] = attempt(lambda: WPL.unload_actors(guids))
    yield 60
    count("load_then_unload", guids)

    settings_cls = getattr(unreal, "WorldPartitionEditorPerProjectUserSettings", None)
    report["settings_class_exposed"] = settings_cls is not None
    if settings_cls is not None:
        settings = settings_cls.get_default_object()
        before = attempt(lambda: settings.get_editor_property("disable_loading_of_last_loaded_regions"))
        report["setting_before"] = before
        report["setting_set"] = attempt(lambda: settings.set_editor_property("disable_loading_of_last_loaded_regions", True))
        report["setting_read_back"] = attempt(lambda: settings.get_editor_property("disable_loading_of_last_loaded_regions"))
        attempt(lambda: unreal.EditorLoadingAndSavingUtils.new_blank_map(False))
        yield 20
        report["reload"] = attempt(lambda: unreal.EditorLoadingAndSavingUtils.load_map(MAP))
        yield 120
        count("setting_off", guids)
        if before.get("ok"):
            restore = before.get("value") == "True"
            report["setting_restored"] = attempt(lambda: settings.set_editor_property("disable_loading_of_last_loaded_regions", restore))
    steps["any_unloaded"] = any(s.get("unloaded_proxies", 0) > 0 for s in steps.values() if isinstance(s, dict))
    report.flush()


def guarded():
    try:
        yield from stages()
    except Exception:
        report["errors"].append({"step": "stages", "error": traceback.format_exc()[-1500:]})


pc.run_stages(guarded, report)
unreal.log("[wp_unload_probe] stages registered")
