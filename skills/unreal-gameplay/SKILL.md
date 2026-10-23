---
name: unreal-gameplay
description: Choose and drive Unreal Engine 5.8 gameplay systems: Gameplay Ability System, Enhanced Input, AI (StateTree, Behavior Trees, Smart Objects, Mass), navigation, Mover and the alternatives to Character Movement, Chaos vehicles, and networking and replication. Not for animation (use unreal-animation), a native C++ game's build and profiling (unreal-native) or choosing a game engine (engine-selection in agent-engine).
when_to_use: Use when asked which Unreal system to use for abilities, stat effects, costs, input bindings or control schemes, NPC behaviour, sensing, crowds, pathfinding, character or vehicle movement, or multiplayer; or on phrases such as RPC, replication, dedicated server, behavior tree, StateTree or nav mesh.
---

# Choosing an Unreal gameplay system

Unreal 5.8 on Windows. Pick the feature from the goal, then read that system's reference: when to use it, what to use instead, how an agent drives it. Brackets show each plugin's shipped state. Other domains: `unreal-effects`, `unreal-animation`, `unreal-gameplay`, `unreal-procedural`, `unreal-rendering`, `unreal-editor-scripting`.

| You are about to | Read |
|---|---|
| Drive wheeled or modular vehicles (Chaos Vehicles, Chaos Modular Vehicle; off, experimental) | [Chaos vehicles](references/unreal-chaos-vehicles.md) |
| Move a character or pawn beyond the Character Movement Component (Mover, ChaosMover; off, experimental) | [Mover](references/unreal-mover.md) |
| Give characters abilities, stat effects, costs or predicted actions (GameplayAbilities; off) | [Gameplay Ability System](references/unreal-gameplay-ability-system.md) |
| Bind player input and switch controls by situation (EnhancedInput; on) | [Enhanced Input](references/unreal-enhanced-input.md) |
| Build NPC decisions, sensing, interaction slots or crowds (StateTree, Behavior Trees, Smart Objects, Mass) | [AI](references/unreal-ai-behavior.md) |
| Path AI across level geometry, including World Partition maps | [Navigation](references/unreal-navigation.md) |
| Replicate gameplay for several players: RPCs, dedicated servers (Iris off; beta or experimental) | [Networking and replication](references/unreal-networking-and-replication.md) |

## Rules of thumb

- When two systems fit equally, choose the one whose plugin is on by default. A beta or experimental plugin is a deliberate opt-in.
- Per-frame behaviour, custom solvers and new data types are C++ or Blueprint; asset creation and property edits are editor Python.

Enable only the plugin a system needs: the steps are under Enable a feature in [unreal-editor-scripting](../unreal-editor-scripting/SKILL.md).
