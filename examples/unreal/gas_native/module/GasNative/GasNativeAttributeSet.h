#pragma once

#include "AttributeSet.h"
#include "AbilitySystemComponent.h"
#include "GasNativeAttributeSet.generated.h"

/** One attribute. ATTRIBUTE_ACCESSORS_BASIC makes GetChargeAttribute, GetCharge, SetCharge and InitCharge. */
UCLASS()
class GASNATIVE_API UGasNativeAttributeSet : public UAttributeSet
{
	GENERATED_BODY()

public:
	UPROPERTY(BlueprintReadOnly, Category = "GasNative")
	FGameplayAttributeData Charge;
	ATTRIBUTE_ACCESSORS_BASIC(UGasNativeAttributeSet, Charge)
};
