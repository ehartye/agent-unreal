# Example scenes: content tooling, rendering probes and native builds

Same method as the other scenes in [Example scenes](unreal-example-scenes.md): each builds a throwaway project in the OS temp folder, runs on an installed Unreal 5.8, prints PASS or FAIL per claim and is a manual run, not part of `node scripts/check.mjs`, which runs only the pure check logic (each folder's `*.test.mjs`). The commands pass the engine folder. A line in a reference marked [tested] is one of these checks. Each folder has a README with the full results.

## Content and tooling scenes (`niagara_toolsets/`, `editor_python_friction/`, `constructor_locks/`, `anim_bridge/`, `contention/`)

- [tested] [`niagara_toolsets`](../../../examples/unreal/niagara_toolsets/README.md) (25 checks, counted from the `check(` calls in `nts-validate-checks.mjs`; the README reports 25 of 25 on 5.8.2): create a system, edit an input, set the material, delete and recreate, add a renderer. Backs [Niagara toolsets](../../unreal-effects/references/unreal-niagara-toolsets.md).
- [tested] [`editor_python_friction`](../../../examples/unreal/editor_python_friction/README.md) (8): `unreal.Box` construction and the benign Interchange alpha-mode log line.
- [tested] [`constructor_locks`](../../../examples/unreal/constructor_locks/README.md) (11): constructor-loaded asset files are locked while the editor is open. Backs [Content pipeline](../../unreal-native/references/unreal-native-content-pipeline.md).
- [tested] [`anim_bridge`](../../../examples/unreal/anim_bridge/README.md) (22): slot-only Animation Blueprints from Python and C++; states, transitions and blend-space resampling need C++. Backs [Animation Blueprints](../../unreal-animation/references/unreal-animation-blueprints.md).
- [tested] [`contention`](../../../examples/unreal/contention/README.md): a helper that stamps other-editor count and free memory into a receipt. Backs [profiling facts](../../unreal-native/references/unreal-native-profiling-facts.md).

## Rendering probes (`examples/unreal/rendering_probes/`)

Backs the [tested] lines of [Two directional lights](../../unreal-rendering/references/unreal-directional-lights.md).

```text
node examples/unreal/rendering_probes/rp_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep]
```

One hidden headless commandlet (`-nullrhi`), under a minute including the first start of the new project; 3 checks (`rp-validate-checks.mjs`). `--keep` leaves `Saved/probe.json` and `Saved/Logs/probe.log`. See the [folder README](../../../examples/unreal/rendering_probes/README.md).

- [tested] Result on 5.8.2: two spawned `DirectionalLight` actors read `forward_shading_priority` 0 and 0; `set_forward_shading_priority(1)` on one gave 1 and 0.
- [tested] `set_editor_property("forward_shading_priority", 2)` stored 2. Assigning the attribute raised a read-only error. The setter with -3 after 2 read back 0, and a Static-mobility component kept 4 after the setter was given 5.
- [tested] `get_console_variable_int_value("r.MegaLights.Allow")` returned 0 and logged `Failed to find console variable`; `r.MegaLights.Allowed` returned 1 and logged nothing.
- [tested] Not reproduced: the renderer's on-screen message, which needs a rendering editor viewport.

## Gameplay Effects in C++ (`examples/unreal/gas_native/`)

Backs [GAS in C++](../../unreal-gameplay/references/unreal-gas-native-effects.md): a small runtime module (attribute set, native tags, a cooldown and a cost effect, an ability) driven headless by a commandlet with no map and no assets.

```text
node examples/unreal/gas_native/gas_native.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler <version>] [--sdk <version>]
```

About one to two minutes to build and 10 to 30 s for the probe; 12 checks (`gas-native-checks.mjs`). See the [folder README](../../../examples/unreal/gas_native/README.md).

- [tested] Result on 5.8.2: 12 of 12 pass. The module builds with `GameplayAbilities`, `GameplayTags` and `GameplayTasks` named, and the effect's constructor leaves one target-tags component that grants the native tag.
- [tested] Activation pays the cost (100 to 90) and sets the cooldown tag; a second activation is refused; the tag is present at 1 s and gone at 2.1 s; it activates again (80); an effect made with `NewObject` at run time takes `AddComponent<UTargetTagsGameplayEffectComponent>()`.
- [tested] The commandlet increments `GFrameCounter` before each `World->Tick`, or `FTimerManager::Tick` returns early and the cooldown never ends.

## Unity builds (`examples/unreal/unity_build/`)

Backs [Unity builds and file-scope names](../../unreal-native/references/unreal-native-unity-builds.md): a three-file module whose files build alone and fail together.

```text
node examples/unreal/unity_build/unity_build.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler <version>] [--sdk <version>]
```

About six minutes: it builds the Editor target 10 times in two throwaway projects (the second is a git repository, so `git` must be on the path); 11 checks (`unity-build-checks.mjs`). See the [folder README](../../../examples/unreal/unity_build/README.md).

- [tested] With the threshold lowered, adaptive unity on, an installed engine and no git repository, all three writable files stay out of the unity file and the clashing sources build.
- [tested] With `-DisableAdaptiveUnity` the files share one unity file and the build fails with `C2374`, `C2086`, `C4459` and `C2872` in `ProbeBeta.cpp`; the old binary is unchanged. `bUseUnity = false`, file-prefixed names and one unity file per source all build.
- [tested] In a git project the clean tree fails; an edited file leaves the chunk and the build passes; committing alone does not regroup; writing the committed file again, as a checkout or rebase does, brings the clash back.
