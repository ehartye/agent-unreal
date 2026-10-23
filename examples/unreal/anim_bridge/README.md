# Animation Blueprints from Python, and the C++ bridge for the rest

Backs [Animation Blueprints](../../../skills/unreal-features/references/unreal-animation-blueprints.md) and the second example in [Bridging editor Python to C++](../../../skills/unreal-features/references/unreal-python-cpp-bridge.md). Unreal Engine 5.8.2, Windows, Visual Studio 2022 Build Tools.

The question: how much of an Animation Blueprint can an agent script, and what needs a small editor module? The run answers it with an engine skeleton (`/Engine/EngineMeshes/SkeletalCube`, bones `Bone01` and `Bone02`), two generated animation clips and a Play-In-Editor session that reads a bone back.

## What Python reaches and what it does not

| Part of the graph | From Python alone on 5.8.2 | Needs C++ |
|---|---|---|
| Animation Blueprint asset | `AnimBlueprintFactory` with `target_skeleton` and `parent_class` through `AssetTools.create_asset` | no |
| Slot, Sequence Player, Blend Space Player and State Machine nodes | `BlueprintGraphEditor.get_graph_editor(graph).create_node_from_name("Animation\|Montage\|Slot'DefaultSlot'", Vector2D, [])`; pins linked with `try_create_connection`; `BlueprintEditorLibrary.compile_blueprint` | no |
| States and transitions in a State Machine | the node and its empty graph exist; the graph's `Nodes` property is protected, its action list holds two comment actions, and `new_object(AnimStateNode)` makes an object that is not in the graph | `AddState`, `AddTransition` |
| Blend Space data | `blend_parameters` and `sample_data` write and read back, and survive save and reload (play length 1 s) | `ResampleBlendSpace` builds the runtime data the player evaluates |
| Playing a clip through a slot | not needed | `USlotClipAnimInstance::PlayClip` (a `UFUNCTION`, so Python calls it on the running instance) |

`BlueprintGraphEditor` is declared in `Engine/Source/Editor/BlueprintEditorLibrary/Private/BlueprintEditorLibrary/BlueprintGraphEditor.h` (`ListAvailableNodes` line 108, `CreateNodeFromName` line 120). The node name is the category and menu name with spaces removed; the Slot node's menu name carries its default slot name, `DefaultSlot`.

## Files

- `module/AnimBridge/` (editor module): `UAnimBridgeLibrary` with `AddSlotToAnimBlueprint` (the C++ equivalent of the Python slot route, kept as a comparison), `AddState`, `AddTransition`, `ResampleBlendSpace` and `DescribeAnimGraph`. Engine headers it uses: `AnimGraphNode_Slot.h`, `AnimGraphNode_Root.h`, `AnimStateNode.h`, `AnimationStateMachineSchema.h` (`FEdGraphSchemaAction_NewStateNode`, line 20), `Animation/BlendSpace.h` (`ValidateSampleData` line 614, `ResampleData` line 660).
- `module/SlotClip/` (runtime module): `USlotClipAnimInstance`, a parent class whose `PlayClip` calls `PlaySlotAnimationAsDynamicMontage` (`AnimInstance.h`, line 590).
- `anim_bridge.mjs` writes a throwaway project in the OS temp folder (`../native-build.mjs`), builds the Editor target and starts the editor twice with `anim_probe.py`: session `build` probes the Python reach, makes the clips, builds the Animation Blueprints and plays the slot ones; session `blend` is a fresh editor that loads the saved Blend Space Animation Blueprints and plays them.
- `anim_probe.py` is the editor script. Clips A and B key the last bone along +X and +Y over one second (30 fps) with `AnimDataController`; it reads `get_socket_transform(bone, RTS_COMPONENT)`. Components use `visibility_based_anim_tick_option = ALWAYS_TICK_POSE_AND_REFRESH_BONES` so a session with no renderer still ticks the pose. The Slate tick guards against re-entry, because long steps run nested ticks.
- `anim-bridge-checks.mjs` judges the reports; `anim-bridge.test.mjs` tests that logic with no Unreal (it runs in `node scripts/check.mjs`).

## Run

```text
node examples/unreal/anim_bridge/anim_bridge.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
```

About 50 s to build and 30 to 40 s per editor session. The editors start hidden with `-nullrhi`.

## What it checks (22 checks, all passed on 5.8.2)

- Both modules compile. The classes, `BlueprintGraphEditor` and the state classes are visible in Python. `AnimationGraph.Nodes` is protected for read and write (`Property 'Nodes' ... is protected and cannot be read`).
- A state machine graph offers no state or transition; `new_object(AnimStateNode)` leaves the graph empty.
- The Python-made and the bridge-made slot Animation Blueprints compile with status `BS_UP_TO_DATE` and no errors or warnings. In Play-In-Editor each plays clip A and clip B through `DefaultSlot`: the montage is `/Engine/Transient.AnimMontage_n`, its position rises, the bone moves 80 to 100 cm (clip A and clip B) along different axes, and returns to the rest position when the montage stops. Both routes give the same pose.
- The bridge builds `Idle` and `Walk` states and a transition, linked from the Entry node. The compiler warns `Idle to Walk will never be taken, please connect something to Can Enter Transition`, as it does in the editor.
- A Blend Space written from Python has two samples and a 1 s play length after save, but its player holds the reference pose (0.00 cm of motion over 12 samples). After `ResampleBlendSpace` the same asset blends the clips at X = 0.5: the bone moves up to 47 cm, by equal amounts along both clip axes. A Sequence Player node made from Python plays its clip, as a control.

## Not verified

A state machine played at runtime (the states here have no content and the transition has no rule), 2D Blend Spaces, linked layers, and montage slot groups other than the default.
