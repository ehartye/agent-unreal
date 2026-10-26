# Authoring a StateTree from C++ in Unreal 5.8: build, compile and run a tree from an editor module

Target: Unreal Engine 5.8, Windows. Paths are under `Engine/Plugins/Runtime/`. The tree, its custom nodes and the run are verified by `examples/unreal/statetree_bridge/` (21 checks, all passed on 5.8.3 in one throwaway project; first 13 also on 5.8.2).

## Enable it

- `StateTree` and `GameplayStateTree` in the project descriptor. [documented] Both are off by default (see [AI](unreal-ai-behavior.md)).
- Runtime module dependencies: `StateTreeModule`, `GameplayStateTreeModule`; `AIModule` and `PropertyBindingUtils` arrive as public dependencies of `StateTreeModule` (`StateTree/Source/StateTreeModule/StateTreeModule.Build.cs` lines 75 and 77). [tested] The example's runtime module lists only the first two plus `AIModule` and builds.
- Editor module dependencies: `StateTreeEditorModule`, `StateTreeModule`, `GameplayStateTreeModule`, `UnrealEd`, `AssetTools`, the runtime node module and `PropertyBindingUtils`. [tested] Without `PropertyBindingUtils` the link fails on `FPropertyBindingBindableStructDescriptor::~FPropertyBindingBindableStructDescriptor` (used through `FStateTreeCompilerLogMessage`).

## Use it when

- An agent must produce or change a tree with no person at the editor: states, tasks, conditions and transitions are C++ calls. [tested] The example builds two states, two tasks, an enter condition and a tick transition, then compiles, saves, reloads and runs them.
- A tree must be rebuilt the same way each time, such as in a regenerated project. [general] Code is the source; the asset is its output.

## Use something else when

- A person tunes the tree by hand and dragging states is the task: use the StateTree editor. [general]
- Only the structure must be read: Python reads sub trees, states, tasks, enter conditions and transitions. [tested] `StateTreeEditorData.get_editor_data(tree).sub_trees[0].children[i].tasks` returned the built structure.
- Python cannot author a working tree on 5.8.2. [tested] The factory's `StateTreeSchemaClass` is a plain `UPROPERTY()` (`StateTreeFactory.h` line 30), so Python gets "Failed to find property" and `create_asset` returns `None`; `unreal` has no class for the editing subsystem or compiler log; states have no add functions; `InstancedStruct` has no initializer and a custom task struct is not a Python type. Python can write raw properties (rename a state, append to `children` or `tasks`, clear `sub_trees`); nothing compiles or fills a node with a task. On 5.8.3 the factory schema class, a compile class and state builders were still missing; the component schema and component classes are exposed.
- Use a Behavior Tree, Mass or other layers per [AI](unreal-ai-behavior.md). [general]

## How an agent drives it

| Step | Call | Evidence |
|---|---|---|
| Create the asset | `UStateTreeFactory`, `SetSchemaClass(UStateTreeAIComponentSchema::StaticClass())`, then `IAssetTools::CreateAsset(Name, Path, UStateTree::StaticClass(), Factory)` | [documented] `StateTreeFactory.cpp` lines 134, 135, 141 |
| Find the root | `Cast<UStateTreeEditorData>(Tree->EditorData)->SubTrees[0]`; treat empty `SubTrees` as a failed creation | [documented] `AddRootState()` at line 135 adds "Root" |
| Add states | `UStateTreeState::AddChildState(Name)` | [documented] `StateTreeState.h` line 282 |
| Add a task | `State.AddTask<T>()` returns `TStateTreeEditorNode<T>&`; `.GetInstanceData()` returns the instance struct | [documented] `StateTreeState.h` line 315, `StateTreeEditorNode.h` line 175 |
| Add an enter condition | `State.AddEnterCondition<T>()` | [documented] `StateTreeState.h` line 289 |
| Add a transition | `State.AddTransition(EStateTreeTransitionTrigger::OnTick, EStateTreeTransitionType::GotoState, &Target)`, returns `FStateTreeTransition&` | [documented] `StateTreeState.h` line 337 |
| Add a transition condition | `Transition.AddConditionWithOuter<T>(&State)`; `AddCondition` is deprecated in 5.8 | [documented] `StateTreeState.h` lines 96 and 105 |
| Compile | `UStateTreeEditingSubsystem::CompileStateTree(Tree, Log)` (static, `bool`) | [documented] `StateTreeEditingSubsystem.h` line 37 |
| Read the log | `Log.ToTokenizedMessages()` for the text, `Log.DumpToLog(Tree, Category)` for the log file | [documented] `StateTreeCompilerLog.h` lines 97 and 109 |
| Run it | on an `AAIController` with a `UStateTreeAIComponent`: `SetStartLogicAutomatically(false)` in the constructor, then `SetStateTree(Tree)` and `StartLogic()` | [documented] `StateTreeComponent.h` lines 81, 113 and 54 |

## Recipe

1. Put the task and condition structs and their instance data in a public header of the runtime module, with the module's `_API` macro on every struct, and name the instance struct in `using FInstanceDataType = ...` and in `GetInstanceDataType()`. [tested] The editor module named `FProbeWorkTask` and `FProbeCounterCondition` in `AddTask<T>()` and `AddConditionWithOuter<T>()` from a separate module.
2. Derive tasks from `FStateTreeTaskCommonBase` and conditions from `FStateTreeConditionCommonBase`. [documented] The component schema allows only the `CommonBase` children (`GameplayStateTree/Source/GameplayStateTreeModule/Private/Components/StateTreeComponentSchema.cpp` lines 37 to 44). [tested] On 5.8.3 the read-back agreed: only the AI schema allowed a task from the AI task base; the common-base task, evaluators and global parameters were allowed by both.
3. Declare an object property in category `Context` and the compiler binds it with no manual binding. [documented] `StateTreeCompiler.cpp` lines 3140 to 3170 add the binding; the category string is read in `StateTreeModule/Private/StateTreePropertyBindings.cpp` line 62.
4. Match the Context property type to a schema context object. [documented] `FindContextData` (`StateTreeEditorData.cpp` lines 495 to 507) accepts a context of the property's type or a child of it, and picks the closest name when several match. The AI schema offers `Actor` (a `APawn`) and `AIController` (`StateTreeAIComponentSchema.cpp` lines 24 and 26), so `TObjectPtr<AActor> Actor` binds to the pawn; cast in the node. [tested] Read back on 5.8.3: AI schema `Actor:Pawn` and `AIController:AIController`; component schema `Actor:Actor` only, and the same node structs compiled under it cleanly.
5. When no context object fits, the compile fails. [tested] A `TObjectPtr<UActorComponent> Component` Context property gave `Could not find matching Context object for Context property 'Component'` (`StateTreeCompiler.cpp` line 3177); `compiled` was false, `IsReadyToRun` false and `NeedsRecompile` true. On 5.8.3 the message ends with `Property must have manual binding.` and reached the caller and both log categories.
6. Read the result from `ToTokenizedMessages`. [tested] A failed compile already logs under `LogStateTreeEditor` (`StateTreeCompilerManager.cpp` line 613); `DumpToLog` with your own category added a second copy; success logs `Compile StateTree ... succeeded.` once from the factory and once per call.
7. Save the asset after compiling. [tested] A fresh editor loaded the saved trees (component-schema ones on 5.8.3) ready to run, no recompile, and ran them.
8. Set `SetStartLogicAutomatically(false)` and start the tree yourself in `OnPossess`. [documented] The component starts logic at `BeginPlay` unless the flag is false (`StateTreeComponent.cpp` lines 95 to 101), and `SetStateTree` is refused while the tree runs (line 470). [tested] On 5.8.3 a plain pawn with no AI controller and a `UStateTreeComponent` started in `BeginPlay` ran the component-schema tree.
9. Read the proof from the pawn. [tested] With `-nullrhi` Play-In-Editor: events `started`, `enter:Work`, `exit:Work`, `enter:Done`, the tick counter stopped at 3 and the run status stayed Running; the same tree with an unreachable threshold stayed in Work and kept counting (about 50 ticks per second on 5.8.2, 120.1 on 5.8.3 under both hosts).
10. A tree parameter bound to a node property. [tested] On 5.8.3 under the AI schema, root parameter `Threshold` (Int32 5), bound to a transition condition whose own threshold was 1000000, compiled; read back as `Threshold:EPropertyBagPropertyType::Int32=5`; the transition fired (counter 5, `enter:Done`), so the binding reached the condition. Added through a `const_cast`: the bag has no mutable accessor.

## Not verified

- [general] Not covered by these runs: other schemas, evaluators, global tasks, bindings between two nodes, parameter overrides, a tree hosted by a Behavior Tree or run by Mass, Context properties of other types.

## Sources

- Example: [statetree_bridge README](../../../examples/unreal/statetree_bridge/README.md)
- [StateTree](https://dev.epicgames.com/documentation/en-us/unreal-engine/state-tree-in-unreal-engine), [Quick Start](https://dev.epicgames.com/documentation/en-us/unreal-engine/statetree-quick-start-guide)
- StateTree and GameplayStateTree plugin source in the 5.8.2 install.
