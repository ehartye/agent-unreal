// The two scenarios the game mode runs. Each step is a number of skipped frames and a lambda; the game runs with a fixed time step
// (-UseFixedTimeStep -FPS=30), so N frames are N/30 seconds of real time, and world time is real time times the time dilation.
//
// Rig scenario (host manager or component): activate the camera, let it settle, read the eye and the field of view from the player
// camera manager's cached view, move the pawn and read how the boom lags, start and stop a modifier rig, then repeat the start at a
// time dilation of 0.0001 and read whether the blend progresses.
// Stock scenario (host stock): two camera actors and the stock view-target blend, in normal time and at a time dilation of 0.0001,
// with a cut in both.
#include "CameraProbeGame.h"
#include "CameraProbeRigs.h"
#include "Build/CameraBuildStatus.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Camera/PlayerCameraManager.h"
#include "Core/CameraRigAsset.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Engine/World.h"
#include "GameFramework/GameplayCameraComponent.h"
#include "GameFramework/GameplayCamerasPlayerCameraManager.h"
#include "Kismet/GameplayStatics.h"

namespace
{
	// The smallest world time dilation the engine accepts: AWorldSettings::MinGlobalTimeDilation (WorldSettings.h), default 0.0001.
	constexpr float HeldWorldDilation = 0.0001f;

	TArray<TSharedPtr<FJsonValue>> Vec3(const FVector& V)
	{
		TArray<TSharedPtr<FJsonValue>> Out;
		Out.Add(MakeShared<FJsonValueNumber>(V.X));
		Out.Add(MakeShared<FJsonValueNumber>(V.Y));
		Out.Add(MakeShared<FJsonValueNumber>(V.Z));
		return Out;
	}
}

void ACameraProbeGameMode::BuildRigScenario(bool bManagerHost)
{
	const FRotator ControlRotation(-10.0, 40.0, 0.0);

	// 1. Activate once the controller has possessed the pawn.
	AddStep(3, [this, bManagerHost, ControlRotation]()
	{
		APlayerController* PC = PlayerOne();
		ACameraProbePawn* Pawn = ProbePawn();
		TSharedRef<FJsonObject> Setup = MakeShared<FJsonObject>();
		Setup->SetStringField(TEXT("camera_manager_class"), PC && PC->PlayerCameraManager ? PC->PlayerCameraManager->GetClass()->GetName() : TEXT("none"));
		Setup->SetStringField(TEXT("pawn_class"), Pawn ? Pawn->GetClass()->GetName() : TEXT("none"));
		Setup->SetBoolField(TEXT("pawn_possessed"), PC && PC->GetPawn() != nullptr);
		Setup->SetBoolField(TEXT("component_found"), Pawn && Pawn->GameplayCamera != nullptr);
		if (!PC || !Pawn || !Pawn->GameplayCamera)
		{
			Report->SetObjectField(TEXT("setup"), Setup);
			Fail(TEXT("no player controller, probe pawn or gameplay camera component"));
			return;
		}
		Setup->SetBoolField(TEXT("standalone_camera_system"), Pawn->GameplayCamera->bRunStandaloneCameraSystem);
		Setup->SetBoolField(TEXT("base_rig_clean"), Pawn->BaseRig && Pawn->BaseRig->BuildStatus == ECameraBuildStatus::Clean);
		Setup->SetBoolField(TEXT("sprint_rig_clean"), Pawn->SprintRig && Pawn->SprintRig->BuildStatus == ECameraBuildStatus::Clean);
		Setup->SetNumberField(TEXT("sprint_enter_transitions"), Pawn->SprintRig ? Pawn->SprintRig->EnterTransitions.Num() : -1);
		Setup->SetNumberField(TEXT("sprint_exit_transitions"), Pawn->SprintRig ? Pawn->SprintRig->ExitTransitions.Num() : -1);
		Setup->SetBoolField(TEXT("base_has_root"), Pawn->BaseRig && Pawn->BaseRig->RootNode != nullptr);
		PC->SetControlRotation(ControlRotation);
		if (bManagerHost)
		{
			// source: GameplayCamerasPlayerCameraManager.h ActivateGameplayCamera(UGameplayCameraComponentBase*, EGameplayCameraComponentActivationMode)
			AGameplayCamerasPlayerCameraManager* Mgr = Cast<AGameplayCamerasPlayerCameraManager>(PC->PlayerCameraManager.Get());
			Setup->SetBoolField(TEXT("manager_is_gameplay_cameras"), Mgr != nullptr);
			if (!Mgr)
			{
				Report->SetObjectField(TEXT("setup"), Setup);
				Fail(TEXT("the camera manager is not an AGameplayCamerasPlayerCameraManager"));
				return;
			}
			Mgr->ActivateGameplayCamera(Pawn->GameplayCamera);
		}
		else
		{
			// source: GameplayCameraComponentBase.h ActivateCameraForPlayerController(APlayerController*, bool bSetAsViewTarget)
			Pawn->GameplayCamera->ActivateCameraForPlayerController(PC, true);
		}
		Setup->SetBoolField(TEXT("has_evaluation_context"), Pawn->GameplayCamera->HasEvaluationContext());
		Report->SetObjectField(TEXT("setup"), Setup);
	});

	// 2. Settle for three seconds, then read the rest view against what the rig's numbers say it should be.
	AddStep(90, [this, ControlRotation]()
	{
		TSharedRef<FJsonObject> S = Snapshot(TEXT("rest"));
		ACameraProbePawn* Pawn = ProbePawn();
		APlayerCameraManager* Mgr = Manager();
		if (Pawn && Mgr)
		{
			const FVector Offset = CameraProbeRigs::BoomOffsetCm();
			const FVector Expected = Pawn->GetActorLocation() + ControlRotation.RotateVector(Offset);
			S->SetArrayField(TEXT("expected_eye"), Vec3(Expected));
			S->SetNumberField(TEXT("expected_distance"), Offset.Size());
			S->SetNumberField(TEXT("expected_fov"), CameraProbeRigs::BaseFieldOfView);
			S->SetNumberField(TEXT("eye_error_cm"), FVector::Dist(Mgr->GetCameraCacheView().Location, Expected));
		}
		Report->SetObjectField(TEXT("rest"), S);
	});

	// 3. Move the pawn 1000 cm in one frame (a plain move, ETeleportType::None: UGameplayCameraComponentBase::OnUpdateTransform marks
	//    a camera cut for any other teleport type, and the boom arm skips its lag on a cut) and read the boom for the next twelve
	//    frames, then every second for ten seconds.
	AddStep(0, [this]()
	{
		if (ACameraProbePawn* Pawn = ProbePawn())
		{
			Pawn->SetActorLocation(Pawn->GetActorLocation() + FVector(1000.0, 0.0, 0.0), false, nullptr, ETeleportType::None);
		}
	});
	for (int32 i = 0; i < 12; ++i)
	{
		AddStep(0, [this, i]()
		{
			TSharedRef<FJsonObject> S = Snapshot(FString::Printf(TEXT("follow_frame_%d"), i));
			FirstFrames.Add(MakeShared<FJsonValueObject>(S));
		});
	}
	for (int32 i = 0; i < 10; ++i)
	{
		AddStep(29, [this, i]()
		{
			TSharedRef<FJsonObject> S = Snapshot(FString::Printf(TEXT("follow_second_%d"), i + 1));
			FollowTrace.Add(MakeShared<FJsonValueObject>(S));
		});
	}

	// 3b. The same distance as a teleport (ETeleportType::TeleportPhysics), back to where the pawn was: the camera cuts, so the eye
	//     should be at its rest distance in the first frames. Read the next three frames.
	AddStep(0, [this]()
	{
		if (ACameraProbePawn* Pawn = ProbePawn())
		{
			Pawn->SetActorLocation(Pawn->GetActorLocation() - FVector(1000.0, 0.0, 0.0), false, nullptr, ETeleportType::TeleportPhysics);
		}
	});
	for (int32 i = 0; i < 3; ++i)
	{
		AddStep(0, [this, i]()
		{
			TSharedRef<FJsonObject> S = Snapshot(FString::Printf(TEXT("teleport_frame_%d"), i));
			TeleportFrames.Add(MakeShared<FJsonValueObject>(S));
		});
	}
	AddStep(30, []() {});

	// 4. Start the modifier rig; read mid-blend (0.2 s of a 0.4 s blend) and after the blend.
	AddStep(0, [this, bManagerHost]()
	{
		ModifierId = StartModifier(bManagerHost);
		TSharedRef<FJsonObject> S = MakeShared<FJsonObject>();
		S->SetBoolField(TEXT("id_valid"), ModifierId.IsValid());
		Report->SetObjectField(TEXT("mode_on_start"), S);
	});
	AddStep(5, [this]() { Report->SetObjectField(TEXT("mode_on_mid"), Snapshot(TEXT("mode_on_mid"))); });
	AddStep(60, [this]()
	{
		TSharedRef<FJsonObject> S = Snapshot(TEXT("mode_on"));
		const FVector Offset = CameraProbeRigs::BoomOffsetCm();
		S->SetNumberField(TEXT("expected_distance"), FVector(Offset.X - CameraProbeRigs::SprintPullCm, Offset.Y, Offset.Z).Size());
		S->SetNumberField(TEXT("expected_fov"), CameraProbeRigs::SprintFieldOfView);
		Report->SetObjectField(TEXT("mode_on"), S);
	});

	// 5. Stop it with the exit blend; read mid-blend and after.
	AddStep(0, [this, bManagerHost]() { StopModifier(bManagerHost, ModifierId, false); });
	AddStep(5, [this]() { Report->SetObjectField(TEXT("mode_off_mid"), Snapshot(TEXT("mode_off_mid"))); });
	AddStep(60, [this]() { Report->SetObjectField(TEXT("mode_off"), Snapshot(TEXT("mode_off"))); });

	// 6. Hold the world at 0.0001 of real time, start the modifier rig, and read for two seconds of real time (60 frames at 30 fps).
	//    Then stop it immediately and read again.
	//    The dilation is set two frames before the start: the frame that sets it still runs with the delta it was given (the camera
	//    update at the end of that frame uses it), so a blend started in the same frame would get one full frame of time.
	AddStep(0, [this]() { UGameplayStatics::SetGlobalTimeDilation(this, HeldWorldDilation); });
	AddStep(2, [this, bManagerHost]()
	{
		Report->SetObjectField(TEXT("dilated_start"), Snapshot(TEXT("dilated_start")));
		ModifierId = StartModifier(bManagerHost);
		TSharedRef<FJsonObject> S = MakeShared<FJsonObject>();
		S->SetBoolField(TEXT("id_valid"), ModifierId.IsValid());
		Report->SetObjectField(TEXT("dilated_id"), S);
	});
	AddStep(60, [this]() { Report->SetObjectField(TEXT("dilated_end"), Snapshot(TEXT("dilated_end"))); });
	AddStep(0, [this, bManagerHost]() { StopModifier(bManagerHost, ModifierId, true); });
	AddStep(4, [this]() { Report->SetObjectField(TEXT("dilated_after_stop"), Snapshot(TEXT("dilated_after_stop"))); });
	AddStep(0, [this]() { UGameplayStatics::SetGlobalTimeDilation(this, 1.0f); });
	AddStep(5, [this]() { Report->SetObjectField(TEXT("restored"), Snapshot(TEXT("restored"))); });
}

void ACameraProbeGameMode::BuildStockScenario()
{
	// Adds where both cameras are and what the photo camera's own lens says, next to what the screen shows.
	auto WithCameras = [this](TSharedRef<FJsonObject> S)
	{
		if (BaseCamera && PhotoCamera)
		{
			APlayerCameraManager* Mgr = Manager();
			S->SetNumberField(TEXT("photo_camera_fov"), PhotoCamera->GetCameraComponent()->FieldOfView);
			S->SetNumberField(TEXT("base_camera_fov"), BaseCamera->GetCameraComponent()->FieldOfView);
			if (Mgr)
			{
				const FVector Eye = Mgr->GetCameraCacheView().Location;
				S->SetNumberField(TEXT("eye_to_photo_camera_cm"), FVector::Dist(Eye, PhotoCamera->GetActorLocation()));
				S->SetNumberField(TEXT("eye_to_base_camera_cm"), FVector::Dist(Eye, BaseCamera->GetActorLocation()));
			}
		}
		return S;
	};

	AddStep(3, [this]()
	{
		UWorld* World = GetWorld();
		APlayerController* PC = PlayerOne();
		TSharedRef<FJsonObject> Setup = MakeShared<FJsonObject>();
		Setup->SetStringField(TEXT("camera_manager_class"), PC && PC->PlayerCameraManager ? PC->PlayerCameraManager->GetClass()->GetName() : TEXT("none"));
		if (!PC || !PC->PlayerCameraManager)
		{
			Report->SetObjectField(TEXT("setup"), Setup);
			Fail(TEXT("no player controller or camera manager"));
			return;
		}
		FActorSpawnParameters Params;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		BaseCamera = World->SpawnActor<ACameraActor>(FVector(0.0, 0.0, 1000.0), FRotator::ZeroRotator, Params);
		PhotoCamera = World->SpawnActor<ACameraActor>(FVector(0.0, 2000.0, 1200.0), FRotator(0.0, -90.0, 0.0), Params);
		Setup->SetBoolField(TEXT("cameras_spawned"), BaseCamera != nullptr && PhotoCamera != nullptr);
		Report->SetObjectField(TEXT("setup"), Setup);
		if (!BaseCamera || !PhotoCamera)
		{
			Fail(TEXT("the camera actors did not spawn"));
			return;
		}
		BaseCamera->GetCameraComponent()->SetFieldOfView(78.f);
		PhotoCamera->GetCameraComponent()->SetFieldOfView(30.f);
		PC->SetViewTargetWithBlend(BaseCamera, 0.f);
	});
	AddStep(5, [this, WithCameras]() { Report->SetObjectField(TEXT("base"), WithCameras(Snapshot(TEXT("base")))); });

	// Normal time: a 0.35 s blend finishes inside 0.7 s. Then a cut back.
	AddStep(0, [this]()
	{
		PlayerOne()->SetViewTargetWithBlend(PhotoCamera, 0.35f, VTBlend_Linear);
	});
	AddStep(20, [this, WithCameras]() { Report->SetObjectField(TEXT("control_done"), WithCameras(Snapshot(TEXT("control_done")))); });
	AddStep(0, [this]() { PlayerOne()->SetViewTargetWithBlend(BaseCamera, 0.f); });
	AddStep(3, [this, WithCameras]() { Report->SetObjectField(TEXT("control_back"), WithCameras(Snapshot(TEXT("control_back")))); });

	// Held world: the same blend, two seconds of real time.
	//   The dilation is set two frames before the blend starts (see the rig scenario).
	AddStep(0, [this]() { UGameplayStatics::SetGlobalTimeDilation(this, HeldWorldDilation); });
	AddStep(2, [this, WithCameras]()
	{
		PlayerOne()->SetViewTargetWithBlend(PhotoCamera, 0.35f, VTBlend_Linear);
		Report->SetObjectField(TEXT("stalled_start"), WithCameras(Snapshot(TEXT("stalled_start"))));
	});
	AddStep(60, [this, WithCameras]() { Report->SetObjectField(TEXT("stalled"), WithCameras(Snapshot(TEXT("stalled")))); });

	// A cut to the camera the stalled blend is already heading for (APlayerCameraManager::SetViewTarget returns early when the new
	// target is the pending one), a cut to the base camera that aborts the blend, then a cut to the photo camera, all in the held
	// world, and a cut back.
	AddStep(0, [this]() { PlayerOne()->SetViewTargetWithBlend(PhotoCamera, 0.f); });
	AddStep(3, [this, WithCameras]() { Report->SetObjectField(TEXT("cut_to_pending"), WithCameras(Snapshot(TEXT("cut_to_pending")))); });
	AddStep(0, [this]() { PlayerOne()->SetViewTargetWithBlend(BaseCamera, 0.f); });
	AddStep(3, [this, WithCameras]() { Report->SetObjectField(TEXT("cut_abort"), WithCameras(Snapshot(TEXT("cut_abort")))); });
	AddStep(0, [this]() { PlayerOne()->SetViewTargetWithBlend(PhotoCamera, 0.f); });
	AddStep(3, [this, WithCameras]() { Report->SetObjectField(TEXT("cut"), WithCameras(Snapshot(TEXT("cut")))); });
	AddStep(0, [this]() { PlayerOne()->SetViewTargetWithBlend(BaseCamera, 0.f); });
	AddStep(3, [this, WithCameras]() { Report->SetObjectField(TEXT("cut_back"), WithCameras(Snapshot(TEXT("cut_back")))); });

	// The blend started in the same frame that sets the dilation: back to normal time first, then set the dilation and start the
	// blend in one step. The frame that sets the dilation still runs with the delta it was given, and the camera update at the end
	// of that frame passes it to the blend, so one frame of the blend (1/30 s) goes through.
	AddStep(0, [this]() { UGameplayStatics::SetGlobalTimeDilation(this, 1.0f); });
	AddStep(2, [this]()
	{
		UGameplayStatics::SetGlobalTimeDilation(this, HeldWorldDilation);
		PlayerOne()->SetViewTargetWithBlend(PhotoCamera, 0.35f, VTBlend_Linear);
	});
	AddStep(60, [this, WithCameras]() { Report->SetObjectField(TEXT("same_frame"), WithCameras(Snapshot(TEXT("same_frame")))); });
	AddStep(0, [this]() { UGameplayStatics::SetGlobalTimeDilation(this, 1.0f); });
}
