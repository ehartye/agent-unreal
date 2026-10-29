---
name: unreal-metahuman
description: "Create, assemble and drive an Unreal Engine 5.8 MetaHuman from a script: what needs Epic's cloud, an account and a sign-in, creating a character from a preset with the MetaHuman Character Python API, auto-rigging and textures, build_meta_human and its retry rule, the assembled Blueprint, and moving the face with control curves. Not for animation systems in general (use unreal-animation), importing a GLB or other file (unreal-import), runtime character customization with Mutable or modelling and rigging a character with agent-meshes (mesh-authoring, mesh-rigging, mesh-tool-selection)."
when_to_use: "Use when asked to make, script, rig, assemble or animate a MetaHuman or digital human; to call MetaHumanCharacterEditorSubsystem, request_auto_rigging, request_texture_sources or build_meta_human; when a MetaHuman build fails with 'Cannot break link'; about the MetaHuman Creator core data, the Epic sign-in or MetaHuman Cloud access; to move a MetaHuman's face with CTRL_expressions curves; or whether a MetaHuman script can run unattended or headless."
---

# Scripting a MetaHuman in Unreal 5.8

Unreal 5.8 on Windows. A MetaHuman is Epic's realistic digital human: a character asset an editor script can create and edit, assembled by `build_meta_human` into a Blueprint with body, face and outfit meshes, and animated on the face through control curves. Pick the step from the goal, then read its reference. Labels: [tested] is a probe result dated 2026-10-29 on one machine in a windowed editor, naming the run or runs it comes from (four runs; a person was at the first launch of each run and nobody at the repeat launches; the runs differ, see [the probe](../../examples/unreal/metahuman/README.md)), [documented] names Epic's page, [general] is judgement. Other Unreal skills: `unreal-animation`, `unreal-import`, `unreal-rendering`, `unreal-editor-scripting`, `unreal-effects`, `unreal-gameplay`, `unreal-procedural`, `unreal-native`, `uefn`, `unreal-architecture`, `unreal-quality`.

| You are about to | Read |
|---|---|
| Ask what a MetaHuman needs: the Character plugin, the core data install, Epic's cloud, an account, a sign-in, or whether the sign-in comes back | [Cloud and setup](references/unreal-metahuman-cloud-and-setup.md) |
| Create a character from a preset, edit and commit it, auto-rig it, fetch textures, or ask what else is scriptable (wardrobe, conform, export) | [Script the character](references/unreal-metahuman-character-script.md) |
| Run `build_meta_human`, retry a `Cannot break link` failure, find the Blueprint and its components, spawn it or capture a frame | [Assemble and spawn](references/unreal-metahuman-assemble-and-spawn.md) |
| Move the face with control curves, or choose among the ARKit pose asset, Live Link, Sequencer and morph routes | [Driving the face](references/unreal-metahuman-face.md) |
| Set the project settings, shader model, grooms and levels of detail, check the licence, or ask whether it runs headless and what is not established | [Limits and settings](references/unreal-metahuman-limits.md) |

## What the runs showed

- [tested] Runs 1 to 4, 2026-10-29: a MetaHuman Character was created from a copied preset, edited, committed, auto-rigged and textured by script with `blocking = True`. The runs happened after the MetaHuman Creator core data was installed (a separate Launcher install; 1,816 files, 5.8 GB as measured on that install); the headless names check, made before the install, found that folder missing. In run 1 the first auto-rig request took 150.7 s with one Epic sign-in done by the person at the editor.
- [tested] Runs 2 to 4: the person at the screen saw no sign-in prompt in the first launch of a new project. Runs 1, 3 and 4: the repeat launch (a reopened editor, nobody at it) finished by itself with the rig and textures returned, in whole launches of 118 s (run 1), 123 s (run 3) and 128 s (run 4); the reports of runs 3 and 4 record 86.7 s and 84.3 s for the launch's own flow. Run 2 had no repeat launch. No launch timed out. Rig and texture times: run 1's first requests took 150.7 s and 12.7 s; the six later requests (runs 1 to 4) took 10.8 to 12.9 s and 8.7 to 11.6 s.
- [tested] Runs 2, 3 and 4 (the three that reached it): the first `build_meta_human` attempt failed with a Control Rig `Cannot break link` error. Run 2: CINEMATIC failed, then OPTIMIZED built (313 assets). Run 4: OPTIMIZED failed, then OPTIMIZED built (282 assets). Run 3: OPTIMIZED failed and no retry was made, so no Blueprint. A retry built both times it was made; why is not established. CINEMATIC never succeeded.
- [tested] Run 4 (run 2 also spawned the Blueprint but captured no frame; run 3 built nothing): the Blueprint spawned in a new level and a frame showed the character with a face. Float curves named `CTRL_expressions_*` in AnimSequences on `Face_Archetype_Skeleton`, played on the Face component, moved the face: the saved frames show a closed mouth, an open jaw and a smile. Runs 1 to 3 drove no face.

## Rules of thumb

- [general] Order the work: core data and project settings first, then create, rig and texture, then build, then spawn, then drive. Each stage can be read back before the next: [Script the character](references/unreal-metahuman-character-script.md).
- [documented] Auto-rigging and texture download call MetaHuman Cloud services and need an Epic account with MetaHuman Cloud access; pass `blocking = True` and `report_progress = False` in batch scripts. Source: Epic's page "MetaHuman Creator Python Scripting in Unreal Engine".
- [general] Never handle credentials. The person signs in inside the editor; the script waits and reports.
- [general] Retry a failed `build_meta_human` once with the same pipeline before changing it (run 4's retry did that; run 2's retry used the other pipeline), and check for the Blueprint afterwards: [Assemble and spawn](references/unreal-metahuman-assemble-and-spawn.md).
- [general] Bound every wait and log progress while it runs. In run 4 the build (two attempts) and the shader wait before the first frame were quiet for minutes, which looked like a hang to the person at the screen.
- [general] Only a headless names check ran (classes and methods exist, no cloud, no character; once, before the core data was installed, 5 of 6 passed, the failing one the missing core data folder): no offscreen or headless character, assemble or drive run was made. The CINEMATIC pipeline succeeding, the ARKit, Live Link and Sequencer routes for the face, export, Animator, Crowd and Mesh to MetaHuman were not run either; each reference says so where it applies.
- [general] Hand off by topic. Control Rig, Sequencer and Hair Strands are in `unreal-animation`; lighting, Nanite and materials in `unreal-rendering`; editor Python run modes, cameras and enabling a plugin in `unreal-editor-scripting`. A model from agent-meshes is not a MetaHuman: bring it in with `unreal-import`, and rig it with `mesh-rigging`. Mutable's runtime composition is not part of this skill.

Enable only the plugins a task needs: the steps are under Enable a feature in [unreal-editor-scripting](../unreal-editor-scripting/SKILL.md).
