# What a MetaHuman needs: plugin, core data, Epic's cloud and a sign-in

Unreal 5.8 on Windows. [tested] lines are probe runs dated 2026-10-29: one machine, a windowed editor, a person at the first launch and none at the repeat launches, four runs ([probe README](../../../examples/unreal/metahuman/README.md)). [documented] lines name the Epic page they come from. [general] is judgement. A step that was not run says so.

## What a MetaHuman is

- [documented] The `MetaHumanCharacter` asset stores one character: face state, body state, skin, eyes, makeup, viewport settings and the slot-based wardrobe collection. The `MetaHumanCharacterEditorSubsystem` does the work that needs the editor: face and body edits, texture and auto-rig requests, and assembly. Source: Epic's page "MetaHuman Creator Python Scripting in Unreal Engine", Overview.
- [general] Keep three things apart: the character asset (data a script edits), the assembled assets (a Blueprint, skeletal meshes, materials and rig assets that `build_meta_human` writes) and the spawned actor. Scripting the face needs the last one; creating and rigging needs only the first.
- [documented] The same API is available from Editor Utility Blueprints. Source: the same page, opening note.

## Plugins and prerequisites

- [documented] A project on 5.8 or later, the MetaHuman Character plugin enabled, and Python scripting enabled for the editor. Source: the same page, Prerequisites.
- [tested] 2026-10-29: a throwaway project with the MetaHuman Character, Python Editor Script and Editor Scripting Utilities plugins was enough to create, rig, assemble and spawn a character. Enabling a plugin from a script and the restart it needs are in [unreal-editor-scripting](../../unreal-editor-scripting/SKILL.md).
- [general] The pages this skill was written from give no maturity label for the Character plugin. Read its flags in the install before promising stability.
- [documented] Animator scripting also needs the MetaHuman Animator, Capture Manager Editor, Python Editor Script and Editor Scripting Utilities plugins. Source: Epic's page "Scripting and Automating MetaHuman Animator in Unreal Engine". It was not run here.

## The core data install

- [general] The MetaHuman Creator core data is a separate Epic Games Launcher install: Library, the engine version, Options, "MetaHuman Creator Core Data". The menu path comes from the plugin's own warning and the probe's instructions, not from a run. A scripted install was not tried.
- [tested] 2026-10-29: after a person installed the core data, the plugin's `Content/Optional` folder held 1,816 files, 5.8 GB (measured on that install; the folder did not exist before it, and a headless names check found it missing).
- [tested] 2026-10-29: with the core data present, 29 preset character assets were installed and could be listed from Python.
- [general] Check that the install has presets before starting an engine run, and stop with a plain message when it does not. A missing install looks like a missing preset, not like a cloud failure.

## Epic's cloud services and the sign-in

- [documented] `request_texture_sources` and `request_auto_rigging` call MetaHuman Cloud services. The editor must be signed in to an Epic account with MetaHuman Cloud access; sign-in is handled by the editor and the first `request_auto_rigging` call in a session triggers it. Source: "MetaHuman Creator Python Scripting in Unreal Engine", Cloud Service Behavior.
- [documented] Epic's batch pattern is `blocking = True` with `report_progress = False`; the call returns after the cloud operation completes or fails. Same source.
- [tested] 2026-10-29: the first auto-rig request needed one Epic sign-in, done by the person at the editor, and took 150.7 s with the sign-in inside it, and the texture request 12.7 s. Across the six later requests (runs 1 to 4), auto-rig took 10.8 to 12.9 s and textures 8.7 to 11.6 s.
- [tested] 2026-10-29: the sign-in persisted. Three reopened editors with nobody at them finished by themselves with the rig and textures returned, in whole launches of 118, 123 and 128 s (editor start-up, shader work, the create stage and shutdown; one repeat launch's report records 84.3 s for its own flow), and the later runs' first launches in new throwaway projects needed none either. A prompt waiting for a person would have held the launch until its timeout, so the launch finishing is the evidence.
- [tested] 2026-10-29: the editor log holds lines that look like a sign-in and are not: a `LogEOSSDK` "Login complete" line, and the Slate warning `Unable to find Slate Widget Style 'MetaHumanAuthenticationMenu'`, four times per launch in one run. Judge by whether the launch finishes, not by matching "login".
- [general] Not established: how the first sign-in completes with nobody at the editor, which entitlement counts as "MetaHuman Cloud access", and any offline route for rigging or textures. Epic's pages do not say, and the runs had a person for the first sign-in.
- [general] Never ask for, read or store the person's credentials. The person signs in inside the editor; the script only waits.
- [documented] A restricted network must allow the auto-rigging cloud domains listed under Allowlist Domains in Epic's page "Getting Started with MetaHuman Animator".
- [documented] Export needs a rigged character with high-resolution textures, so both cloud requests come before any export. Source: "MetaHuman Creator Python Scripting in Unreal Engine", Prerequisites for Export.

## Before an engine run

- [general] A run that reaches the cloud is slow and needs a person for the first sign-in: confirm the core data, the plugin and the project settings in [Limits](unreal-metahuman-limits.md) first, because the project settings need an editor restart.
- [general] Run one Unreal process at a time and keep the editor window in front for the first run. Headless and offscreen runs were not tried; see [Limits](unreal-metahuman-limits.md).
