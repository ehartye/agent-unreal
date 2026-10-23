#include "SlotClipAnimInstance.h"

#include "Animation/AnimMontage.h"

UAnimMontage* USlotClipAnimInstance::PlayClip(UAnimSequenceBase* Clip, FName SlotName, float BlendInTime, float BlendOutTime, float PlayRate, int32 LoopCount)
{
	LastMontage = PlaySlotAnimationAsDynamicMontage(Clip, SlotName, BlendInTime, BlendOutTime, PlayRate, LoopCount);
	return LastMontage;
}

bool USlotClipAnimInstance::IsClipPlaying() const
{
	return LastMontage && Montage_IsPlaying(LastMontage);
}

float USlotClipAnimInstance::GetClipPosition() const
{
	return IsClipPlaying() ? Montage_GetPosition(LastMontage) : -1.0f;
}
