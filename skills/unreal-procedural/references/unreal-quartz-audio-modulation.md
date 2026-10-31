# Quartz and Audio Modulation in Unreal 5.8

Target: Windows editor Python. Run names identify the 2026-10-31 [probe](../../../examples/unreal/audio_modulation/README.md) evidence. Audible output was not tested.

## Choose and enable

- [documented] Use Quartz for sample-accurate scheduling on musical boundaries. Epic names its Subsystem, Clock, Clock Handle and Metronome. `UQuartzSubsystem` belongs to `AudioMixer`, not a Quartz plugin ([overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-quartz-in-unreal-engine), `Source/Runtime/AudioMixer/Public/Quartz/QuartzSubsystem.h`).
- [documented] Use Audio Modulation for continuous volume/pitch controls, evolving Sound Class/Sound Mix. Its Modulation Parameters define normalization/mixing; Control Buses reference them; Control Bus Mixes apply stages; Parameter Patches remap buses; Generators change values over time. [MetaSounds](unreal-metasounds.md) supplies the DSP graph and can consume modulation ([reference](https://dev.epicgames.com/documentation/en-us/unreal-engine/audio-modulation-reference-guide-in-unreal-engine)).
- [documented] `AudioModulation` is off by default: enable it in Edit > Plugins and restart, or add `{"Name":"AudioModulation","Enabled":true}` to `.uproject` Plugins. Its descriptor has beta and experimental flags false, with Runtime and Editor modules (`Plugins/Runtime/AudioModulation/AudioModulation.uplugin`). Enable `PythonScriptPlugin` and `EditorScriptingUtilities` for the probe's editor scripts. Quartz needs no additional plugin.

## Python surface

- [tested] C-Q1 run 1 (`surface-1`, 2026-10-31) exposed `AudioModulationStatics`, the three factories below, `QuartzSubsystem`, `QuartzClockHandle`, clock settings/signature/boundary structs and both Quartz delegates. Subsystem calls include create/find/existence/running queries, timestamp/runtime getters and nine latency getters; handles expose tempo, start/stop and subscriptions. Exposure does not establish runtime behavior.
- [tested] C-Q1 run 1 (2026-10-31) found all 23 queried modulation methods, including create/activate/deactivate, value reads, destinations, generators, global values, updates and profile load/save. The complete member/docstring inventory is `surface.json`; examples below use only the observed subset.
- [tested] C-Q1 run 1 (2026-10-31) did not expose `get_world_subsystem`, `create_package`, `SubsystemBlueprintLibrary`, `EditorPerformanceSettings`, `SoundModulationPatchSettings` or `SoundModulationInput`. Asset readback identified `patch_settings` as `SoundControlModulationPatch`, with `SoundControlModulationInput` inputs (C-Q2 run 1). The probe could not disable background CPU throttling through `EditorPerformanceSettings`; it recorded frame deltas instead.

## Create, save and read back assets

- [tested] C-Q2 run 1 (`nosound-1`, 2026-10-31) created these assets through `AssetToolsHelpers.get_asset_tools().create_asset`; no fallback was needed.

| Asset | Class | Factory |
|---|---|---|
| Bus | `SoundControlBus` | `SoundControlBusFactory` |
| Mix | `SoundControlBusMix` | `SoundControlBusMixFactory` |
| Patch | `SoundModulationPatch` | `SoundModulationPatchFactory` |

- [tested] C-Q2 run 1 (2026-10-31) left the bus parameter and patch at factory defaults. This sequence follows `am_assets.py`:

```python
tools = unreal.AssetToolsHelpers.get_asset_tools()
definitions = [("Bus", "SoundControlBus"), ("Mix", "SoundControlBusMix"),
               ("Patch", "SoundModulationPatch")]
bus, mix, patch = [tools.create_asset(name, "/Game/AudioProbe", getattr(unreal, cls),
                                     getattr(unreal, cls + "Factory")())
                   for name, cls in definitions]
stage = unreal.SoundControlBusMixStage()
stage.set_editor_property("bus", bus)
value = unreal.SoundModulationMixValue()
value.set_editor_property("target_value", 0.25)
value.set_editor_property("attack_time", 0.1)
value.set_editor_property("release_time", 0.1)
stage.set_editor_property("value", value)
mix.set_editor_property("mix_stages", [stage])
saved = [unreal.EditorAssetLibrary.save_loaded_asset(x, only_if_is_dirty=False)
         for x in (bus, mix, patch)]
```

- [tested] C-Q2 run 1 (2026-10-31): all saves returned true. Fresh commandlet `unreal.load_asset` readback matched: classes above, bus `parameter` `/AudioModulation/Volume.Volume`, one `mix_stages` entry with bus `/Game/AudioProbe/Bus.Bus` and `value.target_value` 0.25, `patch_settings.inputs` count 1 and one `transform`. Functioning patch routing was not tested.

## Observe a bus value

- [tested] C-Q3 run 1 (`nosound-1`, 2026-10-31) read `AudioModulationStatics.get_modulator_value(world, bus)` and `is_control_bus_mix_active(world, mix)` before activation, after `activate_bus_mix` and after `deactivate_bus_mix`, with 2 seconds of ticks before each read. Editor and PIE both returned **1, 1, 1**, active **false, false, false**. The live docstring says an inactive modulator returns 1.0; no activation or value change was observed.
- [tested] C-Q3 run 1 (2026-10-31) issued `au.Debug.Modulation.Enable.Matrix 1`; no matrix or bus/mix rows appeared. Mean frame deltas: 0.00833338 s (editor), 0.00833329 s (PIE). Not established: activation. Next experiment: repeat value-only without `-nosound` (not run).

## Create and observe a clock

- [tested] C-Q4 runs 2 and 3 (`device-2`, `nosound-3`, 2026-10-31) used `UnrealEditorSubsystem.get_editor_world()`, then `get_game_world()` 5 seconds after `LevelEditorSubsystem.editor_request_begin_play()`. Select the `ObjectIterator(QuartzSubsystem)` instance whose `get_world()` matches; exclude the class default object.
- [tested] C-Q4 runs 2 and 3 (2026-10-31) created `QuartzClockSettings` with a `QuartzTimeSignature` (`num_beats=4`, `beat_type=QuartzTimeSignatureQuantization.QUARTER_NOTE`), then called `sub.create_new_clock(world, name, settings)`. It set a `QuartzQuantizationBoundary`'s `quantization` to `QuartzCommandQuantization.NONE`, called `clock.set_beats_per_minute(world, boundary, unreal.OnQuartzCommandEventBP(), beats_per_minute=120.0)`, and bound an `OnQuartzMetronomeEventBP` with `bind_callable(callback)`. The callback receives clock name, quantization type, bar, beat and fraction. Retain the clock and delegates; call `subscribe_to_all_quantization_events(world, delegate)`, then `start_clock(world)`. Keep the editor ticking for 16 s; finally `stop_clock(world, cancel_pending_events=True)` and `unsubscribe_from_all_time_divisions(world)`. The full asynchronous recipe is `am_quartz.py` plus `am_common.py`.
- [tested] C-Q4 run 1 (2026-10-31) failed before subscription on nonexistent `QuartzCommandQuantization.IMMEDIATE`. Runs 2 and 3 used `NONE`; the `ufunction` delegate fallback was not needed.
- [tested] C-Q4 runs 2 and 3 (2026-10-31) judged engine-log timestamps: at least 24 of 32 expected beats, median beat interval 0.45–0.55 s, median bar interval 1.8–2.2 s, consecutive bars. Both PIE runs delivered 32 beats and bars 1–8. Run 2 medians were 0.4950001/2.0030000 s; run 3 medians 0.5/2.0 s. `is_quartz_enabled()` was true in every world, including those without events; it is not proof that a clock runs.

## Headless and audio limits

- [tested] Under `-nullrhi`, C-Q1 run 1 and C-Q2 run 1 (2026-10-31) exposed the surface and saved/read back assets with `-nosound`. Their log said `LogAudio: Display: Audio Device Manager not initializing due to all audio being disabled. If this is not intentional, please check command line arguments for "-nosound".` Null RHI did not prevent those editor operations.
- [tested] Under `-nullrhi -nosound`, C-Q4 run 3 (2026-10-31) logged the same disabled-audio line and no `LogAudioMixer` lines. PIE advanced to 15.9936504 s at 120 BPM and passed timing; the editor clock stayed stopped at runtime 0 and 60 BPM, with zero callbacks. Mean frame deltas: editor 0.00833512 s, PIE 0.00833354 s. No unrelated engine workload was observed during this run.
- [tested] Without `-nosound`, C-Q4 run 2 (2026-10-31) logged `LogAudioMixer: Display: Initializing audio mixer using platform API: 'WASAPIMixer'` and identified a real hardware output device. The editor clock advanced to 15.9786663 s but delivered no callbacks; PIE passed timing. Mean frame deltas: editor 0.00841885 s, PIE 0.00836732 s. Another workload overlapped this run, so its timing is not an exclusive-host measurement.
- [general] Not established: why worlds differ, audible/sample-accurate playback, packaged or dedicated-server behavior, or combined Quartz/modulation sound. The null-device mixer fallback remains an untested inference: disabled-audio callbacks do not prove that mechanism.
