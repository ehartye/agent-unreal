# AI decision-making in Unreal 5.8: StateTree, Behavior Trees, EQS, Perception, Smart Objects and Mass

Target: Unreal Engine 5.8, Windows. Epic's AI page lists StateTree, Behavior Trees, EQS, Perception, Smart Objects and MassEntity side by side without ranking them. StateTree is "a general-purpose hierarchical state machine that combines the Selectors from behavior trees with States and Transitions from state machines" (Epic).

## Enable it

| Plugin | Default | Flags (descriptor) | Depends on |
|---|---|---|---|
| `StateTree` | off | not beta, not experimental | PropertyBindingUtils, PropertyAccessEditor |
| `GameplayStateTree` | off | not beta, not experimental | StateTree |
| `SmartObjects` | off | not beta, not experimental | GameplayAbilities, TargetingSystem, WorldConditions |
| `GameplayBehaviorSmartObjects`, `GameplayInteractions` | off | experimental | SmartObjects (and StateTree for interactions) |
| `EnvironmentQueryEditor` | on | uncooked-only module | AISupport |
| `MassGameplay`, `MassAI`, `MassCrowd`, `ZoneGraph` | off | experimental | StateTree, SmartObjects, ZoneGraph |

- Behavior Trees, AI Controllers and AI Perception (AIModule), and MassEntity and MassCore, are engine modules, not plugins.
- Epic's quick start: Settings > Plugins, enable `GameplayStateTree` and `StateTree`, restart. EQS: enable "Environment Query Editor" if it is off.

## Use it when

- StateTree: states with transitions, where selection runs on demand and tasks in an active state run concurrently. The 5.8 release notes add a starting state, a Compiler Manager and out-of-date tracking.
- Behavior Tree: Blackboard-driven decisions with Decorators and Services. Epic: event-driven "to avoid doing unnecessary work every frame".
- EQS: pick the best location or Actor from candidates; run it from a Behavior Tree task.
- AI Perception: sight, hearing, damage, touch, team and prediction senses on an AIController.
- Smart Objects: level activities that agents claim through a reservation system.
- Mass: the descriptor calls MassGameplay "large-scale agent simulation based on MassEntity"; Mass attaches StateTrees to entities.

## Use something else when

- Epic's pages give no rule for StateTree versus Behavior Tree. The documented difference: StateTree commits a selection and re-selects on transitions; Behavior Trees keep executing selection logic. Use one per character. A Behavior Tree can host a StateTree through `BTTask_RunStateTree`, and Mass runs StateTrees.
- Use [Navigation](unreal-navigation.md) for pathing and [Mover](unreal-mover.md) for how the pawn moves.
- Use [Gameplay Ability System](unreal-gameplay-ability-system.md) for abilities, attributes and effects.
- The Mass plugins are experimental; the core modules run without them.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Create a StateTree asset | editor UI; C++ editor module | Content Browser > Artificial Intelligence > StateTree, pick the schema; or `UStateTreeFactory::SetSchemaClass` then AssetTools `CreateAsset`. Python `create_asset` with `unreal.StateTreeFactory` returns `None` because the schema cannot be set [tested] |
| Read tree structure | Python | `unreal.StateTreeEditorData.get_editor_data`, `sub_trees`, `evaluators`, `global_tasks`, `root_parameters`; `unreal.StateTreeState` (`children`, `tasks`, `transitions`, `enter_conditions`); all named in the Python API surface |
| Author states and bindings | C++ editor module; editor UI | An editor module builds and compiles a tree (`AddChildState`, `AddTask<T>`, `AddTransition`, `CompileStateTree`), and a Context property binds on its own [tested]: [StateTree authoring](unreal-statetree-authoring.md). Python cannot compile or fill a node; otherwise the StateTree editor |
| Custom task, evaluator, condition | Blueprint | parents `StateTreeTaskBlueprintBase`, `StateTreeEvaluatorBlueprintBase`, `StateTreeConditionBlueprintBase` (Epic) |
| Run a tree | Blueprint; Python | Run State Tree node; `unreal.GameplayStateTreeLibrary.run_state_tree`; components `StateTreeComponent`, `StateTreeAIComponent` (`get_state_tree_run_status`, `is_running`) |
| Behavior Tree | editor UI; Blueprint; C++ | Blackboard and Behavior Tree assets; AIController Event On Possess > Run Behavior Tree (Epic); `AAIController::RunBehaviorTree` in the 5.8 install |
| Run EQS | editor UI; C++ | Run EQS Query task (Query Template, result Blackboard key); `UEnvQueryManager::RunEQSQuery` in the 5.8 install |
| Perception | Blueprint; C++ | AI Perception Component on the AIController; team affiliation is C++ only (Epic) |
| Smart Objects | editor UI; Blueprint; C++ | SmartObjectDefinition asset, Smart Object Component on an Actor; subsystem Find, Claim, Use, Release. In code: [Smart Objects from C++](unreal-smart-objects-native.md) |
| Mass | editor UI; C++ | MassSpawner Actor, Mass Entity Definition Asset; fragments and processors are native types. No plugin: [native Mass](unreal-mass-native.md) |
| Debug | editor UI | Window > Debugger (StateTree trace recorder, breakpoints); Gameplay Debugger (apostrophe) |
| Project settings and cvars | settings; console | Project Settings > Engine > AI System > Forget Stale Actors; `StateTree.Compiler.EnableQueuedCompilationOnAssetLoad` and `...WhenAssetDirty` (release notes, default off) |

The Python class-surface dump covered StateTree only; no Python names are claimed for the other systems.

## Workflow

The ten steps (choose the layer, enable and create the asset, build states, bindings, compile, then the Behavior Tree, EQS, Perception and Smart Object paths) are in [AI workflow](unreal-ai-behavior-workflow.md).

## Sources

- [Artificial Intelligence in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/artificial-intelligence-in-unreal-engine)
- [StateTree](https://dev.epicgames.com/documentation/en-us/unreal-engine/state-tree-in-unreal-engine), [Overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-state-tree-in-unreal-engine), [Quick Start](https://dev.epicgames.com/documentation/en-us/unreal-engine/statetree-quick-start-guide), [External StateTree](https://dev.epicgames.com/documentation/en-us/unreal-engine/external-statetree-quick-start-guide), [Debugger](https://dev.epicgames.com/documentation/en-us/unreal-engine/statetree-debugger-quick-start-guide), [Run State Tree](https://dev.epicgames.com/documentation/en-us/unreal-engine/BlueprintAPI/AI/RunStateTree)
- [Behavior Tree overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/behavior-tree-in-unreal-engine---overview), [Quick Start](https://dev.epicgames.com/documentation/en-us/unreal-engine/behavior-tree-in-unreal-engine---quick-start-guide)
- [EQS](https://dev.epicgames.com/documentation/en-us/unreal-engine/environment-query-system-in-unreal-engine), [EQS user guide](https://dev.epicgames.com/documentation/en-us/unreal-engine/environment-query-system-user-guide-in-unreal-engine)
- [AI Perception](https://dev.epicgames.com/documentation/en-us/unreal-engine/ai-perception-in-unreal-engine)
- [Smart Objects overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/smart-objects-in-unreal-engine---overview)
- [MassEntity overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-mass-entity-in-unreal-engine), [MassGameplay overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-mass-gameplay-in-unreal-engine)
- [Unreal Engine 5.8 release notes](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-5-8-release-notes)
- Plugin descriptors, AIModule headers in the 5.8 install, and the editor Python class surface.
