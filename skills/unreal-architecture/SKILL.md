---
name: unreal-architecture
description: Audit and plan the code and project structure of an Unreal Engine 5.8 project against Epic's documented guidance: module and plugin boundaries, dependency direction, which gameplay framework class or subsystem owns each piece of state, optional features as Game Feature plugins, hard and soft asset references, and C++ structure. Produces an ownership and dependency map, ranked findings and a bounded remediation plan. Not for choosing a gameplay, rendering or effects system (use the domain skills), running tests or profiling (use unreal-quality), or building and packaging (use unreal-native).
when_to_use: Use when asked to review, audit or restructure a project's architecture or module layout; when a Build.cs, circular dependency, include or compile-time question comes up; when unsure where state belongs (game instance, game mode, game state, player state, controller, pawn, subsystem); when splitting a feature into a plugin or Game Feature; when startup loads too much or hard references chain; or to plan a refactor and its order.
---

# Unreal project architecture

Unreal 5.8. This skill audits how a project's code and content are structured and plans the fix. Every reference labels
its claims `[documented]` (Epic's 5.8 documentation says it) or `[general]` (a judgement built on it), so a finding can say
which kind of rule it breaks. Choosing a gameplay, animation, rendering or effects system is the domain skills
([unreal-gameplay](../unreal-gameplay/SKILL.md), [unreal-rendering](../unreal-rendering/SKILL.md),
[unreal-effects](../unreal-effects/SKILL.md)); tests and profiling are [unreal-quality](../unreal-quality/SKILL.md);
building, running and packaging are [unreal-native](../unreal-native/SKILL.md).

| You are about to | Read |
|---|---|
| Set module, plugin and Build.cs boundaries; fix dependency direction, circular references and includes | [Modules and dependencies](references/unreal-architecture-modules.md) |
| Decide where state and rules live: game instance, subsystem, game mode, game state, player state, controller, pawn, component | [State ownership and lifetimes](references/unreal-architecture-ownership.md) |
| Split an optional feature into a plugin or Game Feature, or structure experiences like Lyra | [Game Features and modular gameplay](references/unreal-architecture-features.md) |
| Decide plugin, target, configuration, config-file, folder or asset-naming layout | [Plugins, targets and layout](references/unreal-architecture-layout.md) |
| Place code in the Actor lifecycle, pick an object pointer type, split Blueprint from C++, or use data assets, registries and tags | [Lifecycle, pointers, Blueprint and data](references/unreal-architecture-lifecycle.md) |
| Control what loads: hard and soft references, async loading, the Asset Manager, Reference Viewer and Size Map | [Content references and loading](references/unreal-architecture-content.md) |
| Name, lay out and write C++ the way Epic's standard asks | [C++ structure rules](references/unreal-architecture-code-standard.md) |
| Audit a project: inventory, map, evidence and ranked findings | [Architecture audit](references/unreal-architecture-audit.md) |
| Turn findings into an ordered, checkable remediation plan | [Remediation plan](references/unreal-architecture-remediation.md) |

## How to work

1. Name the decision or area and when you will stop. A review of one boundary is not an audit of the whole project; do not
   widen it unless a new finding could change the decision.
2. Inspect before recommending: read the `.uproject`, each `.uplugin` and `Build.cs`, the headers that hold state, and the
   asset references. Prefer Epic's systems to a new abstraction.
3. Read the reference for each area you touch. Audit with the audit reference, then plan with the remediation reference.
4. Hand execution to the owner of the detail: engine systems to the domain skills, builds and runs to `unreal-native`,
   tests and measurements to `unreal-quality`.

## Rules of thumb

- Make a dependency private unless a public header needs it, and keep the narrowest lifetime that holds the state.
- Epic's pages describe mechanisms and one sample game, not a mandatory layout. Report a preference as a preference.
- A finding names the file and line, the Epic rule or the judgement behind it, and what would prove it fixed.

## Stop when

The named decision and its consequences are clear enough to plan, or the precise evidence gap is known. Do not
re-review the review or audit areas nobody asked about.
