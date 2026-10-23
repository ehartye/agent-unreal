# Gameplay Ability System in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. The Gameplay Ability System (GAS) is "a framework for building attributes, abilities, and interactions that an Actor can own and trigger" (Epic). Its pieces are the Ability System Component (ASC), Gameplay Abilities, Gameplay Effects, Attribute Sets, Gameplay Tags and Gameplay Cues. Much of the setup is C++; the table below says which parts are not.

## Enable it

| Plugin | Category | Enabled by default | Flags (descriptor) | Dependencies |
|---|---|---|---|---|
| `GameplayAbilities` | Gameplay | no | not beta | EngineAssetDefinitions, GameplayTagsEditor, Niagara, DataRegistry |

- Enable in Edit > Plugins, or add `{ "Name": "GameplayAbilities", "Enabled": true }` to the `.uproject` `Plugins` array, then restart the editor.
- Global settings live in Project Settings > Gameplay Abilities Developer Settings; class overrides go through `AbilitySystemGlobals` (plugin README in the 5.8 install).

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
| Add tags | Project Settings / `.ini` / Data Table | Gameplay Tag Manager, `Config/DefaultGameplayTags.ini` or `Config/Tags` (restart after text edits), `GameplayTagTableRow` tables; native tags need the `GameplayTags` module in `Build.cs` (Epic) |
| Create an ability asset | Python (named in Epic's 5.7 Python pages) | `unreal.GameplayAbilitiesBlueprintFactory` with `parent_class` and `blueprint_type`, as the factory for an asset-tools `create_asset` call |
| Write ability logic | Blueprint / C++ | Event Activate Ability, Ability Tasks, `EndAbility`; custom Ability Tasks are commonly C++ (Epic) |
| Author effects | Blueprint (data-only) / editor UI | Gameplay Effect assets: duration, modifiers, stacking, components, cues. Custom GE components and executions are native code (Epic) |
| Grant, activate, apply | Blueprint / C++ / Python (named in Epic's 5.7 Python pages) | `unreal.AbilitySystemComponent`: `give_ability`, `try_activate_ability_by_class`, `apply_gameplay_effect_to_self`; granting happens on the server |
| Author cosmetic feedback | Blueprint | Gameplay Cue Notify assets keyed by a tag that starts with `GameplayCue` |
| Debug | Gameplay Debugger / console / Visual Logger | `'` opens the debugger; `AbilitySystem.Ability.Grant`, `.Activate`, `AbilitySystem.Effect.Apply`, `AbilitySystem.DisplayGameplayCues` |

The local Python class-surface dump did not cover this plugin, so its Python reach rests on Epic's pages. Ability logic, effect assets and cue assets are editor-UI authoring.

## Workflow

1. Enable `GameplayAbilities`; add its `GameplayAbilities` module (descriptor) and `GameplayTags` (Epic) to the C++ build.
2. Put the ASC on the PlayerState for players, so attributes, tags and abilities persist after the Pawn is destroyed. Put it on the Pawn for AI characters (README; Epic's Lyra page does the same).
3. Call `InitAbilityActorInfo` with the logical owner and the physical avatar. Use Mixed replication for a player-owned ASC: the header states Minimal does not work for owned ASCs (5.8 install).
4. Write Attribute Sets in C++. Replicate with `ReplicatedUsing` and `GAMEPLAYATTRIBUTE_REPNOTIFY`. There is no built-in clamping, so clamp in `PostGameplayEffectExecute` (Epic).
5. Change attributes through Gameplay Effects only, so changes predict and roll back (README). Instant effects change the base value; duration effects change the current value and undo on removal (Epic).
6. Give each ability a Gameplay Tag, and use tags for blocking and cancelling instead of hand-written checks (Epic).
7. Write abilities with `InstancedPerActor`. Reset member variables in `EndAbility` and call `EndAbility` when the ability finishes, or GAS treats it as running (README; Epic).
8. Choose Net Execution Policy per ability: Local Predicted, Local Only, Server Initiated or Server Only (Epic).
9. Rely on prediction for ability activation, Gameplay Effect application (attribute modifiers and tags) and cues from predicted effects. Executions do not predict, and effect removal and periodic ticks are not predicted. The prediction window ends when `ActivateAbility` returns, so a timer or latent node leaves it (`GameplayPrediction.h` in the 5.8 install).
10. Implement cues as Notify assets: one-shot cues use OnExecute, looping cues use OnBurst, OnBecomeRelevant and OnCeaseRelevant (5.5 names). Implement OnBecomeRelevant with OnCeaseRelevant, since OnBurst can be dropped (README). When the ASC lives on the PlayerState, enable `ReplicationProxyEnabled` and implement `IAbilitySystemReplicationProxyInterface` on the Pawn (README).
11. Verify with the Gameplay Debugger, `AbilitySystem.Effect.ListActive` and the Visual Logger (README).

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
