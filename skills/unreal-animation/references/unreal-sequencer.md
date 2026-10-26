# Sequencer in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. Sequencer is Epic's multi-track, non-linear editor for building and previewing cinematics in real time: it pilots cameras, animates lights, moves objects and characters, and renders the result. A Level Sequence is the container asset; bindings attach it to objects, and each binding holds tracks, sections, channels and keys.

## Enable it

| Plugin | Category | Enabled by default | Flags (descriptor) | Dependencies |
|---|---|---|---|---|
| `LevelSequenceEditor` | Editor | yes | not beta, editor-only | none |
| `SequencerScripting` | Scripting | no `EnabledByDefault` entry | beta | PythonScriptPlugin |
| `Takes` (shown as Take Recorder) | Virtual Production | no | not beta, not experimental | AudioCapture, LevelSequenceEditor, NamingTokens |

- Playing a Level Sequence in a running game needs no plugin: the `LevelSequence` runtime module is part of the engine (in the 5.8 install, `Engine/Source/Runtime/LevelSequence`).
- Scripting needs the Python Editor Script Plugin (Epic), plus Editor Scripting Utilities for the simplified editor APIs. The `SequencerScripting` example scripts in the 5.8 install ask for both Python and `SequencerScripting`.
- Enable Take Recorder in Edit > Plugins, restart, then open Window > Cinematics > Take Recorder (Epic). Live Link is optional for performance capture.

## Use it when

- Motion is authored over time: camera moves, character animation, lights, props, particle triggers.
- A cinematic is built from shots: a master Level Sequence holds a Shots track and Subsequences, and each Shot is its own sequence asset, so team members work independently (Epic).
- A cutscene plays from gameplay through a Level Sequence Actor or a Level Sequence Player.
- Gameplay or a performance must be recorded into a sequence: Take Recorder writes a Level Sequence.
- Sequences must be generated or bulk-edited by script.

## Use something else when

- Use [Movie Render Queue](unreal-movie-render-queue.md) to render a sequence to images or video. Epic's Render Movie page is marked Deprecated.
- Use [Niagara](../../unreal-effects/references/unreal-niagara.md) to author the particle effect; Sequencer triggers and times it.
- Use Blueprint or C++ for movement that gameplay decides at runtime. Python does not run at runtime, so it cannot drive a shipped game.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Create a Level Sequence | Python (documented by Epic) | `unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, path, unreal.LevelSequence, unreal.LevelSequenceFactoryNew())` |
| Frame rate and range | Python (documented) | `set_display_rate(unreal.FrameRate(30, 1))`, `set_playback_start`, `set_playback_end`; the default range is 0 to 150 at 30 fps |
| Bind an existing actor | Python | `sequence.add_possessable(actor)` (5.8 install example); `LevelSequenceEditorSubsystem.add_actors` for the selection (documented) |
| Bind a temporary actor | Python | `add_spawnable_from_class(unreal.CineCameraActor)`, `add_spawnable_from_instance` (5.8 install example); `convert_to_spawnable` (documented) |
| Tracks and sections | Python (documented) | `binding.add_track(unreal.MovieScene3DTransformTrack)`, `track.add_section()`, `section.set_range(start, end)` (closes both ends); `set_start_frame_bounded(bool)` and `set_end_frame_bounded(bool)` take a boolean, not a frame (5.8 install header) |
| Keys | Python (5.8 install examples) | channels on sections; see `sequencer_key_examples.py` in the `SequencerScripting` plugin |
| Camera cuts | Python | `ls_system.create_camera(spawnable=True)` (documented); `sequence.add_track(unreal.MovieSceneCameraCutTrack)` with a `unreal.MovieSceneObjectBindingID` set as `CameraBindingID` (5.8 install example) |
| Shots | Python (named in the 5.8 install example) | `unreal.MovieSceneCinematicShotTrack` |
| Work in the open editor | Python (documented) | `unreal.LevelSequenceEditorBlueprintLibrary.open_level_sequence`, `refresh_current_level_sequence` after edits |
| Place and bind a player actor | Python (documented) | `unreal.LevelSequenceActor`: `set_sequence`, `sequence_player`, `replicate_playback`, `set_binding`, `add_binding_by_tag` |
| Play in a game | Blueprint / C++ | `CreateLevelSequencePlayer(WorldContext, LevelSequence, PlaybackSettings, OutActor)` in the 5.8 install; then `Play`, `Pause`, `Stop`, `GoToEndAndStop`, `SetPlaybackPosition`, `SetPlayRate`, events `OnFinished`, `OnStop` (Epic API) |
| Autoplay | Playback settings | `bAutoPlay` in `FMovieSceneSequencePlaybackSettings` (5.8 install; default false) |
| Record a take | Blueprint / C++ | `UTakeRecorderBlueprintLibrary`: `StartRecording`, `StopRecording`, `IsRecording` are BlueprintCallable in the 5.8 install; Epic says `unreal` exposes nearly everything exposed to Blueprints, so Python reaches them by name (not run here) |
| Custom bindings, tags | Blueprint / C++ | Custom Binding and Sequencer Tags and Groups (Epic) |

## Workflow

Steps for the Level Sequence, bindings, cameras, tracks, gameplay playback, multiplayer, Take Recorder and rendering: [Sequencer workflow](unreal-sequencer-workflow.md).

Related: [Control Rig](unreal-control-rig.md).

## Sources

- [Cinematics and Movie Making](https://dev.epicgames.com/documentation/unreal-engine/cinematics-and-movie-making-in-unreal-engine)
- [Python Scripting in Sequencer](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-scripting-in-sequencer-in-unreal-engine)
- [Scripting the Unreal Editor using Python](https://dev.epicgames.com/documentation/unreal-engine/scripting-the-unreal-editor-using-python)
- [UMovieSceneSequencePlayer API](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/MovieScene/UMovieSceneSequencePlayer)
- [unreal.LevelSequenceActor Python API](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/LevelSequenceActor)
- [Old Render Movie](https://dev.epicgames.com/documentation/unreal-engine/old-render-movie-in-unreal-engine)
- The plugin descriptors for LevelSequenceEditor, SequencerScripting and Takes; the `SequencerScripting` Python examples and the `LevelSequence`, `MovieScene` and `Takes` sources in the 5.8 install.
