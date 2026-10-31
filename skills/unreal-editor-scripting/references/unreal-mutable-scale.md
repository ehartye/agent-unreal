# Mutable shared skeletons, compile measurements, materials and callbacks

Target: Unreal Engine 5.8, Windows rendering editor. These are the 2026-10-31 [Mutable probe](../../../examples/unreal/mutable/README.md) results, using the unchanged nine-function [graph bridge](unreal-mutable-bridge.md). Run labels below identify retained experiments, not a rerun requirement. All Mutable compiles used a 240 s wall-clock limit through `run_compile`.

## Shared or separate skeletons

- [tested] B-Q1 run 2 (2026-10-31) imported the same body and two hats first on three separate skeleton assets, then on the body's shared skeleton. Both layouts compiled with zero errors/warnings: separate 0.41 s, shared 0.52 s. Each compiled object exposed `Hat` (INT), options `Cap` and `Tall`, and one component.
- [tested] B-Q1 run 2 (2026-10-31) set the Interchange pipeline's `mesh_pipeline.combine_skeletal_meshes_behavior` to `BY_SKELETON`. After importing the body, it supplied that mesh's skeleton through `common_skeletal_meshes_and_animations_properties.skeleton` for both hats. All three shared meshes read back the same body-skeleton asset; the separate imports read back three distinct assets.
- [tested] B-Q1 run 2 (2026-10-31) set each Instance to `Cap`, then `Tall`; selected options read back correctly and `has_any_skeletal_mesh` was true. The fixed-camera frames showed the selected hats; each layout's pair differed by 6,853 pixels. This establishes a small rigid three-bone fixture, not compatibility of arbitrary character rigs or a requirement to share a skeleton.

## Four parameters with six options each

- [tested] B-Q2 run 2 (2026-10-31) built a graph from one body and 24 option parts, using the working separate-skeleton layout. At both optimization levels, readback listed `Choice0` through `Choice3`, each `MutableParameterType.INT`, each with `Option0` through `Option5`. Every section was connected through the bridge's enum/switch pattern.
- [tested] B-Q2 run 2 (2026-10-31) set `CompileParams.optimization_level` to `CustomizableObjectOptimizationLevel.NONE` (0), then `MAXIMUM` (2). Both completed within 240 s, with `compiled:true`, zero errors and zero warnings:

| Level | Wall time to callback observation | Maximum sampled working set | OS lifetime process peak | Outcome |
|---|---:|---:|---:|---|
| NONE (0) | 0.39 s | 3,404.38 MiB | 3,673.55 MiB | Completed |
| MAXIMUM (2) | 0.50 s | 3,406.14 MiB | 3,673.55 MiB | Completed |

- [tested] B-Q2 run 2 (2026-10-31) sampled only the compiling editor's PID with `GetProcessMemoryInfo`, at a one-second interval plus start/end points. Each subsecond compile therefore has two endpoint samples. The sampled maximum can miss an instantaneous peak; the separate lifetime peak includes editor startup and is not attributed to either compile. NONE ran first and MAXIMUM second in the same editor without resetting caches. These are ordered measurements of a small generated fixture, not a general optimization comparison or production-character budget.
- [general] Not established: compile cost for a production graph with substantial meshes, morph targets, child objects, textures or several LODs. The four-by-six fixture was not compiled headless. Runtime working-memory settings do not substitute for editor compile-memory observations; keep the timeout and measure the actual asset.

## Material parameter through the existing bridge

- [tested] B-Q3 run 3 (2026-10-31) added `CustomizableObjectNodeMaterialParameter` with `ParameterName=Finish` and `DefaultValue`/`ReferenceValue` set to the material asset path. Its output `Material` had category `materialAsset`; the bridge linked it to each `CONodeSkeletalMeshSection` input `Material_Input_Pin` of that category. No new bridge function was needed.
- [tested] B-Q3 run 3 (2026-10-31) compiled in 0.50 s with zero errors/warnings and read back `Finish (<MutableParameterType.MATERIAL: 9>)` alongside `Hat (<MutableParameterType.INT: 2>)`, options `Cap,Tall`. The two materials were unlit emissive red/blue with `used_with_skeletal_mesh` enabled. `set_material_parameter_selected_option("Finish", material)` and `get_material_parameter_selected_option("Finish")` agreed on each asset path. After `update_skeletal_mesh_async(True, True)` and a fixed 12 s wait per variant, the generated mesh was present and the character region differed by 23,558 pixels, visibly red then blue.
- [general] Not established: texture-parameter behavior, modifiers or arbitrary material graphs. The specified texture fallback was unnecessary because the material route worked; its implementation is not evidence of a successful native run. The material screenshots used fixed waits, not the separately tested callback below.

## Two components and an Instance callback

- [tested] B-Q4 run 3 (2026-10-31) added two `CONodeComponentSkeletalMesh` nodes with `ReferenceSkeletalMesh` set to the body and distinct `ComponentName` values. Each had its own make/object-make chain; both component outputs linked to the base object's `Components` array. Compilation took 0.39 s with zero errors/warnings. `get_component_count()` returned 2 and `get_component_name(0/1)` returned `Component0` and `Component1`.
- [tested] B-Q4 run 3 (2026-10-31) created an Instance of that compiled object and obtained `inst.get_editor_property("updated_delegate")`. `delegate.add_callable(updated)` bound a Python callback taking the updated Instance. Retaining the Instance, delegate and callable, then calling `inst.update_skeletal_mesh_async(True, True)` and ticking against a 30 s limit produced the callback and `has_any_skeletal_mesh:true`. The exact log event was:

```text
[2026.10.31-22.33.23:967][361]LogPython: [mu_components] UpdatedDelegate callback instance=/Engine/Transient.CustomizableObjectInstance_0
```

- [general] The older probe's absence of `unreal.InstanceUpdateDelegate` does not establish that all callback routes are absent. Use the Instance's reflected delegate observed above; completion of this fixture does not bound update time on a large character.
- [documented] `CONodeSkeletalMeshMake_V2::AllocateDefaultPins` in the installed Mutable editor source creates LOD inputs. Not established: an additional LOD's native behavior; the experiment chose the successful second-component route. The independent callback-baseline fallback was also not run.

## The Internal-header build experiment

- [tested] B-Q3 run 1 (2026-10-31) added `#include "MuCOE/Nodes/CustomizableObjectNode.h"` only to a throwaway copy of the module. UBT exited 6 after 29 s. At `CustomizableObjectNode.h(8,1)` it reported exactly `fatal error C1083: Cannot open include file: 'MuCO/CustomizableObjectPrivate.h': No such file or directory`, followed by `Result: Failed (OtherCompilationError)`. The engine source was unchanged; the delivered bridge still uses reflection rather than this include.

## Evidence boundary

- [tested] B-Q1 run 2, B-Q2 run 2 and B-Q3 run 3 (2026-10-31) completed with separate reports, frames and phase exit 0 before a private process monitor failed between phases. B-Q4 run 3 ran only its prerequisites and components afterward, printing 12/12 checks and exiting 0 with an owned-Job receipt proving zero active members after cleanup. The offline composition of the four original question reports passed 30/30 checks; the interrupted invocation did not print an aggregate score. Earlier competing workloads were preserved and the affected prerequisite runs stopped; no unrelated workload was observed during these successful question phases.
- [general] Not established: packaging, replication, platform memory budgets, the reported Extension Data hang or morph-target/child-object memory problem. Those forum reports remain anecdotal; these small fixtures neither reproduce nor rule them out.
