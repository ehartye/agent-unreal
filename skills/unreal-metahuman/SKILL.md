---
name: unreal-metahuman
description: "Create, assemble and drive an Unreal Engine 5.8 MetaHuman from a script: what needs Epic's cloud, an account and a sign-in, creating a character from a preset with the MetaHuman Character Python API, auto-rigging and textures, build_meta_human and its retry rule, the assembled Blueprint, and moving the face with control curves. Not for animation systems in general (use unreal-animation), importing a GLB or other file (unreal-import), runtime character customization (unreal-mutable) or modelling and rigging a character with agent-meshes (mesh-authoring, mesh-rigging, mesh-tool-selection)."
when_to_use: "Use when asked to make, script, rig, assemble or animate a MetaHuman or digital human; to call MetaHumanCharacterEditorSubsystem, request_auto_rigging, request_texture_sources or build_meta_human; when a MetaHuman build fails with 'Cannot break link'; about the MetaHuman Creator core data, the Epic sign-in or MetaHuman Cloud access; to move a MetaHuman's face with CTRL_expressions curves; or whether a MetaHuman script can run unattended or headless."
---

# Scripting a MetaHuman in Unreal 5.8

Unreal 5.8 on Windows. A MetaHuman is Epic's realistic digital human: a character asset an editor script can create and edit, assembled by `build_meta_human` into a Blueprint with body, face and outfit meshes, and animated on the face through control curves. Pick the step from the goal, then read its reference. Labels: [tested] is a probe run dated 2026-10-29 (one machine, a windowed editor, a person at the first launch and none at the repeat launches, four runs; [the probe](../../examples/unreal/metahuman/README.md)), [documented] names Epic's page, [general] is judgement. Other Unreal skills: `unreal-animation`, `unreal-import`, `unreal-rendering`, `unreal-editor-scripting`, `unreal-effects`, `unreal-gameplay`, `unreal-procedural`, `unreal-native`, `uefn`, `unreal-architecture`, `unreal-quality`.

| You are about to | Read |
|---|---|
| Ask what a MetaHuman needs: the Character plugin, the core data install, Epic's cloud, an account, a sign-in, or whether the sign-in comes back | [Cloud and setup](references/unreal-metahuman-cloud-and-setup.md) |
| Create a character from a preset, edit and commit it, auto-rig it, fetch textures, or ask what else is scriptable (wardrobe, conform, export) | [Script the character](references/unreal-metahuman-character-script.md) |
| Run `build_meta_human`, retry a `Cannot break link` failure, find the Blueprint and its components, spawn it or capture a frame | [Assemble and spawn](references/unreal-metahuman-assemble-and-spawn.md) |
| Move the face with control curves, or choose among the ARKit pose asset, Live Link, Sequencer and morph routes | [Driving the face](references/unreal-metahuman-face.md) |
| Set the project settings, shader model, grooms and levels of detail, check the licence, or ask whether it runs headless and what is not established | [Limits and settings](references/unreal-metahuman-limits.md) |

## What the runs showed

- [tested] 2026-10-29: A MetaHuman Character was created from a copied preset, edited, committed, auto-rigged and textured by script with `blocking = True`. It needed the MetaHuman Creator core data (a separate Launcher install; 1,816 files, 5.8 GB as measured on that install) and one Epic sign-in by a person at the editor.
- [tested] 2026-10-29: The sign-in persisted: three reopened editors with nobody at them finished by themselves with the rig and textures returned, and no prompt held them. Those were whole launches (editor start-up, shader work, the create stage, shutdown) of 118 to 128 s; one repeat launch's report records 84.3 s for its own flow. In the create stage, auto-rigging took 150.7 s and textures 12.7 s the first time, then 10.8 to 12.9 s and 8.7 to 11.6 s across the six later requests (runs 1 to 4).
- [tested] 2026-10-29: `build_meta_human` failed on a first attempt with a Control Rig `Cannot break link` error in all three runs that reached it. Run 2: CINEMATIC failed, then OPTIMIZED built (313 assets). Run 4: OPTIMIZED failed, then OPTIMIZED built (282 assets). Run 3: OPTIMIZED failed and nothing was retried, so no Blueprint. A retry after a first-attempt failure worked both times it was made; CINEMATIC never succeeded.
- [tested] 2026-10-29: The Blueprint spawned in a new level and a frame showed the character with a face. Float curves named `CTRL_expressions_*` in AnimSequences on `Face_Archetype_Skeleton`, played on the Face component, moved the face: the saved frames show a closed mouth, an open jaw and a smile.

## Rules of thumb

- [general] Order the work: core data and project settings first, then create, rig and texture, then build, then spawn, then drive. Each stage can be read back before the next: [Script the character](references/unreal-metahuman-character-script.md).
- [documented] Auto-rigging and texture download call MetaHuman Cloud services and need an Epic account with MetaHuman Cloud access; pass `blocking = True` and `report_progress = False` in batch scripts. Source: Epic's page "MetaHuman Creator Python Scripting in Unreal Engine".
- [general] Never handle credentials. The person signs in inside the editor; the script waits and reports.
- [general] Retry a failed `build_meta_human` once with the same pipeline before changing it, and check for the Blueprint afterwards: [Assemble and spawn](references/unreal-metahuman-assemble-and-spawn.md).
- [general] Bound every wait. The build and the shader wait before the first frame are quiet for minutes.
- [general] Headless and offscreen use, the CINEMATIC pipeline, the ARKit, Live Link and Sequencer routes for the face, export, Animator, Crowd and Mesh to MetaHuman were not run; each reference says so where it applies.
- [general] Hand off by topic. Control Rig, Sequencer and Hair Strands are in `unreal-animation`; lighting, Nanite and materials in `unreal-rendering`; editor Python run modes, cameras and enabling a plugin in `unreal-editor-scripting`. A model from agent-meshes is not a MetaHuman: bring it in with `unreal-import`, and rig it with `mesh-rigging`. Mutable's runtime composition is `unreal-mutable`.

Enable only the plugins a task needs: the steps are under Enable a feature in [unreal-editor-scripting](../unreal-editor-scripting/SKILL.md).
