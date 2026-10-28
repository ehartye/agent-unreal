# UEFN animation and asset migration

Use this for exact Reset, Level Sequences and moving assets from regular Unreal. Observed in one consuming UEFN project on an earlier UEFN build; not reproduced in this repo. Setup is in [native Python](uefn-native-python.md).

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

## A scene built from code in a scratch project

- [tested] In a scratch UEFN project made from a template (no connection to any real game) a scene was built from scripts and the device tools: an Animated Mesh device with the fox (`skeletalMesh`, `animation`, `loop` true, `playRate` 1, read back), a Customizable Light, two Audio Player devices, a Button and a Fixed Point Camera. `AddEventBinding` wired both spawn pads' `On Player Spawned` to the fox device's `Play` and the Button's `On Interact` to the one-shot player's `Play`. `ListEventBindings` is called on the target device and lists the bindings wired into it.
- [tested] A sprite flipbook needs no particles: an unlit masked Material whose frame is `floor(Time * fps) mod cells` shifts a texture sample's U coordinate by one cell, on a plane static mesh. It showed one cell per sprite and animated. The first build showed the whole sheet because the connect call for the texture sample's UV pin returned False without an error; check every connect result.
- [tested] The Fixed Point Camera device has `addToPlayersOnStart` on by default, so every player's view is fixed at the device from spawn: the character moves and the camera does not follow. Turn it off, or leave the device out, to keep the follow camera.
- [tested] A private session launched from the editor (`StartSession`, then `StartGame`) reached Connected and Running in 1 to 2 minutes on a small project. An owner play-test of the running match reported that the scene looked right (movement, fox, sprites, audio). None of it was read from logs, and multiplayer and the memory budget were not checked.
