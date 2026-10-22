# Geometry Scripting in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. Geometry Script is a function library for creating and editing meshes from Blueprint and Python; its functions operate on `UDynamicMesh` objects, the data structure shared with Geometry Processing and Modeling mode.

## Enable it

| Item | Value (plugin descriptor) |
|---|---|
| Plugin | `GeometryScripting` ("Geometry Script"), category Geometry |
| Enabled by default | No |
| Flags | beta: false, experimental: false, editor-only: false (modules: Runtime and Editor) |
| Plugin dependencies | `GeometryProcessing` (beta: true), `MeshModelingToolset`, `PlanarCut` |

- Epic labels the feature Beta in its guide and advises caution when shipping with it.
- Enable: Edit > Plugins, search "geometry script", tick it, restart the editor. Or add `{ "Name": "GeometryScripting", "Enabled": true }` to the `Plugins` array of the `.uproject`.

## Use it when

- You need parametric or computed geometry: boxes, spheres, capsules, stairs, revolves, sweeps, extrudes, built from parameters.
- You need to edit geometry: Boolean union, intersect or subtract, plane cuts, bevels, offsets, shells.
- You need to clean up or convert a mesh: remesh, simplify to a triangle count, fill holes, recompute normals, regenerate UVs.
- You need to ask a mesh questions: volume, area, bounds, closed or open, nearest point, ray hit, point inside.
- You need meshes generated at runtime (most functions work in the editor and at runtime) or batch asset processing from an Editor Utility Widget, Asset Action or Python.
- You need collision for a generated mesh: convex hulls, convex decomposition, boxes, spheres, capsules.

## Use something else when

- Use agent-meshes (GLB import) when the model is authored art: characters, creatures, props, anything with named parts, rigs or vertex colours. Author it as a GLB, then import it (see the `engine-asset-import` skill). Use Geometry Scripting when the mesh is generated from parameters in the engine, depends on level data at runtime, or is post-processed after import (copy from the static mesh, edit, copy back).
- Use [unreal-procedural-mesh-component.md](unreal-procedural-mesh-component.md) when you already hold raw vertex and triangle arrays and want them on screen with the least setup.
- Use [unreal-pcg.md](unreal-pcg.md) when the goal is populating a world with placed content rather than building one mesh.
- Use [unreal-water.md](unreal-water.md) for oceans, rivers and lakes.
- Use a Static Mesh asset (bake it with Copy Mesh To Static Mesh) when the mesh needs Nanite, LODs or instanced rendering: `UDynamicMeshComponent` supports none of those, and a `UDynamicMesh` is not an asset.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Primitives | Python / Blueprint / C++ | `unreal.GeometryScript_Primitives.append_box`, `append_sphere_lat_long`, `append_cylinder`, `append_capsule`, `append_torus`, `append_revolve_polygon`; options `unreal.GeometryScriptPrimitiveOptions` |
| Booleans | Python / Blueprint | `unreal.GeometryScript_MeshBooleans.apply_mesh_boolean` (`GeometryScriptMeshBooleanOptions`), `apply_mesh_plane_cut`, `apply_mesh_self_union` |
| Extrude, bevel, offset | Python / Blueprint | `unreal.GeometryScript_MeshModeling.apply_mesh_extrude`, `apply_mesh_bevel_selection`, `apply_mesh_shell` |
| Remesh | Python / Blueprint | `unreal.GeometryScript_Remeshing.apply_uniform_remesh` (`GeometryScriptUniformRemeshOptions`), `apply_adaptive_remesh` |
| Simplify | Python / Blueprint | `unreal.GeometryScript_MeshSimplification.apply_simplify_to_triangle_count`, `apply_simplify_to_tolerance`, `apply_simplify_to_planar` |
| Repair | Python / Blueprint | `unreal.GeometryScript_MeshRepair.fill_all_mesh_holes`, `weld_mesh_edges`, `remove_small_components`, `repair_mesh_degenerate_geometry` |
| Normals, tangents | Python / Blueprint | `unreal.GeometryScript_Normals.recompute_normals`, `compute_split_normals`, `compute_tangents` |
| UVs | Python / Blueprint | `unreal.GeometryScript_UVs.auto_generate_x_atlas_mesh_u_vs`, `recompute_mesh_u_vs`, `layout_mesh_u_vs`, `repack_mesh_u_vs` |
| Queries | Python / Blueprint | `unreal.GeometryScript_MeshQueries.get_mesh_volume_area`, `get_mesh_bounding_box`, `get_is_closed_mesh`, `get_num_open_border_loops` |
| Read or write a Static Mesh | Python / Blueprint | `unreal.GeometryScript_AssetUtils.copy_mesh_from_static_mesh_v2`, `copy_mesh_to_static_mesh` |
| Create a new Static Mesh asset | Python / Blueprint, editor only | `unreal.GeometryScript_NewAssetUtils.create_new_static_mesh_asset_from_mesh` with `GeometryScriptCreateNewStaticMeshAssetOptions` |
| Collision | Python / Blueprint | `unreal.GeometryScript_Collision.generate_collision_from_mesh`, `set_dynamic_mesh_collision_from_mesh` (`GeometryScriptCollisionFromMeshOptions`) |
| Show a mesh in a level | Blueprint / Python | `unreal.DynamicMeshActor` and its `dynamic_mesh_component`; an Actor Blueprint on `GeneratedDynamicMeshActor` gives editor-time rebuilds (its rebuild function is editor-only) |
| Reuse temporary meshes | Blueprint / Python | `unreal.GeometryScript_SceneUtils.create_dynamic_mesh_pool` |
| Subdivision (Catmull Clark, Triangle Loop), editor simplifier, unique asset names | editor only | Epic marks these nodes "only works in the Editor" |
| Custom code | C++ | the same `UGeometryScript_*` libraries (modules `GeometryScriptingCore`, runtime; `GeometryScriptingEditor`, editor) |

## Workflow

1. Enable the plugin and restart the editor.
2. For a parametric actor, create a Blueprint on `GeneratedDynamicMeshActor` and build the mesh in the Event On Rebuild Generated Mesh. Store the Target Mesh in a `DynamicMesh` variable.
3. Append a primitive into that variable, then drive its size from an instance-editable variable so each change regenerates the mesh instead of scaling it.
4. Take a temporary tool mesh from the Compute Mesh Pool for Boolean operations. In an Editor Utility Widget, call Create Dynamic Mesh Pool first, because no default pool exists there.
5. Every function edits Target Mesh in place and returns it, so chain calls. Use the Options pin for settings.
6. Bake with Copy Mesh To Static Mesh from a Call In Editor function, using a validated get on the target asset.
7. When creating a new Static Mesh asset, set `enable_nanite`, `enable_recompute_normals` and `enable_recompute_tangents` explicitly; the option struct defaults all three to false (collision defaults to enabled).
8. For a runtime mesh that moves or collides, set the Dynamic Mesh Component's collision explicitly: `CollisionType` defaults to Use Simple As Complex, `bEnableComplexCollision` defaults to false, and `bDeferCollisionUpdates` skips a rebuild on every edit; call `UpdateCollision` after a batch of edits.
9. Treat low-level list and vertex-building functions as the slow path in Blueprint and Python on large meshes; prefer the high-level operations.

## Sources

- [What is Geometry Scripting? (Users Guide)](https://dev.epicgames.com/documentation/unreal-engine/geometry-scripting-users-guide-in-unreal-engine)
- [Introduction to Geometry Scripting](https://dev.epicgames.com/documentation/unreal-engine/introduction-to-geometry-scripting-in-unreal-engine)
- [Geometry Scripting Reference](https://dev.epicgames.com/documentation/unreal-engine/geometry-scripting-reference-in-unreal-engine)
- [Geometry Scripting through Blueprints](https://dev.epicgames.com/documentation/unreal-engine/geometry-scripting-through-blueprints-in-unreal-engine)
- The plugin descriptors for GeometryScripting, GeometryProcessing and ProceduralMeshComponent; the editor's Python class listing for the `unreal.GeometryScript_*` classes.
- Engine headers: `DynamicMeshComponent.h` (collision properties), `CreateNewAssetUtilityFunctions.h` (new-asset option defaults).
