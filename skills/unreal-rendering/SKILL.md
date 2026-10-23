---
name: unreal-rendering
description: Choose and tune Unreal Engine 5.8 rendering: Lumen global illumination and reflections, MegaLights, Virtual Shadow Maps, Nanite, Substrate materials (including Toon), Temporal Super Resolution and anti-aliasing, and a production stack that combines them. Not for effects (use unreal-effects), a native game's frame-time profiling (unreal-native) or choosing a game engine (engine-selection in agent-engine).
when_to_use: Use when asked about lighting, global illumination, ray tracing, reflections, many shadow-casting lights, shadows, dense or high-polygon geometry, materials, layered or toon and cel materials, anti-aliasing, upscaling, a sheen, glare or mirror-like patch you cannot attribute, or combining materials, lighting and profiling in one scene.
---

# Choosing an Unreal rendering system

Unreal 5.8 on Windows. Pick the feature from the goal, then read that system's reference: when to use it, what to use instead, how an agent drives it. Brackets show each plugin's shipped state. Other domains: `unreal-effects`, `unreal-animation`, `unreal-gameplay`, `unreal-procedural`, `unreal-rendering`, `unreal-editor-scripting`.

| You are about to | Read |
|---|---|
| Light a scene dynamically: global illumination, reflections, many shadow-casting lights, high-resolution shadows (project settings; MegaLights opt-in) | [Lumen](references/unreal-lumen.md), [MegaLights](references/unreal-megalights.md), [Virtual Shadow Maps](references/unreal-virtual-shadow-maps.md) |
| Render dense or high-polygon geometry without authored LODs (project setting, per-mesh flag) | [Nanite](references/unreal-nanite.md) |
| Give materials or effects a toon or cel look (Substrate Toon, experimental; Niagara) | [Substrate](references/unreal-substrate.md), [Niagara](../unreal-effects/references/unreal-niagara.md) |
| Author layered or stylized materials; choose anti-aliasing and upscaling (Substrate beta, Substrate Toon experimental; TSR on) | [Substrate](references/unreal-substrate.md), [TSR and anti-aliasing](references/unreal-temporal-super-resolution.md) |
| Find which lighting term causes a sheen, glare, bright patch or wrong reflection (show flags, one term off per capture) | [Isolating a rendering artifact](references/unreal-rendering-isolation.md) |
| Combine materials, lighting, anti-aliasing and profiling; Niagara facts tested on 5.8.2 | [Unreal production stack](references/unreal-production-stack.md) |

## Rules of thumb

- When two features fit equally, choose the one whose plugin or setting is on by default. MegaLights, Substrate and Toon are deliberate opt-ins.
- Cost and quality levers for a shipped game are measured in `unreal-native` profiling.

Enable only the plugin a system needs: the steps are under Enable a feature in [unreal-editor-scripting](../unreal-editor-scripting/SKILL.md).
