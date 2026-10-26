#pragma once

#include "Abilities/GameplayAbility.h"
#include "Dom/JsonValue.h"
#include "GameplayEffectCustomApplicationRequirement.h"
#include "Templates/Function.h"
#include "GasNativeCases.generated.h"

class UWorld;

/** An ability that stays active until something ends or cancels it. The Block and Cancel component cases act on it. */
UCLASS()
class GASNATIVE_API UGasNativeHoldAbility : public UGameplayAbility
{
	GENERATED_BODY()

public:
	UGasNativeHoldAbility();

	virtual void ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo,
		const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData) override;
};

/** Application requirement for the Custom Can Apply component: true only while the target owns GasNative.Case.Gate. */
UCLASS()
class GASNATIVE_API UGasNativeGateRequirement : public UGameplayEffectCustomApplicationRequirement
{
	GENERATED_BODY()

public:
	virtual bool CanApplyGameplayEffect_Implementation(const UGameplayEffect* GameplayEffect, const FGameplayEffectSpec& Spec, UAbilitySystemComponent* ASC) const override;
};

namespace GasNativeCases
{
	/**
	 * Runs every effect-component case in `World` and appends one row per case to `OutRows`:
	 *   { id, component, role ("effect" or "control"), observed: { ... } }
	 * Each case gets its own actor with an ability system component, so no case sees another's tags or effects.
	 * `Advance(Seconds)` ticks the world; the caller owns the time loop.
	 */
	GASNATIVE_API void Run(UWorld* World, TFunction<void(float)> Advance, TArray<TSharedPtr<FJsonValue>>& OutRows);
}
