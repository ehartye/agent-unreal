# Nanite in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. Nanite is Unreal's virtualized geometry system: meshes are split into hierarchical clusters, streamed on demand and switched between levels of detail per cluster at render time, so a Nanite static mesh uses no traditional LODs (Epic's Nanite overview). A Nanite mesh is still a Static Mesh with Nanite enabled.

## Enable it

- Nanite is an engine feature, not a plugin. Project Settings > Engine > Rendering > Nanite holds `r.Nanite.ProjectEnabled` (restart required, 5.8 install header).
- Nanite requires DirectX 12 with Shader Model 6 and recommends a solid state drive for streaming (Epic's Nanite overview). The 5.8 templates target Shader Model 6.
- Per mesh: Static Mesh or Skeletal Mesh editor > Nanite Settings > Enable Nanite Support; Geometry Collection editor > Nanite > Enable Nanite; Content Browser right-click > Nanite > Enable for a batch; Build Nanite in the import options. Landscape: select the Landscape, check Enable Nanite, then Build Data.
- Supported components: Static Mesh, Skeletal Mesh, Instanced Static Mesh, Hierarchical Instanced Static Mesh, Spline Mesh, Geometry Collection and Landscape.

| Feature | State (Epic) | Switch |
|---|---|---|
| Nanite meshes, skeletal meshes, landscape | no status label on the overview | per-mesh setting above |
| Tessellation (runtime displacement) | Experimental | `r.Nanite.AllowTessellation=1` in config (read-only), `r.Nanite.Tessellation=1`; material Enable Tessellation and Displacement input |
| Static displacement mapping (offline) | Experimental | Static Mesh editor Displacement Maps and Trim Relative Error |
| Nanite Foliage (assemblies, voxels, skinning) | Experimental | Project Settings > Rendering > Nanite Foliage (restart); voxels via Shape Preservation = Voxelize |
| Preserve Area for foliage | Beta | Static Mesh Nanite Settings |
| Nanite Assembly Editor Utilities, PCG Nanite Assemblies Interop, Dynamic Wind, Procedural Vegetation Editor, Niagara Nanite | plugins, off by default, experimental in the 5.8 descriptors | Edit > Plugins |
| Nanite Displaced Mesh | plugin, off by default, beta in the 5.8 descriptor | Edit > Plugins |

## Use it when

- Static geometry has high polygon counts or many instances (rocks, buildings, kitbashed sets, scanned assets). Nanite cost scales with screen pixels, not scene complexity.
- Foliage is modeled as geometry. Epic's Nanite Foliage combines assemblies, voxels and skinning, with wind driven by a bone hierarchy instead of World Position Offset.
- Terrain needs detail: Nanite Landscape supports tessellation and displacement from the Landscape material.
- You want Lumen and Virtual Shadow Maps to work against detailed geometry ([Lumen](unreal-lumen.md), [Virtual Shadow Maps](unreal-virtual-shadow-maps.md)).

## Use something else when

- The material is Translucent, or the mesh needs Morph Targets, Forward Rendering, VR stereo, MSAA, Lighting Channels or Minimum Screen Radius: Nanite does not support them. Nanite takes Opaque and Masked blend modes only.
- Foliage is card-based or aggregate geometry (hair, leaves, grass): Epic notes it can be slower with Nanite than without.
- A rigid mesh needs deformation beyond translation, rotation, non-uniform scale and limited World Position Offset: Nanite does not support it. Skinned animation uses Nanite Skeletal Mesh, which has animation LODs and no geometry LODs.
- Non-Nanite meshes keep authored LODs; Epic's Hybrid Non-Nanite and Nanite Content Workflows page covers mixing them.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Enable Nanite project-wide | Project Settings UI / `DefaultEngine.ini` | `r.Nanite.ProjectEnabled`; Epic's Python 5.8 reference has no RendererSettings class |
| Read or set per-mesh Nanite state | Python | `unreal.StaticMesh.nanite_settings` (`unreal.MeshNaniteSettings`: `enabled`, `position_precision`, `keep_percent_triangles`, `trim_relative_error`, `fallback_target`, `fallback_percent_triangles`, `fallback_relative_error`, `shape_preservation`, `max_edge_length_factor`, `displacement_maps`, `displacement_uv_channel`), `get_num_nanite_triangles()`, all documented by Epic's Python 5.8 reference |
| Enable Nanite at import and verify | Python (Interchange) | `build_nanite` on the import pipeline and a read-back of `nanite_settings.enabled`: Unreal import policy (`engine-asset-import` skill, agent-engine) |
| Build Nanite assemblies | Blueprint / editor | `UNaniteAssemblyStaticMeshBuilder`, `UNaniteAssemblySkeletalMeshBuilder` (Nanite Assembly Editor Utilities); USD schemas `NaniteAssemblyRootAPI`, `NaniteAssemblyExternalRefAPI`, `NaniteAssemblySkelBindingAPI`; PCG interop plugin |
| Materials: tessellation, displacement, WPO clamp | Material editor | Enable Tessellation, Displacement input with Magnitude and Center, Displacement Fade, Max World Position Offset Displacement |
| Console | Python / console | `unreal.SystemLibrary.execute_console_command` (documented by Epic): `r.Nanite`, `r.Nanite.Streaming.StreamingPoolSize`, `r.Nanite.Visualize.Advanced`, `r.RayTracing.Nanite.Mode 1` (experimental native ray tracing) |
| Inspect | editor UI | Viewport Nanite Visualization menu: Triangles, Clusters, Overdraw, Tessellation, Pixel Programmable, Raster Bins, Shading Bins |

## Workflow

1. Confirm DirectX 12 and Shader Model 6 and that Nanite is enabled for the project.
2. Enable Nanite on meshes with the Content Browser batch action or `MeshNaniteSettings.enabled`. Use a shared Derived Data Cache, since high-detail builds take time. Disable Generate Lightmap UVs when no baked lighting is used.
3. Use Opaque materials. Masked materials cost considerably more because masked-out pixels cost nearly as much as drawn ones; model foliage as geometry.
4. Limit World Position Offset and clamp it with Max World Position Offset Displacement.
5. Avoid accidental hard edges on dense meshes; a vertex-to-triangle ratio of 2:1 or higher indicates faceted normals.
6. Enable Preserve Area on foliage meshes only. For tessellation, use the full 0 to 1 displacement range with the smallest Magnitude that works, because Magnitude bounds culling. Supply a normal map, since displacement does not change shading.
7. Set Generate Ray Tracing Proxies (`r.RayTracing.RayTracingProxies.ProjectEnabled`), which the 5.8 header recommends for ray tracing LODs; otherwise tune Fallback Relative Error.
8. Check Nanite Overdraw and Triangles visualizations on dense or stacked geometry. A scene streams at most 16 million instances.
9. Nanite Landscape: Build Data after sculpting; tessellation shows only when Nanite data is current.

## Sources

- [Nanite Virtualized Geometry](https://dev.epicgames.com/documentation/en-us/unreal-engine/nanite-virtualized-geometry-in-unreal-engine)
- [Nanite Technical Details](https://dev.epicgames.com/documentation/en-us/unreal-engine/nanite-technical-details)
- [Working with Nanite-Enabled Content](https://dev.epicgames.com/documentation/unreal-engine/working-with-naniteenabled-content)
- [Nanite Foliage](https://dev.epicgames.com/documentation/en-us/unreal-engine/nanite-foliage) and [Nanite Assemblies](https://dev.epicgames.com/documentation/en-us/unreal-engine/nanite-assemblies)
- [Using Nanite with Landscapes](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-nanite-with-landscapes-in-unreal-engine)
- [Nanite in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/nanite-in-unreal-engine)
- Epic Python 5.8 reference: [StaticMesh](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/StaticMesh), [MeshNaniteSettings](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/MeshNaniteSettings), [SystemLibrary](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/SystemLibrary)
- In the 5.8 install: `RendererSettings.h`, the plugin descriptors (`examples/unreal/engine_plugins.mjs`) and the template `DefaultEngine.ini`.
