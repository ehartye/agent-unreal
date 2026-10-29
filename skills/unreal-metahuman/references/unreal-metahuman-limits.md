# Limits, requirements and project settings for a scripted MetaHuman

Unreal 5.8 on Windows. [tested] lines are probe runs dated 2026-10-29 (one machine, windowed editor, person at the first launch, four runs). [documented] lines name Epic's page. Anything not run is listed at the end as not established.

## Project settings

- [documented] Epic lists six settings that MetaHumans need, which a first Quixel Bridge import writes to `DefaultEngine.ini`; changing them needs an editor restart. Source: Epic's page "Requirements and Configuration Settings for MetaHumans in Unreal Engine". Under `[/Script/Engine.RendererSettings]`: `r.GPUSkin.Support16BitBoneIndex=True`, `r.GPUSkin.UnlimitedBoneInfluences=True`, `r.SkinCache.CompileShaders=True`, `r.SkinCache.DefaultBehavior=0`. Under `[ConsoleVariables]`: `SkeletalMesh.UseExperimentalChunking=1`, `fx.Niagara.ForceLastTickGroup=1`.
- [tested] 2026-10-29: a throwaway project whose config held none of the six made the editor warn about two missing project settings. The runs that followed wrote all six into the project config before the first editor launch, and the character built, spawned and animated.
- [general] A script that makes a project writes the six settings before the editor first opens it, because a running editor does not pick them up. Which two the editor named in the warning was not recorded.

## Shader model and Nanite

- [tested] 2026-10-29: a project at the default shader model warned that Nanite needs shader model 6, although the graphics hardware supported it and the project config set no target. The warning did not stop the build, the spawn or the frames.
- [general] Not established: whether setting the shader-model target removes the warning or changes the frames. Nanite and Lumen choices for a scene are in [unreal-rendering](../../unreal-rendering/SKILL.md).
- [documented] Epic's requirements page says Nanite does not support skeletal meshes and so will not work with MetaHumans, and links 5.5 and 5.6 pages. Source: "Requirements and Configuration Settings for MetaHumans in Unreal Engine", Nanite and Lumen. [general] Treat that sentence as possibly dated for 5.8: Epic's 5.8 release notes describe a MetaHuman Crowd plugin rendered with Nanite or dynamic LOD, and the assembled character here was not tested with Nanite.

## Plugins an assembled character may need

- [documented] In a project that never enabled the MetaHuman Creator plugin, an assembled character may need Groom, Rig Logic, Live Link, Live Link Control Rig, Control Rig and Megascans, with an editor restart. Source: the same page, Plugins.
- [general] When a spawned MetaHuman shows no hair or does not move, check that these plugins are enabled before suspecting the script. Enabling a plugin is in [unreal-editor-scripting](../../unreal-editor-scripting/SKILL.md).

## Grooms, levels of detail and platforms

- [tested] 2026-10-29: the assembled OPTIMIZED/MEDIUM character held two groom assets and two groom bindings, and the hair drew in the captured frames.
- [documented] Strand grooms, provided with MetaHumans at LOD 0 and 1, use a lot of memory and are not suitable for mobile. `r.HairStrands.MinLOD=3` removes some hair LODs at cook time, and `r.HairStrands.UseCardsInsteadOfStrands=1` forces cards, which draws nothing where a groom has no cards geometry. Source: the same page, Hair Strands Quality Settings and Useful Platform Scalability Settings. Hair authoring and cost are in [unreal-animation](../../unreal-animation/SKILL.md).
- [documented] MetaHumans use 8K textures; texture LOD groups manage the largest mip per platform. Skinned characters on mobile are limited to 75 bones, with `Compat.MAX_GPUSKIN_BONES=75` under `[ConsoleVariables]`. Source: the same page, MetaHumans on Mobile and Texture LOD Groups. No platform but Windows was run.
- [general] Pipeline choice is a platform choice: UE Optimized is Epic's real-time pipeline and UE Cine its non-interactive one ([Assemble and spawn](unreal-metahuman-assemble-and-spawn.md)). The per-platform LOD specifications are on a separate Epic page, "Platform Support and LOD Specifications for MetaHumans", that was not read.

## The editor, the memory and the time

- [tested] 2026-10-29: every run used a rendering editor with a window; a person was at the first launch and not at the repeat launches. In the last run, create, assemble and drive in one editor session took 448 s once the sign-in was in place; the build and the shader wait before the first frame are quiet for minutes, and the asset compiler warned about low memory limits.
- [general] Not established: headless or offscreen use. Epic's page "Scripting and Automating MetaHuman Animator in Unreal Engine" puts Python in a script run through the editor executable and names no commandlet, and no Epic page read for this skill shows a Character script under `-run=pythonscript`. Run modes are in [unreal-editor-scripting](../../unreal-editor-scripting/SKILL.md).
- [general] Bound every wait, write a progress file after each stage and end the editor from the script, so a stall shows as a timeout instead of an open window.

## Licence and generated files

- [documented] From 5.6 the MetaHuman toolset is covered by the standard Unreal Engine EULA, and MetaHuman characters and animations are classed as non-engine products, so they can be used in games made in other engines such as Unity or Godot. Source: CG Channel, "You can now sell MetaHumans, or use them in Unity or Godot", a press report of Epic's terms; read Epic's EULA for the terms themselves.
- [general] A MetaHuman and the frames of one are generated content under that licence. Keep them out of a repository you publish unless the terms allow it.

## Experimental parts and what was not run

- [documented] MetaHuman Crowd and single-camera body capture (the Markerless Motion Capture plugin) are labelled experimental in 5.8. Source: Epic's page "Unreal Engine 5.8 Release Notes". Neither was run.
- [general] Not established, because not run: the CINEMATIC pipeline succeeding; headless or offscreen use; ARKit values through the pose asset, Live Link, Sequencer with Control Rig, and morph targets for the face; Rig Mapper; `export_dcc`, `export_dna`, `export_geometry` and `export_materials`; Animator; Crowd; Mesh to MetaHuman from a custom head; a character from a non-preset source; any platform but Windows.
