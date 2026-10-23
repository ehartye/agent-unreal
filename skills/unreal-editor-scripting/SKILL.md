---
name: unreal-editor-scripting
description: Script and extend the Unreal Engine 5.8 editor from an agent: editor Python run modes, cameras, whole-map builds and process cleanup; adding what Python lacks (Landscape creation, Animation Blueprint states) with an editor C++ module; enabling a plugin; seeing what Python reaches; and the example scenes that verify these references. Not for choosing a system (use the domain skills such as unreal-rendering) or a native game's build loop and content stage, including locked asset files (use unreal-native).
when_to_use: Use when deciding whether an Unreal task can be scripted from Python or needs C++; when a Python call raises, a run mode quits early, a map will not recreate or a script needs a screenshot or camera; before enabling an Unreal plugin; or when running the example scenes.
---

# Scripting the Unreal editor

Unreal 5.8 on Windows. Pick the feature from the goal, then read that system's reference: when to use it, what to use instead, how an agent drives it. Brackets show each plugin's shipped state. Other domains: `unreal-effects`, `unreal-animation`, `unreal-gameplay`, `unreal-procedural`, `unreal-rendering`, `unreal-editor-scripting`.

| You are about to | Read |
|---|---|
| Run the example scenes | [Example scenes](references/unreal-example-scenes.md) |
| Script the editor from Python: run modes, cameras, input, whole-map builds, process cleanup | [Editor Python](references/unreal-editor-python.md) |
| Add what Python lacks, such as Landscape creation, with an editor C++ module | [Python to C++ bridge](references/unreal-python-cpp-bridge.md) |
| Read back what was saved: a callable's signature, a saved Niagara system, saved meshes and materials | [Editor Python](references/unreal-editor-python.md#read-back-what-was-saved), [editor_probes](../../examples/unreal/editor_probes/README.md) |

## Rules of thumb

- Choose the route by reach: asset creation, level building and property edits are editor Python; per-frame behaviour, custom solvers and new data types are C++ or Blueprint.
- Add what Python lacks with an editor C++ module (Landscape creation, state-machine states).

## Enable a feature

1. List the plugin's descriptor: `node examples/unreal/engine_plugins.mjs --engine "<UE folder>" --name <Plugin>`.
2. Enable it in Edit > Plugins, or add `{ "Name": "<Plugin>", "Enabled": true }` to the `.uproject` `Plugins` array, and restart the editor.
3. See what Python reaches: run [`unreal_surface.py`](../../examples/unreal/unreal_surface.py) headless with `UNREAL_SURFACE_MATCH=<fragment>`.
