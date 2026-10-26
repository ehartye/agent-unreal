# Skeletal mesh material slots: what Python reaches, and a small editor module for the rest

Prepared for [Unreal import policy](../../../skills/unreal-import/references/unreal-import-policy.md) and [Bridging editor Python to C++](../../../skills/unreal-editor-scripting/references/unreal-python-cpp-bridge.md). Unreal Engine 5.8, Windows, Visual Studio 2022 Build Tools.

**Status:** Run on Unreal 5.8.2 on 2026-10-26: 15 of 15 checks pass in the commandlet run and 15 of 15 with `--rendering`. The first run found two probe faults (the engine skeletal cube had to be scanned into the asset registry before `duplicate_asset` could find it in a commandlet; the imported slot name is read with `get_editor_property`, not as an attribute). The assign-back route was expected to leave the package clean and does not: it dirties the package (see the table). The author process exits 1 in a commandlet run because the deliberate refusal logs an error; the checks do not judge the exit code.

The questions: which ways of setting a skeletal mesh's material slots from Python change the mesh, which of them also reach the disk, and does one editor-module function (`SetSkeletalMeshMaterials`) close the gap, including the asset-registry tag that content tools read before loading a mesh?

## What the probe tries

| Route | Where | Observed on 5.8.2 |
|---|---|---|
| Read: `mesh.get_editor_property("materials")` | Python | one slot on the engine skeletal cube, named `MaterialSlot`, with an empty `material_interface` and an imported slot name of `None` |
| Element edit: `slots = mesh.get_editor_property("materials"); slots[0].material_interface = m` | Python | no error, no change (the getter returns a copy) |
| Assign back: `mesh.set_editor_property("materials", [unreal.SkeletalMaterial(...)])` | Python | changes the mesh in memory and dirties the package (also for an identical second set), so `EditorAssetLibrary.save_loaded_asset(mesh)` (only if dirty) writes the file; a default save on an untouched copy writes nothing |
| Assign back, then `save_loaded_asset(mesh, only_if_is_dirty=False)` | Python | the new material reaches the disk, as it does with the default save |
| `SkeletalMaterialsBridgeLibrary.set_skeletal_mesh_materials(mesh, [materials])` | C++ module | sets every slot in order, marks the package dirty so a default save writes it, refuses (False, logged) when the count differs from the slot count |

The engine skeletal cube has one slot, so the probe pads a copy to two slots with the assign-back route before it calls the function on two.

## Files

- `module/SkeletalMaterialsBridge/` (editor-only module): `USkeletalMaterialsBridgeLibrary::SetSkeletalMeshMaterials`. It writes `Mesh->GetMaterials()[i].MaterialInterface` between `Modify()` and `PostEditChange()`, then `MarkPackageDirty()` (`Engine/Classes/Engine/SkeletalMesh.h`, `SkinnedAssetCommon.h`). `PostEditChange` refreshes the material info cache that feeds the hidden asset-registry `Materials` tag (`SkeletalMesh.cpp`, `UpdateSkeletalMaterialsInfoCache`).
- `skel_probe.py` is the editor script. Mode `author` makes two Materials from nodes and five copies of the skeletal cube (`SK_Element`, `SK_Assign`, `SK_AssignForced`, `SK_Single`, `SK_Two`), runs a route on each, and stats each `.uasset` before and after every save. Mode `read` runs in a fresh process: it reads each mesh's `Materials` registry tag from disk before loading anything, then loads each mesh and reads its slots.
- `skeletal_materials.mjs` writes a throwaway code project in the OS temp folder (`../native-build.mjs`), builds the Editor target, and runs the script in two processes (`UnrealEditor-Cmd.exe -run=pythonscript -nullrhi`).
- `skel-checks.mjs` judges the build, the two reports and the author log; `skel-checks.test.mjs` tests that logic with no Unreal (it runs in `node scripts/check.mjs`). The test reports are the shape the script wrote on 5.8.2, with the outcomes in the table.

## Run

```text
node examples/unreal/skeletal_materials/skeletal_materials.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--rendering] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
```

`--engine` may be replaced by the `UE_ROOT` environment variable. A few minutes for the build, then about a minute per process. `--rendering` runs the same script inside a rendering editor (`UnrealEditor.exe` without `-nullrhi`, with a GPU and a window) so the authored-material statistics in the report can be compared with the headless run.

## What it checks (15 checks)

- The module compiles; the author process ran with no script error and the bridge function is visible to Python; the read process ran and loaded all five meshes.
- The Python read returns one named slot; the element edit changes nothing, in memory or after a forced save and a fresh load.
- The assign-back changes the slots in memory; it dirties the package (the set and an identical second set each make the next default save write the file; an untouched control copy writes nothing) and a fresh load reads the new material; a forced save persists it too. Padding a one-slot mesh to two slots from Python works and names the second slot.
- The function refuses three materials for two slots (False, slots unchanged, the module's error in the log), sets one slot and two slots with the slot names unchanged, makes a default save write the file, and its result is what a fresh process loads.
- Every mesh's hidden registry `Materials` tag, read from disk before any load, matches the slots the loaded mesh reports (no stale tag after any route).
- The two authored Materials save and load as `Material`.

## Open risks and what is not judged

- **A content stage without rendering and authored materials.** In one native project the same character's authored materials came out as the default grid when a stage ran in a headless editor with `-nullrhi`, and were right when the stage ran with rendering on a machine with a GPU. The cause was not isolated, and whether it applies to any material-heavy stage was not tested. This probe authors two node-built Materials in the headless run and records their `recompile_material` errors and `get_statistics` instruction counts, without judging them. Run on 5.8.2, both runs report no compile errors, but the headless run reports 0 pixel and 0 vertex instructions for each material while the rendering run reports 266 and 136: with `-nullrhi` no shader is compiled for an authored material, which fits a mesh showing the default grid, but the probe does not render, so the grid itself is not shown. Read materials back after a no-rendering run, or run the stage with rendering.
- On 5.8.2 the engine cube's slot reads an imported name of `MaterialSlot`; slots rebuilt from new `SkeletalMaterial` structs (the assign-back and the padding) read `None`, while the C++ function leaves a slot's imported name alone.
- The imported slot names of structs made from Python are recorded (`get_editor_property("imported_material_slot_name")`; the property is `VisibleAnywhere`, so the attribute form does not exist) and not judged. Whether setting `material_slot_name` or an imported name from Python works is not covered.
- The asset-registry route that worked on 5.8.2 is `get_asset_by_object_path(path, True)` then `AssetData.get_tag_value("Materials")`, which returns the string `Slot,'/Path/Mat.Mat'>...` (an empty slot is `Slot,''>`). The `k2_` alternative was never needed.
- The run copies `/Engine/EngineMeshes/SkeletalCube` after `scan_paths_synchronous` on its folder; without the scan a commandlet's `duplicate_asset` returns `None` with "Could not find the source asset" in the log.
- Not covered: Unreal 5.7, any 5.8 patch other than 5.8.2, an importer policy for skeletal meshes, and rendering of the meshes (the checks compare read-back values, not pictures).
