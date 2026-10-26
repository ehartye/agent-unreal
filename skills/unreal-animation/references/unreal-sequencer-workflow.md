# Sequencer workflow in Unreal 5.8

Target: Unreal Engine 5.8, Windows. The numbered steps for [Sequencer](unreal-sequencer.md).

1. Create the Level Sequence and set the display rate and playback range first.
2. Choose each binding type. A Possessable references an actor already in the level. A Spawnable is created by Sequencer for the sequence, which keeps one-shot lights and effects out of the level (Epic).
3. Set Spawned Object Owner on a Spawnable: This Sequence (default) destroys it when the sequence ends, Root Sequence keeps it for the master sequence, External leaves destroying it to Blueprints (Epic).
4. Structure large work as a master sequence with a Shots track; create alternates with New Take on a Shot (Epic).
5. Create cameras with Create Camera: it adds a Cine Camera Actor and a Camera Cuts track. Each camera section on that track is one cut. Disable Lock Viewport to preview the cuts as they render (Epic). [general] Close each cut's range with `set_range(start, end)`: observed once on 5.8.x, a cut left open at the start (`set_start_frame_bounded` called with a frame number, by analogy with `set_start_frame`) made the Movie Render Queue's shot-list code assert and crashed the editor in `SetSequence`.
6. Add transform and animation tracks to bindings and size each section to the range.
7. When a script edits a sequence open in the editor, call `refresh_current_level_sequence()`.
8. For gameplay playback, call `Play` from the player; call `SetPlaybackPosition(0)` first to restart. Set a track's When Finished to Keep State so its value stays after the end, and call Go to End and Stop to skip a cutscene with its final state applied (Epic).
9. For multiplayer, set `replicate_playback` on the Level Sequence Actor so server playback syncs to clients (Epic Python API).
10. Record with Take Recorder when the source is live play: it records into a Level Sequence, and Record Sources Into Sub Sequences gives each source its own subsequence (Epic).
11. Render with [Movie Render Queue](unreal-movie-render-queue.md).

## Sources

- [Sequences, Shots, and Takes](https://dev.epicgames.com/documentation/unreal-engine/sequences-shots-and-takes-in-unreal-engine)
- [Spawn Temporary Actors in Cinematics](https://dev.epicgames.com/documentation/unreal-engine/spawn-temporary-actors-in-unreal-engine-cinematics)
- [Creating Camera Cuts Using Sequencer](https://dev.epicgames.com/documentation/unreal-engine/creating-camera-cuts-using-sequencer-in-unreal-engine)
- [Triggering Sequences from Gameplay](https://dev.epicgames.com/documentation/unreal-engine/play-cinematics-from-blueprints-in-unreal-engine)
- [Take Recorder](https://dev.epicgames.com/documentation/unreal-engine/take-recorder-in-unreal-engine)
