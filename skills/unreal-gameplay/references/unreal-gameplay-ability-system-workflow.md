# Gameplay Ability System workflow in Unreal 5.8: from the plugin to prediction and cues

Target: Unreal Engine 5.8, Windows. Companion to [Gameplay Ability System](unreal-gameplay-ability-system.md), which covers when to use it and the driving table. This is the plugin entry and the setup steps in order.

## Enable it

| Plugin | Category | Enabled by default | Flags (descriptor) | Dependencies |
|---|---|---|---|---|
| `GameplayAbilities` | Gameplay | no | not beta | EngineAssetDefinitions, GameplayTagsEditor, Niagara, DataRegistry |

- Enable in Edit > Plugins, or add `{ "Name": "GameplayAbilities", "Enabled": true }` to the `.uproject` `Plugins` array, then restart the editor.
- Global settings live in Project Settings > Gameplay Abilities Developer Settings; class overrides go through `AbilitySystemGlobals` (plugin README in the 5.8 install).

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

The sources listed in [Gameplay Ability System](unreal-gameplay-ability-system.md).
