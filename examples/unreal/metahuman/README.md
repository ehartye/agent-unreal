# MetaHuman probe: create a character by script, assemble it, drive its face

Opt-in probe for the questions behind a MetaHuman skill: can an agent create a MetaHuman Character from a preset, rig it, fetch its textures, assemble it, put it in a level and move its face from a script, and does the cloud sign-in come back after the editor is reopened. Windows, Unreal Engine 5.8. Nothing here needs a project of yours: the runner makes a throwaway project (MetaHuman Character, PythonScriptPlugin, EditorScriptingUtilities) in the OS temp folder and deletes it on a clean run. The probe keeps no MetaHuman asset and commits none.

Status: four engine runs on 2026-10-29 in a windowed rendering editor, in a throwaway project at the default shader model (the run notes record that the editor warned that Nanite needs shader model 6; not in a saved log; not changed). A person was at the screen for the first launch of each run and nobody was at the editor for the repeat launches (runs 1, 3 and 4; run 2 had none). The runs differ, so every claim below names its run. The headless `--names` check ran once, before the core data was installed, and passed 5 of 6; the failing check was the missing core data folder. No offscreen or headless character run was made.

- **Run 1, 5 of 13.** `create` passed: preset copied, edited, committed, auto-rigged and textured with `blocking=True` after one sign-in by the person at the screen. The probe's own tick handler re-entered the flow during a blocking cloud call, so nothing after `create` ran (a probe bug, fixed with a re-entrancy guard). The repeat launch finished by itself in 118 s.
- **Run 2, 6 of 13.** The project config held none of the six Epic project settings when the first editor started; the person at the screen reported that the editor warned about 2 missing project settings (not in a saved log), and the kept config after the run held three of the six (who wrote them is not recorded). The Cine pipeline failed after 250 s with a Control Rig `Cannot break link` error, the optimized pipeline built on the retry in 108 s (313 assets) and the Blueprint spawned with Body and Face components. The three pose sequences were made and none was applied; no frame was saved. The log shows Play-In-Editor from 19:59:19 until the person closed the window at 20:01:52 (about 2.5 minutes) with no probe log line between; why the capture and pose code did not run is not established. There was no repeat launch. The probe then got bounded, logged waits, a final report and the six project settings.
- **Run 3, 5 of 13.** The six project settings were in the config from the start. The first optimized build failed after 126 s with the same error; a rule in the probe skipped the Cine pipeline, so no retry was made and nothing was built (a probe mistake, fixed). The repeat launch finished by itself in 123 s.
- **Run 4, 12 of 13 live, 13 of 13 re-judged offline after the sign-in check was simplified.** The six settings were present. The first optimized build failed with the `Cannot break link` error after 110.7 s and the second optimized attempt built in 64.5 s (attempt order now: optimized, optimized again after that error, then Cine). The character spawned with Body and Face components, and the route that moved the face is `anim_sequence_curves`: pose animation sequences with `CTRL_expressions_*` float curves played on the Face component, read back exactly. Frame differences in the face region: jaw open against neutral 10.43 percent, smile against neutral 5.22 percent, two neutral frames 0.76 percent. The repeat launch finished by itself in 128 s with the rig and textures returned. The one live failure was the earlier log-line check on the repeat launch.
- **Across runs.** The first `build_meta_human` attempt failed with the `Cannot break link` error in runs 2 (Cinematic), 3 (Optimized) and 4 (Optimized); a retry built in the two runs where one was made (run 2 Optimized after Cinematic, run 4 Optimized after Optimized). Why is not established. The Cine pipeline never built. The repeat launch finished by itself in the three runs that made one (118, 123 and 128 s as whole launches).

All of this is a probe result on one machine and is tested here against canned reports and a stubbed `unreal` module; morph targets, ARKit pose assets, Live Link and Sequencer were not tried.

## Run

```text
node examples/unreal/metahuman/mh_probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --names
node examples/unreal/metahuman/mh_probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --plan
node examples/unreal/metahuman/mh_probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--only create,assemble,drive,repeat] [--keep] [--out <folder>]
node examples/unreal/metahuman/mh_probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --phase prepare
node examples/unreal/metahuman/mh_probe.mjs --phase judge --project <folder prepare printed> [--keep] [--out <folder>]
```

| Option | Effect |
|---|---|
| `--names` | A headless check (`UnrealEditor-Cmd`, `-nullrhi`, `-unattended`): no cloud request, no sign-in, no character. Reports which classes, methods, fields and enum members the editor script uses are missing from the install, builds the three pose animation sequences on the face skeleton in memory and reads their keys back, and reports whether the core data folder exists |
| `--plan` | Prints the launches, the core data folder state and the owner steps; starts nothing |
| `--only` | Groups to run, in pipeline order. `create`, `assemble` and `drive` share one editor session; `repeat` is a second one |
| `--phase prepare` | Builds the project and prints numbered owner steps for opening it yourself; the project's start-up script runs the probe when it opens |
| `--phase judge` | Needs only `--project`: reads `Saved/mh-launch-N.json` and the screenshots, prints the checks, deletes the project on a clean run |
| `--keep` | Leaves the project (reports, logs, screenshots, the saved assets) |
| `--out <folder>` | Copies the screenshots and the reports there before the project is deleted. The screenshots show a MetaHuman: keep them out of the repository |
| `--preset <name>` | Copies this preset instead of the first one found |
| `--camera-flip` | Puts the camera on the other side of the actor, if the character faces the other way |
| `--timeout-minutes` | Replaces the launch timeouts (90 minutes for the first launch, 40 for `repeat`); the editor's own launch budget is the timeout less three minutes, so it ends the flow and writes the final report first |
| `--skip-core-data-check` | Starts the engine even though the core data folder is missing |

The exit code is 0 when every check passes, 1 when a check fails, 2 on a usage error, a missing engine or a missing core data folder (nothing started). A run is not part of `node scripts/check.mjs`; the pure checks and the runner's boundaries are tested there (`mh-probe.test.mjs`).

## Before a run

- **Core data.** The plugin keeps its presets, the texture synthesis model and the body textures in an `Optional` content folder that ships separately from the engine (Epic Games Launcher, Library, the engine version, Options, "MetaHuman Creator Core Data"). The editor warns and limits itself without it. The runner stops with exit code 2 before the engine starts when the folder is missing.
- **A rendering editor with a window.** The runs are not `-nullrhi` and not `-RenderOffScreen`, and not `-unattended`, because that would suppress the sign-in prompt. Keep the window in front and one Unreal process at a time. Do not close the editor: the shader wait and the character build are quiet for minutes, the runner prints a progress line every 30 seconds, every wait has a limit, and the editor closes itself.
- **Project settings.** The runner writes the six settings Epic lists for MetaHumans into the throwaway project's `Config/DefaultEngine.ini` before the first launch (they need an editor restart): `r.GPUSkin.Support16BitBoneIndex`, `r.GPUSkin.UnlimitedBoneInfluences`, `r.SkinCache.CompileShaders` and `r.SkinCache.DefaultBehavior` under `[/Script/Engine.RendererSettings]`, and `SkeletalMesh.UseExperimentalChunking` and `fx.Niagara.ForceLastTickGroup` under `[ConsoleVariables]`.
- **An Epic account with MetaHuman Cloud access.** Auto-rigging and the texture download are cloud calls. The first one raises the editor's sign-in; the person at the screen signs in inside the editor. The probe never asks for, reads or stores credentials.

## What it does

1. **create.** Copies a preset character asset into the project (the editor's own preset call is not exposed to Python; without a preset it falls back to the asset factory and the first check then fails). Registers it with `MetaHumanCharacterEditorSubsystem.try_add_object_to_edit`, nudges the face landmarks, `commit_face_state` and `commit_body_state`, `request_auto_rigging` and `request_texture_sources` with `blocking=True` and `report_progress=False`, reads `has_high_resolution_textures` and `can_build_meta_human` back (Python has no rigging-state getter), and `remove_object_to_edit`.
2. **assemble.** `build_meta_human` with the optimized pipeline; if that fails with the Control Rig `Cannot break link` error, the optimized pipeline again (a retry built in runs 2 and 4 after a first attempt failed with that error; why is not established); if that also fails, the Cine pipeline. A built Blueprint stops the sequence, and every attempt (pipeline, seconds, error, or why it was skipped) and the reason for the order are in the report; counts the assets under the build folder; spawns the Blueprint in a new level with a camera, two lights and a backdrop; starts Play-In-Editor, waits for shaders, and takes one frame with the actor hidden and one with it shown (`take_high_res_screenshot`, then the `Shot` console command if no file appears within the limit; each frame is recorded under `shots` with the method that produced the file). The frame check compares the face region of the two (a person still reads the image).
3. **drive.** One animation sequence per pose (neutral, jaw open, smile) on the face skeleton, writing the control curves `CTRL_expressions_jawOpen` and `CTRL_expressions_mouthCornerPullL`, `R`, `mouthCornerUpL`, `R` through `AnimationLibrary`, played on the Face component with `play_animation`; reads the values back with `get_curve_value`; one frame per pose and a second neutral frame as the noise control. The route that moved the face is recorded as `anim_sequence_curves`. Not tried, and listed as such in the report: ARKit values through the mapping pose asset, a Live Link pose, Sequencer with the face Control Rig, morph targets.
4. **repeat.** The create stage again, on a second character, in an editor that was closed and reopened and started with nobody at it. The check treats the launch finishing by itself as the answer, and a launch that times out is the failure; no run has timed out. The check judges behaviour only (report done, `end_reason` completed, not timed out, the create stage's rig and textures returned and `can_build_meta_human` true). An earlier version counted editor log lines that look like a sign-in; it was dropped because its pattern kept matching unrelated lines.

The editor script reads `Saved/mh-plan.json` from the project and writes `Saved/mh-launch-N.json` after every step, with a `progress` line and a bounded `trace`. Every wait has a limit from the plan (`pie_wait_seconds`, `shader_wait_seconds`, `shot_wait_seconds`, `build_wait_seconds`, `capture_budget_seconds`, and `launch_budget_seconds` for the whole launch); when one runs out the report gets an error naming the step, and the launch still ends with `done: true` and an `end_reason`. A report that stops partway names the step that did.

## Owner steps

`--phase run` prints these as it starts; `--phase prepare` prints the same list for opening the project yourself.

1. A rendering editor window opens (or open the project when told). Keep it in front and stay at the screen.
2. Do not click in the editor while it works. When Epic's sign-in prompt appears, sign in to your Epic account in the editor.
3. The editor closes itself when launch 1 is done (do not close it earlier; the runner prints progress).
4. For `repeat`, step away from the editor while launch 2 runs. If a sign-in prompt appears again, leave it: the launch times out and that is the result.
5. After `prepare`: `node examples/unreal/metahuman/mh_probe.mjs --phase judge --project <folder>`.

## Checks

Thirteen checks, in `mh-probe-checks.mjs` (`evaluateProbes`): four for `create`, three for `assemble`, four for `drive`, two for `repeat` (the second, `no sign-in flow appears in the reopened editor`, is judged by behaviour: the launch finished by itself with nobody at the editor, so no prompt blocked it); the names mode has six (`evaluateNames`). Each returns `{ pass, name, claim, detail }`; the run prints `N of M probe checks passed`. A frame differs when more than 0.5 percent of the face region changed and more than four times what two neutral frames differ by; a face is visible when the shown frame differs from the control frame in that region by more than 5 percent and is not flat. Those bounds are the probe's own; run 4's frames passed them (jaw open against neutral 10.43 percent, smile 5.22, two neutral frames 0.76).

## Files

| File | Role |
|---|---|
| `mh_probe.mjs` | Runner: project, plan, launches, screenshots, judge, cleanup |
| `mh_probe_editor.py` | In-editor script (names mode and the stages) |
| `mh-probe-checks.mjs` | Pure options, plan, owner steps and checks |
| `mh-probe.test.mjs` | Node tests of the checks and the runner's boundaries |
