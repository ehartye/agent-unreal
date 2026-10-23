#include "GasNativeProbe.h"
#include "AbilitySystemComponent.h"
#include "Abilities/GameplayAbility.h"
#include "Dom/JsonObject.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "GameplayEffectComponents/TargetTagsGameplayEffectComponent.h"
#include "GasNativeAbility.h"
#include "GasNativeAttributeSet.h"
#include "GasNativeEffects.h"
#include "GasNativeTags.h"
#include "CoreGlobals.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

DEFINE_LOG_CATEGORY_STATIC(LogGasNativeProbe, Log, All);

AGasNativeActor::AGasNativeActor()
{
	Asc = CreateDefaultSubobject<UAbilitySystemComponent>(TEXT("Asc"));
}

namespace
{
	constexpr float Step = 0.1f;

	TArray<TSharedPtr<FJsonValue>> TagList(const FGameplayTagContainer& Tags)
	{
		TArray<TSharedPtr<FJsonValue>> Out;
		for (const FGameplayTag& Tag : Tags) { Out.Add(MakeShared<FJsonValueString>(Tag.ToString())); }
		return Out;
	}
}

int32 UGasNativeProbeCommandlet::Main(const FString& Params)
{
	FString ReportPath;
	FParse::Value(*Params, TEXT("Report="), ReportPath);
	TSharedRef<FJsonObject> Report = MakeShared<FJsonObject>();
	TSharedRef<FJsonObject> Classes = MakeShared<FJsonObject>();
	TSharedRef<FJsonObject> Steps = MakeShared<FJsonObject>();
	Report->SetObjectField(TEXT("classes"), Classes);
	Report->SetObjectField(TEXT("steps"), Steps);

	// What the constructors produced, read from the class default objects.
	const UGasNativeCooldownEffect* Cooldown = GetDefault<UGasNativeCooldownEffect>();
	const UTargetTagsGameplayEffectComponent* Granted = Cooldown->FindComponent<UTargetTagsGameplayEffectComponent>();
	Classes->SetBoolField(TEXT("cooldown_component_present"), Granted != nullptr);
	Classes->SetArrayField(TEXT("cooldown_granted_tags"), TagList(Cooldown->GetGrantedTags()));
	Classes->SetBoolField(TEXT("cooldown_has_duration"), Cooldown->DurationPolicy == EGameplayEffectDurationType::HasDuration);
	const UGasNativeAbility* AbilityCdo = GetDefault<UGasNativeAbility>();
	Classes->SetArrayField(TEXT("ability_asset_tags"), TagList(AbilityCdo->GetAssetTags()));
	Classes->SetBoolField(TEXT("cost_effect_set"), AbilityCdo->GetCostGameplayEffect() != nullptr);
	Classes->SetBoolField(TEXT("cooldown_effect_set"), AbilityCdo->GetCooldownGameplayEffect() != nullptr);
	const FGameplayTagContainer* AbilityCooldownTags = AbilityCdo->GetCooldownTags();
	Classes->SetArrayField(TEXT("ability_cooldown_tags"), TagList(AbilityCooldownTags ? *AbilityCooldownTags : FGameplayTagContainer()));

	// A game world with no map, and one actor.
	UWorld* World = UWorld::CreateWorld(EWorldType::Game, false, TEXT("GasNativeWorld"));
	FWorldContext& Context = GEngine->CreateNewWorldContext(EWorldType::Game);
	Context.SetCurrentWorld(World);
	World->InitializeActorsForPlay(FURL());
	World->BeginPlay();
	AGasNativeActor* Actor = World->SpawnActor<AGasNativeActor>();
	UAbilitySystemComponent* Asc = Actor->Asc;
	Asc->InitAbilityActorInfo(Actor, Actor);
	UGasNativeAttributeSet* Set = NewObject<UGasNativeAttributeSet>(Actor);
	Set->InitCharge(100.f);
	Asc->AddAttributeSetSubobject(Set);
	const FGameplayAbilitySpecHandle Handle = Asc->GiveAbility(FGameplayAbilitySpec(UGasNativeAbility::StaticClass(), 1));
	const FGameplayAttribute ChargeAttribute = UGasNativeAttributeSet::GetChargeAttribute();
	const FGameplayTag CooldownTag = Tag_GasNative_Cooldown_Pulse.GetTag();
	float SimTime = 0.f;
	// A timer manager skips a tick that happens in the frame it last ticked, so the loop advances the frame counter as the engine loop does.
	auto Tick = [&]() { ++GFrameCounter; World->Tick(LEVELTICK_All, Step); SimTime += Step; };
	auto AbilityActive = [&]() { const FGameplayAbilitySpec* Spec = Asc->FindAbilitySpecFromHandle(Handle); return Spec && Spec->IsActive(); };
	auto Snapshot = [&](const TCHAR* Name, TFunction<void(FJsonObject&)> Extra = nullptr)
	{
		TSharedRef<FJsonObject> S = MakeShared<FJsonObject>();
		S->SetNumberField(TEXT("sim_time"), SimTime);
		S->SetNumberField(TEXT("world_time"), World->GetTimeSeconds());
		S->SetNumberField(TEXT("charge"), Asc->GetNumericAttribute(ChargeAttribute));
		S->SetBoolField(TEXT("cooldown_tag"), Asc->HasMatchingGameplayTag(CooldownTag));
		S->SetBoolField(TEXT("ability_active"), AbilityActive());
		if (Extra) { Extra(*S); }
		Steps->SetObjectField(Name, S);
	};

	Snapshot(TEXT("start"));

	// 1. Activate: the cost is paid, the cooldown tag appears, the ability stays active for its half-second task.
	const bool First = Asc->TryActivateAbilityByClass(UGasNativeAbility::StaticClass());
	Snapshot(TEXT("first"), [&](FJsonObject& S) { S.SetBoolField(TEXT("activated"), First); });

	// 2. Activate again while the tag is present: refused, and nothing is paid.
	FGameplayTagContainer Relevant;
	const FGameplayAbilitySpec* Spec = Asc->FindAbilitySpecFromHandle(Handle);
	const UGameplayAbility* Instance = Spec ? Spec->GetPrimaryInstance() : nullptr;
	const bool CanWhileCooling = Instance && Instance->CanActivateAbility(Handle, Asc->AbilityActorInfo.Get(), nullptr, nullptr, &Relevant);
	const bool Second = Asc->TryActivateAbilityByClass(UGasNativeAbility::StaticClass());
	Snapshot(TEXT("refused"), [&](FJsonObject& S)
	{
		S.SetBoolField(TEXT("activated"), Second);
		S.SetBoolField(TEXT("can_activate"), CanWhileCooling);
		S.SetArrayField(TEXT("relevant_tags"), TagList(Relevant));
	});

	// 3. Tick the world: the task ends the ability after 0.5 s; the tag stays until 2 s.
	float AbilityEndedAt = -1.f;
	float TagGoneAt = -1.f;
	for (int32 i = 0; i < 60 && TagGoneAt < 0.f; ++i)
	{
		Tick();
		if (AbilityEndedAt < 0.f && !AbilityActive()) { AbilityEndedAt = SimTime; }
		if (!Asc->HasMatchingGameplayTag(CooldownTag)) { TagGoneAt = SimTime; }
		else if (FMath::IsNearlyEqual(SimTime, 1.f, Step * 0.5f)) { Snapshot(TEXT("mid_cooldown")); }
	}
	Snapshot(TEXT("expired"), [&](FJsonObject& S)
	{
		S.SetNumberField(TEXT("ability_ended_at"), AbilityEndedAt);
		S.SetNumberField(TEXT("tag_gone_at"), TagGoneAt);
	});

	// 4. Activate once the cooldown has expired.
	const bool Third = Asc->TryActivateAbilityByClass(UGasNativeAbility::StaticClass());
	Snapshot(TEXT("again"), [&](FJsonObject& S) { S.SetBoolField(TEXT("activated"), Third); });

	// 5. An effect built at run time, outside any constructor, may use AddComponent.
	{
		UGameplayEffect* Dynamic = NewObject<UGameplayEffect>(GetTransientPackage(), TEXT("DynamicEffect"));
		Dynamic->DurationPolicy = EGameplayEffectDurationType::Infinite;
		UTargetTagsGameplayEffectComponent& Component = Dynamic->AddComponent<UTargetTagsGameplayEffectComponent>();
		FInheritedTagContainer Mods;
		Mods.AddTag(Tag_GasNative_Dynamic.GetTag());
		Component.SetAndApplyTargetTagChanges(Mods);
		const FActiveGameplayEffectHandle Applied = Asc->ApplyGameplayEffectToSelf(Dynamic, 1.f, Asc->MakeEffectContext());
		TSharedRef<FJsonObject> S = MakeShared<FJsonObject>();
		S->SetBoolField(TEXT("applied"), Applied.IsValid());
		S->SetBoolField(TEXT("tag_present"), Asc->HasMatchingGameplayTag(Tag_GasNative_Dynamic.GetTag()));
		Steps->SetObjectField(TEXT("runtime_add_component"), S);
	}

	FString Json;
	TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Json);
	FJsonSerializer::Serialize(Report, Writer);
	if (!ReportPath.IsEmpty()) { FFileHelper::SaveStringToFile(Json, *ReportPath); }
	UE_LOG(LogGasNativeProbe, Display, TEXT("GasNativeProbe report written"));

	GEngine->DestroyWorldContext(World);
	World->DestroyWorld(false);
	return 0;
}
