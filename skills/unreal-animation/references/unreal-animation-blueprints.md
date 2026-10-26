# Animation Blueprints in Unreal 5.8: AnimGraph, state machines, linked layers, notifies, montages and blend spaces

Target: Unreal Engine 5.8, Windows. Epic describes Animation Blueprints as "visual scripts that are used for the creation and control of complex animation behaviors". The AnimGraph defines the Output Pose each frame; the Event Graph runs on the game thread.

## Enable it

Animation Blueprints are part of the engine; no plugin is needed. Plugins:

| Plugin | Default | Flags (descriptor) |
|---|---|---|
| `AnimationWarping` (stride, orientation, slope warping) | off | not beta, not experimental |
| `MotionWarping` | off | beta |
| `PoseSearch`, `BlendStack` | off | not beta, not experimental (see [Motion Matching](unreal-motion-matching.md)) |
| `AnimationBudgetAllocator` | off | not beta, not experimental |
| `ControlRig` | on | see [Control Rig](unreal-control-rig.md) |
| `UAF` (Unreal Animation Framework) | off | experimental |

- The 5.8 release notes call UAF "the new Unreal Animation Framework" and label Animation Mixing in Sequencer Experimental.

## Use it when

- A skeletal mesh needs gameplay-driven animation: locomotion, layering, additive aim, montages.
- Per-weapon or per-state logic should be swapped at runtime: Linked Anim Layers.
- Animation should raise events at set times: Anim Notifies.
- One or two continuous inputs (speed, direction, aim) should blend poses: Blend Spaces.

## Use something else when

- Use [Motion Matching](unreal-motion-matching.md) when poses are searched from animation data instead of wired through state-machine transitions.
- Use [Control Rig](unreal-control-rig.md) for procedural pose edits and IK inside the graph.
- Use [Mover](../../unreal-gameplay/references/unreal-mover.md) for movement; the graph reads its results.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| AnimGraph nodes: Slot, Sequence Player, Blend Space Player, State Machine | Python | `unreal.BlueprintGraphEditor`, `compile_blueprint` (Script it) |
| States, transitions, Blend Space resampling, AnimDynamics, Two Bone IK and other nodes | C++ editor module | [AnimGraph from C++](unreal-animgraph-from-cpp.md); `examples/unreal/anim_bridge/` |
| Create the asset | Python; editor UI | AssetTools `create_asset` (see `examples/unreal/build_scene.py`) with `AnimBlueprintFactory` (`ParentClass`, `TargetSkeleton`, `PreviewSkeletalMesh`, `bTemplate`) or `AnimLayerInterfaceFactory` [tested] |
| Edit sequence and montage data | Python | `unreal.AnimationLibrary` (script name of `UAnimationBlueprintLibrary` in the install): `add_animation_notify_event`, `add_animation_notify_state_event`, `add_animation_notify_track`, `get_montage_slot_names`, curve, sync-marker and root-motion setters |
| Play montages at runtime | Blueprint; C++ | `Montage_Play`, `Montage_Stop`, `Montage_JumpToSection`, `PlaySlotAnimationAsDynamicMontage(Asset, SlotNodeName, ...)` on `AnimInstance` (install header); Epic's Play Montage node |
| Swap linked layers | Blueprint; C++ | Link Anim Class Layers node (Target, In Class); `LinkAnimClassLayers`, `GetLinkedAnimLayerInstanceByGroup` (install header) |
| Custom notifies | Blueprint | parents `AnimNotify`, `AnimNotifyState`; override Received Notify, Begin, End, Tick (Epic) |
| Thread-safe update | Blueprint; C++ | override Blueprint Thread Safe Update Animation; `AnimInstance::BlueprintThreadSafeUpdateAnimation(float)` |
| Optimization settings | project settings; class settings | Project Settings > Anim Blueprints: Allow Multi Threaded Animation Update, Optimize Anim Blueprint Member Variable Access (`Engine.h`); Class Settings > Optimization > Warn About Blueprint Usage (Epic) |

## Script it

- [tested] Python builds a slot-only Animation Blueprint: `AnimBlueprintFactory`, then `BlueprintGraphEditor.get_graph_editor(graph).create_node_from_name("Animation|Montage|Slot'DefaultSlot'", ...)`, `try_create_connection` to the Root pin and `compile_blueprint` (`BS_UP_TO_DATE`, no errors). `list_available_nodes([])` lists other names, such as `Animation|StateMachines|StateMachine` and `Animation|BlendSpaces|BlendspacePlayer`.
- [tested] A `UAnimInstance` subclass whose `UFUNCTION` calls `PlaySlotAnimationAsDynamicMontage` (`AnimInstance.h` line 590) played two clips through that slot in Play-In-Editor; the keyed bone moved 80 cm and returned to rest when the montage ended.
- [tested] Python cannot add states or transitions, and a Blend Space it writes plays the reference pose until C++ resamples it; the bridge, other AnimGraph nodes and foot-planting IK are in [AnimGraph from C++](unreal-animgraph-from-cpp.md).
- [tested] On 5.8.2 the bridge's state machine changes state at runtime and the pose follows it, a resampled 2D Blend Space plays its corner clips and blends the interior, and linked layers swap at runtime (13 of 13 checks; details in [AnimGraph from C++](unreal-animgraph-from-cpp.md)).

## Workflow

Steps for the Event Graph, Property Access, Fast Path, state machines, linked layers, montages, notifies, blend spaces and many characters: [Animation Blueprint workflow](unreal-animation-blueprint-workflow.md).

## Sources

- [Animation Blueprints](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-blueprints-in-unreal-engine)
- [Scripting the Editor using Python](https://dev.epicgames.com/documentation/en-us/unreal-engine/scripting-the-unreal-editor-using-python)
- [Unreal Engine 5.8 release notes](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-5-8-release-notes)
- Plugin descriptors, `AnimInstance.h`, `AnimBlueprintFactory.h`, `AnimationBlueprintLibrary.h`, `BlueprintGraphEditor.h` (`Editor/BlueprintEditorLibrary/Private/BlueprintEditorLibrary/`) and `Engine.h` in the 5.8 install.
