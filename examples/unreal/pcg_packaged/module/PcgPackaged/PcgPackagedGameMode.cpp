#include "PcgPackagedGameMode.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Data/PCGBasePointData.h"
#include "Engine/GameInstance.h"
#include "Engine/LevelStreaming.h"
#include "Engine/StaticMesh.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/DefaultPawn.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformMisc.h"
#include "HAL/PlatformProperties.h"
#include "HAL/PlatformTime.h"
#include "Materials/Material.h"
#include "Materials/MaterialInterface.h"
#include "Misc/App.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "PCGComponent.h"
#include "PCGData.h"
#include "PCGGraph.h"
#include "PCGWorldActor.h"
#include "RHI.h"
#include "RHIGlobals.h"
#include "RuntimeGen/SchedulingPolicies/PCGSchedulingPolicyBase.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Subsystems/PCGSubsystem.h"
#include "UObject/UObjectGlobals.h"

namespace PcgPackagedDetail
{
TSharedPtr<FJsonValue> Num(double Value) { return MakeShared<FJsonValueNumber>(Value); }
TSharedPtr<FJsonValue> Obj(const TSharedRef<FJsonObject>& Value) { return MakeShared<FJsonValueObject>(Value); }

const TCHAR* TriggerName(EPCGComponentGenerationTrigger Trigger)
{
	switch (Trigger)
	{
	case EPCGComponentGenerationTrigger::GenerateOnLoad: return TEXT("GenerateOnLoad");
	case EPCGComponentGenerationTrigger::GenerateOnDemand: return TEXT("GenerateOnDemand");
	case EPCGComponentGenerationTrigger::GenerateAtRuntime: return TEXT("GenerateAtRuntime");
	}
	return TEXT("Unknown");
}

FString ArgString(const TCHAR* Key, const FString& Default)
{
	FString Value;
	return FParse::Value(FCommandLine::Get(), Key, Value, false) ? Value : Default;
}

double ArgDouble(const TCHAR* Key, double Default)
{
	const FString Text = ArgString(Key, FString());
	return Text.IsEmpty() ? Default : FCString::Atod(*Text);
}

FVector ArgVector(const TCHAR* Key, const FVector& Default)
{
	TArray<FString> Parts;
	ArgString(Key, FString()).ParseIntoArray(Parts, TEXT(","), true);
	if (Parts.Num() != 3) return Default;
	return FVector(FCString::Atod(*Parts[0]), FCString::Atod(*Parts[1]), FCString::Atod(*Parts[2]));
}

// The console variables the runtime generation scheduler reads; the receipt records their values in the game process.
const TCHAR* const CVarNames[] = {
	TEXT("pcg.RuntimeGeneration.Enable"), TEXT("pcg.RuntimeGeneration.EnableChangeDetection"), TEXT("pcg.RuntimeGeneration.NumGeneratingComponents"),
	TEXT("pcg.RuntimeGeneration.GlobalRadiusMultiplier"), TEXT("pcg.RuntimeGeneration.FramesBeforeFirstGenerate"),
	TEXT("pcg.RuntimeGeneration.TimeBetweenRuntimeGenSchedulerTicks"), TEXT("pcg.RuntimeGeneration.EnableWorldStreamingQueries"),
	TEXT("pcg.RuntimeGeneration.EnablePooling"), TEXT("pcg.RuntimeGeneration.BasePoolSize"),
};
}

APcgPackagedGameMode::APcgPackagedGameMode()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bTickEvenWhenPaused = true;
	PlayerControllerClass = APlayerController::StaticClass();
	DefaultPawnClass = ADefaultPawn::StaticClass();
}

void APcgPackagedGameMode::ReadCommandLine()
{
	using namespace PcgPackagedDetail;
	ModeName = ArgString(TEXT("PcgMode="), TEXT("runtime"));
	Mode = ModeName.Equals(TEXT("stream"), ESearchCase::IgnoreCase) ? EMode::Stream : EMode::Runtime;
	ReportPath = ArgString(TEXT("PcgReport="), FPaths::ProjectSavedDir() / TEXT("pcg-packaged.json"));
	ReportPath = FPaths::ConvertRelativePathToFull(ReportPath);
	WindowSeconds = ArgDouble(TEXT("PcgSeconds="), WindowSeconds);
	ManualSeconds = ArgDouble(TEXT("PcgManualSeconds="), ManualSeconds);
	bManual = !FParse::Param(FCommandLine::Get(), TEXT("PcgNoManual"));
	ArgString(TEXT("PcgAssets="), FString()).ParseIntoArray(AssetPaths, TEXT(","), true);
	OrphanPath = ArgString(TEXT("PcgOrphan="), FString());
	PointA = ArgVector(TEXT("PcgA="), PointA);
	PointB = ArgVector(TEXT("PcgB="), PointB);
	HoldA = ArgDouble(TEXT("PcgHoldA="), HoldA);
	Travel = ArgDouble(TEXT("PcgTravel="), Travel);
	HoldB = ArgDouble(TEXT("PcgHoldB="), HoldB);
}

void APcgPackagedGameMode::BeginPlay()
{
	Super::BeginPlay();
	ReadCommandLine();
	BeginSeconds = FPlatformTime::Seconds();
	RefreshTracked(0.0);
	UE_LOG(LogTemp, Display, TEXT("PCG PACKAGED mode=%s tracked=%d report=%s"), *ModeName, Tracked.Num(), *ReportPath);
	WriteReceipt(false);
}

void APcgPackagedGameMode::RefreshTracked(double T)
{
	UWorld* World = GetWorld();
	if (!World) return;
	for (TActorIterator<AActor> ActorIt(World); ActorIt; ++ActorIt)
	{
		TArray<UPCGComponent*> Components;
		ActorIt->GetComponents<UPCGComponent>(Components);
		for (UPCGComponent* Component : Components)
		{
			if (!Component || Component->IsLocalComponent()) continue;   // a partition actor's local components are counted through their actors
			bool bKnown = false;
			for (const FTracked& Known : Tracked)
			{
				if (Known.Component.Get() == Component) { bKnown = true; break; }
			}
			if (bKnown) continue;
			FTracked& Entry = Tracked.AddDefaulted_GetRef();
			Entry.Component = TWeakObjectPtr<UPCGComponent>(Component);
			Entry.ActorName = ActorIt->GetName();
			Entry.Trigger = PcgPackagedDetail::TriggerName(Component->GenerationTrigger);
			Entry.GraphPath = Component->GetGraph() ? Component->GetGraph()->GetPathName() : FString();
			Entry.PolicyClass = Component->SchedulingPolicy ? Component->SchedulingPolicy->GetClass()->GetName() : FString();
			Entry.bPartitioned = Component->IsPartitioned();
			Entry.bComponentless = Component->UseActorComponentlessGeneration();
			BindEvents(Tracked.Num() - 1);
		}
	}
	(void)T;
}

void APcgPackagedGameMode::BindEvents(int32 Index)
{
	UPCGComponent* Component = Tracked[Index].Component.Get();
	if (!Component) return;
	TWeakObjectPtr<APcgPackagedGameMode> WeakThis(this);
	Component->OnPCGGraphStartGeneratingDelegate.AddLambda([WeakThis, Index](UPCGComponent*)
	{
		APcgPackagedGameMode* Self = WeakThis.Get();
		if (!Self || !Self->Tracked.IsValidIndex(Index)) return;
		FTracked& Entry = Self->Tracked[Index];
		const double Seconds = FPlatformTime::Seconds() - Self->BeginSeconds;
		if (Entry.FirstStartS < 0.0) Entry.FirstStartS = Seconds;
		++Entry.StartEvents;
	});
	Component->OnPCGGraphGeneratedDelegate.AddLambda([WeakThis, Index](UPCGComponent*)
	{
		APcgPackagedGameMode* Self = WeakThis.Get();
		if (!Self || !Self->Tracked.IsValidIndex(Index)) return;
		FTracked& Entry = Self->Tracked[Index];
		const double Seconds = FPlatformTime::Seconds() - Self->BeginSeconds;
		if (Entry.FirstGeneratedS < 0.0) Entry.FirstGeneratedS = Seconds;
		Entry.LastGeneratedS = Seconds;
		++Entry.GeneratedEvents;
	});
}

void APcgPackagedGameMode::CountInstances(const AActor& Owner, FSnap& Out) const
{
	TArray<UInstancedStaticMeshComponent*> Isms;
	Owner.GetComponents<UInstancedStaticMeshComponent>(Isms);
	for (UInstancedStaticMeshComponent* Ism : Isms)
	{
		if (!Ism) continue;
		++Out.IsmComponents;
		Out.Instances += Ism->GetInstanceCount();
		if (Out.Mesh.IsEmpty() && Ism->GetStaticMesh()) Out.Mesh = Ism->GetStaticMesh()->GetPathName();
		if (Out.Material.IsEmpty())
		{
			if (UMaterialInterface* Material = Ism->GetMaterial(0))
			{
				Out.Material = Material->GetPathName();
				Out.bMaterialIsDefault = (Material == UMaterial::GetDefaultMaterial(MD_Surface));
				Out.bMaterialFlag = Material->GetUsageByFlag(MATUSAGE_InstancedStaticMeshes);
			}
		}
	}
	// The GPU-driven spawner makes procedural ISM components, which are not UInstancedStaticMeshComponent; they are counted through their blueprint-callable GetNumInstances.
	TArray<UPrimitiveComponent*> Primitives;
	Owner.GetComponents<UPrimitiveComponent>(Primitives);
	for (UPrimitiveComponent* Primitive : Primitives)
	{
		if (!Primitive || !Primitive->GetClass()->GetName().Contains(TEXT("ProceduralISM"))) continue;
		if (UFunction* Function = Primitive->FindFunction(TEXT("GetNumInstances")))
		{
			struct FCountParams { int32 ReturnValue = 0; } Params;
			Primitive->ProcessEvent(Function, &Params);
			Out.ProceduralInstances += Params.ReturnValue;
		}
	}
}

void APcgPackagedGameMode::Snapshot(const UPCGComponent& Component, FSnap& Out) const
{
	Out.bGenerated = Component.bGenerated;
	Out.bGenerating = Component.IsGenerating();
	for (const FPCGTaggedData& Tagged : Component.GetGeneratedGraphOutput().GetAllInputs())
	{
		++Out.OutputItems;
		if (const UPCGBasePointData* Points = Cast<const UPCGBasePointData>(Tagged.Data.Get())) Out.OutputPoints += Points->GetNumPoints();
	}
	if (const AActor* Owner = Component.GetOwner()) CountInstances(*Owner, Out);
}

TSharedRef<FJsonObject> APcgPackagedGameMode::SnapJson(const FSnap& Snap) const
{
	TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
	Json->SetBoolField(TEXT("generated"), Snap.bGenerated);
	Json->SetBoolField(TEXT("generating"), Snap.bGenerating);
	Json->SetNumberField(TEXT("output_items"), Snap.OutputItems);
	Json->SetNumberField(TEXT("output_points"), Snap.OutputPoints);
	Json->SetNumberField(TEXT("ism_components"), Snap.IsmComponents);
	Json->SetNumberField(TEXT("instances"), Snap.Instances);
	Json->SetNumberField(TEXT("procedural_instances"), Snap.ProceduralInstances);
	Json->SetStringField(TEXT("mesh"), Snap.Mesh);
	Json->SetStringField(TEXT("material"), Snap.Material);
	Json->SetBoolField(TEXT("material_flag_instanced_static_meshes"), Snap.bMaterialFlag);
	Json->SetBoolField(TEXT("material_is_default"), Snap.bMaterialIsDefault);
	return Json;
}

TSharedRef<FJsonObject> APcgPackagedGameMode::ComponentJson(const FTracked& Entry) const
{
	using namespace PcgPackagedDetail;
	TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
	Json->SetStringField(TEXT("actor"), Entry.ActorName);
	Json->SetStringField(TEXT("trigger"), Entry.Trigger);
	Json->SetStringField(TEXT("graph"), Entry.GraphPath);
	Json->SetStringField(TEXT("scheduling_policy"), Entry.PolicyClass);
	Json->SetBoolField(TEXT("partitioned"), Entry.bPartitioned);
	Json->SetBoolField(TEXT("componentless"), Entry.bComponentless);
	Json->SetBoolField(TEXT("alive"), Entry.Component.IsValid());
	Json->SetNumberField(TEXT("start_events"), Entry.StartEvents);
	Json->SetNumberField(TEXT("generated_events"), Entry.GeneratedEvents);
	Json->SetNumberField(TEXT("first_start_s"), Entry.FirstStartS);
	Json->SetNumberField(TEXT("first_generated_s"), Entry.FirstGeneratedS);
	Json->SetNumberField(TEXT("last_generated_s"), Entry.LastGeneratedS);
	Json->SetNumberField(TEXT("first_instances_s"), Entry.FirstInstancesS);
	Json->SetNumberField(TEXT("manual_generate_at_s"), Entry.ManualAtS);
	if (Entry.bHasInitial) Json->SetObjectField(TEXT("initial"), SnapJson(Entry.Initial));
	Json->SetObjectField(TEXT("final"), SnapJson(Entry.Last));
	Json->SetArrayField(TEXT("series"), Entry.Series);
	return Json;
}

TSharedRef<FJsonObject> APcgPackagedGameMode::WorldJson() const
{
	using namespace PcgPackagedDetail;
	TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
	UWorld* World = GetWorld();
	if (!World) return Json;
	Json->SetStringField(TEXT("world"), World->GetName());
	Json->SetBoolField(TEXT("partitioned_world"), World->IsPartitionedWorld());
	int32 WorldActors = 0;
	bool bTreatControllers = false;
	double GridSize = 0.0;
	for (TActorIterator<APCGWorldActor> It(World); It; ++It)
	{
		++WorldActors;
		bTreatControllers = It->bTreatPlayerControllersAsGenerationSources;
		GridSize = static_cast<double>(It->PartitionGridSize);
	}
	Json->SetNumberField(TEXT("pcg_world_actors"), WorldActors);
	Json->SetBoolField(TEXT("treat_player_controllers_as_sources"), bTreatControllers);
	Json->SetNumberField(TEXT("partition_grid_size"), GridSize);
	UPCGSubsystem* Subsystem = UPCGSubsystem::GetInstance(World);
	Json->SetBoolField(TEXT("pcg_subsystem"), Subsystem != nullptr);
	Json->SetBoolField(TEXT("subsystem_has_world_actor"), Subsystem && Subsystem->GetPCGWorldActor() != nullptr);
	Json->SetNumberField(TEXT("player_controllers"), World->GetNumPlayerControllers());
	Json->SetNumberField(TEXT("local_players"), World->GetGameInstance() ? World->GetGameInstance()->GetNumLocalPlayers() : 0);
	if (APlayerController* Controller = World->GetFirstPlayerController())
	{
		FVector ViewLocation; FRotator ViewRotation;
		Controller->GetPlayerViewPoint(ViewLocation, ViewRotation);
		Json->SetStringField(TEXT("pawn"), Controller->GetPawn() ? Controller->GetPawn()->GetClass()->GetName() : FString());
		Json->SetStringField(TEXT("view_target"), Controller->GetViewTarget() ? Controller->GetViewTarget()->GetName() : FString());
		Json->SetArrayField(TEXT("view_point"), { Num(ViewLocation.X), Num(ViewLocation.Y), Num(ViewLocation.Z) });
		Json->SetBoolField(TEXT("streaming_source_enabled"), Controller->IsStreamingSourceEnabled());
	}
	TSharedRef<FJsonObject> CVars = MakeShared<FJsonObject>();
	for (const TCHAR* Name : CVarNames)
	{
		IConsoleVariable* Variable = IConsoleManager::Get().FindConsoleVariable(Name);
		CVars->SetStringField(Name, Variable ? Variable->GetString() : FString(TEXT("(not registered)")));
	}
	Json->SetObjectField(TEXT("cvars"), CVars);
	return Json;
}

TArray<TSharedPtr<FJsonValue>> APcgPackagedGameMode::AssetChecksJson() const
{
	TArray<TSharedPtr<FJsonValue>> Out;
	auto Check = [&Out](const FString& Path, bool bControl)
	{
		UObject* Loaded = StaticLoadObject(UObject::StaticClass(), nullptr, *Path, nullptr, LOAD_NoWarn);
		TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
		Json->SetStringField(TEXT("path"), Path);
		Json->SetBoolField(TEXT("loaded"), Loaded != nullptr);
		Json->SetStringField(TEXT("class"), Loaded ? Loaded->GetClass()->GetName() : FString());
		Json->SetBoolField(TEXT("control"), bControl);
		Out.Add(PcgPackagedDetail::Obj(Json));
	};
	for (const FString& Path : AssetPaths) Check(Path, false);
	if (!OrphanPath.IsEmpty()) Check(OrphanPath, true);
	return Out;
}

void APcgPackagedGameMode::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (bFinished) return;
	const double T = FPlatformTime::Seconds() - BeginSeconds;
	if (!bFirstSampleDone)
	{
		bFirstSampleDone = true;
		WorldAtStart = WorldJson();
	}
	if (Mode == EMode::Runtime) TickRuntime(T); else TickStream(T);
	if (!bFinished && T >= NextFlushT)
	{
		NextFlushT = T + 2.0;
		WriteReceipt(false);
	}
}

void APcgPackagedGameMode::TickRuntime(double T)
{
	if (T >= NextSampleT)
	{
		NextSampleT = T + SampleInterval;
		RefreshTracked(T);
		for (FTracked& Entry : Tracked)
		{
			const UPCGComponent* Component = Entry.Component.Get();
			if (!Component) continue;
			FSnap Snap;
			Snapshot(*Component, Snap);
			const bool bFirst = !Entry.bHasInitial;
			if (bFirst) { Entry.bHasInitial = true; Entry.Initial = Snap; }
			if (Entry.FirstInstancesS < 0.0 && Snap.Instances > 0) Entry.FirstInstancesS = T;
			if (bFirst || Snap.Instances != Entry.Last.Instances || Snap.bGenerating != Entry.Last.bGenerating || Snap.bGenerated != Entry.Last.bGenerated || Snap.OutputPoints != Entry.Last.OutputPoints)
			{
				TSharedRef<FJsonObject> Point = MakeShared<FJsonObject>();
				Point->SetNumberField(TEXT("t"), T);
				Point->SetBoolField(TEXT("generated"), Snap.bGenerated);
				Point->SetBoolField(TEXT("generating"), Snap.bGenerating);
				Point->SetNumberField(TEXT("instances"), Snap.Instances);
				Point->SetNumberField(TEXT("output_points"), Snap.OutputPoints);
				Entry.Series.Add(PcgPackagedDetail::Obj(Point));
			}
			Entry.Last = Snap;
		}
	}
	if (Stage == EStage::Window && T >= WindowSeconds)
	{
		if (!bManual) { Finish(T); return; }
		Stage = EStage::Manual;
		ManualStartT = T;
		for (FTracked& Entry : Tracked)
		{
			UPCGComponent* Component = Entry.Component.Get();
			if (Component && Component->GenerationTrigger == EPCGComponentGenerationTrigger::GenerateOnDemand)
			{
				Entry.ManualAtS = T;
				Component->Generate(true);
			}
		}
	}
	else if (Stage == EStage::Manual && T >= ManualStartT + ManualSeconds)
	{
		Finish(T);
	}
}

TSharedRef<FJsonObject> APcgPackagedGameMode::StreamSample(double T, const TCHAR* Phase, const FVector& Source) const
{
	using namespace PcgPackagedDetail;
	TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
	UWorld* World = GetWorld();
	Json->SetNumberField(TEXT("t"), T);
	Json->SetStringField(TEXT("phase"), Phase);
	Json->SetArrayField(TEXT("source"), { Num(Source.X), Num(Source.Y), Num(Source.Z) });
	int32 LevelsTotal = 0, LevelsLoaded = 0, LevelsVisible = 0;
	for (ULevelStreaming* Streaming : World->GetStreamingLevels())
	{
		if (!Streaming) continue;
		++LevelsTotal;
		if (Streaming->IsLevelLoaded()) ++LevelsLoaded;
		if (Streaming->IsLevelVisible()) ++LevelsVisible;
	}
	Json->SetNumberField(TEXT("levels_total"), LevelsTotal);
	Json->SetNumberField(TEXT("levels_loaded"), LevelsLoaded);
	Json->SetNumberField(TEXT("levels_visible"), LevelsVisible);
	bool bMarkerA = false, bMarkerB = false;
	for (TActorIterator<AStaticMeshActor> MeshIt(World); MeshIt; ++MeshIt)
	{
		const FVector Where = MeshIt->GetActorLocation();
		if (FVector::Dist2D(Where, PointA) < 300.0) bMarkerA = true;
		if (FVector::Dist2D(Where, PointB) < 300.0) bMarkerB = true;
	}
	Json->SetBoolField(TEXT("marker_a"), bMarkerA);
	Json->SetBoolField(TEXT("marker_b"), bMarkerB);
	double Grid = 25600.0;
	for (TActorIterator<APCGWorldActor> WorldIt(World); WorldIt; ++WorldIt) Grid = static_cast<double>(WorldIt->PartitionGridSize);
	int32 PartitionActors = 0, WithInstances = 0, TotalInstances = 0, GeneratingNow = 0;
	TArray<TSharedPtr<FJsonValue>> Cells;
	for (TActorIterator<AActor> ActorIt(World); ActorIt; ++ActorIt)
	{
		if (!ActorIt->GetClass()->GetName().Contains(TEXT("PCGPartitionActor"))) continue;
		++PartitionActors;
		FSnap Snap;
		CountInstances(**ActorIt, Snap);
		TArray<UPCGComponent*> Locals;
		ActorIt->GetComponents<UPCGComponent>(Locals);
		for (const UPCGComponent* Local : Locals)
		{
			if (Local && Local->IsGenerating()) ++GeneratingNow;
		}
		if (Snap.Instances > 0)
		{
			++WithInstances;
			TotalInstances += Snap.Instances;
			const FVector Where = ActorIt->GetActorLocation();
			Cells.Add(MakeShared<FJsonValueArray>(TArray<TSharedPtr<FJsonValue>>{ Num(FMath::FloorToInt(Where.X / Grid)), Num(FMath::FloorToInt(Where.Y / Grid)) }));
		}
	}
	Json->SetNumberField(TEXT("partition_actors"), PartitionActors);
	Json->SetNumberField(TEXT("partition_actors_with_instances"), WithInstances);
	Json->SetNumberField(TEXT("partition_instances"), TotalInstances);
	Json->SetNumberField(TEXT("components_generating"), GeneratingNow);
	Json->SetArrayField(TEXT("cells"), Cells);
	int32 OriginalInstances = 0;
	for (const FTracked& Entry : Tracked)
	{
		const UPCGComponent* Component = Entry.Component.Get();
		if (!Component || !Component->GetOwner()) continue;
		FSnap Snap;
		CountInstances(*Component->GetOwner(), Snap);
		OriginalInstances += Snap.Instances;
	}
	Json->SetNumberField(TEXT("original_instances"), OriginalInstances);
	return Json;
}

void APcgPackagedGameMode::TickStream(double T)
{
	UWorld* World = GetWorld();
	APlayerController* Controller = World ? World->GetFirstPlayerController() : nullptr;
	APawn* Pawn = Controller ? Controller->GetPawn() : nullptr;
	if (!Pawn)
	{
		if (T > 30.0) Finish(T);   // no pawn to move: the receipt says so
		return;
	}
	if (!bTeleported)
	{
		bTeleported = true;
		StreamStartT = T;
		NextSampleT = T;
		Pawn->SetActorLocation(PointA, false, nullptr, ETeleportType::TeleportPhysics);
	}
	const double Elapsed = T - StreamStartT;
	FVector Where = PointA;
	const TCHAR* Phase = TEXT("hold_a");
	if (Elapsed >= HoldA + Travel) { Where = PointB; Phase = TEXT("hold_b"); }
	else if (Elapsed >= HoldA) { Where = FMath::Lerp(PointA, PointB, (Elapsed - HoldA) / FMath::Max(Travel, 0.001)); Phase = TEXT("travel"); }
	Pawn->SetActorLocation(Where, false, nullptr, ETeleportType::TeleportPhysics);
	if (T >= NextSampleT)
	{
		NextSampleT = T + 0.5;
		RefreshTracked(T);
		Samples.Add(PcgPackagedDetail::Obj(StreamSample(T, Phase, Where)));
	}
	if (Elapsed >= HoldA + Travel + HoldB) Finish(T);
}

void APcgPackagedGameMode::WriteReceipt(bool bComplete)
{
	using namespace PcgPackagedDetail;
	TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
	Json->SetStringField(TEXT("scenario"), TEXT("pcg_packaged"));
	Json->SetStringField(TEXT("mode"), ModeName);
	Json->SetBoolField(TEXT("complete"), bComplete);
	Json->SetStringField(TEXT("engine_version"), FApp::GetBuildVersion());
	Json->SetStringField(TEXT("build_configuration"), LexToString(FApp::GetBuildConfiguration()));
	Json->SetBoolField(TEXT("requires_cooked_data"), FPlatformProperties::RequiresCookedData());
#if WITH_EDITOR
	Json->SetBoolField(TEXT("with_editor"), true);
#else
	Json->SetBoolField(TEXT("with_editor"), false);
#endif
	Json->SetBoolField(TEXT("running_game"), IsRunningGame());
	Json->SetBoolField(TEXT("null_rhi"), GUsingNullRHI);
	Json->SetStringField(TEXT("rhi_adapter"), GRHIAdapterName);
	Json->SetNumberField(TEXT("seconds"), FPlatformTime::Seconds() - BeginSeconds);
	if (WorldAtStart.IsValid()) Json->SetObjectField(TEXT("world_start"), WorldAtStart);
	Json->SetObjectField(TEXT("world_now"), WorldJson());
	TArray<TSharedPtr<FJsonValue>> Components;
	for (const FTracked& Entry : Tracked) Components.Add(Obj(ComponentJson(Entry)));
	Json->SetArrayField(TEXT("components"), Components);
	if (Mode == EMode::Runtime)
	{
		Json->SetNumberField(TEXT("window_seconds"), WindowSeconds);
		Json->SetNumberField(TEXT("manual_seconds"), bManual ? ManualSeconds : 0.0);
	}
	else
	{
		Json->SetArrayField(TEXT("point_a"), { Num(PointA.X), Num(PointA.Y), Num(PointA.Z) });
		Json->SetArrayField(TEXT("point_b"), { Num(PointB.X), Num(PointB.Y), Num(PointB.Z) });
		Json->SetNumberField(TEXT("hold_a_seconds"), HoldA);
		Json->SetNumberField(TEXT("travel_seconds"), Travel);
		Json->SetNumberField(TEXT("hold_b_seconds"), HoldB);
		Json->SetBoolField(TEXT("pawn_found"), bTeleported);
		Json->SetArrayField(TEXT("samples"), Samples);
	}
	// Loading by path changes what is in memory, so it is done once, after the last sample.
	if (bComplete) Json->SetArrayField(TEXT("assets"), AssetChecksJson());
	FString Text;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Text);
	FJsonSerializer::Serialize(Json, Writer);
	IFileManager::Get().MakeDirectory(*FPaths::GetPath(ReportPath), true);
	FFileHelper::SaveStringToFile(Text, *ReportPath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
}

void APcgPackagedGameMode::Finish(double T)
{
	bFinished = true;
	WriteReceipt(true);
	UE_LOG(LogTemp, Display, TEXT("PCG PACKAGED receipt %s after %.1f s"), *ReportPath, T);
	FPlatformMisc::RequestExit(false);
}
