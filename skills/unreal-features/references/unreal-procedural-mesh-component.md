# ProceduralMeshComponent in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. `UProceduralMeshComponent` is a renderable component that takes custom triangle geometry (vertex, triangle, normal, UV, colour and tangent arrays) grouped into numbered sections. The plugin descriptor calls it "a renderable component and library of utilities for creating and modifying mesh geometry procedurally."

## Enable it

| Item | Value (plugin descriptor) |
|---|---|
| Plugin | `ProceduralMeshComponent` ("Procedural Mesh Component"), category Rendering |
| Enabled by default | Yes |
| Flags | beta: false, experimental: false, editor-only: false (modules: Runtime and Editor) |
| Plugin dependencies | none |

- The class comment in the engine header and Epic's API page both mark the component experimental and open to substantial change in future releases.
- It is on by default. To make it explicit, add `{ "Name": "ProceduralMeshComponent", "Enabled": true }` to the `Plugins` array of the `.uproject`, or tick it in Edit > Plugins.

## Use it when

- You have vertex and index arrays computed by your own code and need them on screen with one call.
- You want a grid or box built from arrays, using the grid and box helpers in `ProceduralMeshLibrary`.
- You need to update vertex positions of a fixed-topology mesh every few frames (Update Mesh Section).
- You need to slice a mesh with a plane at runtime, with an optional cap (`Slice Procedural Mesh`).
- You need to read geometry back from a Static Mesh into arrays (`Get Section From Static Mesh`) and rebuild it as a procedural mesh.
- You need a few sections, each with its own material slot and its own visibility toggle.

## Use something else when

- Use [unreal-geometry-scripting.md](unreal-geometry-scripting.md) and its Dynamic Mesh Component when you want to edit a mesh with high-level operations (Booleans, remeshing, simplification, repair, UV and normal tools) instead of managing arrays. Epic describes `UDynamicMeshComponent` as similar to `UProceduralMeshComponent` but backed by a `UDynamicMesh`, with in-editor and runtime updates.
- Use Geometry Scripting's Copy Mesh To Static Mesh, or Create New Static Mesh Asset From Mesh (editor only), when the result must become a Static Mesh asset.
- Use agent-meshes (GLB import) for authored models such as characters and props.
- Use [unreal-pcg.md](unreal-pcg.md) when the goal is placing many pieces of content in a world rather than building one mesh.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Add the component | Blueprint / C++ / Python | Add Procedural Mesh Component to an actor (`BlueprintSpawnableComponent`, class group Rendering); Python class `unreal.ProceduralMeshComponent` |
| Create or replace a section | Blueprint / C++ | `Create Mesh Section` (`CreateMeshSection_LinearColor`): SectionIndex, Vertices, Triangles, Normals, UV0 to UV3, VertexColors, Tangents, Create Collision |
| Update vertex data in place | Blueprint / C++ | `Update Mesh Section`: faster than Create Mesh Section, keeps topology, updates collision |
| Clear sections | Blueprint / C++ | `Clear Mesh Section` (other indices keep their numbers), `Clear All Mesh Sections` |
| Show or hide a section | Blueprint / C++ | `Set Mesh Section Visible`, `Is Mesh Section Visible`, `Get Num Sections` |
| Simple collision | Blueprint / C++ / Python | `Add Collision Convex Mesh`, `Clear Collision Convex Meshes`; Python `add_collision_convex_mesh` |
| Collision mode | Details panel / Blueprint read / C++ | `bUseComplexAsSimpleCollision`, `bUseAsyncCooking` (both editable in Details, read-only in Blueprint) |
| Build helpers | Blueprint / C++ / Python | `unreal.ProceduralMeshLibrary`: `generate_box_mesh`, `create_grid_mesh_welded`, `create_grid_mesh_split`, `create_grid_mesh_triangles`, `convert_quad_to_triangles`, `calculate_tangents_for_mesh` |
| Copy from or to Static Mesh | Blueprint / C++ / Python | `ProceduralMeshLibrary`: `get_section_from_static_mesh`, `copy_procedural_mesh_from_static_mesh_component`, `get_section_from_procedural_mesh` |
| Slice with a plane | Blueprint / C++ / Python | `ProceduralMeshLibrary.slice_procedural_mesh` with `EProcMeshSliceCapOption` (NoCap, CreateNewSectionForCap, UseLastSectionForCap) |
| Raw section access | C++ only | `GetProcMeshSection`, `SetProcMeshSection`, `SetCollisionConvexMeshes` |

## Workflow

1. Add the component to an actor and assign materials to its slots; one section index maps to one material slot.
2. Fill the arrays: Triangles is an index buffer whose length is a multiple of 3. Normals, UV0, VertexColors and Tangents are optional, and when supplied each must match the Vertices length.
3. Call Create Mesh Section once per section. Use the LinearColor version in Blueprint; the FColor version is deprecated for Blueprints.
4. Set Create Collision only for sections that need it. Epic documents that it "adds significant cost".
5. For per-frame deformation, keep the topology and call Update Mesh Section instead of Create Mesh Section.
6. For collision, choose one mode. Set `bUseComplexAsSimpleCollision` to true to use the triangles as collision. Set it to false when the component receives simple collision (Add Collision Convex Mesh) and is simulated.
7. Enable `bUseAsyncCooking` when collision does not have to be current immediately, such as far-away streamed pieces; cooking then runs off the game thread.
8. Call Clear Mesh Section for one section, or Clear All Mesh Sections to reset. A raw pointer from `GetProcMeshSection` changes meaning when sections are added or removed, so re-fetch it after such changes.
9. When the mesh needs Booleans, remeshing or LOD work, move to a Dynamic Mesh Component or bake to a Static Mesh with Geometry Scripting.

## Sources

- [UProceduralMeshComponent API reference (5.8)](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/ProceduralMeshComponent/UProceduralMeshComponent)
- [What is Geometry Scripting? (Users Guide)](https://dev.epicgames.com/documentation/unreal-engine/geometry-scripting-users-guide-in-unreal-engine)
- The ProceduralMeshComponent plugin descriptor.
- Engine source: `ProceduralMeshComponent.h`, `ProceduralMeshComponent.cpp` (section index selects the material) and `KismetProceduralMeshLibrary.h` (function signatures, parameter documentation, collision properties); the editor's Python class listing for `unreal.ProceduralMeshComponent` and `unreal.ProceduralMeshLibrary`.
