# Gameplay Effect components added from C++ on Unreal 5.8: what each one does

Target: Unreal Engine 5.8, Windows. Companion of [GAS in C++](unreal-gas-native-effects.md). Headers are under `Engine/Plugins/Runtime/GameplayAbilities/Source/GameplayAbilities/Public/GameplayEffectComponents/`. `examples/unreal/gas_native/` ran 44 cases over the components the install ships, headless in one throwaway project with no map: each case on its own actor, each component with a control (the same effect without it), and the expectation for every case written from engine source before the run (`gas-native-cases.mjs`).

## Use it when

- [general] An effect needs more than tags and a duration: a gate, a block, an immunity, a follow-up effect, a chance of applying, or a granted ability, all set in code.

## What held

Every asserted case observed what its expectation said. Each bullet names the calls the cases made.

- [tested] Asset Tags (`SetAndApplyAssetTagChanges`): the tags stay on the effect definition and the target does not own them (2 cases).
- [tested] Immunity (`ImmunityQueries.Add`): an effect whose asset tags match the query is refused and the block delegate fires; other effects apply; removing the immunity effect ends the blocking (4 cases).
- [tested] Additional Effects (`OnApplicationGameplayEffects`, `OnCompleteNormal`, `OnCompletePrematurely`, `OnCompleteAlways`): the extra effect applies with the main one, unless a `RequiredSourceTags` entry is not met; on completion Normal fires only on expiry, Prematurely only on early removal, Always on both (10 asserted cases).
- [tested] Block Abilities with Tags (`SetAndApplyBlockedAbilityTagChanges`): activation of an ability with a matching asset tag is refused while the effect lasts and allowed after its removal (3 cases).
- [tested] Cancel Abilities with Tags (`SetAndApplyCanceledAbilityTagChanges`): an active ability with a matching asset tag ends when the effect is applied, for an instant and an infinite effect, and an ability with another tag stays active (4 asserted cases).
- [tested] Chance To Apply (`SetChanceToApplyToTarget`): chance 0 applied 0 of 20 attempts and chance 1 applied 20 of 20 (3 asserted cases).
- [tested] Custom Can Apply (`ApplicationRequirements.Add(<requirement class>)`): the effect is refused until the requirement class returns true (3 cases).
- [tested] Remove Other Effects (`RemoveGameplayEffectQueries.Add`): active effects the query matches are removed and others stay (2 asserted cases).
- [tested] Require Tags (`ApplicationTagRequirements`, `OngoingTagRequirements`, `RemovalTagRequirements`): application is refused without the tag; an applied effect is inhibited and un-inhibited as the tag leaves and returns; with the removal tag present the effect is removed and refused again (5 cases).
- [tested] Grant Gameplay Abilities (`AddGrantedAbilityConfig`): the target owns the ability while the effect lasts and loses it with the effect (3 cases).

## Observed, not asserted

- [tested] Chance 0.5 over 200 attempts applied 105 times.
- [tested] An Additional Effects entry with a required source tag that the source owns (the source was the target itself): the extra tag was owned.
- [tested] Cancel Abilities with the mode set to On Execution, written by reflection: an instant effect cancelled the ability (active after: false); an infinite effect did not (true).
- [tested] A Remove Other effect whose query matches its own effect: the remover applied, was not active afterwards, and its tag was not owned.

## Adding a component

- [tested] `AddComponent<T>()` on an effect built with `NewObject` at run time worked for every case; no ensure failed during the component cases. The constructor route is in [GAS in C++](unreal-gas-native-effects.md).
- [documented] Only `ComponentMode` on `UCancelAbilityTagsGameplayEffectComponent` is private (`CancelAbilityTagsGameplayEffectComponent.h`, `ComponentMode`); the other components expose public members or a setter.
- [general] The example writes `ComponentMode` with `FindPropertyByName` on the class (`examples/unreal/gas_native/module/GasNative/GasNativeCases.cpp`).
- [documented] `UGameplayEffectUIData` and its text-only subclass are components too and hold display data. [general] The example has no case for them.

## Sources

- Example: [gas_native README](../../../examples/unreal/gas_native/README.md)
- The component headers and sources in `Engine/Plugins/Runtime/GameplayAbilities` of the 5.8 install
