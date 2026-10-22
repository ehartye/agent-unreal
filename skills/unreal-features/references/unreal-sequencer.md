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
- Use [Niagara](unreal-niagara.md) to author the particle effect; Sequencer triggers and times it.
- Use Blueprint or C++ for movement that gameplay decides at runtime. Python does not run at runtime, so it cannot drive a shipped game.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Create a Level Sequence | Python (documented by Epic) | `unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, path, unreal.LevelSequence, unreal.LevelSequenceFactoryNew())` |
| Frame rate and range | Python (documented) | `set_display_rate(unreal.FrameRate(30, 1))`, `set_playback_start`, `set_playback_end`; the default range is 0 to 150 at 30 fps |
| Bind an existing actor | Python | `sequence.add_possessable(actor)` (5.8 install example); `LevelSequenceEditorSubsystem.add_actors` for the selection (documented) |
| Bind a temporary actor | Python | `add_spawnable_from_class(unreal.CineCameraActor)`, `add_spawnable_from_instance` (5.8 install example); `convert_to_spawnable` (documented) |
| Tracks and sections | Python (documented) | `binding.add_track(unreal.MovieScene3DTransformTrack)`, `track.add_section()`, `section.set_range(start, end)` |
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

1. Create the Level Sequence and set the display rate and playback range first.
2. Choose each binding type. A Possessable references an actor already in the level. A Spawnable is created by Sequencer for the sequence, which keeps one-shot lights and effects out of the level (Epic).
3. Set Spawned Object Owner on a Spawnable: This Sequence (default) destroys it when the sequence ends, Root Sequence keeps it for the master sequence, External leaves destroying it to Blueprints (Epic).
4. Structure large work as a master sequence with a Shots track; create alternates with New Take on a Shot (Epic).
5. Create cameras with Create Camera: it adds a Cine Camera Actor and a Camera Cuts track. Each camera section on that track is one cut. Disable Lock Viewport to preview the cuts as they render (Epic).
6. Add transform and animation tracks to bindings and size each section to the range.
7. When a script edits a sequence open in the editor, call `refresh_current_level_sequence()`.
8. For gameplay playback, call `Play` from the player; call `SetPlaybackPosition(0)` first to restart. Set a track's When Finished to Keep State so its value stays after the end, and call Go to End and Stop to skip a cutscene with its final state applied (Epic).
9. For multiplayer, set `replicate_playback` on the Level Sequence Actor so server playback syncs to clients (Epic Python API).
10. Record with Take Recorder when the source is live play: it records into a Level Sequence, and Record Sources Into Sub Sequences gives each source its own subsequence (Epic).
11. Render with [Movie Render Queue](unreal-movie-render-queue.md).

Related: [Control Rig](unreal-control-rig.md).

## Sources

- [Cinematics and Movie Making](https://dev.epicgames.com/documentation/unreal-engine/cinematics-and-movie-making-in-unreal-engine)
- [Python Scripting in Sequencer](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-scripting-in-sequencer-in-unreal-engine)
- [Scripting the Unreal Editor using Python](https://dev.epicgames.com/documentation/unreal-engine/scripting-the-unreal-editor-using-python)
- [Sequences, Shots, and Takes](https://dev.epicgames.com/documentation/unreal-engine/sequences-shots-and-takes-in-unreal-engine)
- [Spawn Temporary Actors in Cinematics](https://dev.epicgames.com/documentation/unreal-engine/spawn-temporary-actors-in-unreal-engine-cinematics)
- [Creating Camera Cuts Using Sequencer](https://dev.epicgames.com/documentation/unreal-engine/creating-camera-cuts-using-sequencer-in-unreal-engine)
- [Triggering Sequences from Gameplay](https://dev.epicgames.com/documentation/unreal-engine/play-cinematics-from-blueprints-in-unreal-engine)
- [Take Recorder](https://dev.epicgames.com/documentation/unreal-engine/take-recorder-in-unreal-engine)
- [UMovieSceneSequencePlayer API](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/MovieScene/UMovieSceneSequencePlayer)
- [unreal.LevelSequenceActor Python API](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/LevelSequenceActor)
- [Old Render Movie](https://dev.epicgames.com/documentation/unreal-engine/old-render-movie-in-unreal-engine)
- The plugin descriptors for LevelSequenceEditor, SequencerScripting and Takes; the `SequencerScripting` Python examples and the `LevelSequence`, `MovieScene` and `Takes` sources in the 5.8 install.
