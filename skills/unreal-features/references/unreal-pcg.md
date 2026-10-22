# Procedural Content Generation (PCG) in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. PCG is a node-graph "visual scripting framework for procedurally populating worlds with content in editor and/or at run-time" (plugin descriptor). Epic describes it as a toolset for building procedural content from small asset utilities to whole worlds.

## Enable it

| Plugin | Category | Enabled by default | Flags | Dependencies |
|---|---|---|---|---|
| `PCG` | Editor | yes | not beta, not experimental, not editor-only (Runtime + Editor modules) | EditorScriptingUtilities, ComputeFramework, GeometryProcessing, MeshModelingToolset |
| `PCGBiomeCore` | Other | no | experimental | PCG, PCGGeometryScriptInterop |
| `PCGBiomeSample` | Other | no | experimental | PCGBiomeCore, PCG |

- Enable via Edit > Plugins, or add `{"Name": "PCGBiomeCore", "Enabled": true}` to the `Plugins` array of the `.uproject`.
- Sampling points on static meshes needs the Geometry Script Interop plugin (Epic overview).
- The Biome plugins are examples of PCG usage: Attribute Set Tables, feedback loops, recursive sub-graphs and runtime hierarchical generation. Epic labels them experimental.

## Use it when

- You need many instances (trees, rocks, props, fences, buildings from shape grammar) placed by rule across a Landscape, volume, spline or mesh surface.
- The layout must regenerate when inputs change: the graph updates live in the viewport and can re-run on demand.
- A large open world needs content that streams with World Partition (partitioned generation) or generates near the player (runtime generation).
- You need artist-tunable placement: Graph Parameters and Graph Instances work like Material parameters and Material Instances.
- Scatter must be cheap at runtime: the GPU Static Mesh Spawner builds instances entirely on the GPU.

## Use something else when

- Use hand placement when a handful of specific, authored actors matter individually.
- Use [Geometry Scripting](unreal-geometry-scripting.md) when the output is new mesh geometry (booleans, extrusions, remeshing) rather than placed instances; PCG also carries mesh results as dynamic mesh data (`unreal.PCGDynamicMeshData`, `PCGStaticMeshToDynamicMeshSettings`).
- Use [Procedural Mesh Component](unreal-procedural-mesh-component.md) when one runtime mesh is built from code vertex by vertex.
- Use [Landmass](unreal-landmass.md) when the goal is sculpting the Landscape heightmap itself.
- Use [Water](unreal-water.md) for rivers, lakes and oceans; PCG can scatter shoreline props around them.
- Use [Niagara](unreal-niagara.md) for particle effects; PCG output is scene content.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Author a graph visually | Editor UI | PCG Graph editor (node editor like the Material Editor); save as template for reuse |
| Create graph asset, add nodes and edges | Python | `unreal.PCGGraph` (`add_node_of_type`, `add_node_copy`, `add_edge`, `get_input_node`, `get_output_node`), `unreal.PCGGraphFactory` for asset creation; node settings classes such as `unreal.PCGSurfaceSamplerSettings`, `unreal.PCGStaticMeshSpawnerSettings`, `unreal.PCGGetLandscapeSettings` |
| Run a graph on an actor | Python | `unreal.PCGComponent` (`generate`, `generate_local`, `cleanup`, `cleanup_local`, `get_graph`, `generation_trigger`, `generation_radii`, `get_generated_graph_output`) |
| Place a volume that runs a graph | Python / editor UI | `unreal.PCGVolume`; assign the graph on its PCG Component |
| Choose when generation runs | Python property | `unreal.PCGComponentGenerationTrigger` (`GENERATE_ON_LOAD`, `GENERATE_ON_DEMAND`, `GENERATE_AT_RUNTIME`) |
| Parameterized variants | Python / editor UI | `unreal.PCGGraphInstance` (`graph` property) |
| Custom node logic | Blueprint | Subclass `PCGBlueprintElement` (Python exposes `unreal.PCGBlueprintElement`, `PCGBlueprintSettings`); visible instance-editable variables become overridable |
| Custom native nodes | C++ | Settings properties marked `PCG_Overridable` become override pins |
| Weighted mesh choice | Python | `unreal.PCGMeshSelectorWeighted`, `PCGMeshSelectorByAttribute` |
| GPU scatter | Editor UI | Toggle Execute on GPU on a node (labeled GPU in the graph) |
| Debug a node | Editor UI | D debug render, E enable/disable, A inspect |

## Workflow

Epic's forest example:
1. Create a Landscape; add a PCG Volume and scale it over the area.
2. Create a PCG Graph asset and assign it to the volume's PCG Component.
3. Add Get Landscape Data and a Surface Sampler (points per square meter, point extents); points conform to the Landscape.
4. Add Transform Points (rotation range, scale min/max).
5. Add a Static Mesh Spawner with weighted Mesh Entries.
6. Click Generate; inspect each node's point data with debug rendering.

Pick the generation mode per component:
- On demand: the Generate button or `PCGComponent.generate`.
- Partitioned: enable Is Partitioned to generate across a grid for World Partition streaming; the grid size lives on the PCGWorldActor, and changing it requires cleanup and regeneration.
- Hierarchical: enable in Graph Settings, set HiGen Default Grid Size, and place the Grid Size node before samplers; it requires partitioned components.
- Runtime: set Generation Trigger to Generate at Runtime; components generate inside the Generation Radius of a PCG Generation Source and clean up outside the radius times the Cleanup Radius Multiplier. Radii should increase with each grid size. It runs in editor, PIE and standalone. Tune with `pcg.RuntimeGeneration.NumGeneratingComponents` (default 16) and `pcg.FrameTime` (default 16.667 ms). Enable Treat Editor Viewport as Generation Source on the PCGWorldActor to test in the viewport.

GPU execution:
- Supported nodes: Attribute Partition, Copy Points, Cull Points Outside Actor Bounds, Custom HLSL, Data Count, Normal to Density, Static Mesh Spawner, Transform Points.
- Use it when the data holds enough points to fill the GPU; group GPU nodes to limit CPU-GPU transfers.
- A GPU Static Mesh Spawner creates transient instances in GPU memory; it does not support collision and physics, navigation, ray tracing, Distance Field lighting, baked static lighting or HLOD, and works only with the Weighted and By-Attribute selectors and the by-attribute packer. Epic labels the feature Beta and the GPU spawner Experimental.

World Partition: assign PCG assets to a Data Layer and HLOD Layer and the generated actors inherit them; Spawn Actor and Create Target Actor nodes expose Data Layer Source and HLOD Source settings.

## Sources

- [Procedural Content Generation Framework](https://dev.epicgames.com/documentation/unreal-engine/procedural-content-generation-framework-in-unreal-engine)
- [Procedural Content Generation Overview](https://dev.epicgames.com/documentation/unreal-engine/procedural-content-generation-overview)
- [Using PCG Generation Modes](https://dev.epicgames.com/documentation/unreal-engine/using-pcg-generation-modes-in-unreal-engine)
- [Using PCG with World Partition](https://dev.epicgames.com/documentation/unreal-engine/using-pcg-with-world-partition-in-unreal-engine)
- [Using PCG with GPU Processing](https://dev.epicgames.com/documentation/unreal-engine/using-pcg-with-gpu-processing-in-unreal-engine)
- [PCG Biome Core and Sample Plugins](https://dev.epicgames.com/documentation/unreal-engine/procedural-content-generation-pcg-biome-core-and-sample-plugins-in-unreal-engine)
- [PCG Development Guides](https://dev.epicgames.com/documentation/unreal-engine/pcg-development-guides)
- The engine plugin descriptors for PCG, PCGBiomeCore and PCGBiomeSample, and the editor Python class surface.
