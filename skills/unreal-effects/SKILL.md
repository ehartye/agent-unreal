---
name: unreal-effects
description: Choose and drive Unreal Engine 5.8 visual effects and physics-driven effects: Niagara particles, fluids and sand, Niagara templates (fire, smoke, explosion) and authoring Niagara systems from Python, Cascade content, Chaos Niagara, and Chaos destruction (fracture, debris, fields). Not for lighting or materials (use unreal-rendering), character animation (unreal-animation) or importing assets (use unreal-import).
when_to_use: Use when asked to make fire, smoke, sparks, trails, liquid, sand, an explosion or any particle effect; to author, edit, verify or capture a Niagara system or choose a Niagara template; whether Unreal can do something "like Niagara"; for an ink, cel or toon look on an effect; to convert Cascade content; to break walls or props apart; or to drive effects from physics or destruction events.
---

# Choosing an Unreal effects system

Unreal 5.8 on Windows. Pick the feature from the goal, then read that system's reference: when to use it, what to use instead, how an agent drives it. Brackets show each plugin's shipped state. Other domains: `unreal-effects`, `unreal-animation`, `unreal-gameplay`, `unreal-procedural`, `unreal-rendering`, `unreal-editor-scripting`.

| You are about to | Read |
|---|---|
| Make fire, smoke, trails, liquid, sand or any particle effect (Niagara; fluids in NiagaraFluids; on) | [Niagara](references/unreal-niagara.md), [Niagara templates](references/unreal-niagara-templates.md), [Toolsets](references/unreal-niagara-toolsets.md), [Toolset inputs](references/unreal-niagara-toolset-inputs.md) |
| Keep or convert existing Cascade particle content (Cascade on in the editor; converter off, beta) | [Cascade](references/unreal-cascade.md) |
| Drive effects from destruction or physics events (ChaosNiagara; on, beta) | [Chaos Niagara](references/unreal-chaos-niagara.md) |
| Break walls or props apart: fracture, debris, fields (Geometry Collections and Fracture; off, beta) | [Chaos destruction](references/unreal-chaos-destruction.md) |

## Rules of thumb

- Use Niagara for new particle work, Cascade only for existing content. Each reference states what it supersedes and its beta or experimental label.
- Import a fixed asset (GLB, WAV, sprite atlas) with `unreal-import`; build in Unreal when it must respond to gameplay.

Enable only the plugin a system needs: the steps are under Enable a feature in [unreal-editor-scripting](../unreal-editor-scripting/SKILL.md).
