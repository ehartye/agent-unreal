#include "CameraProbeGame.h"
#include "CameraProbeRigs.h"
#include "Camera/PlayerCameraManager.h"
#include "Components/SceneComponent.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Engine/World.h"
#include "GameFramework/GameplayCameraComponent.h"          // source: GameplayCameras Public/GameFramework/GameplayCameraComponent.h
#include "GameFramework/GameplayCamerasPlayerCameraManager.h" // source: GameplayCameras Public/GameFramework/GameplayCamerasPlayerCameraManager.h
#include "GameFramework/WorldSettings.h"
#include "HAL/PlatformMisc.h"
#include "Core/CameraAsset.h"
#include "Core/CameraRigAsset.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/App.h"
#include "Misc/CommandLine.h"
#include "Misc/EngineVersion.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

DEFINE_LOG_CATEGORY_STATIC(LogCameraProbe, Log, All);

namespace
{
	const FString HostManager = TEXT("manager");
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Pawn

ACameraProbePawn::ACameraProbePawn()
{
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	GameplayCamera = CreateDefaultSubobject<UGameplayCameraComponent>(TEXT("GameplayCamera"));
	GameplayCamera->SetupAttachment(RootComponent);
	// The scenario activates the camera after the controller has possessed the pawn: the attach-to-player-pawn node reads the
	// controller's pawn when its rig starts (AttachToPlayerPawnCameraNode.cpp, OnInitialize), so a rig started earlier finds none.
	GameplayCamera->bAutoActivate = false;
}

void ACameraProbePawn::PostInitializeComponents()
{
	Super::PostInitializeComponents();
	FString Host;
	FParse::Value(FCommandLine::Get(), TEXT("CamHost="), Host);
	// manager: the camera manager runs the camera system, the component only supplies the evaluation context.
	// component: the component runs its own camera system and drives a child camera component that the stock manager reads.
	GameplayCamera->bRunStandaloneCameraSystem = !Host.Equals(HostManager, ESearchCase::IgnoreCase);
	BaseRig = CameraProbeRigs::MakeBaseRig();
	SprintRig = CameraProbeRigs::MakeSprintRig();
	CameraAsset = CameraProbeRigs::MakeCameraAsset(BaseRig);
	GameplayCamera->CameraReference.SetCameraAsset(CameraAsset);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Controller

ACameraProbeController::ACameraProbeController()
{
	FString Host;
	FParse::Value(FCommandLine::Get(), TEXT("CamHost="), Host);
	if (Host.Equals(HostManager, ESearchCase::IgnoreCase))
	{
		PlayerCameraManagerClass = AGameplayCamerasPlayerCameraManager::StaticClass();
	}
	else
	{
		PlayerCameraManagerClass = APlayerCameraManager::StaticClass();
	}
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Game mode

ACameraProbeGameMode::ACameraProbeGameMode()
{
	PlayerControllerClass = ACameraProbeController::StaticClass();
	DefaultPawnClass = ACameraProbePawn::StaticClass();
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = true;
}

void ACameraProbeGameMode::HandleStartingNewPlayer_Implementation(APlayerController* NewPlayer)
{
	// The map has no player start. Spawn the pawn at a fixed transform, high enough that nothing is near the camera.
	RestartPlayerAtTransform(NewPlayer, FTransform(FRotator::ZeroRotator, FVector(0.0, 0.0, 1000.0)));
}

APlayerController* ACameraProbeGameMode::PlayerOne() const
{
	return UGameplayStatics::GetPlayerController(this, 0);
}

APlayerCameraManager* ACameraProbeGameMode::Manager() const
{
	APlayerController* PC = PlayerOne();
	return PC ? PC->PlayerCameraManager.Get() : nullptr;
}

ACameraProbePawn* ACameraProbeGameMode::ProbePawn() const
{
	APlayerController* PC = PlayerOne();
	return PC ? Cast<ACameraProbePawn>(PC->GetPawn()) : nullptr;
}

namespace
{
	TArray<TSharedPtr<FJsonValue>> Vec3(const FVector& V)
	{
		TArray<TSharedPtr<FJsonValue>> Out;
		Out.Add(MakeShared<FJsonValueNumber>(V.X));
		Out.Add(MakeShared<FJsonValueNumber>(V.Y));
		Out.Add(MakeShared<FJsonValueNumber>(V.Z));
		return Out;
	}
}

TSharedRef<FJsonObject> ACameraProbeGameMode::Snapshot(const FString& Label)
{
	TSharedRef<FJsonObject> S = MakeShared<FJsonObject>();
	UWorld* World = GetWorld();
	S->SetStringField(TEXT("label"), Label);
	S->SetNumberField(TEXT("frame"), TotalFrames);
	S->SetNumberField(TEXT("world_time"), World->GetTimeSeconds());
	S->SetNumberField(TEXT("real_time"), World->GetRealTimeSeconds());
	S->SetNumberField(TEXT("time_dilation"), World->GetWorldSettings()->GetEffectiveTimeDilation());
	if (APlayerCameraManager* Mgr = Manager())
	{
		// The cached view is what the renderer is given: the screen's camera, not the camera any asset was set up with.
		const FMinimalViewInfo& View = Mgr->GetCameraCacheView();
		S->SetArrayField(TEXT("eye"), Vec3(View.Location));
		S->SetArrayField(TEXT("rotation"), Vec3(FVector(View.Rotation.Pitch, View.Rotation.Yaw, View.Rotation.Roll)));
		S->SetNumberField(TEXT("fov"), View.FOV);
		S->SetStringField(TEXT("view_target"), GetNameSafe(Mgr->ViewTarget.Target.Get()));
		S->SetStringField(TEXT("pending_target"), GetNameSafe(Mgr->PendingViewTarget.Target.Get()));
		S->SetNumberField(TEXT("blend_time_to_go"), Mgr->BlendTimeToGo);
		if (ACameraProbePawn* Pawn = ProbePawn())
		{
			S->SetArrayField(TEXT("pawn"), Vec3(Pawn->GetActorLocation()));
			S->SetNumberField(TEXT("distance_to_pawn"), FVector::Dist(View.Location, Pawn->GetActorLocation()));
		}
	}
	return S;
}

void ACameraProbeGameMode::AddStep(int32 WaitFrames, TFunction<void()> Run)
{
	FStep Step;
	Step.WaitFrames = WaitFrames;
	Step.Run = MoveTemp(Run);
	Steps.Add(MoveTemp(Step));
}

void ACameraProbeGameMode::BeginPlay()
{
	Super::BeginPlay();
	FParse::Value(FCommandLine::Get(), TEXT("CamHost="), Host);
	FParse::Value(FCommandLine::Get(), TEXT("CamReport="), ReportPath);
	if (Host.IsEmpty())
	{
		Host = HostManager;
	}
	Report = MakeShared<FJsonObject>();
	Report->SetStringField(TEXT("host"), Host);
	Report->SetStringField(TEXT("engine_version"), FEngineVersion::Current().ToString());
	Report->SetBoolField(TEXT("fixed_step"), FApp::UseFixedTimeStep());
	Report->SetNumberField(TEXT("fixed_delta"), FApp::GetFixedDeltaTime());
	if (Host.Equals(TEXT("stock"), ESearchCase::IgnoreCase))
	{
		BuildStockScenario();
	}
	else
	{
		BuildRigScenario(Host.Equals(HostManager, ESearchCase::IgnoreCase));
	}
	AddStep(0, [this]() { Finish(TEXT("done")); });
	UE_LOG(LogCameraProbe, Display, TEXT("CameraProbe host=%s steps=%d"), *Host, Steps.Num());
}

void ACameraProbeGameMode::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (bFinished || !Report.IsValid())
	{
		return;
	}
	++TotalFrames;
	if (TotalFrames > 4000)
	{
		Fail(TEXT("watchdog: the scenario did not finish in 4000 frames"));
		return;
	}
	if (!Steps.IsValidIndex(StepIndex))
	{
		return;
	}
	if (FramesWaited < Steps[StepIndex].WaitFrames)
	{
		++FramesWaited;
		return;
	}
	FramesWaited = 0;
	const int32 Index = StepIndex++;
	Steps[Index].Run();
}

void ACameraProbeGameMode::Fail(const FString& Message)
{
	UE_LOG(LogCameraProbe, Error, TEXT("CameraProbe failed: %s"), *Message);
	Errors.Add(MakeShared<FJsonValueString>(Message));
	Finish(TEXT("failed"));
}

void ACameraProbeGameMode::Finish(const TCHAR* Reason)
{
	if (bFinished)
	{
		return;
	}
	bFinished = true;
	UGameplayStatics::SetGlobalTimeDilation(this, 1.0f);
	Report->SetStringField(TEXT("finished"), Reason);
	Report->SetNumberField(TEXT("frames"), TotalFrames);
	Report->SetArrayField(TEXT("errors"), Errors);
	Report->SetArrayField(TEXT("follow_first_frames"), FirstFrames);
	Report->SetArrayField(TEXT("follow_trace"), FollowTrace);
	Report->SetArrayField(TEXT("teleport_frames"), TeleportFrames);
	FString Json;
	TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Json);
	FJsonSerializer::Serialize(Report.ToSharedRef(), Writer);
	if (!ReportPath.IsEmpty())
	{
		FFileHelper::SaveStringToFile(Json, *ReportPath);
	}
	UE_LOG(LogCameraProbe, Display, TEXT("CameraProbe report written (%s)"), Reason);
	FPlatformMisc::RequestExit(false);
}

FCameraRigInstanceID ACameraProbeGameMode::StartModifier(bool bManagerHost)
{
	ACameraProbePawn* Pawn = ProbePawn();
	if (!Pawn)
	{
		return FCameraRigInstanceID();
	}
	if (bManagerHost)
	{
		// source: GameplayCamerasPlayerCameraManager.h StartGlobalCameraModifierRig(const UCameraRigAsset*, int32 OrderKey)
		if (AGameplayCamerasPlayerCameraManager* Mgr = Cast<AGameplayCamerasPlayerCameraManager>(Manager()))
		{
			return Mgr->StartGlobalCameraModifierRig(Pawn->SprintRig, 0);
		}
		return FCameraRigInstanceID();
	}
	// source: GameplayCameraComponentBase.h StartGlobalCameraModifierRig(const UCameraRigAsset*, int32 OrderKey)
	return Pawn->GameplayCamera->StartGlobalCameraModifierRig(Pawn->SprintRig, 0);
}

void ACameraProbeGameMode::StopModifier(bool bManagerHost, FCameraRigInstanceID Id, bool bImmediately)
{
	ACameraProbePawn* Pawn = ProbePawn();
	if (!Pawn)
	{
		return;
	}
	if (bManagerHost)
	{
		// source: GameplayCamerasPlayerCameraManager.h StopCameraModifierRig(FCameraRigInstanceID, bool bImmediately)
		if (AGameplayCamerasPlayerCameraManager* Mgr = Cast<AGameplayCamerasPlayerCameraManager>(Manager()))
		{
			Mgr->StopCameraModifierRig(Id, bImmediately);
		}
		return;
	}
	// source: GameplayCameraComponentBase.h StopCameraModifierRig(FCameraRigInstanceID, bool bImmediately)
	Pawn->GameplayCamera->StopCameraModifierRig(Id, bImmediately);
}
