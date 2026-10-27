# Unreal import notes

## Sprites, audio and running it (general)

Observed on an earlier engine build; not repeated on the pinned build.

Building a native C++ game? Read the native Unreal build and capture loop (`unreal-native` skill): exact toolchain selection, procedural geometry, editor font/material generation, actual game-camera captures and automation results that cannot be inferred from exit code zero. Its current Editor-game evidence is separate from packaged/cook acceptance.

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

## Changes between 5.7 and 5.8 (general)

Observed on an earlier engine build; not repeated on the pinned build. The same scripts from `examples/unreal` passed on an earlier 5.8 build (fox animating, music bed playing, both flipbooks advancing,
screenshot read by eye) after three changes. Each failed quietly on the first try.

- **The fox split into 48 meshes.** On an earlier 5.7 build the same `InterchangeManager.import_asset` call gave
  one `fox` mesh; on an earlier 5.8 build it gave 48 skeletal meshes, 48 physics assets and one shared skeleton, so
  "the first SkeletalMesh" was `back_mantle`. Pass a saved pipeline asset with `combine_skeletal_meshes_behavior = BY_SKELETON` through
  `ImportAssetParameters.override_pipelines`, and pick the mesh by name. Python cannot pass a pipeline object there:
  it takes soft asset paths, so create the pipeline with `AssetTools.create_asset`, save it, and pass its path.
  The enum has `BY_SKELETON`, `BY_SKELETON_VISIBLE_ONLY` and `DO_NOT_COMBINE`.
- **An automated import no longer saves its assets.** On an earlier 5.7 build the files were on disk afterwards; on an earlier 5.8 build they stayed
  in memory, so the saved map referenced nothing. The build step still reported the fox placed, and only the rendered
  run showed an empty scene. Call `EditorAssetLibrary.save_directory(dest, only_if_is_dirty=False, recursive=True)`
  after each import, and check what the render shows, not what the build claims.
- **FBX clips need whole-frame lengths.** See [FBX clips and MCP](./unreal-fbx-and-mcp.md).

## An Interchange error line that is not a failed import (tested)

- A GLB with a `BLEND` or `MASK` material, imported through an owned `InterchangeGenericAssetsPipeline` (the pattern `unreal-import` uses), logs `LogInterchangeEngine: Error: [ : '', Unknown] Invalid input AlphaMode for material expression node MF_Default_Body.` once per such material, and a commandlet then exits with 1.
- The import is correct anyway. Every static mesh, material, skeletal mesh, skeleton and animation sequence arrived, and the blend modes were right (translucent for `BLEND`; masked, with the file's cutoff, for `MASK`). Check the saved assets and the report, not the exit code.
- Cause (`Engine/Plugins/Interchange/Runtime/Source/Import/Private/Gltf/InterchangeGLTFMaterial.cpp:439`, `.../Private/Material/InterchangeMaterialFactory.cpp:297`): the importer sets an `AlphaMode` input on the body function for every non-opaque material, and `MF_Default_Body` has no input of that name.
- An opaque material logs nothing, and neither does the engine's default glTF stack, which imports material instances. [`epf_validate.mjs`](../../../examples/unreal/editor_python_friction/README.md) runs this on generated files.
