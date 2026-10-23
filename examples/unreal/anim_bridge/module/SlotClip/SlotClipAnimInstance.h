#pragma once

#include "CoreMinimal.h"
#include "Animation/AnimInstance.h"
#include "SlotClipAnimInstance.generated.h"

/**
 * Parent class of a slot-only Animation Blueprint. It plays an animation clip through a named slot as a dynamic montage, so the
 * Animation Blueprint needs no state machine. Python sees it as unreal.SlotClipAnimInstance.
 */
UCLASS(Blueprintable, BlueprintType)
class USlotClipAnimInstance : public UAnimInstance
{
	GENERATED_BODY()

public:
	/** Play Clip in the slot (one clip at a time per slot group). Returns the montage. */
	UFUNCTION(BlueprintCallable, Category = "SlotClip")
	UAnimMontage* PlayClip(UAnimSequenceBase* Clip, FName SlotName, float BlendInTime = 0.1f, float BlendOutTime = 0.1f, float PlayRate = 1.0f, int32 LoopCount = 1);

	/** True while the montage started by the last PlayClip is still playing. */
	UFUNCTION(BlueprintCallable, Category = "SlotClip")
	bool IsClipPlaying() const;

	/** Position in seconds of the montage started by the last PlayClip, or -1 when none is playing. */
	UFUNCTION(BlueprintCallable, Category = "SlotClip")
	float GetClipPosition() const;

private:
	UPROPERTY(Transient)
	TObjectPtr<UAnimMontage> LastMontage;
};
