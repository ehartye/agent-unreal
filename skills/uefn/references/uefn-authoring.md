# UEFN authoring beyond MCP

Use this when UEFN MCP lacks an operation, animation controls need exact Reset,
audio needs importing, or authoring in regular Unreal and porting is proposed.
Observed in one consuming UEFN project on UEFN 42.30 and UE 5.8.3; not reproduced
in this repo. Re-discover capabilities after upgrades.

## Choose the smallest working route

Keep a Fortnite project's playable scene, devices and Verse behavior authoritative in
UEFN. Use available MCP tools; for missing operations, try native editor Python or
ordinary editor actions. Regular UE is an optional asset workshop. This ordering is
a recommendation from one consuming project, not a requirement to reject other workflows.

| Route | Time | Risk | Complexity | Architectural fit | Maintenance |
|---|---|---|---|---|---|
| UEFN MCP plus a small native Python script | One probe, then repeatable batch work | Preview API/validation uncertainty | Low–moderate | Target owns bindings and behavior | One project script |
| Native UEFN editor exemplar | Fast for a few operations | Repeated manual edits | Low initially | Direct target authoring | Document recipe; automate repetition |
| Selective UE asset authoring and migration | Setup and compatibility proof | Versions, dependencies, actor bindings | Moderate | Separate asset workshop | Second project and upgrade checks |
| Whole level in UE, then port | Most adaptation work | Unsupported assets/gameplay | High | Two scene representations | Ongoing conversion work |

## Capability discovery: do not confuse transport with editor support

[general] UEFN exposes MCP wrappers `list_toolsets`, `describe_toolset`
and `call_tool`. Discover the live schemas; regular UE tool names and argument
shapes are not a UEFN contract. With AllToolsets mounted in the observed 42.30 build,
Sequencer and Sequencer Keyframing toolsets were absent. Audio import was also
absent. Do not send the user searching for an unverified toggle after this check.

The MCP script sandbox allowed `json`, `re`, `math`, `copy`, `time`, `datetime`
and registered tools; it could not import `unreal`. Do not treat native Python
documentation as permission to bypass that sandbox. Native editor Python is a
separate, Epic-documented entrypoint.

[documented] [UEFN Python](https://dev.epicgames.com/documentation/en-us/fortnite/python-tools-in-uefn)
supports imports, scene automation and remote execution in early preview. It links
[Unreal Python execution](https://dev.epicgames.com/documentation/en-us/unreal-engine/scripting-the-unreal-editor-using-python),
which describes File > Execute Python Script and Output Log Cmd mode:

```text
py "C:/path/to/project_script.py"
```

Preflight required APIs and the active project before edits. UEFN validation can
reject Python-created content; restrict changes to project assets and properties
available in its UI. A successful Python call is not validation or runtime proof.
Before asking the user to execute scripts manually, check the native routes below.
If an editor action is needed, prepare its exact script and expected receipt first.

## Native Python execution in UEFN 42.30

[general] **Project files:** `Content/Python/init_unreal.py` ran automatically after reopening
the project with Python enabled. It waited for the exact island world, then
created and saved one Level Sequence through `unreal`. A bounded startup callback
should unregister before edits, log failures without retrying, and leave existing
assets unchanged. A newly added startup file needs a reopen; writing a file is not
itself proof that the running editor executed it. Keep these editor scripts as source.

[general] **Native remote execution:** Epic's shipped
`Engine/Plugins/Experimental/PythonScriptPlugin/Content/Python/remote_execution.py`
successfully executed project scripts with `unreal` in the running UEFN. It opens
a short-lived command connection; no custom MCP bridge or resident service was added.

Discover the current settings rather than assume client defaults. MCP ObjectTools
can inspect `/Script/PythonScriptPlugin.Default__PythonScriptPluginSettings`.
The observed editor already had `bRemoteExecution=true`, multicast endpoint
`239.0.0.1:6766`, bind address `0.0.0.0` and TTL 0. Earlier default loopback
discovery returned no nodes; after reopening, matching the configured bind address
discovered the editor. This does not isolate every cause of the earlier failure.
Do not infer that every UEFN has these settings or enable them solely from this example.
[Epic Python settings](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-settings-in-the-unreal-engine-project-settings).

Using the supplied client: configure discovery, `start()`, collect nodes, select
exactly one intended editor, `open_command_connection(node_id)`, `run_command(...)`,
and `stop()` in `finally`. Check `success` and log output; never retry a timed-out
mutation blindly. The observed node advertised `project_name=FortniteGame` and an
engine project root, so those fields did **not** identify the loaded island.
Read `UnrealEditorSubsystem.get_editor_world().get_path_name()` and verify its
mount/level before writes. A local native client must preserve that guard.

Minimal read-only probe after adding the installed client directory to `sys.path`
and checking discovery settings (the two named values are project inputs):

```python
import ast
import time
import remote_execution

config = remote_execution.RemoteExecutionConfig()
config.multicast_bind_address = checked_editor_bind_address
client = remote_execution.RemoteExecution(config)
try:
    client.start()
    time.sleep(2)
    nodes = client.remote_nodes
    if len(nodes) != 1:
        raise RuntimeError("Select exactly one intended editor")
    client.open_command_connection(nodes[0]["node_id"])
    client.run_command("import unreal",
                       exec_mode=remote_execution.MODE_EXEC_STATEMENT,
                       raise_on_failure=True)
    result = client.run_command(
        "unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)"
        ".get_editor_world().get_path_name()",
        exec_mode=remote_execution.MODE_EVAL_STATEMENT,
        raise_on_failure=True)
    world = ast.literal_eval(result["result"])
    if world.split(".")[0] != expected_island_level:
        raise RuntimeError("Wrong loaded island; abort")
finally:
    client.stop()
```

After this guard, a prepared script can use `MODE_EXEC_FILE` with its quoted
absolute path. Keep the same world check inside the script, inspect result/logs,
and save only intended assets. Empty discovery is a failed probe, not permission
to launch a second editor or replay an earlier mutation.

[general] **Launch with a project:** Epic documents the Project Browser's
[Open last project on start up](https://dev.epicgames.com/documentation/fortnite/starting-and-organizing-a-project-in-fortnite).
The observed config object `/Script/ValkyrieEditor.Default__ValkyrieEditorConfig`
exposed `valkyrieLoadAtStartupMostRecentProject=LastProject`; the old boolean
`bStartupWithLastProject` is deprecated. The saved `LastProjectFileName` identified
the project. Normal close and Epic Launcher relaunch opened that project and ran
its startup hook. Verify saved configuration: changing the live property did not
immediately change the INI. Discover the installed Launcher app identity; do not
hardcode a machine's catalog ID. No arbitrary UEFN `-project=` route was proved.

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

## Audio: import rendered files directly

Agent Beeps supplies rendered WAVs; its browser synth is not the Fortnite audio
runtime. [Native UEFN import](https://dev.epicgames.com/documentation/en-us/fortnite/importing-custom-audio-in-unreal-editor-for-fortnite)
supports WAV through Import or Content Browser drag/drop. Use Sound Wave/Sound Cue
and Audio Player as appropriate; verify looping and volume in the target session.
[general] In 42.30, SoundFactory plus AssetImportTask imported approved WAVs,
created their direct looping Wave Player Cues and saved only the new packages.
The [native-audio reference](uefn-native-audio.md) covers the source checks,
pending receipts, task-result omission and independent metadata/package verification.
This removes the need for manual dragging when the native connection is available.
Auto Reimport did not create WAV assets in the earlier local test; repeating it
or introducing a second UE project is not a necessary prerequisite for audio.
For an initial score, one auditioned loop is enough to prove delivery. Stems and
adaptive scheduling should follow a musical or gameplay need.

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

## Operational traps

Native architecture imports exposed reflected coordinates, reversed glyphs and
omitted UCX collision. The [FBX reference](uefn-native-fbx.md) records the
42.30 basis, shape/readback recipe, editor traces and uncertain reimport crash;
none establishes cooked character or weapon collision.

- [general] Verify the active level and project mount before each connection's first edit.
  The observed project used a UUID mount; a previous project's paths were not reusable.
- [general] Import responses may list only the mesh. Query the destination registry for
  skeleton, materials and clips, read duration/frame counts, then save explicitly.
  The observed asset save tool treats an empty asset list as **save all dirty assets**;
  reject an empty list when intending a scoped save.
- [general] Property updates may partly succeed before reporting an error. Read back before
  retrying. Use stable labels/IDs; repeated placement should update, not duplicate.
- [tested] Set Blender's frame rate before importing GLB, and choose a rate that aligns
  clip lengths to whole frames, as [glb_to_fbx.py](../../../examples/uefn/glb_to_fbx.py)
  does at 30 fps. Verify transforms, scale and text-facing in a capture.
- [general] `CaptureViewport` returned an MCP image content block; its JSON image URN was
  not the PNG. Inspect the response rather than decoding the URN as base64.
- [general] A session launch exceeded the HTTP timeout and continued cooking. Poll session
  status before retrying. Validation/upload then a transport disconnect does not
  establish runtime success and is separate from the authoring transport.

## Bounded proof and reporting

Reuse one imported clip and actor. Create, save and reopen one sequence; inspect
start/middle/end poses. Configure controls and optionally import an existing short
WAV independently. If Python fails, record the exact failure and use one native
editor exemplar. Try UE staging when native authoring fails or repeated work
justifies its cost. Stop broad workflow research after a reproducible validated
authoring path exists; keep runtime acceptance open until observed in Fortnite.

Report separately: files exported, assets imported/saved, editor appearance,
validation, runtime behavior and listener audition. The observed project verified
export/import, editor appearance, project startup, native remote execution,
scoped native saves and saved Sequence evaluation. After an earlier client
disconnection, automatic startup and controller checks passed in Fortnite,
followed by a normal push with QA disabled. Physical button
use, rendered reset poses, completed-clip reset, audible audio, multiplayer and performance
remain unverified. Native audio import/save and personal playback preparation are
verified separately; a later launch reached server cook but ended without a connected
game client. The [operations reference](uefn-native-operations.md) records
those operational checks and their limits.
