# Gameplay Effects, attribute sets, tags and abilities in C++

Backs [Gameplay Effects, attribute sets, tags and abilities in C++](../../../skills/unreal-gameplay/references/unreal-gas-native-effects.md). Unreal Engine 5.8.2, Windows, Visual Studio 2022 Build Tools.

The question: how does a native Gameplay Effect get its tag-granting component, and does the whole cost and cooldown loop work from code alone? The run builds a small module and drives it headless with no map and no assets.

## Files

- `module/GasNative/` (runtime module):
  - `GasNativeAttributeSet` has one attribute, `Charge`, with `ATTRIBUTE_ACCESSORS_BASIC`.
  - `GasNativeTags` declares and defines three native tags (`UE_DECLARE_GAMEPLAY_TAG_EXTERN`, `UE_DEFINE_GAMEPLAY_TAG_COMMENT`).
  - `GasNativeEffects` has `UGasNativeEffectBase`, whose protected helper `MakeTimed` adds the target-tags component with `CreateDefaultSubobject` and `GEComponents.Add`; `UGasNativeCooldownEffect` (two seconds, grants `GasNative.Cooldown.Pulse`) and `UGasNativeCostEffect` (instant, `Charge` minus 10).
  - `GasNativeAbility` sets its asset tag with `SetAssetTags`, names the cost and cooldown classes, commits in `ActivateAbility` and ends after a `UAbilityTask_WaitDelay` of half a second.
  - `GasNativeProbe` has a test actor with an Ability System Component and `UGasNativeProbeCommandlet`, which makes a game world by hand, runs the scenario and writes a JSON report.
  - `GasNative.Build.cs` lists `GameplayAbilities`, `GameplayTags` and `GameplayTasks`.
- `gas_native.mjs` writes a throwaway project in the OS temp folder (`../native-build.mjs`), builds the Editor target, and runs `UnrealEditor-Cmd.exe Project.uproject -run=GasNativeProbe -Report=<file> -nullrhi` hidden.
- `gas-native-checks.mjs` judges the build, the report and the log; `gas-native.test.mjs` tests that logic with no Unreal (it runs in `node scripts/check.mjs`).

## Run

```text
node examples/unreal/gas_native/gas_native.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
```

About one to two minutes to build and 10 to 30 s for the probe.

## What it checks (12 checks, all passed on 5.8.2)

- The module builds and links with `GameplayAbilities`, `GameplayTags` and `GameplayTasks` named, and the probe exits 0 with no `Fatal error` in the log.
- The cooldown effect's class default object holds one target-tags component that grants `GasNative.Cooldown.Pulse`; the log has no `should be added to GEComponents` ensure, no `LogGameplayEffects` error and no `SetAssetTags` complaint.
- The ability has the asset tag `GasNative.Ability.Pulse`, both effect classes resolve, and its cooldown tags are the cooldown effect's granted tag.
- `TryActivateAbilityByClass` activates it: `Charge` goes from 100 to 90 and the cooldown tag appears.
- A second activation is refused (`CanActivateAbility` is false, `TryActivateAbilityByClass` returns false) and `Charge` stays 90.
- The commandlet ticks the world in 0.1 s steps: the tag is still present at 1 s and is gone at 2.1 s (the first step after the two seconds); the `WaitDelay` task ends the ability at 0.6 s.
- After the tag is gone the ability activates again and `Charge` goes to 80.
- An effect made with `NewObject` at run time takes `AddComponent<UTargetTagsGameplayEffectComponent>()` and its tag reaches the target.

The commandlet makes its world with `UWorld::CreateWorld`, `InitializeActorsForPlay` and `BeginPlay`, and its loop increments `GFrameCounter` before each `World->Tick`: `FTimerManager::Tick` returns early when it already ticked in the current frame (`TimerManager.cpp` line 1136), which would stop the cooldown and the task from ever finishing.

## Variants that were run once and are not shipped

Each was a copy of the module with one change, built and started in a throwaway project. The run records are in the reference; none of these variants is in this folder.

- `AddComponent<UTargetTagsGameplayEffectComponent>()` and, separately, `FindOrAddComponent<...>()` in place of `CreateDefaultSubobject` and `GEComponents.Add` in `MakeTimed`. Both build. Starting `UnrealEditor-Cmd.exe` (with `-run=GasNativeProbe`, both variants) and `UnrealEditor.exe` (`-nullrhi -unattended`, the `AddComponent` variant) ends in exit code 3 right after the log line that loads `UnrealEditor-GasNative.dll`, before any commandlet code: `Fatal error: [File:...UObjectGlobals.cpp] [Line: 4880] NewObject with empty name can't be used to create default subobjects (inside of UObject derived class constructor) as it produces inconsistent object names. Use ObjectInitializer.CreateDefaultSubobject<> instead.` The callstack runs `UGameplayEffect::AddComponent<UTargetTagsGameplayEffectComponent>()` (`GameplayEffect.h:2501`), `UGasNativeEffectBase::MakeTimed()`, then the effect's constructor.
- `GasNative.Build.cs` naming only `Core`, `CoreUObject`, `Engine`, `GameplayAbilities` and `Json`. The sources compile and the link fails with 9 unresolved externals: `FNativeGameplayTag` (constructor and destructor), `FGameplayTagContainer::AddTag` and its assignment operators, `FGameplayTagQuery` (GameplayTags) and `UGameplayTask::ReadyForActivation` (GameplayTasks).

## Not verified

Effect components other than target tags, executions and magnitude calculations written in C++, and replicated play.
