# UEFN native Python

Use this to run Python in a running UEFN editor and to avoid its operational traps. Observed in one consuming UEFN project on UEFN 42.30; not reproduced in this repo. Capability discovery and the choice of route are in the [authoring reference](uefn-authoring.md).

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
