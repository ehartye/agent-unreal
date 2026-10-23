#include "GasNativeEffects.h"
#include "GameplayEffectComponents/TargetTagsGameplayEffectComponent.h"
#include "GasNativeAttributeSet.h"
#include "GasNativeTags.h"

void UGasNativeEffectBase::MakeTimed(float Seconds, const FGameplayTag& GrantedTag)
{
	DurationPolicy = EGameplayEffectDurationType::HasDuration;
	DurationMagnitude = FGameplayEffectModifierMagnitude(FScalableFloat(Seconds));

	// In a constructor a component is a default subobject: CreateDefaultSubobject, then add it to GEComponents by hand.
	// AddComponent and FindOrAddComponent call NewObject with no name, which the engine refuses inside a constructor.
	UTargetTagsGameplayEffectComponent* Granted = CreateDefaultSubobject<UTargetTagsGameplayEffectComponent>(TEXT("GrantedTags"));
	GEComponents.Add(Granted);

	FInheritedTagContainer Mods;
	Mods.AddTag(GrantedTag);
	Granted->SetAndApplyTargetTagChanges(Mods);
}

UGasNativeCostEffect::UGasNativeCostEffect()
{
	DurationPolicy = EGameplayEffectDurationType::Instant;
	FGameplayModifierInfo Info;
	Info.Attribute = UGasNativeAttributeSet::GetChargeAttribute();
	Info.ModifierOp = EGameplayModOp::Additive;
	Info.ModifierMagnitude = FGameplayEffectModifierMagnitude(FScalableFloat(-10.f));
	Modifiers.Add(Info);
}

UGasNativeCooldownEffect::UGasNativeCooldownEffect()
{
	MakeTimed(2.f, Tag_GasNative_Cooldown_Pulse.GetTag());
}
