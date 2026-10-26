---
name: unreal-gameplay
description: "Choose and drive Unreal Engine 5.8 gameplay systems: Gameplay Ability System, Enhanced Input, AI (StateTree, Behavior Trees, Smart Objects, Mass), Gameplay Cameras, navigation, Mover and the alternatives to Character Movement, Chaos vehicles, and networking and replication. Not for animation (use unreal-animation), a native C++ game's build and profiling (unreal-native) or choosing a game engine (engine-selection in agent-engine)."
when_to_use: "Use when asked which Unreal system to use for abilities, stat effects, costs, input bindings or control schemes, NPC behaviour, sensing, crowds, pathfinding, character or vehicle movement, a third-person camera or multiplayer; or on phrases such as RPC, replication, dedicated server, behavior tree, StateTree, building a StateTree from C++, a Gameplay Effect or attribute set in C++, Smart Objects or Mass from C++, or nav mesh."
---

# Choosing an Unreal gameplay system

Unreal 5.8 on Windows. Pick the feature from the goal, then read that system's reference: when to use it, what to use instead, how an agent drives it. Brackets show each plugin's shipped state. Other domains: `unreal-effects`, `unreal-animation`, `unreal-procedural`, `unreal-rendering`, `unreal-editor-scripting`, `unreal-native`, `unreal-import`, `uefn`, `unreal-architecture`, `unreal-quality`.

| You are about to | Read |
|---|---|
| Drive wheeled or modular vehicles (Chaos Vehicles, Chaos Modular Vehicle; off, experimental) | [Chaos vehicles](references/unreal-chaos-vehicles.md) |
| Move a character or pawn beyond the Character Movement Component (Mover, ChaosMover; off, experimental) | [Mover](references/unreal-mover.md) |
| Give characters abilities, stat effects, costs or predicted actions (GameplayAbilities; off) | [Gameplay Ability System](references/unreal-gameplay-ability-system.md) |
| Set up GAS in order: ASC placement, attribute sets, prediction, cues (GameplayAbilities) | [GAS workflow](references/unreal-gameplay-ability-system-workflow.md) |
| Write Gameplay Effects, attribute sets, native tags or a cost and cooldown in C++ (GameplayAbilities) | [GAS in C++](references/unreal-gas-native-effects.md) |
| Bind player input and switch controls by situation (EnhancedInput; on) | [Enhanced Input](references/unreal-enhanced-input.md) |
| Build NPC decisions, sensing, interaction slots or crowds (StateTree, Behavior Trees, Smart Objects, Mass) | [AI](references/unreal-ai-behavior.md) |
| Follow the numbered steps for a StateTree, Behavior Tree, EQS, Perception or Smart Object setup | [AI workflow](references/unreal-ai-behavior-workflow.md) |
| Create Smart Objects and claim slots from C++ at run time, with no authored assets (SmartObjects; off) | [Smart Objects from C++](references/unreal-smart-objects-native.md) |
| Run Mass entities and processors by hand from C++ without the Mass plugins (MassEntity, MassCore modules) | [Native Mass](references/unreal-mass-native.md) |
| Follow a pawn with a Gameplay Cameras rig, or blend a view while world time is dilated (GameplayCameras; experimental) | [Gameplay Cameras](references/unreal-gameplay-cameras.md) |
| Build, compile and run a StateTree from an editor module, or find out what Python can author | [StateTree authoring](references/unreal-statetree-authoring.md) |
| Path AI across level geometry, including World Partition maps | [Navigation](references/unreal-navigation.md) |
| Replicate gameplay for several players: RPCs, dedicated servers (Iris off; beta or experimental) | [Networking and replication](references/unreal-networking-and-replication.md) |

## Rules of thumb

- When two systems fit equally, choose the one whose plugin is on by default. A beta or experimental plugin is a deliberate opt-in.
- Per-frame behaviour, custom solvers and new data types are C++ or Blueprint; asset creation and property edits are editor Python.

Enable only the plugin a system needs: the steps are under Enable a feature in [unreal-editor-scripting](../unreal-editor-scripting/SKILL.md).
