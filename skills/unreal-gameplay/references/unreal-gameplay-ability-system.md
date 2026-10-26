# Gameplay Ability System in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. The Gameplay Ability System (GAS) is "a framework for building attributes, abilities, and interactions that an Actor can own and trigger" (Epic). Its pieces are the Ability System Component (ASC), Gameplay Abilities, Gameplay Effects, Attribute Sets, Gameplay Tags and Gameplay Cues. Much of the setup is C++; the table below says which parts are not.

Plugin entry, enabling steps and the setup order, from ASC placement to prediction, cues and verification: [GAS workflow](unreal-gameplay-ability-system-workflow.md).

## Use it when

- Characters have abilities that must coordinate mechanics, effects, animation, sound and data (Epic's design target: RPGs, action-adventure, MOBAs).
- Stats need buffs, debuffs, costs and cooldowns that stack, expire and undo cleanly.
- The game is multiplayer and abilities need client prediction with server rollback.
- You must record who caused an outcome, such as awarding a kill for damage-over-time (plugin README).
- Lyra, Epic's sample, runs most of its gameplay through GAS and is the worked example.

## Use something else when

- Epic documents no minimum size and no exclusion list. The design target above is the guidance: a game with a handful of fixed actions, plain float stats, and no buffs, costs, cooldowns or prediction needs does not need a framework built for those, so use plain Blueprint or C++ events and variables.
- The project cannot add C++: Attribute Sets cannot be created in Blueprint (Epic).
- The effect is feedback that must reach every client: Gameplay Cues use unreliable replication and are for cosmetic feedback only (Epic). Use an Ability Task such as Play Montage for gameplay-relevant feedback.
- Data must be visible on simulated proxies: Gameplay Abilities exist only on the server and the locally controlled client (README). Use Attributes or direct RPCs on the Actor.
- Non-instanced abilities are deprecated since 5.5; use `InstancedPerActor` (README).

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Enable plugin | `.uproject` edit / editor UI | `Plugins` array; Edit > Plugins |
| Add the ASC and map it to an Actor | C++ | Implement `IAbilitySystemInterface`, return the component from `GetAbilitySystemComponent` (Epic); one ASC per Actor |
| Bind owner and avatar | C++ | `InitAbilityActorInfo(Owner, Avatar)` and `SetReplicationMode(Minimal / Mixed / Full)`; neither is named in Epic's 5.7 Python page for `unreal.AbilitySystemComponent` |
| Define attributes | C++ only | `UAttributeSet` with `FGameplayAttributeData` properties (Epic) |
| Register a set | C++ / Blueprint | The server adds sets; for an Actor Blueprint, add the set type to the ASC Default Starting Data (Epic) |
| Add tags | Project Settings / `.ini` / Data Table | Gameplay Tag Manager, `Config/DefaultGameplayTags.ini` or `Config/Tags` (restart after text edits), `GameplayTagTableRow` tables; native tags need the `GameplayTags` module in `Build.cs` (Epic); declare and define macros in [C++ effects](unreal-gas-native-effects.md) |
| Create an ability asset | Python (named in Epic's 5.7 Python pages) | `unreal.GameplayAbilitiesBlueprintFactory` with `parent_class` and `blueprint_type`, as the factory for an asset-tools `create_asset` call |
| Write ability logic | Blueprint / C++ | Event Activate Ability, Ability Tasks, `EndAbility`; custom Ability Tasks are commonly C++ (Epic) |
| Author effects | Blueprint (data-only) / editor UI | Gameplay Effect assets: duration, modifiers, stacking, components, cues. Custom GE components and executions are native code (Epic). A C++ effect class adds components with `CreateDefaultSubobject`, not `AddComponent` ([C++ effects](unreal-gas-native-effects.md)) |
| Grant, activate, apply | Blueprint / C++ / Python (named in Epic's 5.7 Python pages) | `unreal.AbilitySystemComponent`: `give_ability`, `try_activate_ability_by_class`, `apply_gameplay_effect_to_self`; granting happens on the server |
| Author cosmetic feedback | Blueprint | Gameplay Cue Notify assets keyed by a tag that starts with `GameplayCue` |
| Debug | Gameplay Debugger / console / Visual Logger | `'` opens the debugger; `AbilitySystem.Ability.Grant`, `.Activate`, `AbilitySystem.Effect.Apply`, `AbilitySystem.DisplayGameplayCues` |

The local Python class-surface dump did not cover this plugin, so its Python reach rests on Epic's pages. Ability logic, effect assets and cue assets are editor-UI authoring.

Related: [Enhanced Input](unreal-enhanced-input.md), [Networking and replication](unreal-networking-and-replication.md).

## Sources

- [Gameplay Ability System for Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/gameplay-ability-system-for-unreal-engine)
- [Understanding the Gameplay Ability System](https://dev.epicgames.com/documentation/en-us/unreal-engine/understanding-the-unreal-engine-gameplay-ability-system)
- [Gameplay Ability System Component and Gameplay Attributes](https://dev.epicgames.com/documentation/en-us/unreal-engine/gameplay-ability-system-component-and-gameplay-attributes-in-unreal-engine)
- [Gameplay Attributes and Attribute Sets](https://dev.epicgames.com/documentation/unreal-engine/gameplay-attributes-and-attribute-sets-for-the-gameplay-ability-system-in-unreal-engine?lang=en-US)
- [Gameplay Effects](https://dev.epicgames.com/documentation/en-us/unreal-engine/gameplay-effects-for-the-gameplay-ability-system-in-unreal-engine)
- [Using Gameplay Abilities](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-gameplay-abilities-in-unreal-engine)
- [Using Gameplay Tags](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-gameplay-tags-in-unreal-engine)
- [Abilities in Lyra](https://dev.epicgames.com/documentation/unreal-engine/abilities-in-lyra-in-unreal-engine)
- Epic Python API 5.7: [AbilitySystemComponent](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/AbilitySystemComponent?application_version=5.7), [GameplayAbilitiesBlueprintFactory](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/GameplayAbilitiesBlueprintFactory?application_version=5.7)
- The plugin descriptor, `README.md`, `GameplayPrediction.h` and `AbilitySystemComponent.h` in the 5.8 install
