# Animation Blueprints in Unreal 5.8: AnimGraph, state machines, linked layers, notifies, montages and blend spaces

Target: Unreal Engine 5.8, Windows. Epic describes Animation Blueprints as "visual scripts that are used for the creation and control of complex animation behaviors". The AnimGraph defines the Output Pose for every frame; the single Event Graph runs on the game thread.

## Enable it

Animation Blueprints are part of the engine; no plugin is needed. Related plugins in the 5.8 install:

| Plugin | Default | Flags (descriptor) |
|---|---|---|
| `AnimationWarping` (stride, orientation, slope warping) | off | not beta, not experimental |
| `MotionWarping` | off | beta |
| `PoseSearch`, `BlendStack` | off | not beta, not experimental (see [Motion Matching](unreal-motion-matching.md)) |
| `AnimationBudgetAllocator` | off | not beta, not experimental |
| `ControlRig` | on | see [Control Rig](unreal-control-rig.md) |
| `UAF` (Unreal Animation Framework) | off | experimental |

- The 5.8 release notes call UAF "the new Unreal Animation Framework" and label Animation Mixing in Sequencer Experimental. This reference covers Animation Blueprints only.

## Use it when

- A skeletal mesh needs gameplay-driven animation: locomotion, layering, additive aim, montage-driven actions.
- Per-weapon or per-state logic should be swapped at runtime: Linked Anim Layers.
- Animation should raise events at set times: Anim Notifies.
- One or two continuous inputs (speed, direction, aim) should blend poses: Blend Spaces.

## Use something else when

- Use [Motion Matching](unreal-motion-matching.md) when poses should be searched from animation data instead of wired through state-machine transitions. Epic documents state machines separately.
- Use [Control Rig](unreal-control-rig.md) for procedural pose edits and IK inside the graph.
- Use [Mover](unreal-mover.md) for movement; the Animation Blueprint reads its results.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Author AnimGraph, state machines, transitions | editor UI | Animation Blueprint Editor (no scripted graph editing is claimed here) |
| Create the asset | Python; editor UI | AssetTools `create_asset` (see `examples/unreal/build_scene.py`) with `AnimBlueprintFactory` (`ParentClass`, `TargetSkeleton`, `PreviewSkeletalMesh`, `bTemplate`) or `AnimLayerInterfaceFactory`, declared in the 5.8 install; `EditAnywhere` properties are editor properties (Epic); not run here |
| Edit sequence and montage data | Python | `unreal.AnimationLibrary` (script name of `UAnimationBlueprintLibrary` in the install): `add_animation_notify_event`, `add_animation_notify_state_event`, `add_animation_notify_track`, `get_montage_slot_names`, curve, sync-marker and root-motion setters |
| Play montages at runtime | Blueprint; C++ | `Montage_Play`, `Montage_Stop`, `Montage_JumpToSection`, `PlaySlotAnimationAsDynamicMontage(Asset, SlotNodeName, ...)` on `AnimInstance` (install header); Epic's Play Montage node |
| Swap linked layers | Blueprint; C++ | Link Anim Class Layers node (Target, In Class); `LinkAnimClassLayers`, `GetLinkedAnimLayerInstanceByGroup` (install header) |
| Custom notifies | Blueprint | parents `AnimNotify`, `AnimNotifyState`; override Received Notify, Received Notify Begin, End, Tick (Epic) |
| Thread-safe update | Blueprint; C++ | override Blueprint Thread Safe Update Animation; `AnimInstance::BlueprintThreadSafeUpdateAnimation(float)` |
| Optimization settings | project settings; class settings | Project Settings > Anim Blueprints: Allow Multi Threaded Animation Update, Optimize Anim Blueprint Member Variable Access (`Engine.h`); Class Settings > Optimization > Warn About Blueprint Usage (Epic) |

## Workflow

1. Create the Animation Blueprint from an AnimInstance parent class and a target skeleton.
2. Use the Event Graph as little as possible (Epic): it runs on the game thread. Put update logic in a function that overrides Blueprint Thread Safe Update Animation.
3. Read game-thread data through Property Access, which snapshots it for worker threads. Give custom Property Access functions the Thread Safe property and a pure Return Node whose output is named `ReturnValue`; leave Call Site on Automatic.
4. Keep AnimGraph pins on Fast Path: member variables, negated Boolean members and members of nested structs. Any calculation removes Fast Path. Turn on Warn About Blueprint Usage so the Compiler Results panel lists calls into the Blueprint VM.
5. Parallel update needs `AnimInstance::NeedsImmediateUpdate` to pass; Epic states root motion blocks it because character movement is not multithreaded.
6. State machines: connect the machine to the Output Pose; each state outputs a pose; transitions are one-way, so two-way movement needs one in each direction. Conduits give one-to-many and many-to-one routing; aliases share transition rules. Enable Create Notify Meta Data when transition rules call notify functions. Max Transitions Per Frame = 1 limits the machine to one transition decision per tick.
7. Linked Anim Layers: create an Animation Layer Interface; bind it in Class Settings of the base Blueprint and of every Blueprint that implements it; call Link Anim Class Layers. Layers under one non-default Group name share an instance. Layers load when linked; unloading needs your own streaming logic (Epic).
8. Montages: place animations in slots, name Sections, and route slots through the AnimGraph so separate Slot Groups can drive separate body parts. Do not overlap animations in one slot. Replicate the Play Montage node yourself with an RPC. Montage Notifies need Play Montage, not Play Anim Montage. Montage Tick Type: Queued is asynchronous and cheaper; Branching Point is synchronous and precise.
9. Notifies: Notify fires once; Notify State has begin, tick and end. Skeleton Notifies live on the Skeleton asset, so save it. The 5.8 release notes add an option to not merge notify-state lifetimes.
10. Blend Spaces: set axis range and grid; Smoothing Time and Type set how an axis eases; Wrap Input needs similar animations at both ends; drop the asset in the AnimGraph as a Blend Space player; analysis functions can place samples.
11. For many characters, enable Update Rate Optimizations at 15 Hz or lower at distance, or use the Animation Budget Allocator plugin, which Epic recommends instead.

## Sources

- [Animation Blueprints](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-blueprints-in-unreal-engine)
- [Graphing in Animation Blueprints](https://dev.epicgames.com/documentation/en-us/unreal-engine/graphing-in-animation-blueprints-in-unreal-engine)
- [Animation Optimization](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-optimization-in-unreal-engine)
- [Property Access](https://dev.epicgames.com/documentation/en-us/unreal-engine/property-access-in-unreal-engine)
- [State Machines](https://dev.epicgames.com/documentation/en-us/unreal-engine/state-machines-in-unreal-engine)
- [Animation Blueprint Linking](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-blueprint-linking-in-unreal-engine)
- [Animation Montage](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-montage-in-unreal-engine)
- [Animation Notifies](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-notifies-in-unreal-engine)
- [Blend Spaces](https://dev.epicgames.com/documentation/en-us/unreal-engine/blend-spaces-in-unreal-engine)
- [Scripting the Editor using Python](https://dev.epicgames.com/documentation/en-us/unreal-engine/scripting-the-unreal-editor-using-python)
- [Unreal Engine 5.8 release notes](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-5-8-release-notes)
- Plugin descriptors, `AnimInstance.h`, `AnimBlueprintFactory.h`, `AnimationBlueprintLibrary.h` and `Engine.h` in the 5.8 install.
