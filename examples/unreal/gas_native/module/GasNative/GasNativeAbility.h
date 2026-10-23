#pragma once

#include "Abilities/GameplayAbility.h"
#include "GasNativeAbility.generated.h"

/** Costs 10 Charge, cools down for two seconds, and stays active for half a second (an ability task). */
UCLASS()
class GASNATIVE_API UGasNativeAbility : public UGameplayAbility
{
	GENERATED_BODY()

public:
	UGasNativeAbility();

	virtual void ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo,
		const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData) override;

private:
	UFUNCTION()
	void OnDelayFinished();
};
