#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "Core/CameraRigInstanceID.h"
#include "CameraProbeGame.generated.h"

class ACameraActor;
class FJsonObject;
class UCameraAsset;
class UCameraRigAsset;
class UGameplayCameraComponent;

/** A pawn with a Gameplay Camera component. The rigs are built in code when the pawn's components are initialised. */
UCLASS()
class CAMERAPROBE_API ACameraProbePawn : public APawn
{
	GENERATED_BODY()

public:
	ACameraProbePawn();
	virtual void PostInitializeComponents() override;

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UGameplayCameraComponent> GameplayCamera;

	UPROPERTY()
	TObjectPtr<UCameraAsset> CameraAsset;

	UPROPERTY()
	TObjectPtr<UCameraRigAsset> BaseRig;

	UPROPERTY()
	TObjectPtr<UCameraRigAsset> SprintRig;
};

/**
 * A player controller whose camera manager class follows the command line: -CamHost=manager uses
 * AGameplayCamerasPlayerCameraManager; any other value (component, stock) uses the stock APlayerCameraManager.
 */
UCLASS()
class CAMERAPROBE_API ACameraProbeController : public APlayerController
{
	GENERATED_BODY()

public:
	ACameraProbeController();
};

/**
 * Starts the pawn at a fixed transform and runs the whole scenario from Tick, one step per frame count, then writes a JSON report
 * and exits the process.
 *   UnrealEditor.exe Project.uproject /Engine/Maps/Entry?game=/Script/CameraProbe.CameraProbeGameMode -game -nullrhi
 *       -UseFixedTimeStep -FPS=30 -CamHost=manager|component|stock -CamReport=<file.json>
 */
UCLASS()
class CAMERAPROBE_API ACameraProbeGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	ACameraProbeGameMode();
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual void HandleStartingNewPlayer_Implementation(APlayerController* NewPlayer) override;

private:
	struct FStep
	{
		int32 WaitFrames = 0;
		TFunction<void()> Run;
	};

	void AddStep(int32 WaitFrames, TFunction<void()> Run);
	void BuildRigScenario(bool bManagerHost);
	void BuildStockScenario();
	void Finish(const TCHAR* Reason);
	void Fail(const FString& Message);

	// Reading the screen's camera: the player camera manager's cached view, which is what the renderer is given.
	APlayerController* PlayerOne() const;
	class APlayerCameraManager* Manager() const;
	ACameraProbePawn* ProbePawn() const;
	TSharedRef<FJsonObject> Snapshot(const FString& Label);

	FCameraRigInstanceID StartModifier(bool bManagerHost);
	void StopModifier(bool bManagerHost, FCameraRigInstanceID Id, bool bImmediately);

	TArray<FStep> Steps;
	int32 StepIndex = 0;
	int32 FramesWaited = 0;
	int32 TotalFrames = 0;
	bool bFinished = false;

	FString Host;
	FString ReportPath;
	TSharedPtr<FJsonObject> Report;
	TArray<TSharedPtr<class FJsonValue>> Errors;
	TArray<TSharedPtr<class FJsonValue>> FirstFrames;
	TArray<TSharedPtr<class FJsonValue>> FollowTrace;

	FCameraRigInstanceID ModifierId;

	UPROPERTY()
	TObjectPtr<ACameraActor> BaseCamera;

	UPROPERTY()
	TObjectPtr<ACameraActor> PhotoCamera;
};
