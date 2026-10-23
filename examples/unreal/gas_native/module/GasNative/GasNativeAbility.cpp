#include "GasNativeAbility.h"
#include "Abilities/Tasks/AbilityTask_WaitDelay.h"
#include "GasNativeEffects.h"
#include "GasNativeTags.h"

UGasNativeAbility::UGasNativeAbility()
{
	InstancingPolicy = EGameplayAbilityInstancingPolicy::InstancedPerActor;

	// SetAssetTags replaces writing AbilityTags, which is deprecated since 5.5. It is for constructors only.
	FGameplayTagContainer Tags;
	Tags.AddTag(Tag_GasNative_Ability_Pulse.GetTag());
	SetAssetTags(Tags);

	// A cost is an instant effect; a cooldown is a duration effect that grants a tag.
	CostGameplayEffectClass = UGasNativeCostEffect::StaticClass();
	CooldownGameplayEffectClass = UGasNativeCooldownEffect::StaticClass();
}

void UGasNativeAbility::ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo,
	const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData)
{
	// CommitAbility applies the cost and the cooldown.
	if (!CommitAbility(Handle, ActorInfo, ActivationInfo))
	{
		EndAbility(Handle, ActorInfo, ActivationInfo, true, true);
		return;
	}
	UAbilityTask_WaitDelay* Wait = UAbilityTask_WaitDelay::WaitDelay(this, 0.5f);
	Wait->OnFinish.AddDynamic(this, &UGasNativeAbility::OnDelayFinished);
	Wait->ReadyForActivation();
}

void UGasNativeAbility::OnDelayFinished()
{
	EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo, true, false);
}
