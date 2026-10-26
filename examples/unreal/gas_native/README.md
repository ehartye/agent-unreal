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
  - `GasNativeCases` holds `UGasNativeHoldAbility` (stays active until cancelled), `UGasNativeGateRequirement` (a Custom Can Apply requirement class) and `GasNativeCases::Run`, which runs the effect-component cases below. `GasNativeEffects` also has `UGasNativeBonusEffect`, the class the Additional Effects cases name.
  - `GasNativeRep` is the replicated-play scenario (second runner below): a replicated attribute set, a locally predicted ability with a cost, a buff effect, a player state that owns an Ability System Component in Mixed mode, and a game mode that writes the server receipt.
- `gas_native.mjs` writes a throwaway project in the OS temp folder (`../native-build.mjs`), builds the Editor target, and runs `UnrealEditor-Cmd.exe Project.uproject -run=GasNativeProbe -Report=<file> -nullrhi` hidden.
- `gas-native-checks.mjs` judges the build, the report and the log; `gas-native-cases.mjs` holds the table of effect-component cases (expectation, source line, assert or observe) and judges them; `gas-native.test.mjs` tests that logic with no Unreal (it runs in `node scripts/check.mjs`).
- `gas_rep.mjs` starts a dedicated server and one client for the replicated-play scenario; `gas-rep-checks.mjs` builds their command lines and judges the two receipts together; `gas_rep_pie_readback.py` reads the Play In Editor multiplayer settings back; `gas-rep.test.mjs` tests the judge.

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

## Effect components other than target tags (prepared, not yet run on an engine)

The same commandlet, after the scenario above, runs one case table over the other Gameplay Effect components the 5.8 install ships under `Engine/Plugins/Runtime/GameplayAbilities/Source/GameplayAbilities/Public/GameplayEffectComponents/` (each header was read first). Every case has its own actor, so no case sees another's tags or effects; every component has a control, the same effect without it. The probe records only what it observed (`component_cases` in the report); the expectation, derived from the engine source before any run, is in `gas-native-cases.mjs` with an install-relative `path:line`, and a case is `observe` when the source does not pin the outcome.

| Component | Cases (effect / control) | Observable outcome |
|---|---|---|
| Asset Tags | 1 / 1 | the tag is on the definition, the target does not own it |
| Immunity | 3 / 1 | a matching effect is refused and the block delegate fires; an unrelated effect applies; removing the immunity unblocks |
| Additional Effects | 9 / 2 | the extra effect's tag on application (and with a required source tag, met is `observe`, unmet is asserted), and on completion by list (Normal, Prematurely, Always) after expiry or early removal |
| Block Abilities with Tags | 2 / 1 | the activation of an ability with the matching asset tag is refused, and allowed again after removal |
| Cancel Abilities with Tags | 5 / 1 | an active ability ends on application; a non-matching tag leaves it; `ComponentMode` OnExecution (private, set by reflection) is `observe` |
| Chance To Apply | 3 / 1 | chance 0 applies 0 of 20, chance 1 applies 20 of 20; chance 0.5 over 200 is `observe` |
| Custom Can Apply | 2 / 1 | refused without the gate tag, applied with it |
| Remove Other Effects | 2 / 1 | the matching active effect goes, the bystander stays; an infinite remover that matches itself is `observe` |
| Require Tags to Apply/Continue | 4 / 1 | application refused without the tag; ongoing requirement inhibits and un-inhibits; removal requirement removes and refuses again |
| Grant Gameplay Abilities | 2 / 1 | the target owns and can activate the ability while the effect lasts, and loses it with the effect |

How a component is added, from `GameplayEffect.h` in the install: `GEComponents` is protected, so a constructor needs a `UGameplayEffect` subclass member to fill it (`CreateDefaultSubobject`, then `GEComponents.Add`, as `MakeTimed` and `MakeInfinite` do). Outside a constructor, `AddComponent<T>()` and `FindOrAddComponent<T>()` are public and are what every case here uses. No component of the 11 is unreachable from C++: the others expose public members or a setter (`ImmunityQueries`, `OnApplicationGameplayEffects`, `ApplicationRequirements`, `RemoveGameplayEffectQueries`, `ApplicationTagRequirements`, `SetAndApplyBlockedAbilityTagChanges`, `SetAndApplyCanceledAbilityTagChanges`, `SetChanceToApplyToTarget`, `AddGrantedAbilityConfig`, `SetAndApplyAssetTagChanges`); only `UCancelAbilityTagsGameplayEffectComponent::ComponentMode` is private, so the OnExecution mode is written through reflection. `UGameplayEffectUIData` and its text-only subclass are also components, and are display data.

Runtime: the cases add a few seconds to the probe (44 cases; the seven Additional Effects completion cases tick the world for one second each). The runner prints the observe-only cases and any case that differs from the table.

## Replicated play (prepared, not yet run on an engine)

The question: with a dedicated server and one client on the same machine, does an actor with an Ability System Component in Mixed replication mode (owner and avatar: a player state) replicate a granted ability, an active Gameplay Effect and an attribute value to the client, and what does a client-side activation do?

```text
node examples/unreal/gas_native/gas_rep.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--reuse <kept folder>] [--render] [--pie-readback] [--timeout 150]
```

About two minutes to build (the same module as `gas_native.mjs`), then 20 to 40 s for the scenario. One engine process at a time except the scenario itself, which runs a server and a client together on a free UDP port.

Design, from the engine source (install-relative):

- Binary: the Editor target built by `native-build.mjs`; no Game, Server or Client target and no packaging. In an editor build `-server` makes `IsRunningDedicatedServer()` true and `-game` runs the editor binary as a game (`Engine/Source/Runtime/Core/Private/Misc/CoreMisc.cpp`, `StaticDedicatedServerCheck`, `StaticGameCheck`). A Game or Server target would need a source build (the installed engine ships no server target) and a cook; the editor route needs neither.
- Server: `UnrealEditor-Cmd.exe Project.uproject /Engine/Maps/Entry?game=/Script/GasNative.GasNativeRepGameMode -server -game -Port=<free port> -nullrhi -RepReceipt=<file> -abslog=<file> -unattended -nosplash -nosound -notraceserver -nopause`. The map is the engine's own, so the project needs no assets. `-Port=` overrides the URL port (`CoreMisc.cpp`, `FUrlConfig::Init`). `UEngine::LoadMap` calls `UWorld::Listen` before `UWorld::BeginPlay` (`Engine/Source/Runtime/Engine/Private/UnrealEngine.cpp`, the `Listen for clients` block), so the game mode's "server ready" log line means a client can connect. `-log` is left out: it opens a console window and the log file is written without it.
- Client: `UnrealEditor.exe Project.uproject 127.0.0.1:<port> -game -nullrhi -windowed -ResX=640 -ResY=360 -RepReceipt=<file> -abslog=<file> ...`; the first plain token is the URL. `--render` swaps `-nullrhi` for `-RenderOffScreen`.
- `?listen` is not used: the map option makes the process a listen server, which is the other mode and not what the question asks.
- Receipts: each process writes a JSON receipt to its own `-RepReceipt=` file after a fixed time (server 8 s after the join, client 3 s after its player state begins play for the activation and 2 s later for the receipt, then it exits). The runner waits for both with a hard timeout, kills whatever is left and judges the two together.

What the scenario does: on the join the server's game mode grants `UGasNativeRepAbility` and applies `UGasNativeRepBuffEffect` (infinite, Energy +5, grants a tag) to the player state's component. `Energy` starts at 100 and replicates. Three seconds into its map the client snapshots what it can see, then calls `TryActivateAbilityByClass`; the ability is `LocalPredicted`, costs 10 Energy, counts its activations split by `IsNetAuthority()`, and ends at once. Two seconds later the client snapshots again.

Checks (10, none run on an engine):

- Asserted from source: the module builds; both receipts are written with no fatal error (exit codes are reported, not judged); the server is `DedicatedServer` and a client joined; on the server the component is Mixed, owned by the player state, and holds the ability, the buff and Energy 105/100; on the client the component is Mixed and owned by the player state, the ability is present (`ActivatableAbilities`, `COND_ReplayOrOwner`: `AbilitySystemComponent.cpp:1861`), the buff is an active effect and its tag is owned (Mixed gives the owner full effect info: `GameplayEffect.cpp:5195`), and Energy reads 105/100; after the settle time client and server read the same Energy.
- Observed only (printed beside the source-derived expectation, never asserted): whether the client had the spec at the call, whether `TryActivateAbilityByClass` returned true, the predicted and authority activation counts on each side, Energy after the cost (expected 90 base, 95 current on both), and the roles, controller and avatar readings.
- `--pie-readback` adds an observe-only check: Python reads `LevelEditorPlaySettings` (`PlayNetMode`, `PlayNumberOfClients`, `RunUnderOneProcess`, `bLaunchSeparateServer`, `ServerPort`) with `get_editor_property`, writes `play_number_of_clients` and `play_net_mode` in memory, reads them back and restores them. It does not start Play In Editor. The first three are private members with `EditAnywhere`, so whether Python reaches them is the question; the report holds each call's result or exception text.

Not covered: Play In Editor itself, more than one client, a pawn as owner or avatar (Epic's usual setup puts the avatar on the pawn), Minimal and Full modes, Iris, prediction rejection, lag or loss, and a packaged Server or Client target.

## Variants that were run once and are not shipped

Each was a copy of the module with one change, built and started in a throwaway project. The run records are in the reference; none of these variants is in this folder.

- `AddComponent<UTargetTagsGameplayEffectComponent>()` and, separately, `FindOrAddComponent<...>()` in place of `CreateDefaultSubobject` and `GEComponents.Add` in `MakeTimed`. Both build. Starting `UnrealEditor-Cmd.exe` (with `-run=GasNativeProbe`, both variants) and `UnrealEditor.exe` (`-nullrhi -unattended`, the `AddComponent` variant) ends in exit code 3 right after the log line that loads `UnrealEditor-GasNative.dll`, before any commandlet code: `Fatal error: [File:...UObjectGlobals.cpp] [Line: 4880] NewObject with empty name can't be used to create default subobjects (inside of UObject derived class constructor) as it produces inconsistent object names. Use ObjectInitializer.CreateDefaultSubobject<> instead.` The callstack runs `UGameplayEffect::AddComponent<UTargetTagsGameplayEffectComponent>()` (`GameplayEffect.h:2501`), `UGasNativeEffectBase::MakeTimed()`, then the effect's constructor.
- `GasNative.Build.cs` naming only `Core`, `CoreUObject`, `Engine`, `GameplayAbilities` and `Json`. The sources compile and the link fails with 9 unresolved externals: `FNativeGameplayTag` (constructor and destructor), `FGameplayTagContainer::AddTag` and its assignment operators, `FGameplayTagQuery` (GameplayTags) and `UGameplayTask::ReadyForActivation` (GameplayTasks).

## Not verified

Executions and magnitude calculations written in C++. The effect-component cases and the replicated-play scenario are prepared and have not run on an engine yet, so nothing in those sections is `[tested]`.
