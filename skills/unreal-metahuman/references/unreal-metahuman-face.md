# Driving the face: the route that worked and the routes not run

Unreal 5.8 on Windows. [tested] lines are probe results dated 2026-10-29 on one machine in a windowed editor. Every [tested] line here comes from run 4 alone: runs 1 to 3 drove no face (run 1's flow stopped after the create stage, run 2's poses were made and never applied, run 3 built nothing), and a person was at run 4's first launch. [documented] lines name Epic's page. Needs a spawned, assembled character: [Assemble and spawn](unreal-metahuman-assemble-and-spawn.md).

## The control curves

- [documented] Epic's Facial Description Standard is the list of control curves that represent facial movements of a MetaHuman. It is the basic representation stored when you bake an AnimSequence from Control Rig or export from MetaHuman Animator. Source: Epic's page "MetaHuman Facial Description Standard", which links the index of curves.
- [tested] Run 4: five curves from that family moved the face: `CTRL_expressions_jawOpen`, `CTRL_expressions_mouthCornerPullL`, `CTRL_expressions_mouthCornerPullR`, `CTRL_expressions_mouthCornerUpL` and `CTRL_expressions_mouthCornerUpR`. The index page was not read for these runs, so no other curve name is established here.
- [general] Take curve names from Epic's index, not from guesses, and read back a value before judging a frame.

## The route that worked: float curves in an AnimSequence on the face skeleton

- [tested] Run 4: one AnimSequence per pose was created with `AnimSequenceFactory` on the skeleton `Face_Archetype_Skeleton` (the `target_skeleton` property), each holding one key at time 0 and a play length of 1.0 s. The curves were added with `AnimationLibrary.add_curve(sequence, name, RawCurveTrackTypes.RCT_FLOAT)` and `AnimationLibrary.add_float_curve_key(sequence, name, 0.0, value)`.
- [tested] Run 4: the poses were neutral (`jawOpen` 0), jaw open (`jawOpen` 1) and smile (`mouthCornerPullL` and `mouthCornerPullR` 1, `mouthCornerUpL` and `mouthCornerUpR` 0.5).
- [tested] Run 4: each sequence was played on the spawned actor's `Face` component with `play_animation(sequence, True)`. The component's animation mode read Animation Blueprint (class `ABP_Face`) before the first play and single node after it.
- [tested] Run 4: `get_curve_value` on the component read the written values back exactly for all five curves.
- [tested] Run 4: the probe waited 3 s for each pose to evaluate before taking its frame, in Play-In-Editor; no shorter wait was tried.
- [tested] Run 4: the three saved frames differ in the face region by 10.43% (jaw open against neutral), 5.22% (smile against neutral) and 11.68% (jaw open against smile), where two neutral frames differ by 0.76%. By eye the mouth is closed in the neutral frame, wide open in the jaw-open frame and a smile in the smile frame. The camera saw the character in profile.
- [general] The pose is a set of curve values, so the same route should carry a clip with keys over time; only single-key poses were run. Whether the curves reach the rig through a Control Rig, a pose asset or morph targets inside `ABP_Face` was not examined.
- [general] Because `play_animation` switched the component from Animation Blueprint mode to single-node mode in run 4, expect that call to stop whatever the Animation Blueprint was doing on that component, such as a Live Link feed. Whether it does was not tested.

## Routes not run

- [tested] Run 4: the assembled project held `AS_MetaHuman_ARKit_Mapping` and `PA_MetaHuman_ARKit_Mapping`. Using the ARKit pose asset to drive the face with ARKit values was not run: not established.
- [documented] Rig Mapper transfers motion between character setups, for example ARKit animation onto a MetaHuman, and 5.8 improved its graph authoring and Retargeter integration. Source: Epic's page "Unreal Engine 5.8 Release Notes". Whether it can be scripted was not run: not established.
- [documented] Epic lists the Live Link and Live Link Control Rig plugins among those an assembled character may need. Source: "Requirements and Configuration Settings for MetaHumans in Unreal Engine", Plugins. A Live Link pose (run 4's assembled project held `ABP_MH_LiveLink`) was not run: not established.
- [general] Sequencer with a face Control Rig, and morph targets set directly on the face mesh, were not run. Sequencer and Control Rig are in [unreal-animation](../../unreal-animation/SKILL.md); for a Control Rig on the face, check its hierarchy for the `CTRL_expressions_*` controls first.
- [documented] MetaHuman Animator solves a performance from video or audio and exports an Animation Sequence; its Python and Blueprint APIs are described in "Scripting and Automating MetaHuman Animator in Unreal Engine". Not run: not established.

## The portable rig, and other characters

- [documented] A DNA file packages mesh, joints, skin weights and solver data; the Character API can import and export it (`import_from_face_dna`, `export_dna`). Epic's MetaHuman Devkit publishes the RigLogic and DNA libraries as open source (MIT) for use outside Unreal. Sources: "MetaHuman Creator Python Scripting in Unreal Engine" and "MetaHuman Devkit in Unreal Engine".
- [general] A model built with agent-meshes is not a MetaHuman, and Epic's creator tools do not recognise it. Its ARKit face rig is authored with mesh-rigging and brought in with `unreal-import`; driving such a head in Unreal is a different job from driving a MetaHuman's `CTRL_expressions_*` curves, and was not run here.
- [general] Runtime composition of a MetaHuman's parts is Mutable's job; this skill does not cover it.
