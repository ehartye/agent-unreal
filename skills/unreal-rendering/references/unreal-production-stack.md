# Unreal production stack for visual polish

Public Epic pages below were read as UE 5.8 documentation on 2026-10-16/17.
Installed 5.8.2 was the research context; only the "Materials tested on Unreal 5.8.2" bullet below was run.
Check the consuming project's installed APIs, renderer and active runtime settings;
public version labels and older experimental wording do not establish local support.

## Diagnose the material and render contract

- [documented] Unlit uses Emissive for surface color. Lumen can propagate emissive light, but enabling it does not turn that surface into lit paint. Inspect the actual graph, normal-based custom shading and final color transfer before changing GI/shadows. [Epic: Shading Models](https://dev.epicgames.com/documentation/en-us/unreal-engine/shading-models-in-unreal-engine)
- [documented] Additive blending cannot darken a bright background; Masked gives binary coverage. Choose opaque/masked authored cores for graphic dark masses when appropriate and reserve transparency for the intended fringe. [Epic: Material Blend Modes](https://dev.epicgames.com/documentation/en-us/unreal-engine/material-blend-modes-in-unreal-engine)
- [documented] DBuffer decals modify material channels that the receiver must consume. Verify the receiver response and actual rendered result, especially with a custom Unlit/Emissive road. A bounded mesh strip or explicit receiver mask may suit transient marks better; keep durable wear in surface authoring. [Epic: Decal Materials](https://dev.epicgames.com/documentation/en-us/unreal-engine/decal-materials-in-unreal-engine)
- [documented] Depth/normal outlines depend on post-process location relative to temporal AA; late passes can jitter. Inspect the current graph and compare moving output before relocating a finish/palette pass. [Epic: Post Process Materials](https://dev.epicgames.com/documentation/en-us/unreal-engine/post-process-materials-in-unreal-engine)

## Niagara families, scalability and the Niagara facts tested on 5.8.2

See [Niagara families and stock content](../../unreal-effects/references/unreal-niagara-stock-content.md).

## Materials tested on Unreal 5.8.2

- [tested] A Custom material node body is one function body: a `#define` macro compiles; a helper function logs `function definition is not allowed here` and the material falls back to the default. Instanced static meshes need `used_with_instanced_static_meshes`: `False` on a Python-made material and in a commandlet, set when a rendering editor draws instances or for a list by `allow_instancing` ([editor Python](../../unreal-editor-scripting/references/unreal-editor-python.md)).

## Evaluate motion and production cost

- [documented] TSR depends on history, velocity and disocclusion handling; translucency has additional reconstruction limits. Query active AA rather than assuming config won. Compare current AA (including FXAA where used) against a candidate at matched output/screen percentage in moving play: thin seams, outlines, grit, ghosting and trails. Select from captured fidelity and cost; TSR is not an automatic new default. [Epic: TSR](https://dev.epicgames.com/documentation/en-us/unreal-engine/temporal-super-resolution-in-unreal-engine)
- [general] Pool caps need scope: 40 components per car permits 320 across eight cars; neither number establishes a global GPU budget, peak active count or draw count. Profile the actual real-time worst overlap, including eight racers when that is the game's load. Avoid inferring presentation latency from effect age/TTL, and assign no invented millisecond allowance.
- [documented] `stat unit` separates frame, game, draw and GPU observations. Use supported build instrumentation for matched baseline, effect-off diagnostic and candidate runs; retain first-use and steady/worst-overlap samples, median/p95/max, settings, hardware and build/content identity. An overlay snapshot is not a benchmark. [Epic: Stat Commands](https://dev.epicgames.com/documentation/en-us/unreal-engine/stat-commands-in-unreal-engine)
- [documented] Niagara Debugger can expose system, particle and memory observations. Keep those receipts beside continuous real-time footage, event-close frames and independent reference judgment. Counts verify bounded execution; images and motion establish the effect's readable shape and causality. [Epic: Niagara Debugger](https://dev.epicgames.com/documentation/en-us/unreal-engine/niagara-debugger-for-unreal-engine)
