---
name: unreal-procedural
description: Choose and drive Unreal Engine 5.8 procedural world, mesh and audio systems: World Partition and large open worlds, Landscape and Landmass, Water, PCG in the editor and in a running game, Geometry Scripting, the Procedural Mesh Component, and MetaSounds. Not for lighting or rendering (use unreal-rendering), scripting the editor from Python (unreal-editor-scripting), importing fixed assets (use unreal-import) or deciding whether Blender or Unreal should make a mesh (mesh-tool-selection in agent-meshes).
when_to_use: Use when asked to build an open world, a large landscape with rivers, a partitioned map, terrain, oceans or lakes; to scatter foliage, props or biomes by rules; when PCG output is missing in a running game; to build or edit meshes from code or at runtime; or for parameter-driven procedural audio.
---

# Choosing an Unreal procedural system

Unreal 5.8 on Windows. Pick the feature from the goal, then read that system's reference: when to use it, what to use instead, how an agent drives it. Brackets show each plugin's shipped state. Other domains: `unreal-effects`, `unreal-animation`, `unreal-gameplay`, `unreal-procedural`, `unreal-rendering`, `unreal-editor-scripting`.

| You are about to | Read |
|---|---|
| Build a large landscape with rivers and scattered content (World Partition, Landmass, Water, PCG) | [World Partition](references/unreal-world-partition.md), [Landmass](references/unreal-landmass.md), [Water](references/unreal-water.md), [PCG](references/unreal-pcg.md) |
| Scatter world content by rules: foliage, props, biomes, in the editor or a running game (PCG; on) | [PCG](references/unreal-pcg.md), [PCG in a game](references/unreal-pcg-game-process.md) |
| Author terrain with helpers (Landmass; off, beta) | [Landmass](references/unreal-landmass.md) |
| Add oceans, lakes or rivers (Water; off, experimental) | [Water](references/unreal-water.md) |
| Build or edit meshes from code, in the editor or at runtime (Geometry Scripting; off) | [Geometry Scripting](references/unreal-geometry-scripting.md) |
| Create a runtime mesh from vertex arrays (Procedural Mesh Component; on) | [Procedural Mesh Component](references/unreal-procedural-mesh-component.md) |
| Make parameter-driven, sample-accurate game audio (MetaSounds; on) | [MetaSounds](references/unreal-metasounds.md) |

## Rules of thumb

- A Landscape is created by the Open World template or an editor C++ module; Python has no function that creates one.
- Import a fixed asset (GLB, WAV, sprite atlas) with `unreal-import`. Blender or Unreal for a mesh: `mesh-tool-selection`.

Enable only the plugin a system needs: the steps are under Enable a feature in [unreal-editor-scripting](../unreal-editor-scripting/SKILL.md).
