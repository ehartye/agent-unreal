# Driving the face: the route that worked and the routes not run

Unreal 5.8 on Windows. [tested] lines are probe runs dated 2026-10-29 (one machine, windowed editor, person at the first launch). [documented] lines name Epic's page. Needs a spawned, assembled character: [Assemble and spawn](unreal-metahuman-assemble-and-spawn.md).

## The control curves

- [documented] Epic's Facial Description Standard is the list of control curves that represent facial movements of a MetaHuman. It is the basic representation stored when you bake an AnimSequence from Control Rig or export from MetaHuman Animator. Source: Epic's page "MetaHuman Facial Description Standard", which links the index of curves.
- [tested] 2026-10-29: five curves from that family moved the face: `CTRL_expressions_jawOpen`, `CTRL_expressions_mouthCornerPullL`, `CTRL_expressions_mouthCornerPullR`, `CTRL_expressions_mouthCornerUpL` and `CTRL_expressions_mouthCornerUpR`. The index page was not read for these runs, so no other curve name is established here.
- [general] Take curve names from Epic's index, not from guesses, and read back a value before judging a frame.

## The route that worked: float curves in an AnimSequence on the face skeleton

- [tested] 2026-10-29: one AnimSequence per pose was created with `AnimSequenceFactory` on the skeleton `Face_Archetype_Skeleton` (the `target_skeleton` property), each holding one key at time 0 and a play length of 1.0 s. The curves were added with `AnimationLibrary.add_curve(sequence, name, RawCurveTrackTypes.RCT_FLOAT)` and `AnimationLibrary.add_float_curve_key(sequence, name, 0.0, value)`.
- [tested] 2026-10-29: the poses were neutral (`jawOpen` 0), jaw open (`jawOpen` 1) and smile (`mouthCornerPullL` and `mouthCornerPullR` 1, `mouthCornerUpL` and `mouthCornerUpR` 0.5).
- [tested] 2026-10-29: each sequence was played on the spawned actor's `Face` component with `play_animation(sequence, True)`. That switched the component from Animation Blueprint mode (it used `ABP_Face`) to single-node mode.
- [tested] 2026-10-29: `get_curve_value` on the component read the written values back exactly for all five curves.
- [tested] 2026-10-29: each pose needed about 3 s to evaluate before its frame was taken; the frames were taken in Play-In-Editor.
- [tested] 2026-10-29: the three saved frames differ in the face region by 10.43% (jaw open against neutral), 5.22% (smile against neutral) and 11.68% (jaw open against smile), where two neutral frames differ by 0.76%. By eye the mouth is closed in the neutral frame, wide open in the jaw-open frame and a smile in the smile frame. The camera saw the character in profile.
- [general] The pose is a set of curve values, so the same route should carry a clip with keys over time; only single-key poses were run. Whether the curves reach the rig through a Control Rig, a pose asset or morph targets inside `ABP_Face` was not examined.
- [general] Because the face moved only after `play_animation` replaced the Animation Blueprint, expect that call to stop whatever the Animation Blueprint was doing on that component, such as a Live Link feed.

## Routes not run

- [tested] 2026-10-29: the assembled project held `AS_MetaHuman_ARKit_Mapping` and `PA_MetaHuman_ARKit_Mapping`. Using the ARKit pose asset to drive the face with ARKit values was not run: not established.
- [documented] Rig Mapper transfers motion between character setups, for example ARKit animation onto a MetaHuman, and 5.8 improved its graph authoring and Retargeter integration. Source: Epic's page "Unreal Engine 5.8 Release Notes". Whether it can be scripted was not run: not established.
- [documented] Epic lists the Live Link and Live Link Control Rig plugins among those an assembled character may need. Source: "Requirements and Configuration Settings for MetaHumans in Unreal Engine", Plugins. A Live Link pose (the assembled project held `ABP_MH_LiveLink`) was not run: not established.
- [general] Sequencer with a face Control Rig, and morph targets set directly on the face mesh, were not run. Sequencer and Control Rig are in [unreal-animation](../../unreal-animation/SKILL.md); for a Control Rig on the face, check its hierarchy for the `CTRL_expressions_*` controls first.
- [documented] MetaHuman Animator solves a performance from video or audio and exports an Animation Sequence; its Python and Blueprint APIs are described in "Scripting and Automating MetaHuman Animator in Unreal Engine". Not run: not established.

## The portable rig, and other characters

- [documented] A DNA file packages mesh, joints, skin weights and solver data; the Character API can import and export it (`import_from_face_dna`, `export_dna`). Epic's MetaHuman Devkit publishes the RigLogic and DNA libraries as open source (MIT) for use outside Unreal. Sources: "MetaHuman Creator Python Scripting in Unreal Engine" and "MetaHuman Devkit in Unreal Engine".
- [general] A model built with agent-meshes is not a MetaHuman, and Epic's creator tools do not recognise it. Its ARKit face rig is authored with mesh-rigging and brought in with `unreal-import`; driving such a head in Unreal is a different job from driving a MetaHuman's `CTRL_expressions_*` curves, and was not run here.
- [general] Runtime composition of a MetaHuman's parts is Mutable's job (unreal-mutable, a sibling skill: this skill does not cover it).
