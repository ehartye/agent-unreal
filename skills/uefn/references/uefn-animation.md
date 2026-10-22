# UEFN animation and asset migration

Use this for exact Reset, Level Sequences and moving assets from regular Unreal. Observed in one consuming UEFN project on UEFN 42.30; not reproduced in this repo. Setup is in [native Python](uefn-native-python.md).

## Animation: preserve the actual control requirement

[general] Animated Mesh devices expose Play, Pause and Reverse; the
read-only playback properties do not provide a writable seek/reset. Reverse is
not exact Reset. Imported eight-second skeletal clips read back as
240 frames and 241 sampled keys at 30 fps. This establishes import, not playback.

[general] Native Python created a Level Sequence
with an eight-second skeletal animation section at 30 fps (frames 0–240).
Its actor and component possessables both resolved in the target level, and five
scrubbed samples produced five different numeric bone poses. The sequence was saved
and read back clean. This is editor evaluation evidence, not Fortnite playback.
A Cinematic Sequence device is the documented runtime route. Generic
[Sequencer Python examples](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-scripting-in-sequencer-in-unreal-engine)
show `LevelSequenceFactoryNew`, actor bindings and animation sections. Those core
operations worked locally; preflight their availability again after upgrades.
The [device API](https://dev.epicgames.com/documentation/en-us/fortnite/verse-api/fortnitedotcom/devices/cinematic_sequence_device)
includes `SetPlaybackFrame` and `SetPlaybackTime`.

[general] The observed saved cinematic controllers passed frame
checks for reset, held-frame pause/resume and wrapping variant cycles; startup
advanced its timelines. Method calls did not
verify physical button use or visible reset poses. Verify the immediate rendered
frame-zero pose, paused state and resumption, including completed clips. Keep
camera tracks out of prop-only sequences. Verify shared
visibility and late joining in Fortnite; inspect completion state and device
cost before multiplying devices. [Cinematic device guidance](https://dev.epicgames.com/documentation/en-us/fortnite/using-cinematic-sequence-device-in-unreal-editor-for-fortnite).

[documented] For naturally rigid prop motion, Verse
[animation_controller.Stop](https://dev.epicgames.com/documentation/en-us/fortnite/verse-api/fortnitedotcom/devices/creativeanimation/animation_controller)
documents resetting animation and prop transform. It does not replace skeletal
bone animation; rebuilding an existing skeleton as props adds work.

## Selective UE migration

[documented] [Epic supports UE-to-UEFN asset migration](https://dev.epicgames.com/documentation/fortnite/migrating-assets-from-unreal-engine-to-unreal-editor-for-fortnite?lang=en-US),
with supported same/newer destination versions. Migration copies dependencies;
it does **not** validate compatibility. Unsupported assets may block playtesting.
This is not a guarantee that a UE map or Blueprint gameplay ports wholesale.

Use one isolated asset/sequence as the proof, inspect its dependencies, and choose
the actual destination project's Content folder. Discover the live mount rather
than assuming `/Game` or the project's display name. Sequence possessables may
need actor/component rebinding in the destination; verify their references and
scrub after migration. Do not assume custom bindings or director events transfer.
Keep original FBX/WAV sources as recovery paths. A successful copy or forward-looking
version number alone does not prove compatible serialization or Fortnite support.
