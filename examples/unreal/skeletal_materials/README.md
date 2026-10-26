# Skeletal mesh material slots: what Python reaches, and a small editor module for the rest

Prepared for [Unreal import policy](../../../skills/unreal-import/references/unreal-import-policy.md) and [Bridging editor Python to C++](../../../skills/unreal-editor-scripting/references/unreal-python-cpp-bridge.md). Unreal Engine 5.8, Windows, Visual Studio 2022 Build Tools.

**Status:** Prepared 2026-10-26; not yet run on an engine. A first run tests the probe before it tests the engine. The first run is also the first compile of the C++ module.

The questions: which ways of setting a skeletal mesh's material slots from Python change the mesh, which of them also reach the disk, and does one editor-module function (`SetSkeletalMeshMaterials`) close the gap, including the asset-registry tag that content tools read before loading a mesh?

## What the probe tries

| Route | Where | Expected, from the backlog record (not yet run) |
|---|---|---|
| Read: `mesh.get_editor_property("materials")` | Python | one slot on the engine skeletal cube, with `material_slot_name` and `material_interface` |
| Element edit: `slots = mesh.get_editor_property("materials"); slots[0].material_interface = m` | Python | no error, no change (the getter returns a copy) |
| Assign back: `mesh.set_editor_property("materials", [unreal.SkeletalMaterial(...)])` | Python | changes the mesh in memory; does not dirty the package, so `EditorAssetLibrary.save_loaded_asset(mesh)` (only if dirty) writes nothing |
| Assign back, then `save_loaded_asset(mesh, only_if_is_dirty=False)` | Python | the new material reaches the disk |
| `SkeletalMaterialsBridgeLibrary.set_skeletal_mesh_materials(mesh, [materials])` | C++ module | sets every slot in order, marks the package dirty so a default save writes it, refuses (False, logged) when the count differs from the slot count |

The engine skeletal cube has one slot, so the probe pads a copy to two slots with the assign-back route before it calls the function on two.

## Files

- `module/SkeletalMaterialsBridge/` (editor-only module): `USkeletalMaterialsBridgeLibrary::SetSkeletalMeshMaterials`. It writes `Mesh->GetMaterials()[i].MaterialInterface` between `Modify()` and `PostEditChange()`, then `MarkPackageDirty()` (`Engine/Classes/Engine/SkeletalMesh.h`, `SkinnedAssetCommon.h`). `PostEditChange` refreshes the material info cache that feeds the hidden asset-registry `Materials` tag (`SkeletalMesh.cpp`, `UpdateSkeletalMaterialsInfoCache`).
- `skel_probe.py` is the editor script. Mode `author` makes two Materials from nodes and five copies of the skeletal cube (`SK_Element`, `SK_Assign`, `SK_AssignForced`, `SK_Single`, `SK_Two`), runs a route on each, and stats each `.uasset` before and after every save. Mode `read` runs in a fresh process: it reads each mesh's `Materials` registry tag from disk before loading anything, then loads each mesh and reads its slots.
- `skeletal_materials.mjs` writes a throwaway code project in the OS temp folder (`../native-build.mjs`), builds the Editor target, and runs the script in two processes (`UnrealEditor-Cmd.exe -run=pythonscript -nullrhi`).
- `skel-checks.mjs` judges the build, the two reports and the author log; `skel-checks.test.mjs` tests that logic with no Unreal (it runs in `node scripts/check.mjs`). The test reports are the shape the script writes, with the outcomes in the table: the shape is an assumption until a first run.

## Run

```text
node examples/unreal/skeletal_materials/skeletal_materials.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--rendering] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
```

`--engine` may be replaced by the `UE_ROOT` environment variable. A few minutes for the build, then about a minute per process. `--rendering` runs the same script inside a rendering editor (`UnrealEditor.exe` without `-nullrhi`, with a GPU and a window) so the authored-material statistics in the report can be compared with the headless run.

## What it checks (15 checks)

- The module compiles; the author process ran with no script error and the bridge function is visible to Python; the read process ran and loaded all five meshes.
- The Python read returns one named slot; the element edit changes nothing, in memory or after a forced save and a fresh load.
- The assign-back changes the slots in memory; it leaves the package clean (two default saves write nothing, a fresh load reads the original); with a forced save the new material persists. Padding a one-slot mesh to two slots from Python works and names the second slot.
- The function refuses three materials for two slots (False, slots unchanged, the module's error in the log), sets one slot and two slots with the slot names unchanged, makes a default save write the file, and its result is what a fresh process loads.
- Every mesh's hidden registry `Materials` tag, read from disk before any load, matches the slots the loaded mesh reports (no stale tag after any route).
- The two authored Materials save and load as `Material`.

## Open risks and what is not judged

- **A content stage without rendering and authored materials.** In one native project the same character's authored materials came out as the default grid when a stage ran in a headless editor with `-nullrhi`, and were right when the stage ran with rendering on a machine with a GPU. The cause was not isolated, and whether it applies to any material-heavy stage was not tested. This probe authors two node-built Materials in the headless run and records their `recompile_material` errors and `get_statistics` instruction counts, without judging them. Run it once headless and once with `--rendering` and compare those two fields; a headless material with zero instructions or compile errors is the first lead. Until then, read materials back after a no-rendering run, or run the stage with rendering.
- The imported slot names (`imported_material_slot_name`) of structs made from Python are recorded and not judged. Whether setting `material_slot_name` or an imported name from Python works is not covered.
- The Python names of the asset-registry route (`get_asset_by_object_path`, its `k2_` alternative, `AssetData.get_tag_value`) are derived from the C++ names and not confirmed; the read process tries both lookups and records which worked and the raw shape the tag call returned.
- Not covered: Unreal 5.7, any 5.8 patch other than the one the first run uses, an importer policy for skeletal meshes, and rendering of the meshes (the checks compare read-back values, not pictures).
