# Control Rig, RigVM, IK Rig and Full Body IK in Unreal 5.8: when to use them and how to drive them

Target: Unreal Engine 5.8, Windows. Control Rig is a framework for animation driven by user controls (plugin descriptor), built on the RigVM visual-programming runtime. IK Rig is a goal-and-solver IK asset. Full Body IK (FBIK) is a multi-goal solver in both.

## Enable it

| Plugin | Category | Default | Flags | Depends on |
|---|---|---|---|---|
| `ControlRig` | Animation | on | not beta; runtime | RigVM, LevelSequenceEditor, PropertyAccessEditor, SequencerScripting, TweeningUtils |
| `RigVM` | Misc | on | not beta; runtime | GameplayInsights, Scribble, PythonScriptPlugin |
| `IKRig` | Animation | on | not beta; runtime | ControlRig, FullBodyIK |
| `FullBodyIK` | Other | off | not beta, not experimental; runtime | ControlRig |
| `ControlRigModules` | Animation | on | beta | ControlRig, ControlRigSpline, RigVM, ControlRigPhysics, PhysicsControl, FullBodyIK |
| `ControlRigSpline` | Animation | on | beta; runtime | ControlRig, RigVM |
| `ControlRigPhysics` | Animation | on | beta | ControlRig, PhysicsControl |

- Enable in Edit > Plugins, then restart, or add `{ "Name": "FullBodyIK", "Enabled": true }` to the `Plugins` array of the `.uproject`.
- Epic's FBIK page asks to enable FullBodyIK for the Control Rig FBIK node. IKRig and ControlRigModules list it as a dependency.
- Epic labels Modular Control Rigs Experimental. The Control Rig Modules plugin is optional and supplies ready-made modules.

## Use it when

- Control Rig: you want custom controls on a skeletal mesh, keyed in Sequencer, without a DCC tool.
- Control Rig in an Animation Blueprint: gameplay should adjust a pose procedurally (ground alignment, contact points).
- Control Rig Component: a gameplay Blueprint should drive a rig, or a rig control should drive a non-skeletal component such as a camera.
- Spline rigging: a long chain (tail, tentacle, spine, snake) needs few controls; splines need four or more points.
- ControlRigPhysics: a rig needs simulated bodies, joints, physics controls and solvers (nodes such as Spawn Physics Body, Set Physics Solver External Velocity for wind).
- IK Rig: a limb or the whole body must reach goals (hands, feet, pelvis) at runtime, or you need retarget chains.

## Use something else when

- Use IK Rig, not a hand-built Control Rig graph, for goal-driven limb, pole and body-mover IK and for retargeting. IK Rigs are skeleton agnostic and shareable across similar skeletons.
- Use the Limb IK solver for single arms and legs (cheaper). Use the FBIK solver when several goals should move the whole body.
- Use the Control Rig FBIK node for a procedural adjustment inside a rig.
- Use [unreal-hair-strands.md](unreal-hair-strands.md) for hair simulation and [unreal-chaos-cloth-and-flesh.md](unreal-chaos-cloth-and-flesh.md) for cloth.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Create a rig from a mesh | Python (load module first) | `unreal.load_module('ControlRigDeveloper')`; `unreal.ControlRigBlueprintFactory.create_control_rig_from_skeletal_mesh_or_skeleton`, `.create_new_control_rig_asset` |
| Add hierarchy elements (Bone, Control, Null, Curve) | Python | `unreal.ControlRigBlueprintLibrary.get_hierarchy_controller` |
| Build the graph | Python | `unreal.ControlRigBlueprint.get_controller()` returns `unreal.RigVMController`: `add_unit_node`, `add_unit_node_from_struct_path`, `add_link`; `add_member_variable` on the blueprint |
| Compile; list units | Python | `ControlRigBlueprintLibrary.recompile_vm`, `.recompile_vm_if_required`, `.get_available_rig_units` |
| Animate in Sequencer, bake, constrain | Python | `unreal.ControlRigSequencerLibrary`: `find_or_create_control_rig_track`, `bake_to_control_rig`, `batch_set_control_transforms`, `add_constraint`, `export_anim_sequence_from_sequencer` |
| Run a rig in an Animation Blueprint | Editor UI (Anim Graph: Misc > Control Rig); Blueprint | `unreal.AnimNodeControlRigLibrary.set_control_rig_class`; node classes `unreal.AnimGraphNode_ControlRig`, `unreal.AnimNode_ControlRig` |
| Drive a rig from gameplay | Blueprint / Python | `unreal.ControlRigComponent`: `add_mapped_skeletal_mesh`, `add_mapped_elements` |
| Spline nodes | Python graph building | `unreal.RigUnit_ControlRigSplineFromPoints` |
| Physics and FBIK nodes | C++ structs (`FRigUnit_*`); add to a graph with `add_unit_node_from_struct_path` | no `unreal.RigUnit_*` class for them in the Python surface |
| Modular rigs | Editor UI (Visual Rigging); Epic documents `modular_rig_model` and `get_modular_rig_controller()` on the rig blueprint | no `unreal.` class in the Python surface |
| Create an IK Rig | Python | `unreal.IKRigDefinitionFactory.create_new_ik_rig_asset`; `unreal.IKRigController` |
| Solvers, goals, links | Python | `add_solver`, `add_new_goal`, `connect_goal_to_solver`, `apply_auto_fbik`, `apply_auto_generated_retarget_definition`, `add_retarget_chain`; solver classes `unreal.IKRigLimbSolver`, `IKRigPoleSolver`, `IKRigSetTransform`, `IKRigBodyMoverSolver`, `IKRigFullBodyIKSolver` |
| FBIK per-bone and goal settings | Python | `unreal.IKRigFBIKController`  |
| Run an IK Rig in an Animation Blueprint | Editor UI (IK Rig node, goals set to Manual Input) | `unreal.AnimGraphNode_IKRig`, `unreal.AnimNode_IKRig` |
| Author an IK Retargeter asset | Editor UI; no Python class | retarget chains come from `IKRigController` |

## Workflow

1. Control Rig: right-click the skeletal mesh > Create > Control Rig (saved with a `_CtrlRig` suffix) and open it.
2. In Rig Hierarchy add a New Control (suffix `_ctrl`). Build the control hierarchy beside the skeleton by unparenting controls (Shift+P).
3. In Rig Graph wire Get Control into Set Bone from Forwards Solve, then Compile. Forwards Solve drives the skeleton from controls. Add a Backwards Solve node so Sequencer's Bake To Control Rig works.
4. Animate: drag the asset into the level, key controls in Sequencer.
5. At runtime: add the Control Rig node in the Anim Graph, connect Source to the result pose, choose the Control Rig Class. Expose controls with Use Pin.
6. FBIK in Control Rig: Hierarchy > Full Body IK from Forwards Solve, set Root (hips or pelvis), one effector per control, Bone Settings only where needed. Exclude bones rather than locking them with full stiffness.
7. IK Rig: create the asset, add solvers, create goals on end bones, connect each goal to a solver, set each Limb IK root bone. Solvers run in stack order: Set Transform first, Pole Solver last, Body Mover paired with other solvers.

## Sources

- [Control Rig in Unreal Engine](https://dev.epicgames.com/documentation/unreal-engine/control-rig-in-unreal-engine)
- [Control Rig quick start](https://dev.epicgames.com/documentation/unreal-engine/how-to-create-control-rigs-in-unreal-engine)
- [Solve directions](https://dev.epicgames.com/documentation/unreal-engine/control-rig-forwards-solve-and-backwards-solve-in-unreal-engine)
- [Control Rig in Animation Blueprints](https://dev.epicgames.com/documentation/unreal-engine/control-rig-in-animation-blueprints-in-unreal-engine)
- [Control Rig Component](https://dev.epicgames.com/documentation/unreal-engine/control-rig-in-blueprints-in-unreal-engine)
- [Modular Control Rigs](https://dev.epicgames.com/documentation/en-us/unreal-engine/modular-control-rigs-in-unreal-engine)
- [Spline rigging](https://dev.epicgames.com/documentation/unreal-engine/control-rig-spline-rigging-in-unreal-engine)
- [Control Rig Full-Body IK](https://dev.epicgames.com/documentation/unreal-engine/control-rig-full-body-ik-in-unreal-engine)
- [Control Rig Python scripting](https://dev.epicgames.com/documentation/unreal-engine/control-rig-python-scripting-in-unreal-engine)
- [Python for animating with Control Rig](https://dev.epicgames.com/documentation/unreal-engine/python-scripting-for-animating-with-control-rig-in-unreal-engine)
- [ControlRigPhysics API module](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/ControlRigPhysics)
- [IK Rig](https://dev.epicgames.com/documentation/en-us/unreal-engine/ik-rig-in-unreal-engine)
- [IK Rig solvers](https://dev.epicgames.com/documentation/unreal-engine/ik-rig-solvers-in-unreal-engine)
- [Python for IK Rigs](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-python-to-create-and-edit-ik-rigs-in-unreal-engine)
- Engine plugin descriptors (`.uplugin`) and the editor Python module surface for the `unreal.` names.
