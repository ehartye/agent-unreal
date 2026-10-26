#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Physics/Experimental/ChaosEventType.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "ChaosBreakRunSubsystem.generated.h"

class AGeometryCollectionActor;
class UGeometryCollection;
class UGeometryCollectionComponent;

/**
 * Runs break scenarios inside a game process and writes a JSON report. It exists only when the command line carries -CBScenarios=.
 *
 *   -CBScenarios="label|/Game/Chaos/GC_Healthy.GC_Healthy|strain|deferred;label2|<asset>|none|deferred"
 *   -CBReport=<path of the JSON report>
 *
 * Each scenario is label|asset object path|action|spawn.
 *   action: none (control, nothing is applied), strain (ApplyExternalStrain, then CrumbleActiveClusters), noproxy (destroy the physics
 *           state first, then the same calls: they are silent no-ops without a physics proxy).
 *   spawn:  deferred (SpawnActorDeferred, SetRestCollection, FinishSpawning) or late (FinishSpawning, then SetRestCollection).
 * Every scenario is spawned far above the floor, so an intact one is still falling when the run ends.
 */
UCLASS()
class UChaosBreakRunSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override;
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

private:
	struct FScenario
	{
		FString Label;
		FString AssetPath;
		FString Action;
		FString Spawn;
		bool bAssetLoaded = false;
		bool bSpawned = false;
		bool bHasProxyAtStrain = false;
		int32 NumTransforms = 0;
		int32 BreaksAfterStrain = 0;
		int32 BreaksFinal = 0;
		float FirstBreakSeconds = -1.f;   // run time of the first break event, -1 when none
		float FirstBreakZ = 0.f;          // world height of the first breaking piece (centimetres)
		float FirstBreakVelocityZ = 0.f;  // vertical velocity of the first breaking piece (cm/s)
		bool bFirstBreakFromCrumble = false;
		TSet<int32> DistinctIndices;
		TWeakObjectPtr<AGeometryCollectionActor> Actor;
	};

	bool Tick(float DeltaSeconds);
	void SpawnAll(UWorld* World);
	void ApplyStrain();
	void Crumble();
	void WriteReportAndQuit(UWorld* World);

	UFUNCTION()
	void OnBreak(const FChaosBreakEvent& BreakEvent);

	TArray<FScenario> Scenarios;
	FString ReportPath;
	FTSTicker::FDelegateHandle TickHandle;
	float RunSeconds = 0.f;
	float PhaseStart = 0.f;
	int32 Phase = 0;
	TArray<FString> Errors;

	// Keeps the loaded assets alive while the run lasts.
	UPROPERTY(Transient)
	TArray<TObjectPtr<UGeometryCollection>> LoadedAssets;
};
