# Mesh Terrain in Unreal 5.8: mesh-based terrain with non-destructive modifiers

Target: Unreal Engine 5.8, Windows. **Experimental.** [documented] Epic calls Mesh Terrain "a new experimental technology". Plugins: `MeshPartition`, `MeshPartitionWater`, `PCG MeshPartition Interop`, `Mesh Terrain Mode`. Written only from Epic's five 5.8 pages (Sources); nothing here was run.

## What it is

- [documented] **Mesh Partition** is the system, actor and geometry; **Mesh Terrain** is the tooling and workflows.
- [documented] Terrain is not a height field: overhangs, tunnels and sheer cliffs are possible, and resolution can vary (dense at points of interest, sparse far away).
- [documented] Modifiers are actor components, attachable to any actor, that deform the geometry and write weight channels. They stack without changing the base level.
- [documented] Base sections come from creation; preview sections are editor-only; compiled sections are the runtime form, decoupled from preview.
- [documented] A **Mesh Partition Definition** (MPD) is a data asset, the recipe for building a partition; several partitions can share one.

## Enable it

- [documented] Enable all four plugins: `MeshPartition` (core), `MeshPartitionWater` (water bodies), `PCG MeshPartition Interop`, `Mesh Terrain Mode` (the toolbar). The pages give no default state or restart note.
- [documented] Requires a World Partition level; choose an Open World level when creating it. See [World Partition](unreal-world-partition.md).

## Use it when

- [general] The terrain needs caves, overhangs, tunnels or local detail a height field cannot hold, and an experimental feature is acceptable.
- [general] The terrain is edited by layering modifiers (splines, noise, meshes, PCG) rather than painting one heightmap.

## Use something else when

- [general] The project needs stable terrain: use Landscape ([World Partition Landscape](unreal-world-partition-landscape.md)) with [Landmass](unreal-landmass.md) and [Water](unreal-water.md).
- [general] A script must build the terrain: the pages describe only editor tools, so prefer Landscape until a scripted path is known.
- [documented] Not all Landscape water carving has been translated to Mesh Terrain yet.

## How an agent drives it

| Task | Route | What the pages give |
|---|---|---|
| Open the mode | Editor UI | Enable plugins in Edit > Plugins, then Mesh Terrain mode in the toolbar |
| Create the base | Editor UI | Create tab: Create Rectangle, Import Heightmap, Convert Mesh |
| Edit sections | Editor UI | Edit tab: Convert, Expand, Merge, Stitch, Split, Resection, Edit Pivot, Bake Transform, Edit Attributes, Inspect |
| Add modifiers | Editor UI | Modifiers tab, drag onto the terrain; Sculpt and Paint tabs need a selected modifier |
| Compile | Editor UI | Build > Build Mesh Partitions |
| Read build order and cost | Editor UI | Tools > Mesh Partition Settings opens the Outliner: build order, per-modifier time, Build To slider |
| Script it | Python, C++ | The pages are silent: no class, function, commandlet or console command is named |

- [documented] Blueprints can build Mesh Terrain tools; Epic's example makes a dynamic mesh from a spline and feeds it to a Boolean modifier for a tunnel or arch.
- [general] The pages are silent on headless compiled-section builds, so treat the work as editor-interactive.

## Workflow

1. [documented] Enable the plugins; create an Open World level.
2. [documented] Create an `MPD_<name>` Data Asset of class Mesh Partition Definition: material, channels, priority layers, build variants.
3. [documented] Create the base, assign the MPD in Details, add modifiers; set each Priority Layer and sub-priority.
4. [documented] Run Build > Build Mesh Partitions before PIE or a cooked game; preview sections are not enough.
5. [documented] Keep sections small: the builder recalculates a whole section for any modifier change.

## Creating the base

- [documented] Create Rectangle: Size (cm), Resolution (quads per axis), Sections Generation Automatic (Max Triangles) or Explicit (Layout, Resolution), Save and Unload for very large partitions.
- [documented] Import Heightmap: Filename, Resolution, Size. Convert Mesh: Number Of Sections Per Side (3 gives 3x3). Edit Pivot and Bake Transform change the selected static mesh asset; duplicate it first.

## Mesh Partition Definition

- [documented] Material: Material, Channel Texel Size (resolution of baked channel textures), Physical Material Channels, Default Physical Material, Channels (user attributes for material effects, PCG masks, biomes).
- [documented] A channel a modifier writes but the MPD lacks stays editor-only (not baked for compiled sections) but remains readable by modifiers and PCG.
- [documented] Modifiers: Modifier Layer Priorities. Index 0 builds first, then 1; several modifiers can share a layer.
- [documented] Build: variants (Name, Max Section Complexity as vertex count, Transformer Pipeline) plus per-platform variant names; Default applies when no platform entry matches.
- [documented] Transformer pipelines are Data Assets (`TP_Compiled_<Platform>_<Name>`, `TP_Preview_<Platform>_<Name>`) holding Collision (Error Tolerance), Far Field (for Lumen), RVT, Skirt, Static Mesh (LODs, Nanite), Subsection and WP Actor Properties (runtime grid, data layer, HLOD layer) transformers. Preview sections have their own max complexity and pipeline.

## Modifiers and build order

- [documented] Modifiers named: texture (Adaptive Tessellation option), spline, noise, sculpt (also paints, with local mesh layers), mesh, remesh, spline remesh, Boolean, Patch, Lake, River, and Patch and Mesh Projection instances that PCG spawners create from points.
- [documented] Remesh makes uniform triangles (Target Edge Length, optional weight channel for density); Tessellate subdivides existing triangles and is usually faster.
- [documented] A hole: Boolean modifier, Mesh Source Mode StaticMesh, a mesh, Boolean Op Trim. Raise Expand Operator Bounds (Z on vertical faces) for jagged triangles.
- [documented] Common parameters: Affected Mesh Partition, Priority Layer, Layer Sub-Priority (higher builds later), Projection Plane, Local and World Bounds, Disabled in Editor (still active in the build), Disabled in Build, Base Growth.
- [documented] Build order is priority layer, then sub-priority. A later layer needs earlier geometry: Epic builds a Boolean egg on layer 1, then a texture modifier on layer 2.

## Weight channels

- [documented] Channels live on vertices and bake to a Texture 2D array for compiled sections; paint them or write them from modifiers or PCG. A channel must exist in the MPD to render.
- [documented] Water: add a Mesh Partition component to the water body, a LakeModifier or RiverModifier with affected partition and priority layer, and channels under Layer Weightmap Settings. Island: use a spline modifier (Lake at sub-priority 1, spline at 2, same layer). Ocean needs no modifier.

## PCG

- [documented] Graphs read and write the partition: Query (surface in the PCG volume, weight channels), ToPoint, Write (point count must match Query; keep original positions in an FVector attribute such as SourcePositions, or edit Destination Positions).
- [documented] Feed the same priority layer and sub-priority to Query and Write, and do not make Query inclusive by default, to avoid feedback loops. See [PCG](unreal-pcg.md).

## Not covered by the pages

Python or C++ creation, build commandlets, plugin default states, runtime edits, performance limits. The hub links Mesh Terrain Material and Runtime Virtual Textures pages, not read here.

## Sources

- [Mesh Terrain](https://dev.epicgames.com/documentation/unreal-engine/mesh-terrain-in-unreal-engine)
- [Accessing Mesh Terrain](https://dev.epicgames.com/documentation/unreal-engine/accessing-mesh-terrain-in-unreal-engine)
- [Crafting Mesh Terrain](https://dev.epicgames.com/documentation/unreal-engine/crafting-mesh-terrain-in-unreal-engine)
- [Mesh Partition Definition](https://dev.epicgames.com/documentation/unreal-engine/mesh-partition-definition-in-unreal-engine)
- [PCG and Mesh Terrain](https://dev.epicgames.com/documentation/unreal-engine/pcg-and-mesh-terrain-in-unreal-engine)
