---
name: unreal-procedural
description: "Choose and drive Unreal Engine 5.8 procedural world, mesh and audio systems: World Partition and large open worlds, Landscape and Landmass, Water, PCG in the editor and in a running game, Geometry Scripting, the Procedural Mesh Component, and MetaSounds. Not for lighting or rendering (use unreal-rendering), scripting the editor from Python (unreal-editor-scripting), importing fixed assets (use unreal-import) or deciding whether Blender or Unreal should make a mesh (mesh-tool-selection in agent-meshes)."
when_to_use: "Use when asked to build an open world, a large landscape with rivers, a partitioned map, terrain with caves or overhangs (Mesh Terrain), oceans or lakes; to scatter foliage, props or biomes by rules; when PCG output is missing in a running game; to build or edit meshes from code or at runtime, or a generated mesh sits at the wrong height or rotation; or for parameter-driven procedural audio."
---

# Choosing an Unreal procedural system

Unreal 5.8 on Windows. Pick the feature from the goal, then read that system's reference: when to use it, what to use instead, how an agent drives it. Brackets show each plugin's shipped state. Other Unreal skills: `unreal-effects`, `unreal-animation`, `unreal-gameplay`, `unreal-rendering`, `unreal-editor-scripting`, `unreal-native`, `unreal-import`, `uefn`, `unreal-architecture`, `unreal-quality`.

| You are about to | Read |
|---|---|
| Build a large landscape with rivers and scattered content (World Partition, Landmass, Water, PCG) | [World Partition](references/unreal-world-partition.md), [Landmass](references/unreal-landmass.md), [Water](references/unreal-water.md), [PCG](references/unreal-pcg.md) |
| Scatter world content by rules: foliage, props, biomes, in the editor or a running game (PCG; on) | [PCG](references/unreal-pcg.md), [PCG in a game](references/unreal-pcg-game-process.md) |
| Convert a plain map to World Partition or run its builder commandlets and `wp.Runtime` console commands | [World Partition commandlets](references/unreal-world-partition-commandlets.md) |
| Size the Landscape proxy grid of a partitioned map, or read Landscape heights back | [World Partition Landscape](references/unreal-world-partition-landscape.md) |
| Pick a PCG generation mode (partitioned, hierarchical, runtime) or tune runtime generation (PCG; on) | [PCG generation modes](references/unreal-pcg-generation-modes.md) |
| Run PCG nodes on the GPU, or check what the GPU Static Mesh Spawner does not support (PCG; on) | [PCG GPU execution](references/unreal-pcg-gpu.md) |
| Author terrain with helpers (Landmass; off, beta) | [Landmass](references/unreal-landmass.md) |
| Add oceans, lakes or rivers (Water; off, experimental) | [Water](references/unreal-water.md) |
| Make mesh-based terrain with overhangs, tunnels or modifiers (Mesh Terrain; experimental, editor tools) | [Mesh Terrain](references/unreal-mesh-terrain.md) |
| Read Mesh Terrain weight channels in a material, or set up Runtime Virtual Textures on it (experimental) | [Mesh Terrain materials](references/unreal-mesh-terrain-materials.md) |
| Build or edit meshes from code, in the editor or at runtime (Geometry Scripting; off) | [Geometry Scripting](references/unreal-geometry-scripting.md) |
| Stack primitives into one mesh, rotate them, or fix a generated mesh that floats, sinks or faces the wrong way | [Geometry Scripting traps](references/unreal-geometry-scripting-traps.md) |
| Create a runtime mesh from vertex arrays (Procedural Mesh Component; on) | [Procedural Mesh Component](references/unreal-procedural-mesh-component.md) |
| Make parameter-driven, sample-accurate game audio (MetaSounds; on) | [MetaSounds](references/unreal-metasounds.md) |

## Rules of thumb

- A Landscape is created by the Open World template or an editor C++ module ([Python to C++ bridge](../unreal-editor-scripting/references/unreal-python-cpp-bridge.md)); Python has no function that creates one.
- Import a fixed asset (GLB, WAV, sprite atlas) with `unreal-import`. Blender or Unreal for a mesh: `mesh-tool-selection`.

Enable only the plugin a system needs: the steps are under Enable a feature in [unreal-editor-scripting](../unreal-editor-scripting/SKILL.md).
