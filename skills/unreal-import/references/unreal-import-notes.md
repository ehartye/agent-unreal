# Unreal import notes (5.7.3 and 5.8.3)

## Unreal 5.7: sprites, audio and running it (tested)

Building a native C++ game? Read the native Unreal build and capture loop (`unreal-native` skill): exact 5.8.2 toolchain selection, procedural geometry, editor font/material generation, actual game-camera captures and automation results that cannot be inferred from exit code zero. Its current Editor-game evidence is separate from packaged/cook acceptance.

Built and run in the Unreal [sample scene](../../../docs/sample-scene.md); scripts in `examples/unreal`.

- Import GLB and PNG with `InterchangeManager.import_asset` and `is_automated = True`. glTF through
  `AssetTools.import_asset_tasks` in a commandlet crashes on a missing Slate application. WAV is not an
  Interchange format: use `AssetTools` for it.
- Names change on import: `relic-discovered.0.wav` becomes `relic-discovered_0`.
- Sprites need the Paper2D plugin. Its pivots are in **sheet pixels**: set the pivot to the frame's x and y
  plus the atlas pivot, or every frame but the first is drawn displaced.
- Paper2D sprites lie in the XZ plane. Yaw them to face the camera, or they render edge-on and look missing.
- The atlas `frames` array holds raw cells, each tag's frames and named cells together. Follow the tag's
  `from` and `to` into it; frame index is not cell index, and durations differ between the copies.
- The music manifest says `loop: true` but the WAV has no loop metadata. Set looping on the imported asset.
- Run with `UnrealEditor -RenderOffScreen -ExecCmds="py script.py"`. `-ExecutePythonScript` quits the editor
  when the script ends and is refused in `-game`. In Git Bash set `MSYS_NO_PATHCONV=1`.
- Take a screenshot. Wrong rotation order, scale, facing and pivots only showed up there.

## Unreal 5.8.3 (tested)

The same scripts from `examples/unreal` pass on 5.8.3 (fox animating, music bed playing, both flipbooks advancing,
screenshot read by eye) after three changes. Each failed quietly on the first try.

- **The fox split into 48 meshes.** The same `InterchangeManager.import_asset` call that gave one `fox` mesh on
  5.7.3 gave 48 skeletal meshes, 48 physics assets and one shared skeleton, so "the first SkeletalMesh" was
  `back_mantle`. Pass a saved pipeline asset with `combine_skeletal_meshes_behavior = BY_SKELETON` through
  `ImportAssetParameters.override_pipelines`, and pick the mesh by name. Python cannot pass a pipeline object there:
  it takes soft asset paths, so create the pipeline with `AssetTools.create_asset`, save it, and pass its path.
  The enum has `BY_SKELETON`, `BY_SKELETON_VISIBLE_ONLY` and `DO_NOT_COMBINE`.
- **An automated import no longer saves its assets.** On 5.7.3 the files were on disk afterwards; on 5.8.3 they stayed
  in memory, so the saved map referenced nothing. The build step still reported the fox placed, and only the rendered
  run showed an empty scene. Call `EditorAssetLibrary.save_directory(dest, only_if_is_dirty=False, recursive=True)`
  after each import, and check what the render shows, not what the build claims.
- **FBX clips need whole-frame lengths.** See [FBX clips and MCP](./unreal-fbx-and-mcp.md).
