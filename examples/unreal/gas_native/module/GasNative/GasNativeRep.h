#pragma once

#include "AbilitySystemComponent.h"
#include "AbilitySystemInterface.h"
#include "AttributeSet.h"
#include "Abilities/GameplayAbility.h"
#include "Dom/JsonObject.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/PlayerState.h"
#include "GasNativeEffects.h"
#include "TimerManager.h"
#include "GasNativeRep.generated.h"


/**
 * Replicated-play scenario: a dedicated server and one client, a player state that owns an Ability System Component in Mixed replication
 * mode, one granted ability, one infinite effect and one replicated attribute. Each process writes a JSON receipt (-RepReceipt=<file>)
 * after a fixed time; gas_rep.mjs starts both processes and judges the two receipts together.
 */

/** One replicated attribute. Energy replicates with OnRep_Energy, the pattern GAMEPLAYATTRIBUTE_REPNOTIFY documents. */
UCLASS()
class GASNATIVE_API UGasNativeRepAttributeSet : public UAttributeSet
{
	GENERATED_BODY()

public:
	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

	UPROPERTY(BlueprintReadOnly, ReplicatedUsing = OnRep_Energy, Category = "GasNative")
	FGameplayAttributeData Energy;
	ATTRIBUTE_ACCESSORS_BASIC(UGasNativeRepAttributeSet, Energy)

	UFUNCTION()
	void OnRep_Energy(const FGameplayAttributeData& OldValue);
};

/** Instant effect that subtracts 10 from Energy. The replicated ability's cost. */
UCLASS()
class GASNATIVE_API UGasNativeRepCostEffect : public UGasNativeEffectBase
{
	GENERATED_BODY()

public:
	UGasNativeRepCostEffect();
};

/** Infinite effect that adds 5 to Energy and grants GasNative.Rep.Buff. The server applies it to the player state's component. */
UCLASS()
class GASNATIVE_API UGasNativeRepBuffEffect : public UGasNativeEffectBase
{
	GENERATED_BODY()

public:
	UGasNativeRepBuffEffect();
};

/**
 * Locally predicted ability that costs 10 Energy and ends at once. It counts its activations on the player state, split by whether the
 * activation ran with authority (the server) or as a client prediction.
 */
UCLASS()
class GASNATIVE_API UGasNativeRepAbility : public UGameplayAbility
{
	GENERATED_BODY()

public:
	UGasNativeRepAbility();

	virtual void ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo,
		const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData) override;
};

/** The replicated actor under test: owns the component (Mixed) and the attribute set; the owning client is the player's connection. */
UCLASS()
class GASNATIVE_API AGasNativeRepPlayerState : public APlayerState, public IAbilitySystemInterface
{
	GENERATED_BODY()

public:
	AGasNativeRepPlayerState();

	virtual UAbilitySystemComponent* GetAbilitySystemComponent() const override { return Asc; }
	virtual void BeginPlay() override;

	/** Server only: grant the ability and apply the buff. */
	void ServerGrantAndBuff();

	/** What this process can see of the component right now. */
	TSharedRef<FJsonObject> Snapshot() const;

	/** Counted by UGasNativeRepAbility, not replicated. */
	int32 ActivationsAuthority = 0;
	int32 ActivationsPredicted = 0;

	UPROPERTY()
	TObjectPtr<UAbilitySystemComponent> Asc;

	UPROPERTY()
	TObjectPtr<UGasNativeRepAttributeSet> RepSet;

private:
	void ClientBefore();
	void ClientAfter();

	FTimerHandle ClientTimer;
	TSharedPtr<FJsonObject> ClientReceipt;
	bool bClientScenarioStarted = false;
};

/** Game mode for the dedicated server: the player state class above, and the server half of the scenario. */
UCLASS()
class GASNATIVE_API AGasNativeRepGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AGasNativeRepGameMode();

	virtual void BeginPlay() override;
	virtual void PostLogin(APlayerController* NewPlayer) override;

private:
	void WriteServerReceipt(bool bClientJoined);

	FTimerHandle ReceiptTimer;
	FTimerHandle AfterTimer;
	FTimerHandle FallbackTimer;
	TSharedPtr<FJsonObject> Joined;
	TSharedPtr<FJsonObject> After;
	int32 AfterPlayerCount = 0;
	TWeakObjectPtr<class AGasNativeRepPlayerState> JoinedState;
	bool bClientSeen = false;
};
