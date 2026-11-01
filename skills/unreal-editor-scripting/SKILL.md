---
name: unreal-editor-scripting
description: "Script and extend the Unreal Engine 5.8 editor from an agent: editor Python run modes, cameras, whole-map builds and process cleanup; adding what Python lacks, such as Landscape creation, with an editor C++ module; enabling a plugin; seeing what Python reaches; and the example scenes that verify these references. Not for choosing a system (use the domain skills such as unreal-rendering), Animation Blueprint states or transitions (use unreal-animation) or a native game's build loop and content stage, including locked asset files (use unreal-native)."
when_to_use: "Use when deciding whether an Unreal task can be scripted from Python or needs C++; when an unreal module call is missing or raises while scripting the editor, a headless run quits before output is written, a map will not recreate, or an editor script needs a camera or screenshot; before enabling an Unreal plugin; or when running the example scenes."
---

# Scripting the Unreal editor

Before starting an editor or commandlet, read the consumer launcher instructions and the [shared launcher](../unreal-native/references/unreal-engine-launcher.md). New integrations use it; retain existing consumer launchers until migration is separately verified.

Unreal 5.8 on Windows. Pick the feature from the goal, then read that system's reference: when to use it, what to use instead, how an agent drives it. Other domains: `unreal-effects`, `unreal-animation`, `unreal-gameplay`, `unreal-procedural`, `unreal-rendering`, `unreal-native`, `unreal-import`, `uefn`, `unreal-architecture`, `unreal-quality`.

| You are about to | Read |
|---|---|
| Run the example scenes (stylized, World Partition, PCG, Editor Python) | [Example scenes](references/unreal-example-scenes.md) |
| Run content-tooling or rendering-probe scenes | [Tooling and rendering examples](references/unreal-example-scenes-tooling.md) |
| Run native Landscape bridges, automation tests, Gameplay Effects or unity builds | [Native examples](references/unreal-example-scenes-native.md) |
| Script the editor from Python: run modes, cameras and input | [Editor Python](references/unreal-editor-python.md) |
| Run over SSH, inspect offscreen viewports or understand historical timeout/cleanup evidence | [Windows processes and remote rendering](references/unreal-editor-python-processes.md) |
| Build a whole map from Python: recreate a map, set properties, make materials and meshes, run stages, trace to the ground | [Editor Python: maps, materials and meshes](references/unreal-editor-python-maps.md) |
| Add what Python lacks, such as Landscape creation, with an editor C++ module | [Python to C++ bridge](references/unreal-python-cpp-bridge.md) |
| Add a node to a Mutable Customizable Object's graph or link a pin from Python (bridge functions) | [Mutable graph bridge](references/unreal-mutable-bridge.md) |
| Use a shared skeleton, measure a Mutable graph's compile, add a material parameter or second component, or bind an Instance update callback | [Mutable scale, materials and callbacks](references/unreal-mutable-scale.md) |
| Attach a Landmass brush to a Landscape edit layer from Python (bridge functions) | [Landscape bridge brushes](references/unreal-landscape-bridge-brushes.md) |
| Read back what was saved: a callable's signature, a saved Niagara system, saved meshes and materials | [Editor Python](references/unreal-editor-python.md#read-back-what-was-saved), [editor_probes](../../examples/unreal/editor_probes/README.md) |

## Rules of thumb

- Choose the route by reach: asset creation, level building and property edits are editor Python; per-frame behaviour, custom solvers and new data types are C++ or Blueprint.
- Add what Python lacks with an editor C++ module (Landscape creation).

## Enable a feature

1. List the plugin's descriptor: `node examples/unreal/engine_plugins.mjs --engine "<UE folder>" --name <Plugin>`.
2. Enable it in Edit > Plugins, or add `{ "Name": "<Plugin>", "Enabled": true }` to the `.uproject` `Plugins` array, and restart the editor.
3. See what Python reaches: run [`unreal_surface.py`](../../examples/unreal/unreal_surface.py) headless with `UNREAL_SURFACE_MATCH=<fragment>`.
