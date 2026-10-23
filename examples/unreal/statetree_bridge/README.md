# Building, compiling and running a StateTree from C++

Backs [StateTree authoring from C++](../../../skills/unreal-gameplay/references/unreal-statetree-authoring.md). Unreal Engine 5.8.2, Windows, Visual Studio 2022 Build Tools.

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
- `module/StateTreeBridge/` (editor module): `UStateTreeBridgeLibrary` with `CreateTree` (factory with the AI component schema, states, tasks, enter condition, transition with `AddConditionWithOuter`), `CompileTree` (`CompileStateTree`, then `ToTokenizedMessages` and `DumpToLog`), `IsReadyToRun` and `NeedsRecompile`.
- `statetree_bridge.mjs` writes a throwaway project in the OS temp folder (`../native-build.mjs`), builds the Editor target and starts the editor twice with `statetree_probe.py`: session `build` creates, compiles, reads back and saves the trees and probes what Python reaches; session `run` is a fresh editor that loads the saved trees and plays them.
- `statetree-bridge-checks.mjs` judges the reports; `statetree-bridge.test.mjs` tests that logic with no Unreal (it runs in `node scripts/check.mjs`).

## Run

```text
node examples/unreal/statetree_bridge/statetree_bridge.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
```

About 70 s to build, 25 to 75 s for the build session and 30 s for the run session. The editors start hidden with `-nullrhi`.

## What it checks (13 checks, all passed on 5.8.2)

- Both modules compile. The factory makes a tree whose single sub tree is `Root`; the builder adds the states, tasks, enter condition and transition.
- `ST_Probe` and `ST_Gated` compile with no messages and report ready to run and no recompile needed. `ST_Broken` fails with `Could not find matching Context object for Context property 'Component'`; the message comes back to the caller and the log has it under `LogStateTreeEditor` (the engine dumps it on failure) and under the caller's own category.
- Python reads the built structure. It cannot set the factory's schema (`Failed to find property 'state_tree_schema_class'`), so `create_asset` returns `None`; states have no add functions; there is no compile class in `unreal`. It can write raw properties (rename a state, append a state to `children`, append an empty node to `tasks`, clear `sub_trees`); `InstancedStruct` has no initializer and the custom task struct is not a Python type.
- A fresh session loads the saved trees ready to run. On the probe pawn the events are `started`, `enter:Work`, `exit:Work`, `enter:Done`; the counter stops at 3 and the run status stays Running. On the gated pawn the events stay `started`, `enter:Work` while the counter keeps rising (about 50 per second).
- The play session logs no StateTree warnings or errors.

## Not verified

Other schemas, tree parameters, evaluators, global tasks, bindings between two nodes, a tree hosted by a Behavior Tree or run by Mass.
