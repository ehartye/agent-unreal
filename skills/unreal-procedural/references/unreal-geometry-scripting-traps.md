# Geometry Scripting traps in Unreal 5.8: primitive origins and rotation, new asset options and runtime collision

Target: Unreal Engine 5.8, Windows. Companion to [Geometry Scripting](unreal-geometry-scripting.md), which covers enabling the plugin, the function table, the workflow and the plane-cut check. These are the facts that cost a rebuild when a mesh is assembled from primitives and only looked at afterwards.

## Primitive origin and rotation

- [documented] `EGeometryScriptPrimitiveOriginMode` is `Center` or `Base`, passed as `Origin` (Python `origin`). It defaults to `Base` for `AppendBox`, `AppendCapsule`, `AppendCylinder`, `AppendCone`, `AppendTorus` and `AppendSimpleExtrudePolygon`, and to `Center` for `AppendSphereLatLong` and `AppendSphereBox` (`Engine/Plugins/Runtime/GeometryScripting/Source/GeometryScriptingCore/Public/GeometryScript/MeshPrimitiveFunctions.h`).
- [documented] `Base` means the shape stands on its transform: `AppendBox` shifts the box up by half its Z dimension (`MeshPrimitiveFunctions.cpp`), so a box of 1,400 units in Z at the origin spans Z 0 to 1,400, not -700 to 700. Pass `origin` explicitly when a part is stacked on another.
- [general] Observed once: a crown placed "at half height" of a tall wall, on the assumption of a centred box, floated; it belongs at the box's top, Z 1,400.
- [documented] A positive roll turns local +Z toward +Y. `FRotationTranslationMatrix` (`Engine/Source/Runtime/Core/Public/Math/RotationTranslationMatrix.h`) gives the rotated Z axis `(-(CR*SP*CY + SR*SY), CY*SR - CR*SP*SY, CR*CP)`, which is `(0, sin r, cos r)` for roll `r` with pitch and yaw 0. A ring of rays in the YZ plane, each ray built along +Z, therefore needs the roll `90 - angle` to point at `angle` measured from +Y toward +Z. [general] The ring built this way looked right in a picture once.
- [documented] `FRotator` stores Pitch, Yaw, Roll, but its native make function is `MakeRotator {Roll, Pitch, Yaw}` (`Engine/Source/Runtime/Engine/Classes/Kismet/KismetMathLibrary.h`). Build `unreal.Rotator` with keywords (`roll=`, `pitch=`, `yaw=`); a helper that takes `(pitch, yaw, roll)` is easy to mis-assign by hand. The Python constructor's argument order was not read.
- [general] Read the pieces back before saving: count the triangles, read `get_mesh_bounding_box`, and check that the base is at Z 0 and the top where the stack says. A wrong origin imports fine and shows only when the mesh is placed, half-buried or floating.
- Not run: a check that prints the bounding box of a box, a cone, a cylinder and a rotated cone from this repo. Until one exists these lines stay `[documented]` or `[general]`, not `[tested]`.

## New Static Mesh asset and runtime collision

- [documented] When creating a new Static Mesh asset, set `enable_nanite`, `enable_recompute_normals` and `enable_recompute_tangents` explicitly; the option struct defaults all three to false (collision defaults to enabled) (`CreateNewAssetUtilityFunctions.h`).
- [documented] For a runtime mesh that moves or collides, set the Dynamic Mesh Component's collision explicitly: `CollisionType` defaults to Use Simple As Complex, `bEnableComplexCollision` defaults to false, and `bDeferCollisionUpdates` skips a rebuild on every edit; call `UpdateCollision` after a batch of edits (`DynamicMeshComponent.h`).

## Sources

- Engine headers and source in the 5.8 install: `MeshPrimitiveFunctions.h`, `MeshPrimitiveFunctions.cpp`, `RotationTranslationMatrix.h`, `KismetMathLibrary.h`, `NoExportTypes.h`, `DynamicMeshComponent.h`, `CreateNewAssetUtilityFunctions.h`.
