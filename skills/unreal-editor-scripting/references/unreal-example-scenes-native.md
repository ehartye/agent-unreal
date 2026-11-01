# Example scenes: native bridges, automation and builds

These manual engine runs use disposable projects. From the plugin root, run each complete probe through the shared adapter shown below. Existing scientific results remain historical observations; moving this catalogue does not rerun them. See [scene examples](unreal-example-scenes.md) and [tooling/rendering examples](unreal-example-scenes-tooling.md) for the other probes.

## C++ bridge and automation test (`landscape_bridge/`, `automation_test/`)

Two throwaway code projects discover compiler/SDK, build with UBT, and run headless.

- `pwsh -NoProfile -File examples/unreal/engine_lock/with-engine-lock.ps1 node examples/unreal/landscape_bridge/landscape_bridge.mjs --engine <UE_5.8 folder>`: an editor-only module exposes `ALandscapeProxy::Import` as `unreal.LandscapeBridgeLibrary.create_landscape_from_heights`. A 505 by 505 height array becomes a Landscape of 16 components (quad size 100); sampled heights match the input within half a height step (worst 0.379 cm). Same result in a non-partitioned map and in a `new_level(path, True)` World Partition map: grid size 0 keeps all 16 components on the Landscape actor, grid size 2 makes 4 streaming proxies. 19 of 19 checks. [Python to C++ bridge](unreal-python-cpp-bridge.md).
- `pwsh -NoProfile -File examples/unreal/engine_lock/with-engine-lock.ps1 node examples/unreal/landscape_bridge/landscape_world.mjs --engine <UE_5.8 folder> [--rendering]`: five brush functions on the same module, then three phases (Landmass brush attach, PCG on a partitioned Landscape, proxy unload). It passed 16 of 18 checks in `-nullrhi` editors and 18 of 18 with `--rendering`. [Landscape bridge brushes](unreal-landscape-bridge-brushes.md), [Landmass](../../unreal-procedural/references/unreal-landmass.md).
- `pwsh -NoProfile -File examples/unreal/engine_lock/with-engine-lock.ps1 node examples/unreal/automation_test/automation_test.mjs --engine <UE_5.8 folder>`: a passing and a deliberately failing `IMPLEMENT_SIMPLE_AUTOMATION_TEST` (`EditorContext | ProductFilter`), run with `-ExecCmds="Automation RunTests <filter>; Quit"`. The failing test is reported as `failed: 1`, state `Fail`, with message and line; exit codes are 255 with `; Quit` and 0 with `-TestExit`, so `automation_report.mjs` decides from `index.json`. 9 of 9 checks. [Automation tests](../../unreal-native/references/unreal-native-automation-tests.md).

Both folders have READMEs and pure tests in `node scripts/check.mjs`; engine runs take 3–5 minutes.

## Gameplay Effects in C++ (`examples/unreal/gas_native/`)

Backs [GAS in C++](../../unreal-gameplay/references/unreal-gas-native-effects.md): a small runtime module (attribute set, native tags, a cooldown and a cost effect, an ability) driven headless by a commandlet with no map and no assets.

```text
pwsh -NoProfile -File examples/unreal/engine_lock/with-engine-lock.ps1 node examples/unreal/gas_native/gas_native.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler <version>] [--sdk <version>]
```

About one to two minutes to build and 10 to 30 s for the probe; 12 checks (`gas-native-checks.mjs`). See the [folder README](../../../examples/unreal/gas_native/README.md).

- [tested] Result: 12 of 12 pass (24 of 24 with the component cases). The module builds with `GameplayAbilities`, `GameplayTags` and `GameplayTasks` named, and the effect's constructor leaves one target-tags component that grants the native tag.
- [tested] Activation pays the cost (100 to 90) and sets the cooldown tag; a second activation is refused; the tag is present at 1 s and gone at 2.1 s; it activates again (80); an effect made with `NewObject` at run time takes `AddComponent<UTargetTagsGameplayEffectComponent>()`.
- [tested] The commandlet increments `GFrameCounter` before each `World->Tick`, or `FTimerManager::Tick` returns early and the cooldown never ends.

## Unity builds (`examples/unreal/unity_build/`)

Backs [Unity builds and file-scope names](../../unreal-native/references/unreal-native-unity-builds.md) and [its fixes](../../unreal-native/references/unreal-native-unity-build-fixes.md): a three-file module whose files build alone and fail together.

```text
pwsh -NoProfile -File examples/unreal/engine_lock/with-engine-lock.ps1 node examples/unreal/unity_build/unity_build.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler <version>] [--sdk <version>]
```

About six minutes: it builds the Editor target 10 times in two throwaway projects (the second is a git repository, so `git` must be on the path); 11 checks (`unity-build-checks.mjs`). See the [folder README](../../../examples/unreal/unity_build/README.md).

- [tested] With the threshold lowered, adaptive unity on, an installed engine and no git repository, all three writable files stay out of the unity file and the clashing sources build.
- [tested] With `-DisableAdaptiveUnity` the files share one unity file and the build fails with `C2374`, `C2086`, `C4459` and `C2872` in `ProbeBeta.cpp`; the old binary is unchanged. `bUseUnity = false`, file-prefixed names and one unity file per source all build.
- [tested] In a git project the clean tree fails; an edited file leaves the chunk and the build passes; committing alone does not regroup; writing the committed file again, as a checkout or rebase does, brings the clash back.
