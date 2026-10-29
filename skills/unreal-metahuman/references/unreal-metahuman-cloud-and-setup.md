# What a MetaHuman needs: plugin, core data, Epic's cloud and a sign-in

Unreal 5.8 on Windows. [tested] lines are probe results dated 2026-10-29 on one machine in a windowed editor, each naming its runs (four runs; a person was at the first launch of each run and nobody at the repeat launches; [probe README](../../../examples/unreal/metahuman/README.md)). [documented] lines name the Epic page they come from. [general] is judgement. A step that was not run says so.

## What a MetaHuman is

- [documented] The `MetaHumanCharacter` asset stores one character: face state, body state, skin, eyes, makeup, viewport settings and the slot-based wardrobe collection. The `MetaHumanCharacterEditorSubsystem` does the work that needs the editor: face and body edits, texture and auto-rig requests, and assembly. Source: Epic's page "MetaHuman Creator Python Scripting in Unreal Engine", Overview.
- [general] Keep three things apart: the character asset (data a script edits), the assembled assets (a Blueprint, skeletal meshes, materials and rig assets that `build_meta_human` writes) and the spawned actor. Scripting the face needs the last one; creating and rigging needs only the first.
- [documented] The same API is available from Editor Utility Blueprints. Source: the same page, opening note.

## Plugins and prerequisites

- [documented] A project on 5.8 or later, the MetaHuman Character plugin enabled, and Python scripting enabled for the editor. Source: the same page, Prerequisites.
- [tested] Runs 1 to 4: a throwaway project with the MetaHuman Character, Python Editor Script and Editor Scripting Utilities plugins was enough to create and rig a character; runs 2 and 4 also assembled and spawned it. Enabling a plugin from a script and the restart it needs are in [unreal-editor-scripting](../../unreal-editor-scripting/SKILL.md).
- [general] The pages this skill was written from give no maturity label for the Character plugin. Read its flags in the install before promising stability.
- [documented] Animator scripting also needs the MetaHuman Animator, Capture Manager Editor, Python Editor Script and Editor Scripting Utilities plugins. Source: Epic's page "Scripting and Automating MetaHuman Animator in Unreal Engine". It was not run here.

## The core data install

- [general] The MetaHuman Creator core data is a separate Epic Games Launcher install: Library, the engine version, Options, "MetaHuman Creator Core Data". The menu path comes from the plugin's own warning and the probe's instructions, not from a run. A scripted install was not tried.
- [tested] Outside the four runs: after a person installed the core data, the plugin's `Content/Optional` folder held 1,816 files, 5.8 GB (measured on that install; the folder did not exist before it, and the headless names check found it missing).
- [tested] Runs 1 to 4: with the core data present, 29 preset character assets were installed and could be listed from Python (the count is from runs 1 and 4).
- [general] Check that the install has presets before starting an engine run, and stop with a plain message when it does not. A missing install looks like a missing preset, not like a cloud failure.

## Epic's cloud services and the sign-in

- [documented] `request_texture_sources` and `request_auto_rigging` call MetaHuman Cloud services. The editor must be signed in to an Epic account with MetaHuman Cloud access; sign-in is handled by the editor and the first `request_auto_rigging` call in a session triggers it. Source: "MetaHuman Creator Python Scripting in Unreal Engine", Cloud Service Behavior.
- [documented] Epic's batch pattern is `blocking = True` with `report_progress = False`; the call returns after the cloud operation completes or fails. Same source.
- [tested] Run 1: the first auto-rig request needed one Epic sign-in, done by the person at the editor, and took 150.7 s with the sign-in inside it, and the texture request 12.7 s. Across the six later requests (run 1's repeat launch, run 2, run 3's two launches, run 4's two launches), auto-rig took 10.8 to 12.9 s and textures 8.7 to 11.6 s.
- [tested] Runs 2 to 4: the person at the screen saw no sign-in prompt in the first launch of a new project. Runs 1, 3 and 4: the repeat launch, a reopened editor with nobody at it, finished by itself with the rig and textures returned, in whole launches of 118 s (run 1), 123 s (run 3) and 128 s (run 4); editor start-up, shader work, the create stage and shutdown are in those times, and the reports of runs 3 and 4 record 86.7 s and 84.3 s for the launch's own flow. Run 2 had no repeat launch. No launch timed out. How the sign-in is kept between launches was not examined.
- [general] Judge a repeat launch by behaviour: it finished by itself with nobody at the editor, or it timed out. Do not count editor log lines that look like a sign-in: lines with "login" or "authentication" in them occur that are not a prompt, and the probe dropped its log-line check for that reason.
- [general] Not established: how the first sign-in completes with nobody at the editor, which entitlement counts as "MetaHuman Cloud access", and any offline route for rigging or textures. Epic's pages do not say, and run 1 had a person for the first sign-in.
- [general] Never ask for, read or store the person's credentials. The person signs in inside the editor; the script only waits.
- [documented] A restricted network must allow the auto-rigging cloud domains listed under Allowlist Domains in Epic's page "Getting Started with MetaHuman Animator".
- [documented] Export needs a rigged character with high-resolution textures, so both cloud requests come before any export. Source: "MetaHuman Creator Python Scripting in Unreal Engine", Prerequisites for Export.

## Before an engine run

- [general] A run that reaches the cloud is slow and needs a person for the first sign-in: confirm the core data, the plugin and the project settings in [Limits](unreal-metahuman-limits.md) first, because the project settings need an editor restart.
- [general] Run one Unreal process at a time and keep the editor window in front for the first run. Only a headless names check ran, and no offscreen or headless character run was made; see [Limits](unreal-metahuman-limits.md).
