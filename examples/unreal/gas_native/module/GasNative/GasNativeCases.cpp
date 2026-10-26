#include "GasNativeCases.h"
#include "AbilitySystemComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/World.h"
#include "GameplayEffect.h"
#include "GameplayEffectComponents/AbilitiesGameplayEffectComponent.h"
#include "GameplayEffectComponents/AdditionalEffectsGameplayEffectComponent.h"
#include "GameplayEffectComponents/AssetTagsGameplayEffectComponent.h"
#include "GameplayEffectComponents/BlockAbilityTagsGameplayEffectComponent.h"
#include "GameplayEffectComponents/CancelAbilityTagsGameplayEffectComponent.h"
#include "GameplayEffectComponents/ChanceToApplyGameplayEffectComponent.h"
#include "GameplayEffectComponents/CustomCanApplyGameplayEffectComponent.h"
#include "GameplayEffectComponents/ImmunityGameplayEffectComponent.h"
#include "GameplayEffectComponents/RemoveOtherGameplayEffectComponent.h"
#include "GameplayEffectComponents/TargetTagRequirementsGameplayEffectComponent.h"
#include "GameplayEffectComponents/TargetTagsGameplayEffectComponent.h"
#include "GasNativeAttributeSet.h"
#include "GasNativeEffects.h"
#include "GasNativeProbe.h"
#include "GasNativeTags.h"
#include "UObject/Package.h"
#include "UObject/StrongObjectPtr.h"
#include "UObject/UnrealType.h"

UGasNativeHoldAbility::UGasNativeHoldAbility()
{
	InstancingPolicy = EGameplayAbilityInstancingPolicy::InstancedPerActor;
	FGameplayTagContainer Tags;
	Tags.AddTag(Tag_GasNative_Ability_Hold.GetTag());
	SetAssetTags(Tags);
}

void UGasNativeHoldAbility::ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo,
	const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData)
{
	// Commits (no cost, no cooldown) and then neither ends nor waits: the ability stays active until cancelled.
	(void)CommitAbility(Handle, ActorInfo, ActivationInfo);
}

bool UGasNativeGateRequirement::CanApplyGameplayEffect_Implementation(const UGameplayEffect* GameplayEffect, const FGameplayEffectSpec& Spec, UAbilitySystemComponent* ASC) const
{
	return ASC != nullptr && ASC->HasMatchingGameplayTag(Tag_GasNative_Case_Gate.GetTag());
}

namespace
{
	using FRows = TArray<TSharedPtr<FJsonValue>>;

	struct FSubject
	{
		AGasNativeActor* Actor = nullptr;
		UAbilitySystemComponent* Asc = nullptr;
	};

	/** One case that differs from its siblings only by flags. */
	struct FCaseSpec
	{
		const TCHAR* Id;
		const TCHAR* Role;
		bool bComponent;
		bool bGate;
	};

	/**
	 * Every case builds its effects at run time with NewObject and AddComponent: that is the route for an effect made outside a
	 * constructor. A component that takes an effect class (Additional Effects) is given UGasNativeBonusEffect, which is a real class.
	 */
	class FRunner
	{
	public:
		FRunner(UWorld* InWorld, TFunction<void(float)> InAdvance, FRows& InRows) : World(InWorld), Advance(MoveTemp(InAdvance)), Rows(InRows) {}

		void RunAll()
		{
			AssetTags();
			Immunity();
			AdditionalEffects();
			BlockAbilityTags();
			CancelAbilityTags();
			ChanceToApply();
			CustomCanApply();
			RemoveOther();
			TargetTagRequirements();
			Abilities();
		}

	private:
		UWorld* World;
		TFunction<void(float)> Advance;
		FRows& Rows;
		TArray<TStrongObjectPtr<UGameplayEffect>> Keep;

		// ---- plumbing ---------------------------------------------------------------------------------------------------------

		FSubject Spawn(bool bGiveHold = false)
		{
			FSubject S;
			S.Actor = World->SpawnActor<AGasNativeActor>();
			S.Asc = S.Actor->Asc;
			S.Asc->InitAbilityActorInfo(S.Actor, S.Actor);
			UGasNativeAttributeSet* Set = NewObject<UGasNativeAttributeSet>(S.Actor);
			Set->InitCharge(100.f);
			S.Asc->AddAttributeSetSubobject(Set);
			if (bGiveHold) { S.Asc->GiveAbility(FGameplayAbilitySpec(UGasNativeHoldAbility::StaticClass(), 1)); }
			return S;
		}

		TSharedPtr<FJsonObject> Case(const TCHAR* Id, const TCHAR* Component, const TCHAR* Role)
		{
			TSharedPtr<FJsonObject> Row = MakeShared<FJsonObject>();
			Row->SetStringField(TEXT("id"), Id);
			Row->SetStringField(TEXT("component"), Component);
			Row->SetStringField(TEXT("role"), Role);
			TSharedPtr<FJsonObject> Observed = MakeShared<FJsonObject>();
			Row->SetObjectField(TEXT("observed"), Observed);
			Rows.Add(MakeShared<FJsonValueObject>(Row));
			return Observed;
		}

		UGameplayEffect* NewEffect(EGameplayEffectDurationType Policy, float Seconds = 0.f)
		{
			UGameplayEffect* Effect = NewObject<UGameplayEffect>(GetTransientPackage());
			Effect->DurationPolicy = Policy;
			if (Policy == EGameplayEffectDurationType::HasDuration) { Effect->DurationMagnitude = FGameplayEffectModifierMagnitude(FScalableFloat(Seconds)); }
			Keep.Emplace(Effect);
			return Effect;
		}

		static FInheritedTagContainer Inherited(const FGameplayTag& Tag)
		{
			FInheritedTagContainer Mods;
			Mods.AddTag(Tag);
			return Mods;
		}

		static FGameplayTagContainer One(const FGameplayTag& Tag) { return FGameplayTagContainer(Tag); }

		static void Grants(UGameplayEffect* Effect, const FGameplayTag& Tag)
		{
			Effect->AddComponent<UTargetTagsGameplayEffectComponent>().SetAndApplyTargetTagChanges(Inherited(Tag));
		}

		static void AssetTag(UGameplayEffect* Effect, const FGameplayTag& Tag)
		{
			Effect->AddComponent<UAssetTagsGameplayEffectComponent>().SetAndApplyAssetTagChanges(Inherited(Tag));
		}

		static FActiveGameplayEffectHandle Apply(const FSubject& S, const UGameplayEffect* Effect)
		{
			return S.Asc->ApplyGameplayEffectToSelf(Effect, 1.f, S.Asc->MakeEffectContext());
		}

		static bool Owns(const FSubject& S, const FGameplayTag& Tag) { return S.Asc->HasMatchingGameplayTag(Tag); }
		static bool StillActive(const FSubject& S, const FActiveGameplayEffectHandle& Handle) { return S.Asc->GetActiveGameplayEffect(Handle) != nullptr; }
		static bool WasApplied(const FActiveGameplayEffectHandle& Handle) { return Handle.WasSuccessfullyApplied(); }

		static bool HasHoldSpec(const FSubject& S) { return S.Asc->FindAbilitySpecFromClass(UGasNativeHoldAbility::StaticClass()) != nullptr; }
		static bool HoldActive(const FSubject& S)
		{
			const FGameplayAbilitySpec* Spec = S.Asc->FindAbilitySpecFromClass(UGasNativeHoldAbility::StaticClass());
			return Spec && Spec->IsActive();
		}

		// ---- Asset Tags -------------------------------------------------------------------------------------------------------

		void AssetTags()
		{
			for (const bool bWith : { true, false })
			{
				FSubject S = Spawn();
				UGameplayEffect* Effect = NewEffect(EGameplayEffectDurationType::Infinite);
				if (bWith) { AssetTag(Effect, Tag_GasNative_Case_Blocked.GetTag()); }
				const FActiveGameplayEffectHandle Handle = Apply(S, Effect);
				TSharedPtr<FJsonObject> O = Case(bWith ? TEXT("asset_tags") : TEXT("asset_tags_control"), TEXT("AssetTags"), bWith ? TEXT("effect") : TEXT("control"));
				O->SetBoolField(TEXT("applied"), Handle.IsValid());
				O->SetBoolField(TEXT("tag_on_definition"), Effect->GetAssetTags().HasTagExact(Tag_GasNative_Case_Blocked.GetTag()));
				O->SetBoolField(TEXT("target_owns_tag"), Owns(S, Tag_GasNative_Case_Blocked.GetTag()));
			}
		}

		// ---- Immunity ---------------------------------------------------------------------------------------------------------

		UGameplayEffect* ImmunityEffect()
		{
			UGameplayEffect* Effect = NewEffect(EGameplayEffectDurationType::Infinite);
			Effect->AddComponent<UImmunityGameplayEffectComponent>().ImmunityQueries.Add(FGameplayEffectQuery::MakeQuery_MatchAnyEffectTags(One(Tag_GasNative_Case_Blocked.GetTag())));
			return Effect;
		}

		/** Grants Marker and carries the asset tag the immunity matches, or (not matching) grants Bonus with no asset tag. */
		UGameplayEffect* VictimEffect(bool bMatching)
		{
			UGameplayEffect* Effect = NewEffect(EGameplayEffectDurationType::Infinite);
			Grants(Effect, bMatching ? Tag_GasNative_Case_Marker.GetTag() : Tag_GasNative_Case_Bonus.GetTag());
			if (bMatching) { AssetTag(Effect, Tag_GasNative_Case_Blocked.GetTag()); }
			return Effect;
		}

		void Immunity()
		{
			const FGameplayTag Marker = Tag_GasNative_Case_Marker.GetTag();
			const FGameplayTag Bonus = Tag_GasNative_Case_Bonus.GetTag();
			{	// effect: immunity active, the victim carries the matching asset tag
				FSubject S = Spawn();
				int32 Blocks = 0;
				const FDelegateHandle Bound = S.Asc->OnImmunityBlockGameplayEffectDelegate.AddLambda([&Blocks](const FGameplayEffectSpec&, const FActiveGameplayEffect*) { ++Blocks; });
				const FActiveGameplayEffectHandle Immune = Apply(S, ImmunityEffect());
				const FActiveGameplayEffectHandle Victim = Apply(S, VictimEffect(true));
				S.Asc->OnImmunityBlockGameplayEffectDelegate.Remove(Bound);
				TSharedPtr<FJsonObject> O = Case(TEXT("immunity_blocks"), TEXT("Immunity"), TEXT("effect"));
				O->SetBoolField(TEXT("immunity_applied"), Immune.IsValid());
				O->SetBoolField(TEXT("victim_applied"), WasApplied(Victim));
				O->SetBoolField(TEXT("victim_tag_owned"), Owns(S, Marker));
				O->SetNumberField(TEXT("block_delegate_count"), Blocks);
			}
			{	// control: no immunity
				FSubject S = Spawn();
				int32 Blocks = 0;
				const FDelegateHandle Bound = S.Asc->OnImmunityBlockGameplayEffectDelegate.AddLambda([&Blocks](const FGameplayEffectSpec&, const FActiveGameplayEffect*) { ++Blocks; });
				const FActiveGameplayEffectHandle Victim = Apply(S, VictimEffect(true));
				S.Asc->OnImmunityBlockGameplayEffectDelegate.Remove(Bound);
				TSharedPtr<FJsonObject> O = Case(TEXT("immunity_control"), TEXT("Immunity"), TEXT("control"));
				O->SetBoolField(TEXT("victim_applied"), WasApplied(Victim));
				O->SetBoolField(TEXT("victim_tag_owned"), Owns(S, Marker));
				O->SetNumberField(TEXT("block_delegate_count"), Blocks);
			}
			{	// effect: immunity active, an effect that does not match the query is not blocked
				FSubject S = Spawn();
				int32 Blocks = 0;
				const FDelegateHandle Bound = S.Asc->OnImmunityBlockGameplayEffectDelegate.AddLambda([&Blocks](const FGameplayEffectSpec&, const FActiveGameplayEffect*) { ++Blocks; });
				Apply(S, ImmunityEffect());
				const FActiveGameplayEffectHandle Other = Apply(S, VictimEffect(false));
				S.Asc->OnImmunityBlockGameplayEffectDelegate.Remove(Bound);
				TSharedPtr<FJsonObject> O = Case(TEXT("immunity_unrelated_effect"), TEXT("Immunity"), TEXT("effect"));
				O->SetBoolField(TEXT("other_applied"), WasApplied(Other));
				O->SetBoolField(TEXT("other_tag_owned"), Owns(S, Bonus));
				O->SetNumberField(TEXT("block_delegate_count"), Blocks);
			}
			{	// effect: the immunity is removed, and the same victim applies again
				FSubject S = Spawn();
				const FActiveGameplayEffectHandle Immune = Apply(S, ImmunityEffect());
				const bool bBlockedFirst = !WasApplied(Apply(S, VictimEffect(true)));
				S.Asc->RemoveActiveGameplayEffect(Immune);
				const FActiveGameplayEffectHandle Victim = Apply(S, VictimEffect(true));
				TSharedPtr<FJsonObject> O = Case(TEXT("immunity_removed"), TEXT("Immunity"), TEXT("effect"));
				O->SetBoolField(TEXT("blocked_while_active"), bBlockedFirst);
				O->SetBoolField(TEXT("victim_applied_after_removal"), WasApplied(Victim));
				O->SetBoolField(TEXT("victim_tag_owned"), Owns(S, Marker));
			}
		}

		// ---- Additional Effects -----------------------------------------------------------------------------------------------

		void AdditionalEffects()
		{
			const FGameplayTag Bonus = Tag_GasNative_Case_Bonus.GetTag();
			const FGameplayTag Gate = Tag_GasNative_Case_Gate.GetTag();
			// on application, and the control without the component
			for (const bool bWith : { true, false })
			{
				FSubject S = Spawn();
				UGameplayEffect* Main = NewEffect(EGameplayEffectDurationType::Infinite);
				if (bWith)
				{
					FConditionalGameplayEffect Extra;
					Extra.EffectClass = UGasNativeBonusEffect::StaticClass();
					Main->AddComponent<UAdditionalEffectsGameplayEffectComponent>().OnApplicationGameplayEffects.Add(Extra);
				}
				const FActiveGameplayEffectHandle Handle = Apply(S, Main);
				TSharedPtr<FJsonObject> O = Case(bWith ? TEXT("additional_on_application") : TEXT("additional_on_application_control"), TEXT("AdditionalEffects"), bWith ? TEXT("effect") : TEXT("control"));
				O->SetBoolField(TEXT("main_applied"), Handle.IsValid());
				O->SetBoolField(TEXT("extra_tag_owned"), Owns(S, Bonus));
			}
			// on application with a required source tag, met and unmet (the target is also the source)
			for (const bool bMet : { true, false })
			{
				FSubject S = Spawn();
				if (bMet) { S.Asc->AddLooseGameplayTag(Gate); }
				UGameplayEffect* Main = NewEffect(EGameplayEffectDurationType::Infinite);
				FConditionalGameplayEffect Extra;
				Extra.EffectClass = UGasNativeBonusEffect::StaticClass();
				Extra.RequiredSourceTags.AddTag(Gate);
				Main->AddComponent<UAdditionalEffectsGameplayEffectComponent>().OnApplicationGameplayEffects.Add(Extra);
				Apply(S, Main);
				TSharedPtr<FJsonObject> O = Case(bMet ? TEXT("additional_source_tag_met") : TEXT("additional_source_tag_unmet"), TEXT("AdditionalEffects"), TEXT("effect"));
				O->SetBoolField(TEXT("extra_tag_owned"), Owns(S, Bonus));
			}
			// on complete: which list, and how the main effect ends
			Complete(TEXT("additional_complete_normal_expired"), TEXT("effect"), 1, false);
			Complete(TEXT("additional_complete_normal_removed"), TEXT("effect"), 1, true);
			Complete(TEXT("additional_complete_premature_removed"), TEXT("effect"), 2, true);
			Complete(TEXT("additional_complete_premature_expired"), TEXT("effect"), 2, false);
			Complete(TEXT("additional_complete_always_expired"), TEXT("effect"), 3, false);
			Complete(TEXT("additional_complete_always_removed"), TEXT("effect"), 3, true);
			Complete(TEXT("additional_complete_control"), TEXT("control"), 0, false);
		}

		/** Which: 0 no component, 1 OnCompleteNormal, 2 OnCompletePrematurely, 3 OnCompleteAlways. The main effect lasts 0.5 s. */
		void Complete(const TCHAR* Id, const TCHAR* Role, int32 Which, bool bRemoveEarly)
		{
			const FGameplayTag Bonus = Tag_GasNative_Case_Bonus.GetTag();
			FSubject S = Spawn();
			UGameplayEffect* Main = NewEffect(EGameplayEffectDurationType::HasDuration, 0.5f);
			if (Which != 0)
			{
				UAdditionalEffectsGameplayEffectComponent& C = Main->AddComponent<UAdditionalEffectsGameplayEffectComponent>();
				TArray<TSubclassOf<UGameplayEffect>>& List = Which == 1 ? C.OnCompleteNormal : (Which == 2 ? C.OnCompletePrematurely : C.OnCompleteAlways);
				List.Add(UGasNativeBonusEffect::StaticClass());
			}
			const FActiveGameplayEffectHandle Handle = Apply(S, Main);
			Advance(0.2f);
			const bool bBonusEarly = Owns(S, Bonus);
			const bool bActiveEarly = StillActive(S, Handle);
			bool bRemoved = false;
			if (bRemoveEarly) { bRemoved = S.Asc->RemoveActiveGameplayEffect(Handle); }
			const bool bBonusRightAfterRemoval = Owns(S, Bonus);
			Advance(0.8f);
			TSharedPtr<FJsonObject> O = Case(Id, TEXT("AdditionalEffects"), Role);
			O->SetBoolField(TEXT("main_applied"), Handle.IsValid());
			O->SetBoolField(TEXT("main_active_at_0_2s"), bActiveEarly);
			O->SetBoolField(TEXT("extra_tag_at_0_2s"), bBonusEarly);
			O->SetBoolField(TEXT("removed_early"), bRemoved);
			O->SetBoolField(TEXT("extra_tag_right_after_removal"), bBonusRightAfterRemoval);
			O->SetBoolField(TEXT("main_active_at_end"), StillActive(S, Handle));
			O->SetBoolField(TEXT("extra_tag_at_end"), Owns(S, Bonus));
		}

		// ---- Block Abilities with Tags ----------------------------------------------------------------------------------------

		void BlockAbilityTags()
		{
			const FGameplayTag Hold = Tag_GasNative_Ability_Hold.GetTag();
			for (const bool bWith : { true, false })
			{
				FSubject S = Spawn(true);
				UGameplayEffect* Effect = NewEffect(EGameplayEffectDurationType::Infinite);
				if (bWith) { Effect->AddComponent<UBlockAbilityTagsGameplayEffectComponent>().SetAndApplyBlockedAbilityTagChanges(Inherited(Hold)); }
				const FActiveGameplayEffectHandle Handle = Apply(S, Effect);
				const bool bActivated = S.Asc->TryActivateAbilityByClass(UGasNativeHoldAbility::StaticClass());
				TSharedPtr<FJsonObject> O = Case(bWith ? TEXT("block_blocks") : TEXT("block_control"), TEXT("BlockAbilityTags"), bWith ? TEXT("effect") : TEXT("control"));
				O->SetBoolField(TEXT("applied"), Handle.IsValid());
				O->SetBoolField(TEXT("tag_on_definition"), Effect->GetBlockedAbilityTags().HasTagExact(Hold));
				O->SetBoolField(TEXT("activation_returned"), bActivated);
				O->SetBoolField(TEXT("ability_active"), HoldActive(S));
			}
			{	// the effect is removed: the ability can activate again
				FSubject S = Spawn(true);
				UGameplayEffect* Effect = NewEffect(EGameplayEffectDurationType::Infinite);
				Effect->AddComponent<UBlockAbilityTagsGameplayEffectComponent>().SetAndApplyBlockedAbilityTagChanges(Inherited(Hold));
				const FActiveGameplayEffectHandle Handle = Apply(S, Effect);
				const bool bBlocked = !S.Asc->TryActivateAbilityByClass(UGasNativeHoldAbility::StaticClass());
				S.Asc->RemoveActiveGameplayEffect(Handle);
				const bool bActivated = S.Asc->TryActivateAbilityByClass(UGasNativeHoldAbility::StaticClass());
				TSharedPtr<FJsonObject> O = Case(TEXT("block_removed"), TEXT("BlockAbilityTags"), TEXT("effect"));
				O->SetBoolField(TEXT("blocked_while_active"), bBlocked);
				O->SetBoolField(TEXT("activation_returned_after_removal"), bActivated);
				O->SetBoolField(TEXT("ability_active"), HoldActive(S));
			}
		}

		// ---- Cancel Abilities with Tags ---------------------------------------------------------------------------------------

		static bool SetCancelMode(UCancelAbilityTagsGameplayEffectComponent& Component, ECancelAbilityTagsGameplayEffectComponentMode Mode)
		{
			// ComponentMode is private: reflection is the only route from C++ outside the class.
			FProperty* Property = Component.GetClass()->FindPropertyByName(TEXT("ComponentMode"));
			if (FEnumProperty* AsEnum = CastField<FEnumProperty>(Property))
			{
				AsEnum->GetUnderlyingProperty()->SetIntPropertyValue(AsEnum->ContainerPtrToValuePtr<void>(&Component), static_cast<int64>(Mode));
				return true;
			}
			if (FByteProperty* AsByte = CastField<FByteProperty>(Property))
			{
				AsByte->SetPropertyValue(AsByte->ContainerPtrToValuePtr<uint8>(&Component), static_cast<uint8>(Mode));
				return true;
			}
			return false;
		}

		/** Activates the hold ability, applies an effect that cancels abilities with CancelTag, and reads whether the ability is still active. */
		void CancelCase(const TCHAR* Id, const TCHAR* Role, bool bWithComponent, const FGameplayTag& CancelTag, EGameplayEffectDurationType Policy, bool bSetMode, ECancelAbilityTagsGameplayEffectComponentMode Mode)
		{
			FSubject S = Spawn(true);
			S.Asc->TryActivateAbilityByClass(UGasNativeHoldAbility::StaticClass());
			const bool bActiveBefore = HoldActive(S);
			UGameplayEffect* Effect = NewEffect(Policy);
			bool bModeWritten = false;
			if (bWithComponent)
			{
				UCancelAbilityTagsGameplayEffectComponent& C = Effect->AddComponent<UCancelAbilityTagsGameplayEffectComponent>();
				C.SetAndApplyCanceledAbilityTagChanges(Inherited(CancelTag), FInheritedTagContainer());
				if (bSetMode) { bModeWritten = SetCancelMode(C, Mode); }
			}
			const FActiveGameplayEffectHandle Handle = Apply(S, Effect);
			TSharedPtr<FJsonObject> O = Case(Id, TEXT("CancelAbilityTags"), Role);
			O->SetBoolField(TEXT("active_before"), bActiveBefore);
			O->SetBoolField(TEXT("effect_applied"), WasApplied(Handle));
			O->SetBoolField(TEXT("mode_written"), bModeWritten);
			O->SetBoolField(TEXT("active_after"), HoldActive(S));
		}

		void CancelAbilityTags()
		{
			const FGameplayTag Hold = Tag_GasNative_Ability_Hold.GetTag();
			const FGameplayTag Other = Tag_GasNative_Case_Blocked.GetTag();
			const ECancelAbilityTagsGameplayEffectComponentMode OnApplication = ECancelAbilityTagsGameplayEffectComponentMode::OnApplication;
			const ECancelAbilityTagsGameplayEffectComponentMode OnExecution = ECancelAbilityTagsGameplayEffectComponentMode::OnExecution;
			CancelCase(TEXT("cancel_cancels"), TEXT("effect"), true, Hold, EGameplayEffectDurationType::Instant, false, OnApplication);
			CancelCase(TEXT("cancel_control"), TEXT("control"), false, Hold, EGameplayEffectDurationType::Instant, false, OnApplication);
			CancelCase(TEXT("cancel_other_tag"), TEXT("effect"), true, Other, EGameplayEffectDurationType::Instant, false, OnApplication);
			CancelCase(TEXT("cancel_on_application_infinite"), TEXT("effect"), true, Hold, EGameplayEffectDurationType::Infinite, false, OnApplication);
			CancelCase(TEXT("cancel_on_execution_infinite"), TEXT("effect"), true, Hold, EGameplayEffectDurationType::Infinite, true, OnExecution);
			CancelCase(TEXT("cancel_on_execution_instant"), TEXT("effect"), true, Hold, EGameplayEffectDurationType::Instant, true, OnExecution);
		}

		// ---- Chance To Apply --------------------------------------------------------------------------------------------------

		/** Applies an instant +1 Charge effect `Times` times and counts how many applied; Chance below zero means no component. */
		void ChanceCase(const TCHAR* Id, const TCHAR* Role, float Chance, int32 Times)
		{
			FSubject S = Spawn();
			UGameplayEffect* Effect = NewEffect(EGameplayEffectDurationType::Instant);
			FGameplayModifierInfo Info;
			Info.Attribute = UGasNativeAttributeSet::GetChargeAttribute();
			Info.ModifierOp = EGameplayModOp::Additive;
			Info.ModifierMagnitude = FGameplayEffectModifierMagnitude(FScalableFloat(1.f));
			Effect->Modifiers.Add(Info);
			if (Chance >= 0.f) { Effect->AddComponent<UChanceToApplyGameplayEffectComponent>().SetChanceToApplyToTarget(FScalableFloat(Chance)); }
			int32 Applied = 0;
			for (int32 i = 0; i < Times; ++i) { if (WasApplied(Apply(S, Effect))) { ++Applied; } }
			TSharedPtr<FJsonObject> O = Case(Id, TEXT("ChanceToApply"), Role);
			O->SetNumberField(TEXT("attempts"), Times);
			O->SetNumberField(TEXT("applied_count"), Applied);
			O->SetNumberField(TEXT("charge_gained"), S.Asc->GetNumericAttribute(UGasNativeAttributeSet::GetChargeAttribute()) - 100.f);
		}

		void ChanceToApply()
		{
			ChanceCase(TEXT("chance_zero"), TEXT("effect"), 0.f, 20);
			ChanceCase(TEXT("chance_one"), TEXT("effect"), 1.f, 20);
			ChanceCase(TEXT("chance_control"), TEXT("control"), -1.f, 20);
			ChanceCase(TEXT("chance_half"), TEXT("effect"), 0.5f, 200);
		}

		// ---- Custom Can Apply -------------------------------------------------------------------------------------------------

		void CustomCanApply()
		{
			const FGameplayTag Gate = Tag_GasNative_Case_Gate.GetTag();
			const FGameplayTag Marker = Tag_GasNative_Case_Marker.GetTag();
			const FCaseSpec Specs[] = {
				{ TEXT("custom_refused"), TEXT("effect"), true, false },
				{ TEXT("custom_allowed"), TEXT("effect"), true, true },
				{ TEXT("custom_control"), TEXT("control"), false, false },
			};
			for (const FCaseSpec& V : Specs)
			{
				FSubject S = Spawn();
				if (V.bGate) { S.Asc->AddLooseGameplayTag(Gate); }
				UGameplayEffect* Effect = NewEffect(EGameplayEffectDurationType::Infinite);
				Grants(Effect, Marker);
				if (V.bComponent) { Effect->AddComponent<UCustomCanApplyGameplayEffectComponent>().ApplicationRequirements.Add(UGasNativeGateRequirement::StaticClass()); }
				const FActiveGameplayEffectHandle Handle = Apply(S, Effect);
				TSharedPtr<FJsonObject> O = Case(V.Id, TEXT("CustomCanApply"), V.Role);
				O->SetBoolField(TEXT("gate_tag_present"), V.bGate);
				O->SetBoolField(TEXT("applied"), WasApplied(Handle));
				O->SetBoolField(TEXT("tag_owned"), Owns(S, Marker));
			}
		}

		// ---- Remove Other Effects ---------------------------------------------------------------------------------------------

		void RemoveOther()
		{
			const FGameplayTag Marker = Tag_GasNative_Case_Marker.GetTag();
			const FGameplayTag Bonus = Tag_GasNative_Case_Bonus.GetTag();
			for (const bool bWith : { true, false })
			{
				FSubject S = Spawn();
				UGameplayEffect* Victim = NewEffect(EGameplayEffectDurationType::Infinite);
				Grants(Victim, Marker);
				UGameplayEffect* Bystander = NewEffect(EGameplayEffectDurationType::Infinite);
				Grants(Bystander, Bonus);
				Apply(S, Victim);
				Apply(S, Bystander);
				const bool bMarkerBefore = Owns(S, Marker);
				UGameplayEffect* Remover = NewEffect(EGameplayEffectDurationType::Instant);
				if (bWith) { Remover->AddComponent<URemoveOtherGameplayEffectComponent>().RemoveGameplayEffectQueries.Add(FGameplayEffectQuery::MakeQuery_MatchAnyOwningTags(One(Marker))); }
				const FActiveGameplayEffectHandle Handle = Apply(S, Remover);
				TSharedPtr<FJsonObject> O = Case(bWith ? TEXT("remove_other_removes") : TEXT("remove_other_control"), TEXT("RemoveOther"), bWith ? TEXT("effect") : TEXT("control"));
				O->SetBoolField(TEXT("remover_applied"), WasApplied(Handle));
				O->SetBoolField(TEXT("victim_tag_before"), bMarkerBefore);
				O->SetBoolField(TEXT("victim_tag_after"), Owns(S, Marker));
				O->SetBoolField(TEXT("bystander_tag_after"), Owns(S, Bonus));
			}
			{	// an infinite remover whose own granted tag matches its query (a runtime-built effect is not the class default object)
				FSubject S = Spawn();
				UGameplayEffect* Victim = NewEffect(EGameplayEffectDurationType::Infinite);
				Grants(Victim, Marker);
				Apply(S, Victim);
				UGameplayEffect* Remover = NewEffect(EGameplayEffectDurationType::Infinite);
				Grants(Remover, Marker);
				Remover->AddComponent<URemoveOtherGameplayEffectComponent>().RemoveGameplayEffectQueries.Add(FGameplayEffectQuery::MakeQuery_MatchAnyOwningTags(One(Marker)));
				const FActiveGameplayEffectHandle Handle = Apply(S, Remover);
				TSharedPtr<FJsonObject> O = Case(TEXT("remove_other_matches_itself"), TEXT("RemoveOther"), TEXT("effect"));
				O->SetBoolField(TEXT("remover_applied"), Handle.IsValid());
				O->SetBoolField(TEXT("remover_still_active"), StillActive(S, Handle));
				O->SetBoolField(TEXT("tag_owned"), Owns(S, Marker));
			}
		}

		// ---- Require Tags to Apply/Continue This Effect -----------------------------------------------------------------------

		void TargetTagRequirements()
		{
			const FGameplayTag Gate = Tag_GasNative_Case_Gate.GetTag();
			const FGameplayTag Marker = Tag_GasNative_Case_Marker.GetTag();
			const FCaseSpec Specs[] = {
				{ TEXT("requirements_application_unmet"), TEXT("effect"), true, false },
				{ TEXT("requirements_application_met"), TEXT("effect"), true, true },
				{ TEXT("requirements_control"), TEXT("control"), false, false },
			};
			for (const FCaseSpec& V : Specs)
			{
				FSubject S = Spawn();
				if (V.bGate) { S.Asc->AddLooseGameplayTag(Gate); }
				UGameplayEffect* Effect = NewEffect(EGameplayEffectDurationType::Infinite);
				Grants(Effect, Marker);
				if (V.bComponent) { Effect->AddComponent<UTargetTagRequirementsGameplayEffectComponent>().ApplicationTagRequirements.RequireTags.AddTag(Gate); }
				const FActiveGameplayEffectHandle Handle = Apply(S, Effect);
				TSharedPtr<FJsonObject> O = Case(V.Id, TEXT("TargetTagRequirements"), V.Role);
				O->SetBoolField(TEXT("gate_tag_present"), V.bGate);
				O->SetBoolField(TEXT("applied"), WasApplied(Handle));
				O->SetBoolField(TEXT("tag_owned"), Owns(S, Marker));
			}
			{	// ongoing requirement: the effect stays applied but switches off and on with the gate tag
				FSubject S = Spawn();
				UGameplayEffect* Effect = NewEffect(EGameplayEffectDurationType::Infinite);
				Grants(Effect, Marker);
				Effect->AddComponent<UTargetTagRequirementsGameplayEffectComponent>().OngoingTagRequirements.RequireTags.AddTag(Gate);
				const FActiveGameplayEffectHandle Handle = Apply(S, Effect);
				auto Inhibited = [&]() { const FActiveGameplayEffect* Active = S.Asc->GetActiveGameplayEffect(Handle); return Active ? Active->bIsInhibited : false; };
				TSharedPtr<FJsonObject> O = Case(TEXT("requirements_ongoing"), TEXT("TargetTagRequirements"), TEXT("effect"));
				O->SetBoolField(TEXT("applied"), Handle.IsValid());
				O->SetBoolField(TEXT("tag_owned_without_gate"), Owns(S, Marker));
				O->SetBoolField(TEXT("inhibited_without_gate"), Inhibited());
				S.Asc->AddLooseGameplayTag(Gate);
				O->SetBoolField(TEXT("tag_owned_with_gate"), Owns(S, Marker));
				O->SetBoolField(TEXT("inhibited_with_gate"), Inhibited());
				S.Asc->RemoveLooseGameplayTag(Gate);
				O->SetBoolField(TEXT("tag_owned_gate_removed"), Owns(S, Marker));
				O->SetBoolField(TEXT("inhibited_gate_removed"), Inhibited());
			}
			{	// removal requirement: the gate tag removes the effect and refuses it again
				FSubject S = Spawn();
				UGameplayEffect* Effect = NewEffect(EGameplayEffectDurationType::Infinite);
				Grants(Effect, Marker);
				Effect->AddComponent<UTargetTagRequirementsGameplayEffectComponent>().RemovalTagRequirements.RequireTags.AddTag(Gate);
				const FActiveGameplayEffectHandle Handle = Apply(S, Effect);
				TSharedPtr<FJsonObject> O = Case(TEXT("requirements_removal"), TEXT("TargetTagRequirements"), TEXT("effect"));
				O->SetBoolField(TEXT("applied"), Handle.IsValid());
				O->SetBoolField(TEXT("tag_owned_without_gate"), Owns(S, Marker));
				S.Asc->AddLooseGameplayTag(Gate);
				O->SetBoolField(TEXT("still_active_with_gate"), StillActive(S, Handle));
				O->SetBoolField(TEXT("tag_owned_with_gate"), Owns(S, Marker));
				O->SetBoolField(TEXT("reapplied_with_gate"), WasApplied(Apply(S, Effect)));
			}
		}

		// ---- Grant Gameplay Abilities -----------------------------------------------------------------------------------------

		void Abilities()
		{
			for (const bool bWith : { true, false })
			{
				FSubject S = Spawn();
				const bool bSpecBefore = HasHoldSpec(S);
				UGameplayEffect* Effect = NewEffect(EGameplayEffectDurationType::Infinite);
				if (bWith)
				{
					FGameplayAbilitySpecConfig Config;
					Config.Ability = UGasNativeHoldAbility::StaticClass();
					Effect->AddComponent<UAbilitiesGameplayEffectComponent>().AddGrantedAbilityConfig(Config);
				}
				const FActiveGameplayEffectHandle Handle = Apply(S, Effect);
				const bool bSpecAfter = HasHoldSpec(S);
				const bool bActivated = bSpecAfter && S.Asc->TryActivateAbilityByClass(UGasNativeHoldAbility::StaticClass());
				TSharedPtr<FJsonObject> O = Case(bWith ? TEXT("abilities_granted") : TEXT("abilities_control"), TEXT("Abilities"), bWith ? TEXT("effect") : TEXT("control"));
				O->SetBoolField(TEXT("applied"), Handle.IsValid());
				O->SetBoolField(TEXT("spec_before"), bSpecBefore);
				O->SetBoolField(TEXT("spec_after_apply"), bSpecAfter);
				O->SetBoolField(TEXT("activation_returned"), bActivated);
			}
			{	// the effect is removed: the granted ability goes with it (the default removal policy cancels and clears it)
				FSubject S = Spawn();
				UGameplayEffect* Effect = NewEffect(EGameplayEffectDurationType::Infinite);
				FGameplayAbilitySpecConfig Config;
				Config.Ability = UGasNativeHoldAbility::StaticClass();
				Effect->AddComponent<UAbilitiesGameplayEffectComponent>().AddGrantedAbilityConfig(Config);
				const FActiveGameplayEffectHandle Handle = Apply(S, Effect);
				const bool bSpecAfterApply = HasHoldSpec(S);
				S.Asc->RemoveActiveGameplayEffect(Handle);
				TSharedPtr<FJsonObject> O = Case(TEXT("abilities_removed"), TEXT("Abilities"), TEXT("effect"));
				O->SetBoolField(TEXT("spec_after_apply"), bSpecAfterApply);
				O->SetBoolField(TEXT("spec_after_removal"), HasHoldSpec(S));
			}
		}
	};
}

void GasNativeCases::Run(UWorld* World, TFunction<void(float)> Advance, TArray<TSharedPtr<FJsonValue>>& OutRows)
{
	FRunner(World, MoveTemp(Advance), OutRows).RunAll();
}
