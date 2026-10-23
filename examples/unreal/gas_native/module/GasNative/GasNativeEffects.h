#pragma once

#include "GameplayEffect.h"
#include "GasNativeEffects.generated.h"

/**
 * Base class for effects written in C++. GEComponents is protected, so the helper that fills it has to be a member of a
 * UGameplayEffect subclass. Call MakeTimed from the constructor of a subclass.
 */
UCLASS(Abstract)
class GASNATIVE_API UGasNativeEffectBase : public UGameplayEffect
{
	GENERATED_BODY()

protected:
	/** Duration effect that grants GrantedTag to its target while it lasts. */
	void MakeTimed(float Seconds, const FGameplayTag& GrantedTag);
};

/** Instant effect that subtracts 10 from Charge. Used as the ability's cost. */
UCLASS()
class GASNATIVE_API UGasNativeCostEffect : public UGasNativeEffectBase
{
	GENERATED_BODY()

public:
	UGasNativeCostEffect();
};

/** Two-second effect that grants GasNative.Cooldown.Pulse. Used as the ability's cooldown. */
UCLASS()
class GASNATIVE_API UGasNativeCooldownEffect : public UGasNativeEffectBase
{
	GENERATED_BODY()

public:
	UGasNativeCooldownEffect();
};
