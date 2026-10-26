---
name: unreal-effects
description: "Choose and drive Unreal Engine 5.8 visual effects and physics-driven effects: Niagara particles, fluids and sand, Niagara templates (fire, smoke, explosion) and authoring Niagara systems from Python, Cascade content, Chaos Niagara, and Chaos destruction (fracture, debris, fields). Not for lighting or materials, toon and cel looks on meshes included (use unreal-rendering), character animation (unreal-animation) or importing assets (use unreal-import)."
when_to_use: "Use when asked to make fire, smoke, sparks, trails, liquid, sand, an explosion or any particle effect; to author, edit, verify or capture a Niagara system, add a renderer to an emitter, set a spawn rate or other stack input, or choose a Niagara template; whether Unreal can do something 'like Niagara'; for an ink, cel or toon look on particles, ribbons or other Niagara output; to convert Cascade content; to break walls or props apart, including a code-built collection without convex hulls that never breaks; or to drive effects from physics or destruction events."
---

# Choosing an Unreal effects system

Unreal 5.8 on Windows. Pick the feature from the goal, then read that system's reference: when to use it, what to use instead, how an agent drives it. Brackets show each plugin's shipped state. Other domains: `unreal-rendering`, `unreal-animation`, `unreal-gameplay`, `unreal-procedural`, `unreal-editor-scripting`, `unreal-native`, `unreal-import`, `unreal-architecture`, `unreal-quality`, `uefn`.

| You are about to | Read |
|---|---|
| Make fire, smoke, trails, liquid, sand or any particle effect, pick a Niagara route, or verify a system (Niagara; fluids in NiagaraFluids; on) | [Niagara](references/unreal-niagara.md) |
| Choose a Niagara template or template emitter: a stream such as a fountain of sparks, a burst, a beam or ribbon, a gas or liquid system | [Niagara templates](references/unreal-niagara-templates.md) |
| Author a Niagara system from Python: create it, add emitters, read and set a stack input such as a spawn rate or lifetime, set renderer properties, or work around an added emitter that counts 0 particles | [Toolsets](references/unreal-niagara-toolsets.md) |
| Replace a linked or dynamic input, or get past a hidden-input refusal | [Toolset inputs](references/unreal-niagara-toolset-inputs.md) |
| Add a renderer (such as a Light renderer) to an emitter and address it by index; use local space, `SortOrderHint` or a ribbon material flag | [Toolset renderers](references/unreal-niagara-toolset-renderers.md) |
| Delete and recreate a Niagara system saved by an earlier process, or read the NiagaraToolsets start-up log | [Toolsets lifecycle](references/unreal-niagara-toolsets-lifecycle.md) |
| Choose cheap Niagara families, set scalability and instance caps, bake a flipbook, or find which stock Niagara and fluid content was tested on 5.8.2 | [Niagara families and stock content](references/unreal-niagara-stock-content.md) |
| Keep or convert existing Cascade particle content (Cascade on in the editor; converter off, beta) | [Cascade](references/unreal-cascade.md) |
| Drive effects from destruction or physics events (ChaosNiagara; on, beta) | [Chaos Niagara](references/unreal-chaos-niagara.md) |
| Break walls or props apart: fracture, debris, fields (Geometry Collections and Fracture; off, beta) | [Chaos destruction](references/unreal-chaos-destruction.md), [Chaos destruction from C++](references/unreal-chaos-destruction-native.md) |
| Find why a code-built Geometry Collection without convex hulls never breaks: convex hulls, simulation-data order, spawn order, the no-geometry log lines | [Chaos hulls and spawn order](references/unreal-chaos-destruction-hulls.md) |

## Rules of thumb

- Use Niagara for new particle work, Cascade only for existing content. Each reference states what it supersedes and its beta or experimental label.
- Import a fixed asset (GLB, WAV, sprite atlas) with `unreal-import`; build in Unreal when it must respond to gameplay.

Enable only the plugin a system needs: the steps are under Enable a feature in [unreal-editor-scripting](../unreal-editor-scripting/SKILL.md).
