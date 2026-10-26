#include "ChaosBreakRunSubsystem.h"

#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "GeometryCollection/GeometryCollectionActor.h"
#include "GeometryCollection/GeometryCollectionComponent.h"
#include "GeometryCollection/GeometryCollectionObject.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformMisc.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"

DEFINE_LOG_CATEGORY_STATIC(LogChaosBreakProbe, Log, All);

namespace
{
	// Escapes a string for a JSON value. Labels and paths hold no control characters; the backslash and the quote are enough.
	FString JsonEscape(const FString& In)
	{
		return In.Replace(TEXT("\\"), TEXT("\\\\")).Replace(TEXT("\""), TEXT("\\\""));
	}

	// Seconds the run waits after play begins before it spawns, so the solver and the level are settled.
	constexpr float SettleSeconds = 2.0f;
	// Seconds an intact scenario falls before the strain; the strain is applied this long after the spawn.
	constexpr float FallBeforeStrainSeconds = 1.0f;
	constexpr float StrainToCrumbleSeconds = 0.75f;
	constexpr float CrumbleToReportSeconds = 1.0f;
	// Distance between scenarios, and the height they are spawned at (centimetres). 5000 cm of free fall lasts about 3.2 s.
	constexpr double ScenarioSpacing = 1500.0;
	constexpr double SpawnHeight = 5000.0;
}

bool UChaosBreakRunSubsystem::ShouldCreateSubsystem(UObject* Outer) const
{
	FString Value;
	return FParse::Value(FCommandLine::Get(), TEXT("CBScenarios="), Value) && !Value.IsEmpty();
}

void UChaosBreakRunSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	FString Spec;
	FParse::Value(FCommandLine::Get(), TEXT("CBScenarios="), Spec);
	FParse::Value(FCommandLine::Get(), TEXT("CBReport="), ReportPath);

	TArray<FString> Entries;
	Spec.ParseIntoArray(Entries, TEXT(";"), true);
	for (const FString& Entry : Entries)
	{
		TArray<FString> Fields;
		Entry.ParseIntoArray(Fields, TEXT("|"), false);
		if (Fields.Num() != 4)
		{
			Errors.Add(FString::Printf(TEXT("scenario '%s' does not have four fields"), *Entry));
			continue;
		}
		FScenario& Scenario = Scenarios.AddDefaulted_GetRef();
		Scenario.Label = Fields[0];
		Scenario.AssetPath = Fields[1];
		Scenario.Action = Fields[2];
		Scenario.Spawn = Fields[3];
	}
	UE_LOG(LogChaosBreakProbe, Display, TEXT("ChaosBreak probe: %d scenarios, report %s"), Scenarios.Num(), *ReportPath);
	TickHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateUObject(this, &UChaosBreakRunSubsystem::Tick), 0.0f);
}

void UChaosBreakRunSubsystem::Deinitialize()
{
	FTSTicker::GetCoreTicker().RemoveTicker(TickHandle);
	Super::Deinitialize();
}

bool UChaosBreakRunSubsystem::Tick(float DeltaSeconds)
{
	RunSeconds += DeltaSeconds;
	UGameInstance* Instance = GetGameInstance();
	UWorld* World = Instance ? Instance->GetWorld() : nullptr;
	if (Phase == 0)
	{
		if (World && World->HasBegunPlay() && RunSeconds > SettleSeconds)
		{
			SpawnAll(World);
			Phase = 1;
			PhaseStart = RunSeconds;
		}
	}
	else if (Phase == 1 && RunSeconds - PhaseStart > FallBeforeStrainSeconds)
	{
		ApplyStrain();
		Phase = 2;
		PhaseStart = RunSeconds;
	}
	else if (Phase == 2 && RunSeconds - PhaseStart > StrainToCrumbleSeconds)
	{
		for (FScenario& Scenario : Scenarios)
		{
			Scenario.BreaksAfterStrain = Scenario.BreaksFinal;
		}
		Crumble();
		Phase = 3;
		PhaseStart = RunSeconds;
	}
	else if (Phase == 3 && RunSeconds - PhaseStart > CrumbleToReportSeconds)
	{
		WriteReportAndQuit(World);
		Phase = 4;
	}
	return true;
}

void UChaosBreakRunSubsystem::SpawnAll(UWorld* World)
{
	int32 Index = 0;
	for (FScenario& Scenario : Scenarios)
	{
		UGeometryCollection* Asset = LoadObject<UGeometryCollection>(nullptr, *Scenario.AssetPath);
		Scenario.bAssetLoaded = Asset != nullptr;
		if (!Asset)
		{
			Errors.Add(FString::Printf(TEXT("scenario %s: asset %s did not load"), *Scenario.Label, *Scenario.AssetPath));
			++Index;
			continue;
		}
		LoadedAssets.Add(Asset);

		const FTransform Where(FRotator::ZeroRotator, FVector(ScenarioSpacing * Index, 0.0, SpawnHeight));
		AGeometryCollectionActor* Actor = World->SpawnActorDeferred<AGeometryCollectionActor>(AGeometryCollectionActor::StaticClass(), Where, nullptr, nullptr, ESpawnActorCollisionHandlingMethod::AlwaysSpawn);
		if (!Actor)
		{
			Errors.Add(FString::Printf(TEXT("scenario %s: the actor did not spawn"), *Scenario.Label));
			++Index;
			continue;
		}
		// The label ends up in the component's full name, which the engine prints in its "tried to create N particles with no geometry" line.
		Actor->Rename(*Scenario.Label, nullptr, REN_DontCreateRedirectors | REN_NonTransactional);
		UGeometryCollectionComponent* Component = Actor->GetGeometryCollectionComponent();
		if (Scenario.Spawn == TEXT("late"))
		{
			Actor->FinishSpawning(Where);
			Component->SetRestCollection(Asset);
		}
		else
		{
			Component->SetRestCollection(Asset);
			Actor->FinishSpawning(Where);
		}
		Component->SetNotifyBreaks(true);
		Component->OnChaosBreakEvent.AddDynamic(this, &UChaosBreakRunSubsystem::OnBreak);
		Scenario.Actor = Actor;
		Scenario.bSpawned = true;
		Scenario.NumTransforms = Component->GetNumElements(FName(TEXT("Transform")));
		++Index;
	}
}

void UChaosBreakRunSubsystem::ApplyStrain()
{
	for (FScenario& Scenario : Scenarios)
	{
		AGeometryCollectionActor* Actor = Scenario.Actor.Get();
		if (!Actor || Scenario.Action == TEXT("none"))
		{
			continue;
		}
		UGeometryCollectionComponent* Component = Actor->GetGeometryCollectionComponent();
		if (Scenario.Action == TEXT("noproxy"))
		{
			Component->DestroyPhysicsState();
		}
		Scenario.bHasProxyAtStrain = Component->GetPhysicsProxy() != nullptr;
		// Strain on the root item, a large radius around the actor, propagating through the hierarchy. The values are deliberately far above the asset's damage thresholds.
		Component->ApplyExternalStrain(Component->GetRootIndex(), Actor->GetActorLocation(), 1000.0f, 8, 1.0f, 1.0e7f);
	}
}

void UChaosBreakRunSubsystem::Crumble()
{
	for (FScenario& Scenario : Scenarios)
	{
		AGeometryCollectionActor* Actor = Scenario.Actor.Get();
		if (Actor && Scenario.Action != TEXT("none"))
		{
			Actor->GetGeometryCollectionComponent()->CrumbleActiveClusters();
		}
	}
}

void UChaosBreakRunSubsystem::OnBreak(const FChaosBreakEvent& BreakEvent)
{
	const AActor* Owner = BreakEvent.Component ? BreakEvent.Component->GetOwner() : nullptr;
	for (FScenario& Scenario : Scenarios)
	{
		if (Owner && Scenario.Actor.Get() == Owner)
		{
			++Scenario.BreaksFinal;
			Scenario.DistinctIndices.Add(BreakEvent.Index);
			return;
		}
	}
}

void UChaosBreakRunSubsystem::WriteReportAndQuit(UWorld* World)
{
	FString Json = TEXT("{\n");
	Json += FString::Printf(TEXT("  \"world\": \"%s\",\n"), World ? *JsonEscape(World->GetPathName()) : TEXT(""));
	Json += FString::Printf(TEXT("  \"gravityZ\": %.1f,\n"), World ? World->GetGravityZ() : 0.0f);
	Json += FString::Printf(TEXT("  \"runSeconds\": %.2f,\n"), RunSeconds);
	Json += TEXT("  \"scenarios\": [\n");
	for (int32 i = 0; i < Scenarios.Num(); ++i)
	{
		const FScenario& S = Scenarios[i];
		Json += FString::Printf(TEXT("    {\"label\": \"%s\", \"asset\": \"%s\", \"action\": \"%s\", \"spawn\": \"%s\", \"assetLoaded\": %s, \"spawned\": %s, \"hasProxyAtStrain\": %s, \"transforms\": %d, \"breaksAfterStrain\": %d, \"breaksFinal\": %d, \"distinctFinal\": %d}%s\n"),
			*JsonEscape(S.Label), *JsonEscape(S.AssetPath), *JsonEscape(S.Action), *JsonEscape(S.Spawn),
			S.bAssetLoaded ? TEXT("true") : TEXT("false"), S.bSpawned ? TEXT("true") : TEXT("false"), S.bHasProxyAtStrain ? TEXT("true") : TEXT("false"),
			S.NumTransforms, S.BreaksAfterStrain, S.BreaksFinal, S.DistinctIndices.Num(), i + 1 < Scenarios.Num() ? TEXT(",") : TEXT(""));
	}
	Json += TEXT("  ],\n  \"errors\": [");
	for (int32 i = 0; i < Errors.Num(); ++i)
	{
		Json += FString::Printf(TEXT("%s\"%s\""), i ? TEXT(", ") : TEXT(""), *JsonEscape(Errors[i]));
	}
	Json += TEXT("]\n}\n");

	if (!ReportPath.IsEmpty())
	{
		IFileManager::Get().MakeDirectory(*FPaths::GetPath(ReportPath), true);
		FFileHelper::SaveStringToFile(Json, *ReportPath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
	}
	UE_LOG(LogChaosBreakProbe, Display, TEXT("ChaosBreak probe: report written, requesting exit"));
	FPlatformMisc::RequestExit(false);
}
