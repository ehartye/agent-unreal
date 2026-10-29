# Limits, requirements and project settings for a scripted MetaHuman

Unreal 5.8 on Windows. [tested] lines are probe results dated 2026-10-29 on one machine in a windowed editor, each naming its runs (a person was at the first launch of each run). [documented] lines name Epic's page. Anything not run is listed at the end as not established.

## Project settings

- [documented] Epic lists six settings that MetaHumans need, which a first Quixel Bridge import writes to `DefaultEngine.ini`; changing them needs an editor restart. Source: Epic's page "Requirements and Configuration Settings for MetaHumans in Unreal Engine". Under `[/Script/Engine.RendererSettings]`: `r.GPUSkin.Support16BitBoneIndex=True`, `r.GPUSkin.UnlimitedBoneInfluences=True`, `r.SkinCache.CompileShaders=True`, `r.SkinCache.DefaultBehavior=0`. Under `[ConsoleVariables]`: `SkeletalMesh.UseExperimentalChunking=1`, `fx.Niagara.ForceLastTickGroup=1`.
- [tested] Run 2: the project config held none of the six when the first editor started (its log sets none of them); the person at the screen reported that the editor warned about 2 missing project settings (not in a saved log; which two was not recorded). The kept config after run 2 held three of the six (the `RendererSettings` ones except `r.SkinCache.DefaultBehavior`); who wrote them is not recorded. Run 2 still built (on a retry) and spawned the character, and drove no face.
- [tested] Runs 3 and 4: all six were written into the project config before the first launch. Run 3 built nothing (its first build attempt failed with `Cannot break link` and no retry was made). Run 4 built on its second attempt, spawned and animated the character. Whether the six settings matter to the build was not tested: run 2 built without all of them.
- [general] A script that makes a project writes the six settings before the editor first opens it, because Epic's page says changing them needs an editor restart.

## Shader model and Nanite

- [tested] Run 4: a project at the default shader model warned that Nanite needs shader model 6, although the editor log lists shader model 6.7 for the graphics hardware and the project config set no target (the warning is in the run notes, not in a saved log). The warning did not stop the build, the spawn or the frames.
- [general] Not established: whether setting the shader-model target removes the warning or changes the frames. Nanite and Lumen choices for a scene are in [unreal-rendering](../../unreal-rendering/SKILL.md).
- [documented] Epic's requirements page says Nanite does not support skeletal meshes and so will not work with MetaHumans, and links 5.5 and 5.6 pages. Source: "Requirements and Configuration Settings for MetaHumans in Unreal Engine", Nanite and Lumen. [general] Treat that sentence as possibly dated for 5.8: Epic's 5.8 release notes describe a MetaHuman Crowd plugin rendered with Nanite or dynamic LOD, and the assembled character here was not tested with Nanite.

## Plugins an assembled character may need

- [documented] In a project that never enabled the MetaHuman Creator plugin, an assembled character may need Groom, Rig Logic, Live Link, Live Link Control Rig, Control Rig and Megascans, with an editor restart. Source: the same page, Plugins.
- [general] When a spawned MetaHuman shows no hair or does not move, check that these plugins are enabled before suspecting the script. Enabling a plugin is in [unreal-editor-scripting](../../unreal-editor-scripting/SKILL.md).

## Grooms, levels of detail and platforms

- [tested] Run 4: the assembled OPTIMIZED/MEDIUM character held two groom assets and two groom bindings, and the hair drew in the captured frames.
- [documented] Strand grooms, provided with MetaHumans at LOD 0 and 1, use a lot of memory and are not suitable for mobile. `r.HairStrands.MinLOD=3` removes some hair LODs at cook time, and `r.HairStrands.UseCardsInsteadOfStrands=1` forces cards, which draws nothing where a groom has no cards geometry. Source: the same page, Hair Strands Quality Settings and Useful Platform Scalability Settings. Hair authoring and cost are in [unreal-animation](../../unreal-animation/SKILL.md).
- [documented] MetaHumans use 8K textures; texture LOD groups manage the largest mip per platform. Skinned characters on mobile are limited to 75 bones, with `Compat.MAX_GPUSKIN_BONES=75` under `[ConsoleVariables]`. Source: the same page, MetaHumans on Mobile and Texture LOD Groups. No platform but Windows was run.
- [general] Pipeline choice is a platform choice: UE Optimized is Epic's real-time pipeline and UE Cine its non-interactive one ([Assemble and spawn](unreal-metahuman-assemble-and-spawn.md)). The per-platform LOD specifications are on a separate Epic page, "Platform Support and LOD Specifications for MetaHumans", that was not read.

## The editor, the memory and the time

- [tested] Runs 1 to 4: every run used a rendering editor with a window; a person was at the first launch of each run and not at the repeat launches. In run 4, create, assemble and drive in one editor session took 448 s by the report's own clock (475 s as a launch); the build and the shader wait before the first frame were quiet for minutes, and the asset compiler's log warned that its memory estimate was above the available limit (run 4's log holds 140 such warnings, with limits from 84 MiB up to 2,252 MiB).
- [general] Not established: headless or offscreen character, assemble or drive use. Only a headless names check ran (classes and methods exist, no cloud, no character; once, before the core data was installed; 5 of 6 passed, the failing one the missing core data folder). Epic's page "Scripting and Automating MetaHuman Animator in Unreal Engine" puts Python in a script run through the editor executable and names no commandlet, and no Epic page read for this skill shows a Character script under `-run=pythonscript`. Run modes are in [unreal-editor-scripting](../../unreal-editor-scripting/SKILL.md).
- [general] Bound every wait, write a progress file after each stage and end the editor from the script, so a stall shows as a timeout instead of an open window.

## Licence and generated files

- [documented] From 5.6 the MetaHuman toolset is covered by the standard Unreal Engine EULA, and MetaHuman characters and animations are classed as non-engine products, so they can be used in games made in other engines such as Unity or Godot. Source: CG Channel, "You can now sell MetaHumans, or use them in Unity or Godot", a press report of Epic's terms; read Epic's EULA for the terms themselves.
- [general] A MetaHuman and the frames of one are generated content under that licence. Keep them out of a repository you publish unless the terms allow it.

## Experimental parts and what was not run

- [documented] MetaHuman Crowd and single-camera body capture (the Markerless Motion Capture plugin) are labelled experimental in 5.8. Source: Epic's page "Unreal Engine 5.8 Release Notes". Neither was run.
- [general] Not established: a CINEMATIC build succeeding (it failed on its one attempt, run 2); a headless or offscreen character, assemble or drive run (only the names check ran); ARKit values through the pose asset, Live Link, Sequencer with Control Rig, and morph targets for the face; Rig Mapper; `export_dcc`, `export_dna`, `export_geometry` and `export_materials`; Animator; Crowd; Mesh to MetaHuman from a custom head; a character from a non-preset source; any platform but Windows.
