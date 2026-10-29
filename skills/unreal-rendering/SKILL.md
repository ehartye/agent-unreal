---
name: unreal-rendering
description: "Choose and tune Unreal Engine 5.8 rendering: Lumen global illumination and reflections, MegaLights, Virtual Shadow Maps, Nanite, Substrate materials (including Toon on meshes and scenes), Heterogeneous Volumes, Temporal Super Resolution and anti-aliasing, and a production stack that combines them. Not for particle or Niagara effects, toon looks on them included (use unreal-effects), a native game's frame-time profiling or measuring what a feature costs (unreal-native) or choosing a game engine (engine-selection in agent-engine)."
when_to_use: "Use when asked about lighting, global illumination, ray tracing, reflections, many shadow-casting lights, shadows, dense or high-polygon geometry, materials, layered materials, a toon or cel look on meshes, characters or a whole scene, a mist, smoke or light-column volume the renderer ray-marches (Heterogeneous Volumes), anti-aliasing, upscaling, a sheen, glare or mirror-like patch you cannot attribute, two directional lights (a sun and a moon), a renderer message that directional lights are competing, or combining materials, lighting and anti-aliasing into one production stack."
---

# Choosing an Unreal rendering system

Unreal 5.8 on Windows. Pick the feature from the goal, then read that system's reference: when to use it, what to use instead, how an agent drives it. Brackets show each plugin's shipped state. Other domains: `unreal-effects`, `unreal-animation`, `unreal-gameplay`, `unreal-procedural`, `unreal-editor-scripting`, `unreal-native`, `unreal-import`, `unreal-architecture`, `unreal-quality`, `uefn`.

| You are about to | Read |
|---|---|
| Light a scene dynamically: global illumination, reflections, many shadow-casting lights, high-resolution shadows (project settings; MegaLights opt-in) | [Lumen](references/unreal-lumen.md), [MegaLights](references/unreal-megalights.md), [Virtual Shadow Maps](references/unreal-virtual-shadow-maps.md) |
| Set MegaLights variables, volume overrides and quality tiers, or tune its cost | [Driving and tuning MegaLights](references/unreal-megalights-driving.md) |
| Read the MegaLights tracing-route probe records or the cost comparison against Virtual Shadow Maps | [MegaLights measurements](references/unreal-megalights-measurements.md) |
| Set up a sun and a moon (two directional lights) or fix a renderer message that directional lights are competing for forward shading (ForwardShadingPriority) | [Directional lights](references/unreal-directional-lights.md) |
| Render dense or high-polygon geometry without authored LODs (project setting, per-mesh flag) | [Nanite](references/unreal-nanite.md) |
| Give meshes and scenes a toon or cel look (Substrate Toon, experimental); for particles start in unreal-effects | [Substrate](references/unreal-substrate.md) |
| Author layered or stylized materials, pick a slab pin name or a translucent lighting mode; choose anti-aliasing and upscaling (Substrate beta, Substrate Toon experimental; TSR on) | [Substrate](references/unreal-substrate.md), [Substrate slab graphs](references/unreal-substrate-slabs.md), [TSR and anti-aliasing](references/unreal-temporal-super-resolution.md) |
| Place a mist, smoke or light-column volume that is ray-marched and lit, or size its grid (Heterogeneous Volumes, project setting, Beta) | [Heterogeneous Volumes](references/unreal-heterogeneous-volumes.md) |
| Find which lighting term causes a sheen, glare, bright patch or wrong reflection (show flags, one term off per capture) | [Isolating a rendering artifact](references/unreal-rendering-isolation.md) |
| Combine materials, lighting, anti-aliasing and profiling; review motion and cost | [Unreal production stack](references/unreal-production-stack.md) |

## Rules of thumb

- When two features fit equally, choose the one whose plugin or setting is on by default. MegaLights, Substrate and Toon are deliberate opt-ins.
- Cost and quality levers for a shipped game are measured in `unreal-native` profiling.

Enable only the plugin a system needs: the steps are under Enable a feature in [unreal-editor-scripting](../unreal-editor-scripting/SKILL.md).
