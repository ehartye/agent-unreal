# AnimGraph nodes from C++ in Unreal 5.8: the editor bridge, AnimDynamics on a bone chain and Two Bone IK

Target: Unreal Engine 5.8, Windows. Python places the Slot, Sequence Player, Blend Space Player and State Machine nodes ([Animation Blueprints](unreal-animation-blueprints.md)). Every other AnimGraph node, and the states and transitions inside a state machine, needs a small editor C++ module. Names and signatures below were read in the 5.8 install; `[general]` behaviour was observed once in a consuming native C++ project on an earlier engine build and has not been run from this repo.

## Use it when

- [tested] States, transitions or Blend Space resampling must be scripted: the bridge in `examples/unreal/anim_bridge/` does it.
- [general] A skeletal-control node (AnimDynamics for secondary motion on a bone chain, Two Bone IK for foot planting) must be added and filled by code.

## The bridge

- [tested] Python cannot add states or transitions: `AnimationGraph.Nodes` is protected and a state machine graph offers only comment actions. The bridge's `AddState` and `AddTransition` built them.
- [tested] Python writes a Blend Space (`blend_parameters`, `sample_data`), but the player holds the reference pose until C++ `ResampleData` runs (`BlendSpace.h` line 660); the bridge's `ResampleBlendSpace` fixes it.
- [tested] Add a node with `FGraphNodeCreator<UAnimGraphNode_Slot>` on the animation graph (`Engine/Source/Runtime/Engine/Classes/EdGraph/EdGraph.h`): `CreateNode()`, set members of the node's `Node` struct, `Finalize()`, connect pose pins with the graph schema's `TryCreateConnection`, then `FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified` and `FKismetEditorUtilities::CompileBlueprint`. The editor module lists `AnimGraph` and `AnimGraphRuntime` as dependencies.
- [tested] A played state machine: `AddState`, `SetStateSequence` (a Sequence Player in a state's graph) and `AddTransitionOnVariable` (a Boolean-variable rule on each transition) build Idle and Walk with no node errors. At runtime the state name reads Idle, Walk, Idle, and the bone pose follows the state.
- [tested] A 2D Blend Space: written from Python and resampled by `ResampleBlendSpace`, it plays one clip at each corner sample and blends all three clips at an interior point.
- [tested] Linked layers: an interface with one layer, a host and a guest that implement it, and a Linked Anim Layer node in the host build and compile clean. At runtime the host swaps to the guest's layer after `LinkAnimClassLayers` and back to its own after `LinkAnimClassLayers` with no class. Not run: a guest on a separate skeleton, and montage slot groups other than the default.
- Details: [anim_bridge README](../../../examples/unreal/anim_bridge/README.md) (the runtime phase is `anim_runtime.mjs`; 13 of 13 checks pass).

## Add a skeletal-control node: AnimDynamics

The route below was built in an editor module and replayed once with scripted input; the node and struct names were read in the headers.

- [documented] The editor node is `UAnimGraphNode_AnimDynamics : UAnimGraphNode_SkeletalControlBase` with a member `FAnimNode_AnimDynamics Node` (`Engine/Source/Editor/AnimGraph/Public/AnimGraphNode_AnimDynamics.h`). The runtime struct is in `Engine/Source/Runtime/AnimGraphRuntime/Public/BoneControllers/AnimNode_AnimDynamics.h`.
- [general] Create it as in the bridge, set properties on `Node` before `Finalize()`, connect after. Setup properties: `bChain`, `BoundBone` (top of the chain), `ChainEnd` (bottom), `SimulationSpace`, `ComponentLinearVelScale`, `ComponentLinearAccScale`, `NumSolverIterationsPreUpdate` and `PostUpdate`, and the damping overrides.
- [documented] `UpdateChainPhysicsBodyDefinitions(const FReferenceSkeleton&)`, `ValidateChainPhysicsBodyDefinitions` and `FindChainBoneNames` are `ANIMGRAPHRUNTIME_API`. The first fills `PhysicsBodyDefinitions` with one `FAnimPhysBodyDefinition` per chain bone (copying a lone existing definition), which code can then edit; it hits a `check` when no bone chain is found from `BoundBone` to `ChainEnd`, so set both first.
- [general] The chain axis is not the authoring axis: read it from the skeleton as the dominant axis of the second bone's offset in the first bone's space. Bones authored along Y ran along Z after import.
- [documented] AnimDynamics is a skeletal-control node with component-space pose pins; `UAnimationGraphSchema::CreateAutomaticConversionNodeAndConnections` spawns the Local To Component and Component To Local nodes when a connection joins the two spaces.
- [general] After `BreakAllPinLinks` on the Slot's output pin, `TryCreateConnection` from the slot to the node and from the node to the Root's input made the schema insert both conversions (five graph nodes in all). The compile status was not an error.

Settings that mattered:

- [general] Space. A chain simulated in world space was pulled apart by its anchor when the character moved fast: first-to-last body distance 112 cm at a run and 156 at a sprint, against 58 at rest. In component space with `ComponentLinearAccScale` and `ComponentLinearVelScale` set, the distance held at 57.8 to 61.1 cm through standing, run, sprint, turn, strafe and jump, and the chain still streamed behind a run. `AnimPhysSimSpaceType` has Component, Actor, World, RootRelative and BoneRelative; the World tooltip warns against teleporting characters.
- [documented] Damping. `FAnimPhys::InitializeBodyVelocity` multiplies momentum by `FMath::Pow(1 - Damping, DeltaTime)` (`Engine/Source/Runtime/Engine/Private/Animation/AnimPhysicsSolver.cpp`), so a value above 1 is a negative base with a fractional exponent. Hold the overrides to 0..1 (1.2 gave NaN once); they apply only when `bOverrideLinearDamping` or `bOverrideAngularDamping` is set.
- [documented] Joint limits. `FAnimPhys::ConstrainAngularRangeInternal` always adds a twist lock and reads the min/max vectors by the twist axis: with twist Z only the X and Y entries are used and Z is ignored. Make the chain axis the twist axis and put one limit on each other axis.
- [documented] Planar limit. `FAnimPhys::ConstrainPlanar` keeps a body on the +Z side of the plane (`FAnimPhysPlanarLimit::PlaneTransform`, relative to `DrivingBone` when one is set). Build the plane rotation with `FRotationMatrix::MakeFromZ` from the side the body may be on.
- [general] Values that held for a five-body ribbon: linear damping 0.25, critical angular damping, swing limits of 30 and 12 degrees, 12 solver iterations before the update and 4 after, acceleration scale 1, velocity scale 2.5 per second. Four variants were replayed with the same scripted input and the smoothest in a jump kept.
- Not verified: other skeletal-control nodes through the same route, a chain with branches, and the cost against a cloth asset ([Cloth Asset from code](unreal-chaos-cloth-from-code.md)).

## Two Bone IK and foot planting

- [documented] `FAnimNode_TwoBoneIK::IsValidToEvaluate` (`Engine/Source/Runtime/AnimGraphRuntime/Private/BoneControllers/AnimNode_TwoBoneIK.cpp`) is false when `EffectorLocationSpace` is `BCS_BoneSpace` or `BCS_ParentBoneSpace` and `EffectorTarget` names no valid bone (likewise `JointTarget` for the joint target space). `FAnimNode_SkeletalControlBase` then skips the node, and the path read logs nothing.
- [documented] `IKBone` is the end bone to move (the ankle); `EffectorTarget` is an `FBoneSocketTarget` (`Engine/Source/Runtime/Engine/Public/Animation/BoneSocketReference.h`), so in C++ the effector bone is `EffectorTarget.BoneReference.BoneName`.
- [general] Observed once: a bone-space effector with no effector bone left the ankle untouched, the foot height read the same with the solve on and off to a tenth of a centimetre, and screenshots from behind could not tell. Compare a measured quantity with the node on and off before trusting that a node ran.
- [general] Observed once: easing the foot toward moving ground lags it by the time constant (the deepest foot sank 8 cm on a hill at a run); a rate-limited follow tracked the ramp. A ground trace taken at the ankle's current place is a frame stale; lead it by one frame of movement.

## Sources

- Engine headers and source in the 5.8 install: `AnimGraphNode_AnimDynamics.h`, `AnimNode_AnimDynamics.h`, `AnimNode_AnimDynamics.cpp`, `AnimNode_TwoBoneIK.cpp`, `AnimNode_SkeletalControlBase.cpp`, `AnimPhysicsSolver.cpp`, `AnimationGraphSchema.cpp`, `RotationMatrix.h`.
- [anim_bridge README](../../../examples/unreal/anim_bridge/README.md) for the run behind the tested lines.
