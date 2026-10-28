# GLB to FBX for UEFN and the Unreal MCP tools

UEFN's MCP mesh tool, and Epic's for Unreal, import only FBX and OBJ. `glb_to_fbx.py` converts an agent-meshes
GLB (a rigged, animated model) with Blender:

```text
blender --background --python glb_to_fbx.py -- fox.glb fox.fbx
```

It sets the scene to 30 fps **before** importing the glTF, so clips whose length is a whole number of frames at 30 fps
(the fox's 0.8 s and 1.2 s) survive Unreal's importer, which drops any clip that is not frame-aligned. Setting the rate
after the import shrinks every clip. See FBX clips and MCP (`unreal-import` skill).

[general] Observed on an earlier engine build and an earlier UEFN build; not yet verified on the pinned builds. With Blender on the sample fox, Epic's MCP `import_file` in Unreal produced the mesh, the
skeleton and both clips. Re-run in UEFN: the saved import contains `walk` at 1.2 seconds / 36 frames
and `trot` at 0.8 seconds / 24 frames, both at 30 fps. The UEFN import response initially listed only the mesh;
querying the destination folder afterwards found all 52 assets, including both clips. Check the asset registry
after import and save the complete asset list explicitly.

The Microsoft Store build of Blender must be started through its
execution alias, `%LOCALAPPDATA%\Microsoft\WindowsApps\blender-launcher.exe`, from an interactive user session.

## UEFN device check

The imported fox renders through UEFN's Animated Mesh device. Discover its catalog entry with `ListDeviceAssets`,
place it with `PlaceDevice`, and inspect its properties before setting `skeletalMesh`, `animation`, `loop` and
`playRate`. Playback state is read-only; bind a player spawn pad's `On Player Spawned` event to the device's `Play`
function instead. A property update can apply supported fields and still return an error for another field, so
read the properties back after a partial failure.

[general] Observed on an earlier UEFN build; not yet verified on the pinned build: saved assets, device configuration, spawn-event bindings and editor viewport rendering.
Runtime animation and the complete sample scene remain unverified.

`CaptureViewport` returns the PNG in a separate MCP image content block. Its JSON `image` value is a
`urn:toolresult` reference, not base64 data. Session startup can also outlast the HTTP request timeout: query
`GetSessionStatus` before retrying a launch.

## Sample scene builder

`sample_scene_build.py` builds the UEFN [sample scene](../../docs/sample-scene.md) in a scratch project through native editor
Python, one phase per run (`audio`, `fbx`, `materials`, `vcolor`, `quads`, `inspect`). Make the scratch project from a
template in UEFN (nothing here depends on any particular project), start Epic's MCP server, and run the script through an
already verified native connection with `MODE_EXEC_FILE`, with a `sample_scene_config.json` beside it (phase, mount, level,
source folder, report path; the mount and level are project inputs, never written into the script). Import the fox and the
sprite sheets with the MCP import tools, place devices with `PlaceDevice`, and read everything back before saving.
