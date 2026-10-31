# Audio Modulation and Quartz probe

Status: ran on Unreal 5.8. Surface discovery and fresh-process asset readback passed. Under `-nosound`, neither world activated the mix or moved its bus value. With audio enabled, PIE delivered Quartz events within tolerance; the editor delivered none. The repaired nosound run also delivered PIE events within tolerance; the editor clock stayed stopped. This is an opt-in native-engine probe, separate from the dependency-free merge checks.

```powershell
node examples/unreal/audio_modulation/am_probe.mjs --engine "<engine folder>" --plan
node examples/unreal/audio_modulation/am_probe.mjs --engine "<engine folder>" --only surface --evidence "<new evidence folder>"
node examples/unreal/audio_modulation/am_probe.mjs --engine "<engine folder>" --only assets,value,quartz --keep --evidence "<new evidence folder>"
node examples/unreal/audio_modulation/am_probe.mjs --engine "<engine folder>" --only quartz --audio device --evidence "<new evidence folder>"
```

Use the documented engine lock when other engine users share the machine. The runner starts one engine process at a time, sets a four-minute deadline per process, and stops only the child it started. `--plan` starts nothing. A content-only project is created in a unique OS temporary directory with PythonScriptPlugin, EditorScriptingUtilities and AudioModulation enabled. Every phase uses null RHI. Sound is disabled unless `--audio device` is selected; that mode is accepted only with `--only quartz`. The machine's audio devices and drivers are never changed.

| Group | Observation |
|---|---|
| `surface` | Every member and live docstring of named classes; missing classes are explicit. |
| `assets` | Factories create a bus, mix with one stage at 0.25 and patch, save them, then a separate process reads back classes, references and counts. |
| `value` | Editor and PIE routes read the bus before activation, after activation and after deactivation, two seconds after each transition. |
| `quartz` | Editor and PIE routes create a clock, set 120 BPM in 4/4, bind a Python callback and log all quantization events for 16 seconds per route. |

Quartz timing uses engine-log timestamps, not callback receipt time on the Node side: at least 24 beats, median beat interval 0.45–0.55 seconds, median bar interval 1.8–2.2 seconds, and consecutive bar numbers. `--seconds` changes the observation window (positive, at most 60 seconds); the published acceptance count is deliberately fixed to the 16-second experiment. The report also records world, callback route, frame delta, clock state and audio logs.

`--evidence` writes phase reports, full engine logs and `run.json` to a new evidence folder and retains the temporary project. `--keep` also retains the project. Without either, only a fully passing run is cleaned up; negative and interrupted runs remain inspectable. An existing evidence folder containing `run.json` is refused. GPU samples are taken before, during and after phases when `nvidia-smi` is available. A missing tool is reported, not silently treated as a measurement.

Exit codes: 0 all checks passed; 1 negative checks or process failure; 2 invalid options or missing engine. A negative capability observation is useful evidence and does not mean the probe implementation failed. Interpret each report and log before writing a recipe. No audio quality or audible-output claim is made.

## Recorded observations

The surface and asset questions each used one invocation. Value used one invocation: both editor and PIE read 1 → 1 → 1 with active false. No modulation matrix output was logged. `-nosound` logged `Audio Device Manager not initializing due to all audio being disabled.`

Quartz used all three permitted invocations. The first failed before subscription because `QuartzCommandQuantization.IMMEDIATE` is absent; the repaired script uses the observed `NONE` member. The second, with audio enabled, used a hardware WASAPI mixer, so it does not establish a null-device fallback. PIE produced 32 beats (median interval 0.4950001 s), bars 1–8 (median interval 2.0030000 s), with `bind_callable`. The editor clock advanced but produced zero events. Another engine workload appeared during this run despite use of the shared wrapper; these measurements do not establish exclusive-host timing. The final repaired nosound invocation ran without observed engine contention: PIE produced 32 beats (median 0.5 s), bars 1–8 (median 2 s), runtime 15.9936504 s and mean frame delta 0.0083335366 s. The editor produced no events, runtime 0 s and mean frame delta 0.0083351177 s. Both reported `IsQuartzEnabled` true and bound the callable. The log explicitly disabled the Audio Device Manager and contained no mixer initialization; this establishes observed PIE events under `-nosound`, not a null-device mixer mechanism. No audible-output or sound-quality judgement was made.

## Files and tests

`am_probe.mjs` owns process lifecycle and evidence; `am-probe-checks.mjs` owns option validation, phase planning and pure report judges; `am_common.py` owns report IO and editor/PIE sequencing. The four group scripts own their observations. Run `node --test examples/unreal/audio_modulation/am-probe.test.mjs` for report-positive/report-negative cases, options, planning and the owned-process timeout boundary. No engine runs in these tests.
