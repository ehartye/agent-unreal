#include "GasNativeRep.h"
#include "AbilitySystemComponent.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "GameFramework/DefaultPawn.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/GameStateBase.h"
#include "GameFramework/PlayerController.h"
#include "GasNativeAttributeSet.h"
#include "GasNativeTags.h"
#include "HAL/PlatformMisc.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Net/UnrealNetwork.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

DEFINE_LOG_CATEGORY_STATIC(LogGasNativeRep, Log, All);

namespace
{
	// Seconds, counted from when each process sees the scenario start. The server starts at PostLogin, the client at its player
	// state's BeginPlay. The values leave room for the client to load the map after the server logs the join.
	constexpr float ClientBeforeAt = 3.f;       // client: snapshot, then try the activation
	constexpr float ClientSettleFor = 2.f;      // client: wait this long, snapshot again, write the receipt
	constexpr float ServerSnapshotEvery = 0.25f; // server: refresh the "after" snapshot this often while the client is connected (the client's clock runs ahead of the server's wall clock, so no fixed time catches it)
	constexpr float ServerReceiptAt = 8.f;      // server: write the receipt
	constexpr float ServerFallbackAt = 90.f;    // server: no client ever joined, write the receipt anyway

	const TCHAR* NetModeName(ENetMode Mode)
	{
		switch (Mode)
		{
		case NM_Standalone: return TEXT("Standalone");
		case NM_DedicatedServer: return TEXT("DedicatedServer");
		case NM_ListenServer: return TEXT("ListenServer");
		case NM_Client: return TEXT("Client");
		default: return TEXT("Unknown");
		}
	}

	const TCHAR* RoleName(ENetRole Role)
	{
		switch (Role)
		{
		case ROLE_None: return TEXT("None");
		case ROLE_SimulatedProxy: return TEXT("SimulatedProxy");
		case ROLE_AutonomousProxy: return TEXT("AutonomousProxy");
		case ROLE_Authority: return TEXT("Authority");
		default: return TEXT("Unknown");
		}
	}

	const TCHAR* ReplicationModeName(EGameplayEffectReplicationMode Mode)
	{
		switch (Mode)
		{
		case EGameplayEffectReplicationMode::Minimal: return TEXT("Minimal");
		case EGameplayEffectReplicationMode::Mixed: return TEXT("Mixed");
		case EGameplayEffectReplicationMode::Full: return TEXT("Full");
		default: return TEXT("Unknown");
		}
	}

	/** Writes the receipt to the file named by -RepReceipt=<path> on this process's command line. */
	void WriteReceipt(const TSharedRef<FJsonObject>& Root)
	{
		FString Path;
		FParse::Value(FCommandLine::Get(), TEXT("RepReceipt="), Path);
		FString Json;
		TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Json);
		FJsonSerializer::Serialize(Root, Writer);
		if (!Path.IsEmpty()) { FFileHelper::SaveStringToFile(Json, *Path); }
		UE_LOG(LogGasNativeRep, Display, TEXT("GasNativeRep: receipt written to '%s'"), *Path);
	}
}

// ---- attribute set, effects, ability -------------------------------------------------------------------------------------------

void UGasNativeRepAttributeSet::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);
	DOREPLIFETIME_CONDITION_NOTIFY(UGasNativeRepAttributeSet, Energy, COND_None, REPNOTIFY_Always);
}

void UGasNativeRepAttributeSet::OnRep_Energy(const FGameplayAttributeData& OldValue)
{
	GAMEPLAYATTRIBUTE_REPNOTIFY(UGasNativeRepAttributeSet, Energy, OldValue);
}

UGasNativeRepCostEffect::UGasNativeRepCostEffect()
{
	DurationPolicy = EGameplayEffectDurationType::Instant;
	FGameplayModifierInfo Info;
	Info.Attribute = UGasNativeRepAttributeSet::GetEnergyAttribute();
	Info.ModifierOp = EGameplayModOp::Additive;
	Info.ModifierMagnitude = FGameplayEffectModifierMagnitude(FScalableFloat(-10.f));
	Modifiers.Add(Info);
}

UGasNativeRepBuffEffect::UGasNativeRepBuffEffect()
{
	FGameplayModifierInfo Info;
	Info.Attribute = UGasNativeRepAttributeSet::GetEnergyAttribute();
	Info.ModifierOp = EGameplayModOp::Additive;
	Info.ModifierMagnitude = FGameplayEffectModifierMagnitude(FScalableFloat(5.f));
	Modifiers.Add(Info);
	MakeInfinite(Tag_GasNative_Rep_Buff.GetTag());
}

UGasNativeRepAbility::UGasNativeRepAbility()
{
	InstancingPolicy = EGameplayAbilityInstancingPolicy::InstancedPerActor;
	NetExecutionPolicy = EGameplayAbilityNetExecutionPolicy::LocalPredicted;   // the default, written out because the scenario depends on it
	FGameplayTagContainer Tags;
	Tags.AddTag(Tag_GasNative_Ability_Rep.GetTag());
	SetAssetTags(Tags);
	CostGameplayEffectClass = UGasNativeRepCostEffect::StaticClass();
}

void UGasNativeRepAbility::ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo,
	const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData)
{
	if (ActorInfo)
	{
		if (AGasNativeRepPlayerState* State = Cast<AGasNativeRepPlayerState>(ActorInfo->OwnerActor.Get()))
		{
			if (ActorInfo->IsNetAuthority()) { ++State->ActivationsAuthority; } else { ++State->ActivationsPredicted; }
		}
	}
	const bool bCommitted = CommitAbility(Handle, ActorInfo, ActivationInfo);
	EndAbility(Handle, ActorInfo, ActivationInfo, true, !bCommitted);
}

// ---- player state --------------------------------------------------------------------------------------------------------------

AGasNativeRepPlayerState::AGasNativeRepPlayerState()
{
	Asc = CreateDefaultSubobject<UAbilitySystemComponent>(TEXT("Asc"));
	Asc->SetIsReplicated(true);
	Asc->SetReplicationMode(EGameplayEffectReplicationMode::Mixed);
	// A default subobject attribute set is found by the component in InitializeComponent, on both sides.
	RepSet = CreateDefaultSubobject<UGasNativeRepAttributeSet>(TEXT("RepSet"));
	RepSet->InitEnergy(100.f);
	// Player states replicate rarely by default; the scenario has seconds, not minutes.
	SetNetUpdateFrequency(100.f);
}

void AGasNativeRepPlayerState::BeginPlay()
{
	Super::BeginPlay();
	UE_LOG(LogGasNativeRep, Display, TEXT("GasNativeRep: player state begin play, net mode %s, role %s"), NetModeName(GetNetMode()), RoleName(GetLocalRole()));
	if (GetNetMode() == NM_Client && !bClientScenarioStarted)
	{
		bClientScenarioStarted = true;
		GetWorldTimerManager().SetTimer(ClientTimer, FTimerDelegate::CreateUObject(this, &AGasNativeRepPlayerState::ClientBefore), ClientBeforeAt, false);
	}
}

void AGasNativeRepPlayerState::ServerGrantAndBuff()
{
	// The pawn is the avatar, the player state stays the owner: a player state is a simulated proxy on its owning client, and an ability
	// is not activatable when its avatar is one (UGameplayAbility::CanActivateAbility, ShouldActivateAbility).
	if (APawn* PlayerPawn = GetPawn()) { Asc->InitAbilityActorInfo(this, PlayerPawn); }
	Asc->GiveAbility(FGameplayAbilitySpec(UGasNativeRepAbility::StaticClass(), 1));
	Asc->ApplyGameplayEffectToSelf(GetDefault<UGasNativeRepBuffEffect>(), 1.f, Asc->MakeEffectContext());
}

TSharedRef<FJsonObject> AGasNativeRepPlayerState::Snapshot() const
{
	TSharedRef<FJsonObject> S = MakeShared<FJsonObject>();
	S->SetStringField(TEXT("net_mode"), NetModeName(GetNetMode()));
	S->SetStringField(TEXT("local_role"), RoleName(GetLocalRole()));
	S->SetStringField(TEXT("remote_role"), RoleName(GetRemoteRole()));
	S->SetBoolField(TEXT("has_authority"), HasAuthority());
	const APlayerController* Controller = GetPlayerController();
	S->SetBoolField(TEXT("has_player_controller"), Controller != nullptr);
	S->SetBoolField(TEXT("is_local_controller"), Controller && Controller->IsLocalController());
	S->SetBoolField(TEXT("asc_replicates"), Asc->GetIsReplicated());
	S->SetStringField(TEXT("replication_mode"), ReplicationModeName(Asc->ReplicationMode));
	S->SetBoolField(TEXT("asc_owner_is_player_state"), Asc->GetOwnerActor() == this);
	S->SetBoolField(TEXT("asc_avatar_is_player_state"), Asc->GetAvatarActor() == this);
	const APawn* PlayerPawn = GetPawn();
	S->SetBoolField(TEXT("pawn_present"), PlayerPawn != nullptr);
	S->SetStringField(TEXT("pawn_local_role"), PlayerPawn ? RoleName(PlayerPawn->GetLocalRole()) : TEXT("none"));
	const AActor* Avatar = Asc->GetAvatarActor();
	S->SetStringField(TEXT("avatar_local_role"), Avatar ? RoleName(Avatar->GetLocalRole()) : TEXT("none"));
	S->SetBoolField(TEXT("asc_avatar_is_pawn"), PlayerPawn && Avatar == PlayerPawn);
	S->SetBoolField(TEXT("actor_info_has_player_controller"), Asc->AbilityActorInfo.IsValid() && Asc->AbilityActorInfo->PlayerController.IsValid());
	S->SetBoolField(TEXT("actor_info_locally_controlled"), Asc->AbilityActorInfo.IsValid() && Asc->AbilityActorInfo->IsLocallyControlled());

	TArray<TSharedPtr<FJsonValue>> Abilities;
	for (const FGameplayAbilitySpec& Spec : Asc->GetActivatableAbilities())
	{
		if (Spec.Ability) { Abilities.Add(MakeShared<FJsonValueString>(Spec.Ability->GetClass()->GetName())); }
	}
	S->SetNumberField(TEXT("ability_count"), Abilities.Num());
	S->SetArrayField(TEXT("abilities"), Abilities);
	S->SetBoolField(TEXT("rep_ability_present"), Asc->FindAbilitySpecFromClass(UGasNativeRepAbility::StaticClass()) != nullptr);

	S->SetNumberField(TEXT("effect_count"), Asc->GetNumActiveGameplayEffects());
	S->SetBoolField(TEXT("buff_tag"), Asc->HasMatchingGameplayTag(Tag_GasNative_Rep_Buff.GetTag()));

	const bool bSetFound = Asc->GetSet<UGasNativeRepAttributeSet>() != nullptr;
	S->SetBoolField(TEXT("attribute_set_found"), bSetFound);
	if (bSetFound)
	{
		S->SetNumberField(TEXT("energy_current"), Asc->GetNumericAttribute(UGasNativeRepAttributeSet::GetEnergyAttribute()));
		S->SetNumberField(TEXT("energy_base"), Asc->GetNumericAttributeBase(UGasNativeRepAttributeSet::GetEnergyAttribute()));
	}
	S->SetNumberField(TEXT("activations_authority"), ActivationsAuthority);
	S->SetNumberField(TEXT("activations_predicted"), ActivationsPredicted);
	return S;
}

void AGasNativeRepPlayerState::ClientBefore()
{
	ClientReceipt = MakeShared<FJsonObject>();
	ClientReceipt->SetStringField(TEXT("role"), TEXT("client"));
	ClientReceipt->SetStringField(TEXT("net_mode"), NetModeName(GetNetMode()));
	TSharedRef<FJsonObject> Phases = MakeShared<FJsonObject>();
	ClientReceipt->SetObjectField(TEXT("phases"), Phases);
	Phases->SetObjectField(TEXT("before"), Snapshot());

	// The client asks to activate the ability it was granted. A spec that never arrived is recorded, not retried.
	TSharedRef<FJsonObject> Activation = MakeShared<FJsonObject>();
	if (GEngine) { GEngine->Exec(GetWorld(), TEXT("Log LogAbilitySystem VeryVerbose")); }   // the refusal reasons are logged at Log and Verbose
	const bool bHasSpec = Asc->FindAbilitySpecFromClass(UGasNativeRepAbility::StaticClass()) != nullptr;
	Activation->SetBoolField(TEXT("had_spec"), bHasSpec);
	bool bReturned = false;
	if (bHasSpec) { bReturned = Asc->TryActivateAbilityByClass(UGasNativeRepAbility::StaticClass()); }
	Activation->SetBoolField(TEXT("try_activate_returned"), bReturned);
	Activation->SetNumberField(TEXT("predicted_count_right_after_call"), ActivationsPredicted);
	if (bHasSpec && !bReturned)
	{
		if (const FGameplayAbilitySpec* Spec = Asc->FindAbilitySpecFromClass(UGasNativeRepAbility::StaticClass()))
		{
			FGameplayTagContainer Failed;
			Activation->SetBoolField(TEXT("can_activate_ability_before_reinit"), Spec->Ability && Asc->AbilityActorInfo.IsValid() && Spec->Ability->CanActivateAbility(Spec->Handle, Asc->AbilityActorInfo.Get(), nullptr, nullptr, &Failed));
			Activation->SetStringField(TEXT("can_activate_failure_tags"), Failed.ToStringSimple());
		}
		// The actor info was filled in when the component initialised, with the player state as owner and avatar. Fill it in again with the
		// pawn as avatar (the pattern the server uses) and ask once more; both answers are recorded.
		Asc->InitAbilityActorInfo(this, GetPawn() ? static_cast<AActor*>(GetPawn()) : static_cast<AActor*>(this));
		Activation->SetBoolField(TEXT("reinit_actor_info_locally_controlled"), Asc->AbilityActorInfo.IsValid() && Asc->AbilityActorInfo->IsLocallyControlled());
		const bool bAgain = Asc->TryActivateAbilityByClass(UGasNativeRepAbility::StaticClass());
		Activation->SetBoolField(TEXT("try_activate_after_reinit"), bAgain);
		Activation->SetNumberField(TEXT("predicted_count_after_reinit"), ActivationsPredicted);
	}
	ClientReceipt->SetObjectField(TEXT("activation"), Activation);

	UE_LOG(LogGasNativeRep, Display, TEXT("GasNativeRep: client activation called, had spec %d, returned %d"), bHasSpec, bReturned);
	GetWorldTimerManager().SetTimer(ClientTimer, FTimerDelegate::CreateUObject(this, &AGasNativeRepPlayerState::ClientAfter), ClientSettleFor, false);
}

void AGasNativeRepPlayerState::ClientAfter()
{
	if (ClientReceipt.IsValid())
	{
		ClientReceipt->GetObjectField(TEXT("phases"))->SetObjectField(TEXT("after"), Snapshot());
		WriteReceipt(ClientReceipt.ToSharedRef());
	}
	FPlatformMisc::RequestExit(false);
}

// ---- game mode -----------------------------------------------------------------------------------------------------------------

AGasNativeRepGameMode::AGasNativeRepGameMode()
{
	PlayerStateClass = AGasNativeRepPlayerState::StaticClass();
}

void AGasNativeRepGameMode::BeginPlay()
{
	Super::BeginPlay();
	// The engine listens before it calls BeginPlay, so this line means a client can connect.
	UE_LOG(LogGasNativeRep, Display, TEXT("GasNativeRep: server ready, net mode %s"), NetModeName(GetNetMode()));
	GetWorldTimerManager().SetTimer(FallbackTimer, FTimerDelegate::CreateLambda([this]() { WriteServerReceipt(false); }), ServerFallbackAt, false);
}

void AGasNativeRepGameMode::PostLogin(APlayerController* NewPlayer)
{
	Super::PostLogin(NewPlayer);
	if (bClientSeen || !NewPlayer) { return; }
	if (!NewPlayer->GetPawn())
	{
		// The engine's Entry map has no player start, so no pawn was spawned: spawn the default pawn at the origin and possess it.
		FActorSpawnParameters Params;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		if (APawn* Spawned = GetWorld()->SpawnActor<APawn>(DefaultPawnClass, FTransform::Identity, Params)) { NewPlayer->Possess(Spawned); }
	}
	AGasNativeRepPlayerState* State = NewPlayer->GetPlayerState<AGasNativeRepPlayerState>();
	if (!State)
	{
		UE_LOG(LogGasNativeRep, Warning, TEXT("GasNativeRep: the joining player has no AGasNativeRepPlayerState"));
		return;
	}
	bClientSeen = true;
	State->ServerGrantAndBuff();
	Joined = State->Snapshot();
	UE_LOG(LogGasNativeRep, Display, TEXT("GasNativeRep: client joined, ability granted and buff applied"));
	GetWorldTimerManager().ClearTimer(FallbackTimer);
	JoinedState = State;
	GetWorldTimerManager().SetTimer(AfterTimer, FTimerDelegate::CreateLambda([this]() { if (JoinedState.IsValid()) { After = JoinedState->Snapshot(); AfterPlayerCount = GetNumPlayers(); } }), ServerSnapshotEvery, true);
	GetWorldTimerManager().SetTimer(ReceiptTimer, FTimerDelegate::CreateLambda([this]() { WriteServerReceipt(true); }), ServerReceiptAt, false);
}

void AGasNativeRepGameMode::WriteServerReceipt(bool bClientJoined)
{
	TSharedRef<FJsonObject> Root = MakeShared<FJsonObject>();
	Root->SetStringField(TEXT("role"), TEXT("server"));
	Root->SetStringField(TEXT("net_mode"), NetModeName(GetNetMode()));
	Root->SetBoolField(TEXT("client_joined"), bClientJoined);
	Root->SetNumberField(TEXT("player_count"), GetNumPlayers());
	Root->SetNumberField(TEXT("player_count_at_after"), AfterPlayerCount);
	TSharedRef<FJsonObject> Phases = MakeShared<FJsonObject>();
	Root->SetObjectField(TEXT("phases"), Phases);
	if (Joined.IsValid()) { Phases->SetObjectField(TEXT("joined"), Joined); }
	// The client has left by now; the "after" snapshot is the last one taken while it was still connected.
	if (After.IsValid()) { Phases->SetObjectField(TEXT("after"), After); }
	WriteReceipt(Root);
	FPlatformMisc::RequestExit(false);
}
