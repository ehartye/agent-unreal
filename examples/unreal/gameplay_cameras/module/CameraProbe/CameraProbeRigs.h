#pragma once

#include "CoreMinimal.h"

class UCameraAsset;
class UCameraRigAsset;

/**
 * Builds the camera data in code with the Gameplay Cameras assemblers
 * (Engine/Plugins/Cameras/GameplayCameras/Source/GameplayCameras/Public/Build/CameraAssetAssembleUtils.h).
 * The numbers live here and nowhere else; the probe reads them back to compute what the camera should show.
 */
namespace CameraProbeRigs
{
	constexpr float BaseFieldOfView = 78.f;
	constexpr float SprintFieldOfView = 95.f;
	constexpr float SprintPullCm = 120.f;
	constexpr float EnterBlendSeconds = 0.4f;
	constexpr float ExitBlendSeconds = 0.4f;

	/** Boom offset in the boom's own frame: back and up. The eye sits this far from the pawn at rest. */
	inline FVector BoomOffsetCm() { return FVector(-400.0, 0.0, 100.0); }

	/** Attach to player pawn, boom arm driven by the control rotation, collision push, field of view. */
	UCameraRigAsset* MakeBaseRig();

	/** A modifier rig: a wider field of view and the eye pulled back along the camera's forward axis, with blend transitions. */
	UCameraRigAsset* MakeSprintRig();

	/** A camera asset whose single director plays the base rig; built. */
	UCameraAsset* MakeCameraAsset(UCameraRigAsset* BaseRig);
}
