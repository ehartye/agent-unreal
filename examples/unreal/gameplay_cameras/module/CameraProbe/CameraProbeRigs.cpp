#include "CameraProbeRigs.h"

// source: Engine/Plugins/Cameras/GameplayCameras/Source/GameplayCameras/Public/<header>, one per line below.
#include "Build/CameraAssetAssembleUtils.h"          // FCameraAssetAssembler, FCameraRigAssetAssembler, TCameraNodeAssembler
#include "Core/CameraAsset.h"                        // UCameraAsset::BuildCamera
#include "Core/CameraRigAsset.h"                     // UCameraRigAsset::BuildCameraRig, EnterTransitions, ExitTransitions
#include "Core/CameraRigTransition.h"                // UCameraRigTransition::Blend
#include "Core/CameraValueInterpolator.h"            // UCameraValueInterpolator (MinimalAPI)
#include "Directors/SingleCameraDirector.h"          // USingleCameraDirector::CameraRig
#include "Nodes/Attach/AttachToPlayerPawnCameraNode.h"
#include "Nodes/Blends/SmoothBlendCameraNode.h"      // USmoothBlendCameraNode, SetDefaultBlendTime
#include "Nodes/Collision/CollisionPushCameraNode.h" // CollisionSphereRadius
#include "Nodes/Common/ArrayCameraNode.h"
#include "Nodes/Common/BoomArmCameraNode.h"          // BoomOffset, InputSlot, BoomLengthInterpolator
#include "Nodes/Common/FieldOfViewCameraNode.h"      // FieldOfView
#include "Nodes/Common/OffsetCameraNode.h"           // TranslationOffset
#include "Nodes/Input/Input2DCameraNode.h"           // UInput2DCameraNode (MinimalAPI)

namespace
{
	/**
	 * Two classes the rigs need are declared UCLASS() with no API macro: UDrivenControlRotationCameraNode
	 * (Nodes/Input/DrivenControlRotationCameraNode.h) and UCriticalDamperValueInterpolator
	 * (ValueInterpolators/CriticalDamperValueInterpolator.h). Their StaticClass() is not exported from the GameplayCameras DLL, so
	 * NewObject<UDrivenControlRotationCameraNode>() would not link from another module. Both are made here from the class path
	 * instead, through an exported base class.
	 */
	UInput2DCameraNode* NewDrivenControlRotationNode(UObject* Outer)
	{
		UClass* Class = LoadClass<UInput2DCameraNode>(nullptr, TEXT("/Script/GameplayCameras.DrivenControlRotationCameraNode"));
		return Class ? NewObject<UInput2DCameraNode>(Outer, Class) : nullptr;
	}

	UCameraValueInterpolator* NewCriticalDamper(UObject* Outer)
	{
		UClass* Class = LoadClass<UCameraValueInterpolator>(nullptr, TEXT("/Script/GameplayCameras.CriticalDamperValueInterpolator"));
		return Class ? NewObject<UCameraValueInterpolator>(Outer, Class) : nullptr;
	}

	/**
	 * FCameraRigAssetAssembler::AddEnterTransition() hands the base template to a transition assembler that wants the derived type
	 * (TCameraRigAssetAssemblerBase::AddEnterTransition in CameraAssetAssembleUtils.h), so a build of that call fails. The transitions
	 * are made by hand: UCameraRigAsset::EnterTransitions and ExitTransitions are public arrays.
	 */
	UCameraRigTransition* MakeBlend(UCameraRigAsset* Rig, float Seconds)
	{
		UCameraRigTransition* Transition = NewObject<UCameraRigTransition>(Rig);
		USmoothBlendCameraNode* Blend = NewObject<USmoothBlendCameraNode>(Rig);
		Blend->SetDefaultBlendTime(Seconds);
		Transition->Blend = Blend;
		return Transition;
	}
}

UCameraRigAsset* CameraProbeRigs::MakeBaseRig()
{
	using namespace UE::Cameras;
	UCameraRigAsset* Rig = FCameraRigAssetAssembler(TEXT("ProbeBaseRig"))
		.MakeArrayRootNode()
			.AddArrayChild<UAttachToPlayerPawnCameraNode>().Done()
			.AddArrayChild<UBoomArmCameraNode>()
				.SetParameter(&UBoomArmCameraNode::BoomOffset, BoomOffsetCm())
				.Setup([](UBoomArmCameraNode* Boom)
				{
					Boom->InputSlot = NewDrivenControlRotationNode(Boom->GetOuter());
					Boom->BoomLengthInterpolator = NewCriticalDamper(Boom->GetOuter());
				})
				.Done()
			.AddArrayChild<UCollisionPushCameraNode>()
				.SetParameter(&UCollisionPushCameraNode::CollisionSphereRadius, 12.f)
				.Done()
			.AddArrayChild<UFieldOfViewCameraNode>()
				.SetParameter(&UFieldOfViewCameraNode::FieldOfView, BaseFieldOfView)
				.Done()
			.Done()
		.BuildCameraRig()
		.Get();
	return Rig;
}

UCameraRigAsset* CameraProbeRigs::MakeSprintRig()
{
	using namespace UE::Cameras;
	UCameraRigAsset* Rig = FCameraRigAssetAssembler(TEXT("ProbeSprintRig"))
		.MakeArrayRootNode()
			.AddArrayChild<UFieldOfViewCameraNode>()
				.SetParameter(&UFieldOfViewCameraNode::FieldOfView, SprintFieldOfView)
				.Done()
			.AddArrayChild<UOffsetCameraNode>()
				.SetParameter(&UOffsetCameraNode::TranslationOffset, FVector(-SprintPullCm, 0.0, 0.0))
				.Done()
			.Done()
		.Get();
	Rig->EnterTransitions.Add(MakeBlend(Rig, EnterBlendSeconds));
	Rig->ExitTransitions.Add(MakeBlend(Rig, ExitBlendSeconds));
	Rig->BuildCameraRig();
	return Rig;
}

UCameraAsset* CameraProbeRigs::MakeCameraAsset(UCameraRigAsset* BaseRig)
{
	using namespace UE::Cameras;
	UCameraAsset* Asset = FCameraAssetAssembler()
		.MakeDirector<USingleCameraDirector>()
			.Setup([BaseRig](USingleCameraDirector* Director)
			{
				Director->CameraRig = BaseRig;
			})
			.Done()
		.Get();
	Asset->BuildCamera();
	return Asset;
}
