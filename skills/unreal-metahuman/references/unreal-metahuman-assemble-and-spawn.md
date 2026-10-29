# Assemble and spawn: build_meta_human, the retry rule, the Blueprint, a frame

Unreal 5.8 on Windows. [tested] lines are probe results dated 2026-10-29 on one machine in a windowed editor, each naming its run (a person was at the first launch of each run; run 1 never reached the build, run 3 built nothing, only run 4 drove the face). [documented] lines name Epic's page. The character must already be rigged and textured: [Script the character](unreal-metahuman-character-script.md).

## build_meta_human

- [documented] `build_meta_human(character, params)` takes a `MetaHumanCharacterEditorBuildParameters` with `pipeline_type` (a `MetaHumanDefaultPipelineType` such as `OPTIMIZED`), `pipeline_quality` (a `MetaHumanQualityLevel` such as `MEDIUM`), optional `absolute_build_path` and `common_folder_path`, and `enable_wardrobe_item_validation`. Source: Epic's page "MetaHuman Creator Python Scripting in Unreal Engine", Assemble a Character.
- [documented] Three pipelines: UE Cine (cinematic quality for non-interactive rendering; `pipeline_quality` ignored), UE Optimized (real time; quality `LOW`, `MEDIUM` or `HIGH`; `CINEMATIC` is silently treated as `HIGH`) and UEFN Export. DCC output uses the export utilities instead. Same source.
- [tested] Runs 2 and 4: the OPTIMIZED pipeline at MEDIUM quality built the character (on a retry both times; see below). `can_build_meta_human` was true before every attempt in runs 2, 3 and 4, including the ones that failed.
- [general] The call blocks the editor for minutes with no output. Run it from a script that logs before and after it, and allow two to four minutes per attempt.

## The retry rule

- [tested] Run 4: the first build attempt (OPTIMIZED, MEDIUM) failed with a Control Rig error, `Cannot break link`, naming `CR_MetaHuman_HeadMovement_IK_Proc` and `Face_ControlBoard_CtrlRig` under `/Game/MetaHumans/Common/Face/` (a `RuntimeError` from the subsystem, after 110.7 s). The second attempt, the same pipeline and quality, built in 64.5 s.
- [tested] Runs 2 and 3: run 2's first attempt, the CINEMATIC pipeline, failed after 250 s with the same error naming the same two assets, and the OPTIMIZED pipeline then built in 108 s. In run 3 an OPTIMIZED first attempt failed after 126 s with the same error, and no second attempt was made, so nothing was built.
- [tested] Run 2: the CINEMATIC pipeline was tried once, as the first attempt, and failed; it never succeeded in any run. A Cine build is not established.
- [general] Treat `Cannot break link` as a first-attempt failure: catch the `RuntimeError`, run the same build again once, and only then change pipeline. Runs 2 and 4 made a retry and each show one failure then one success; no run shows why. Bound the retries and report every attempt with its seconds and error.
- [general] After each attempt check the result, not the exception: the Blueprint asset exists and the build folder holds assets.

## What the build leaves

- [tested] Runs 2 and 4: a Blueprint at `/Game/MetaHumans/<name>/BP_<name>`, and 313 assets in run 2 and 282 in run 4, under `/Game/MetaHumans`. Run 4's 282 assets held 132 textures, 4 skeletal meshes, 2 groom assets with 2 groom bindings, 3 DNA assets, 4 Control Rig assets, 5 Animation Blueprints, 2 skeletons and materials. Shared assets sit under `/Game/MetaHumans/Common`.
- [tested] Run 4: among the shared assets were the face skeleton `Face_Archetype_Skeleton`, `AS_MetaHuman_ARKit_Mapping`, `PA_MetaHuman_ARKit_Mapping`, `ABP_Face` and `ABP_MH_LiveLink`. That they exist is all the runs show; see [Driving the face](unreal-metahuman-face.md).
- [general] A build writes hundreds of assets into the project. Build in a throwaway project, or a content folder you can delete, and keep the assets out of a public repository (licence: [Limits](unreal-metahuman-limits.md)).

## The Blueprint and its components

- [tested] Runs 2 and 4: the Blueprint spawned as `BP_<name>_C` with three skeletal mesh components named `Body`, `Face` and `SkeletalMesh`; the meshes (`SKM_<name>_BodyMesh`, `SKM_<name>_FaceMesh` and `<name>_Outfits` on the third) are from run 4. The hair showed in run 4's frames (run 2 captured none).
- [tested] Run 4: the script found the face component by name, `Face`, and played animation on it.
- [general] Look components up by name on the spawned actor instead of by index, and print the component names in the report; the names above are what one build produced.

## Spawn and capture

- [tested] Run 4: a new level (`LevelEditorSubsystem.new_level`), the Blueprint class loaded with `EditorAssetLibrary.load_blueprint_class` and spawned at the origin with `EditorActorSubsystem.spawn_actor_from_class`, then a camera actor, a directional light, a sky light and a cube as a backdrop. The person at the screen reported the editor saying "lighting needs to be rebuilt" (it is in no saved log); the captured frames were not affected.
- [tested] Run 4 (run 2 saved no frame): frames were saved with `AutomationLibrary.take_high_res_screenshot(1280, 720, name)` while Play-In-Editor ran, after a wait for shaders to compile. The shader wait before the first frame ran about two minutes in the log, and the build and that wait were quiet for minutes.
- [tested] Run 4: a frame of the empty level and a frame with the character differed in 65.22% of the face region, and by eye the frame shows a person with a face, hair and a white top. The probe saved the frames during the run; none is kept in this repository. The three pose frames are described in words in [Driving the face](unreal-metahuman-face.md): neutral, mouth closed; jaw open, mouth wide open; smile, smiling.
- [tested] Run 4: the camera sat on the world X axis looking at the head and saw the character in profile, facing left. The actor was spawned with no rotation, so its forward axis is not the world X axis here.
- [general] Spawn, take one frame, and read it before building a longer capture plan; put the camera on the actor's forward vector, or yaw the actor, to see the face from the front.
- [general] Cameras, screenshots and run modes for editor Python are in [unreal-editor-scripting](../../unreal-editor-scripting/SKILL.md); lighting, Lumen and the hair look are in [unreal-rendering](../../unreal-rendering/SKILL.md); Hair Strands content is in [unreal-animation](../../unreal-animation/SKILL.md).
