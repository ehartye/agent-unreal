#pragma once

#include "GameplayEffect.h"
#include "GasNativeEffects.generated.h"

/**
 * Base class for effects written in C++. GEComponents is protected, so the helpers that fill it have to be members of a
 * UGameplayEffect subclass. Call MakeTimed or MakeInfinite from the constructor of a subclass.
 */
UCLASS(Abstract)
class GASNATIVE_API UGasNativeEffectBase : public UGameplayEffect
{
	GENERATED_BODY()

protected:
	/** Duration effect that grants GrantedTag to its target while it lasts. */
	void MakeTimed(float Seconds, const FGameplayTag& GrantedTag);

	/** Infinite effect that grants GrantedTag to its target until it is removed. */
	void MakeInfinite(const FGameplayTag& GrantedTag);

private:
	/** The constructor route to a component: CreateDefaultSubobject, then GEComponents.Add by hand. */
	void AddGrantedTags(const FGameplayTag& GrantedTag);
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

/** Infinite effect that grants GasNative.Case.Bonus. The component cases name this class where a component takes an effect class. */
UCLASS()
class GASNATIVE_API UGasNativeBonusEffect : public UGasNativeEffectBase
{
	GENERATED_BODY()

public:
	UGasNativeBonusEffect();
};
