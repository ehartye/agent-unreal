# Gameplay Effects, attribute sets, tags and abilities in C++ on Unreal 5.8

Target: Unreal Engine 5.8, Windows. This is the native-code half of the [Gameplay Ability System](unreal-gameplay-ability-system.md): an effect written as a C++ class, an attribute set, native tags, and an ability with a cost and a cooldown. The runnable example is `examples/unreal/gas_native/`.

## Use it when

- [general] A Gameplay Effect is better as code than as a data-only asset: a fixed cooldown or cost that ships with the ability class, or a family of effects that share one helper.
- [general] The project already has a C++ module; attribute sets cannot be made in Blueprint, so a module exists once any attribute is needed.

## Use something else when

- [general] Designers tune the numbers: make a data-only Blueprint effect asset and set it on the ability. Only the constructor-time wiring below needs code.
- [documented] An effect built at run time, after construction, uses `AddComponent` or `FindOrAddComponent` (`GameplayEffect.h` lines 2497 to 2521); the constructor rule below does not apply to it. [tested] `gas_native` builds such an effect with `NewObject` and `AddComponent`, applies it, and the target owns its tag.

## How an agent drives it

| Task | What to write | Source |
|---|---|---|
| Effect component in a constructor | `CreateDefaultSubobject<UTargetTagsGameplayEffectComponent>(TEXT("Name"))`, `GEComponents.Add`, then `SetAndApplyTargetTagChanges(FInheritedTagContainer)`; do it in a helper on a `UGameplayEffect` subclass | `GameplayEffect.h` 2466 |
| Attribute accessors | `ATTRIBUTE_ACCESSORS_BASIC(UMySet, Charge)` beside the `FGameplayAttributeData` property | `AttributeSet.h` 465 |
| Ability tags | `SetAssetTags(Container)` in the ability constructor | `GameplayAbility.h` 523 |
| Native tags | `UE_DECLARE_GAMEPLAY_TAG_EXTERN(Tag_X)` in a header; `UE_DEFINE_GAMEPLAY_TAG_COMMENT(Tag_X, "A.B", "note")` in one `.cpp`; read `Tag_X.GetTag()` | `NativeGameplayTags.h` 31, 36, 69 |
| Cost and cooldown | `CostGameplayEffectClass` and `CooldownGameplayEffectClass` set in the constructor; call `CommitAbility` in `ActivateAbility` | `GameplayAbility.h` 723, 731 |
| Wait inside an ability | `UAbilityTask_WaitDelay::WaitDelay(this, Seconds)`, bind `OnFinish`, `ReadyForActivation()` | `AbilityTask_WaitDelay.h` 28 |

- [tested] `node examples/unreal/gas_native/gas_native.mjs --engine <UE_5.8 folder>` builds the module and drives every row headless with a commandlet and no map; 24 of 24 checks passed. The other 12 cover the effect components in [Gameplay Effect components](unreal-gas-effect-components.md).

## Constructor pattern for effect components

- [documented] `AddComponent` calls `NewObject<T>(this, NAME_None, ...)` (`GameplayEffect.h` line 2501). `NewObject` with no name calls `FObjectInitializer::AssertIfInConstructor`, which logs at Fatal level when the outer is the object being constructed (`UObjectGlobals.h` lines 1936, 1963, 1979; `UObjectGlobals.cpp` line 4880). The message is "NewObject with empty name can't be used to create default subobjects (inside of UObject derived class constructor) as it produces inconsistent object names. Use ObjectInitializer.CreateDefaultSubobject<> instead."
- [documented] `FindOrAddComponent` falls through to `AddComponent` when no component of the class exists, so in a constructor it ends in the same call (`GameplayEffect.h` line 2521).
- [tested] In a scratch variant of the example (not shipped), `FindOrAddComponent` and, separately, `AddComponent` in the effect's constructor ended the process while the module loaded, before any other code ran: `UnrealEditor-Cmd.exe` and `UnrealEditor.exe` both exited with code 3, and the log carried the Fatal message above with `UGameplayEffect::AddComponent<UTargetTagsGameplayEffectComponent>()` (`GameplayEffect.h:2501`) under the effect's constructor in the callstack.
- [documented] `PostInitProperties` ensures that every default-subobject component is in `GEComponents` ("should be added to GEComponents during the constructor or in PostInitProperties", `GameplayEffect.cpp` line 235). The array is `protected` (`GameplayEffect.h` line 2466), so the add has to be written in a `UGameplayEffect` subclass; a base class with one `MakeTimed(Seconds, Tag)` helper serves every effect.
- [tested] `examples/unreal/gas_native` builds a timed effect this way: the class default object holds one target-tags component that grants the native tag, and the log has no `GEComponents` ensure.
- [documented] `SetAndApplyTargetTagChanges` stores the tags on the component and merges them into the effect's cached granted tags (`TargetTagsGameplayEffectComponent.cpp` lines 68 to 84). The component's editor data validation rejects an `Instant` effect (lines 56 to 60), so give it `HasDuration` or `Infinite`.

## Attribute sets, tags, abilities

- [documented] `ATTRIBUTE_ACCESSORS` appears only inside a comment in `AttributeSet.h` (lines 419 to 425), as a macro to copy. The macro the header defines is `ATTRIBUTE_ACCESSORS_BASIC` (line 465): property getter, value getter, setter and initter (`GetChargeAttribute`, `GetCharge`, `SetCharge`, `InitCharge`).
- [documented] `AbilityTags` is deprecated for game code since 5.5 (`GameplayAbility.h` line 474). `SetAssetTags` replaces it; it is for constructors only and ensures `RF_NeedInitialization` (`GameplayAbility.cpp` line 1306). Read the tags with `GetAssetTags()`.
- [documented] `UE_DEFINE_GAMEPLAY_TAG_COMMENT` has a static assert that the file is a `.cpp` (`NativeGameplayTags.h` line 36); declare in the header with `UE_DECLARE_GAMEPLAY_TAG_EXTERN`. `FNativeGameplayTag::GetTag()` returns the `FGameplayTag` (line 69).
- [documented] The cooldown check reads the granted tags of the cooldown effect (`GetCooldownTags`, `GameplayAbility.cpp` line 1216) and refuses activation while the owner has any of them (`CheckCooldown`, line 1064). The cost check asks whether the effect's attribute modifiers can apply (`CheckCost`, line 1115). The cooldown effect therefore has to grant a tag.
- [tested] `gas_native` activates the ability: the attribute drops by the cost, the cooldown tag appears, a second activation is refused with no second cost, the tag expires at about two seconds of world time, and the ability activates again.

## Modules

- [documented] `UAbilityTask` derives from `UGameplayTask`, which lives in `GameplayTasks` (`AbilityTask.h` line 90). `GameplayAbilities.Build.cs` lists `GameplayTags` and `GameplayTasks` among its own public dependencies.
- [tested] A scratch variant of the example that named only `GameplayAbilities` compiled but failed to link. The unresolved externals were `FNativeGameplayTag`, `FGameplayTagContainer::AddTag`, `FGameplayTagQuery` (GameplayTags) and `UGameplayTask::ReadyForActivation` (GameplayTasks). The example's `GasNative.Build.cs` names `Core`, `CoreUObject`, `Engine`, `GameplayAbilities`, `GameplayTags` and `GameplayTasks`, and links.
- [general] Name every module the code calls into, and enable the `GameplayAbilities` plugin in the `.uproject`.

## Not covered here

- [general] Not covered by these runs: executions and magnitude calculations in C++. Effect components other than target tags are in [Gameplay Effect components](unreal-gas-effect-components.md); replicated play is in [Networking and replication](unreal-networking-and-replication.md).

## Sources

- `GameplayEffect.h`, `GameplayEffect.cpp`, `AttributeSet.h`, `GameplayAbility.h`, `GameplayAbility.cpp`, `AbilityTask_WaitDelay.h` and `GameplayAbilities.Build.cs` in `Engine/Plugins/Runtime/GameplayAbilities` of the 5.8 install
- `NativeGameplayTags.h` in `Engine/Source/Runtime/GameplayTags`; `UObjectGlobals.h` and `UObjectGlobals.cpp` in `Engine/Source/Runtime/CoreUObject`
