# Editor Python friction scene: unreal.Box construction and an Interchange log line

Backs the `unreal.Box` note in [Scripting the Unreal editor from Python](../../../skills/unreal-editor-scripting/references/unreal-editor-python.md) and the Interchange note in [Unreal import notes](../../../skills/unreal-import/references/unreal-import-notes.md). Verified on Unreal Engine 5.8.4, Windows. Nothing here needs a project or an asset of yours: the validator makes a throwaway project in the OS temp folder and writes two small glTF files itself.

## Run

```text
node examples/unreal/editor_python_friction/epf_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep]
node examples/unreal/editor_python_friction/tiny_glb.mjs <folder>     # only writes the two .glb files
```

It starts five hidden headless commandlets, under a minute in total, prints PASS or FAIL per claim and exits 0 when all 8 pass. It is not part of `node scripts/check.mjs`; the check logic and the glTF writer are tested there (`epf-validate.test.mjs`).

## Files

| File | What it does |
|---|---|
| `epf_box.py` | builds `unreal.Box` five ways, then sets `is_valid` with `set_editor_property` |
| `tiny_glb.mjs` | writes `static.glb` (three quads, materials opaque, `BLEND`, `MASK`) and `skinned.glb` (a strip skinned to two joints, a `BLEND` material, one animation clip) with no outside assets |
| `epf_import.py` | imports one file through Interchange (`InterchangeManager.import_asset`, `is_automated`), with the default stack or an owned `InterchangeGenericAssetsPipeline` (`import_materials` True, `reuse_existing_materials` False) passed in `override_pipelines`, saves, and lists what arrived by class |
| `epf-validate-checks.mjs`, `epf-validate.test.mjs` | one check per claim, including the log-line counter; the test changes one fact at a time and expects the matching check to fail |

## What it showed (5.8.4)

- `unreal.Box(min=, max=, is_valid=True)` and `Box(min, max, True)` raise `TypeError: call() takes at most 2 arguments (3 given)`; `Box(is_valid=True)` raises `TypeError: call() 'is_valid' is an invalid keyword argument for this function`. `Box(min, max)` and `Box(min=, max=)` build a box that is already valid. `set_editor_property("is_valid", False)` and then `True` round-trip. `FBox` in `NoExportTypes.h` has `HasNativeMake=MakeBox`, whose parameters are `Min` and `Max`.
- Through the owned pipeline, `static.glb` logs `LogInterchangeEngine: Error: [ : '', Unknown] Invalid input AlphaMode for material expression node MF_Default_Body.` twice (the `BLEND` and the `MASK` material) and `skinned.glb` once, and the commandlet exits with 1 each time. Every asset arrived: three static meshes and three Materials (opaque, translucent, masked at the file's cutoff of 0.5); a skeletal mesh, a skeleton, a physics asset and an animation sequence (`skinned_Anim`) with one `Cloth` material.
- The default glTF stack imports the same files as material instances and logs nothing.
- The cause is in the engine source: `InterchangeGLTFMaterial.cpp` line 439 sets an `AlphaMode` input for every non-opaque material, `InterchangeMaterialFactory.cpp` line 297 reports an input the function lacks, and `MF_Default_Body` has 89 function inputs, none called `AlphaMode` (it has `AlphaCutoff`).

## Not verified

Other Interchange material settings (instances from the owned pipeline, Substrate enabled); whether the line appears on other 5.8.x builds.
