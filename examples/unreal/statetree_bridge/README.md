# Building, compiling and running a StateTree from C++

Backs [StateTree authoring from C++](../../../skills/unreal-gameplay/references/unreal-statetree-authoring.md). Unreal Engine 5.8.4, Windows, Visual Studio 2022 Build Tools (the first 13 checks below also ran on 5.8.2).

The question: can an agent author a StateTree with no person at the editor, and does the compiled tree run? An editor module builds a small tree, compiles it and returns the compiler messages; a fresh editor session loads the saved tree and runs it on a pawn with an AI controller in Play-In-Editor.

## The tree

```text
Root
  Work   task "Work" (counts ticks on the pawn)    transition OnTick -> Done when WorkTicks >= MinTicks
  Done   enter condition WorkTicks >= MinTicks     task "Done" (does not count ticks)
```

`ST_Probe` uses `MinTicks` 3. `ST_Gated` is the same tree with `MinTicks` 1000000, a control that must stay in Work. `ST_Broken` adds a task whose Context property no schema context object can satisfy, so the compile fails and the messages come back.

## Files

- `module/StateTreeNodes/` (runtime module): `Public/StateTreeProbeNodes.h` holds the task, the condition and their instance data, each with `STATETREENODES_API`; `Public/StateTreeProbeActors.h` holds `AStateTreeProbePawn` (the tick counter and event list Python reads) and `AStateTreeProbeController` (owns a `UStateTreeAIComponent`, `SetStartLogicAutomatically(false)`, then `SetStateTree` and `StartLogic` in `OnPossess`). Context properties are `TObjectPtr<AActor> Actor`, which the compiler binds to the controlled pawn by itself.
- `module/StateTreeBridge/` (editor module): `UStateTreeBridgeLibrary` with `CreateTree` (factory with the AI component schema or the component schema, states, tasks, enter condition, transition with `AddConditionWithOuter`), `CompileTree` (`CompileStateTree`, then `ToTokenizedMessages` and `DumpToLog`), `IsReadyToRun` and `NeedsRecompile`.
- `statetree_bridge.mjs` writes a throwaway project in the OS temp folder (`../native-build.mjs`), builds the Editor target and starts the editor twice with `statetree_probe.py`: session `build` creates, compiles, reads back and saves the trees and probes what Python reaches; session `run` is a fresh editor that loads the saved trees and plays them.
- `statetree-bridge-checks.mjs` judges the reports; `statetree-bridge.test.mjs` tests that logic with no Unreal (it runs in `node scripts/check.mjs`).

## Run

```text
node examples/unreal/statetree_bridge/statetree_bridge.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
```

About 70 s to build, 25 to 75 s for the build session and 30 s for the run session. The editors start hidden with `-nullrhi`.

## What it checks (21 checks, all passed on 5.8.4 in one throwaway project; the first 13 also on 5.8.2)

- Both modules compile. The factory makes a tree whose single sub tree is `Root`; the builder adds the states, tasks, enter condition and transition.
- `ST_Probe` and `ST_Gated` compile with no messages and report ready to run and no recompile needed. `ST_Broken` fails with `Could not find matching Context object for Context property 'Component'`; the message comes back to the caller and the log has it under `LogStateTreeEditor` (the engine dumps it on failure) and under the caller's own category.
- Python reads the built structure. It cannot set the factory's schema (`Failed to find property 'state_tree_schema_class'`), so `create_asset` returns `None`; states have no add functions; there is no compile class in `unreal`. It can write raw properties (rename a state, append a state to `children`, append an empty node to `tasks`, clear `sub_trees`); `InstancedStruct` has no initializer and the custom task struct is not a Python type.
- A fresh session loads the saved trees ready to run. On the probe pawn the events are `started`, `enter:Work`, `exit:Work`, `enter:Done`; the counter stops at 3 and the run status stays Running. On the gated pawn the events stay `started`, `enter:Work` while the counter keeps rising (about 50 per second on 5.8.2).
- The play session logs no StateTree warnings or errors.
- The 8 more checks (rows S1 and S2) are in the next section; on 5.8.4 the 13 above passed again.

## Component schema and a tree parameter (rows S1 and S2, run on 5.8.4)

Both rows reuse the two editor sessions of the command above; they add trees and pawns, no new command. The expectations came from reading the engine source (GameplayStateTree `StateTreeComponentSchema.cpp`, `StateTreeComponent.cpp`; StateTree editor `StateTreeEditorData.h`, `StateTreeCompiler.cpp`) before the run. The report keys, the checks and their canned test reports are in `statetree_probe.py`, `statetree-bridge-checks.mjs` and `statetree-bridge.test.mjs`.

- **S1, the component schema on a plain pawn.** `StateTreeBridgeLibrary.create_tree` takes `bComponentSchema`. `ST_Comp_Probe`, `ST_Comp_Gated` and `ST_Comp_Broken` repeat the three trees under `UStateTreeComponentSchema`. `AStateTreeComponentProbePawn` (runtime module) has no AI controller (`AutoPossessAI` disabled), owns a `UStateTreeComponent` with `SetStartLogicAutomatically(false)`, and calls `SetStateTree` and `StartLogic` in `BeginPlay`. The existing task and condition structs are reused unchanged, with the Context property `TObjectPtr<AActor> Actor`. `DescribeTree` reads the schema class, its context objects and what it allows.
- **S2, a tree parameter bound to a condition.** `ST_Param` has an integer root parameter `Threshold` (5), added to the editor data's parameter bag, and a transition condition that keeps its own `MinTicks` of 1000000 with a binding from the parameter (`AddPropertyBinding`, source path the root parameters guid and `Threshold`, target path the condition node id and `MinTicks`). The transition can fire only through the binding. No private header is used; the parameter bag has no mutable accessor, so the code adds to it through a `const_cast`, as the engine's own tests do.

What the run showed on 5.8.4 (8 more checks, 21 in all):

- The component trees build, compile with no messages and read back the component schema. The same node structs, with the Context property `TObjectPtr<AActor> Actor`, compiled under it.
- The schemas' context objects as read back: component `Actor:Actor` only; AI `Actor:Pawn` and `AIController:AIController`. A task derived from the AI task base is allowed by the AI schema and not by the component schema; the probe task (a common-base struct), evaluators and global parameters are allowed by both.
- The broken control fails to compile under the component schema with `Could not find matching Context object for Context property 'Component' on 'Task 'Root/Work/Probe Needs Component''. Property must have manual binding.`; the message reached the caller, the engine's log category and the caller's.
- The saved component trees reload in a fresh editor ready to run. On the component pawn (controller null, component class `StateTreeComponent`) the events are `started`, `enter:Work`, `exit:Work`, `enter:Done`, the counter stops at 3 and the run status is Running; the gated tree stays in Work and its counter kept rising (944 to 1125 over the sample).
- `ST_Param` compiled under the AI schema with the parameter read back as `Threshold:EPropertyBagPropertyType::Int32=5`; the transition fired (events `started`, `enter:Work`, `exit:Work`, `enter:Done`, counter 5), so the binding reached the condition although the condition's own threshold was 1000000. It saved and reloaded ready.

Observed, not asserted (3 observations): both hosts counted at 119.8 ticks per second in one rerun and at 60 in another (the first run counted 120.1; the 5.8.2 run counted about 50 on the AI host); Python exposes `StateTreeComponentSchema` and `StateTreeComponent` as classes, and still cannot set the factory schema class and exposes no compile class and no state builders; `ST_Param` stopped at counter 5.

Not covered by the run: evaluators, global tasks, a binding between two nodes (only a parameter-to-node binding), parameters overridden on a component or a linked state, a tree hosted by a Behavior Tree or run by Mass, a Context property of a type other than Actor.

## Not verified

Not covered by these runs: schemas other than the AI and component ones, evaluators, global tasks, bindings between two nodes, parameter overrides, a tree hosted by a Behavior Tree or run by Mass.
