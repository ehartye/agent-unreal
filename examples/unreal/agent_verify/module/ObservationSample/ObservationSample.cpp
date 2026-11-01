#include "ObservationSample.h"
#include "AgentVerifyRunner.h"
#include "IAgentVerifyProbe.h"
#include "Domain/TravelRule.h"
#include "Modules/ModuleManager.h"
#include "Camera/CameraActor.h"
#include "Components/AudioComponent.h"
#include "Components/InputComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/DirectionalLight.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/PlayerInput.h"
#include "HAL/IConsoleManager.h"
#include "HAL/PlatformMisc.h"
#include "HAL/PlatformTime.h"
#include "InputCoreTypes.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Sound/SoundWaveProcedural.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

IMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, ObservationSample, "ObservationSample");

AObservationPawn::AObservationPawn()
{
    PrimaryActorTick.bCanEverTick = true;
    auto Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("VisibleBody"));
    RootComponent = Mesh;
    Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}
void AObservationPawn::SetupPlayerInputComponent(UInputComponent* Input)
{
    Super::SetupPlayerInputComponent(Input);
    Input->BindAxis(TEXT("SampleMove"), this, &AObservationPawn::Move);
    Input->BindAction(TEXT("SampleMark"), IE_Pressed, this, &AObservationPawn::Press);
    Input->BindAction(TEXT("SampleMark"), IE_Released, this, &AObservationPawn::Release);
}
void AObservationPawn::Move(float Value) { Axis = Value; }
void AObservationPawn::Press() { Held = true; ++Presses; }
void AObservationPawn::Release() { Held = false; ++Releases; }
void AObservationPawn::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    auto Position = GetActorLocation();
    Position.X = ObservationSample::Domain::Travel(Position.X, Axis, DeltaSeconds);
    SetActorLocation(Position);
}

namespace
{
    class FSampleProbe final : public IAgentVerifyProbe
    {
        TWeakObjectPtr<AObservationGameMode> Game;
    public:
        explicit FSampleProbe(AObservationGameMode* InGame) : Game(InGame) {}
        TArray<FString> MetricNames() const override { return {TEXT("position_x"), TEXT("marks"), TEXT("scene_ready"), TEXT("unavailable")}; }
        TArray<FString> CommandNames() const override { return {TEXT("sample.tone")}; }
        FAgentVerifyMetric ReadMetric(const FString& Name) const override
        {
            const auto G = Game.Get(); const auto P = G ? G->SamplePawn() : nullptr;
            if (!P) return FAgentVerifyMetric::Unavailable(TEXT("pawn_unavailable"));
            if (Name == TEXT("position_x")) return FAgentVerifyMetric::Number(P->GetActorLocation().X);
            if (Name == TEXT("marks")) return FAgentVerifyMetric::Number(P->Presses);
            if (Name == TEXT("scene_ready")) return FAgentVerifyMetric::Number(G->SceneReady ? 1 : 0);
            return FAgentVerifyMetric::Unavailable(TEXT("sample_metric_unavailable"));
        }
        FString HardwareProfile() const override { return TEXT("sample-window-640x360"); }
    };
}

AObservationGameMode::AObservationGameMode()
{
    DefaultPawnClass = AObservationPawn::StaticClass();
    PrimaryActorTick.bCanEverTick = true;
}
AObservationGameMode::~AObservationGameMode() = default;
AObservationPawn* AObservationGameMode::SamplePawn() const
{
    auto PC = GetWorld()->GetFirstPlayerController();
    return PC ? Cast<AObservationPawn>(PC->GetPawn()) : nullptr;
}
void AObservationGameMode::BeginPlay()
{
    Super::BeginPlay();
    FParse::Value(FCommandLine::Get(), TEXT("AVRequest="), RequestPath);
    FParse::Value(FCommandLine::Get(), TEXT("AVOutput="), OutputPath);
    FParse::Value(FCommandLine::Get(), TEXT("AVCancelAfter="), CancelAfter);
    UPlayerInput::AddEngineDefinedAxisMapping(FInputAxisKeyMapping(TEXT("SampleMove"), EKeys::Gamepad_LeftX, 1));
    UPlayerInput::AddEngineDefinedActionMapping(FInputActionKeyMapping(TEXT("SampleMark"), EKeys::SpaceBar));
    const auto P = SamplePawn();
    const auto Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
    if (P)
    {
        P->SetActorLocation(FVector(0, 0, 80));
        CastChecked<UStaticMeshComponent>(P->GetRootComponent())->SetStaticMesh(Cube);
    }
    auto Floor = GetWorld()->SpawnActor<AActor>();
    auto Mesh = NewObject<UStaticMeshComponent>(Floor);
    Floor->SetRootComponent(Mesh); Floor->AddInstanceComponent(Mesh);
    Mesh->SetStaticMesh(Cube); Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision); Mesh->RegisterComponent();
    Mesh->SetWorldScale3D(FVector(20, 20, .1));
    auto Light = GetWorld()->SpawnActor<ADirectionalLight>(); Light->SetActorRotation(FRotator(-50, -30, 0));
    auto Camera = GetWorld()->SpawnActor<ACameraActor>(FVector(-500, -500, 400), FRotator(-25, 45, 0));
    if (auto PC = GetWorld()->GetFirstPlayerController()) PC->SetViewTarget(Camera);
    SceneReady = P && Cube && Camera && Light;
    Tone = NewObject<USoundWaveProcedural>(this);
    Tone->SetSampleRate(48000); Tone->NumChannels = 1; Tone->Duration = INDEFINITELY_LOOPING_DURATION;
    Tone->VirtualizationMode = EVirtualizationMode::PlayWhenSilent;
    TArray<int16> Samples; Samples.SetNumUninitialized(48000 * 30);
    for (int32 I = 0; I < Samples.Num(); ++I) Samples[I] = static_cast<int16>(6000.0 * FMath::Sin(2.0 * PI * 440.0 * I / 48000.0));
    Tone->QueueAudio(reinterpret_cast<const uint8*>(Samples.GetData()), Samples.Num() * sizeof(int16));
    Audio = NewObject<UAudioComponent>(this); Audio->bAutoActivate = false; Audio->bIsUISound = true;
    Audio->SetSound(Tone); Audio->SetVolumeMultiplier(0); Audio->RegisterComponent(); Audio->Play();
    IConsoleManager::Get().RegisterConsoleCommand(TEXT("sample.tone"), TEXT("Sample tone volume: 0 or 1"), FConsoleCommandWithArgsDelegate::CreateUObject(this, &AObservationGameMode::SetTone));
    Started = FPlatformTime::Seconds();
    Probe = MakeShared<FSampleProbe>(this);
}
void AObservationGameMode::SetTone(const TArray<FString>& Args)
{
    ++Commands;
    if (Audio && Args.Num() == 1) Audio->SetVolumeMultiplier(Args[0] == TEXT("1") ? 1.0f : 0.0f);
}
void AObservationGameMode::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (!Runner && Probe && !RequestPath.IsEmpty() && !OutputPath.IsEmpty() && FPlatformTime::Seconds() - Started >= .2)
    {
        Runner = MakeUnique<FAgentVerifyRunner>(GetWorld(), Probe.ToSharedRef(), RequestPath, OutputPath);
        Started = FPlatformTime::Seconds();
    }
    if (!Runner) return;
    if (CancelAfter > 0 && !Cancelled && FPlatformTime::Seconds() - Started >= CancelAfter)
    {
        Runner->Cancel(TEXT("sample_cancelled")); Cancelled = true;
    }
    if (Runner->IsFinished() && ++FramesAfter >= 4)
    {
        WriteAdapterObservation();
        FPlatformMisc::RequestExit(false);
    }
}
void AObservationGameMode::WriteAdapterObservation()
{
    const auto P = SamplePawn();
    auto J = MakeShared<FJsonObject>();
    J->SetNumberField(TEXT("schema_version"), 1); J->SetBoolField(TEXT("scene_ready"), SceneReady);
    J->SetNumberField(TEXT("commands"), Commands); J->SetNumberField(TEXT("post_completion_frames"), FramesAfter);
    J->SetBoolField(TEXT("pawn_available"), P != nullptr);
    if (P)
    {
        J->SetNumberField(TEXT("position_x"), P->GetActorLocation().X); J->SetNumberField(TEXT("axis_after_release"), P->Axis);
        J->SetBoolField(TEXT("key_held_after_release"), P->Held); J->SetNumberField(TEXT("presses"), P->Presses); J->SetNumberField(TEXT("releases"), P->Releases);
    }
    FString Text; FJsonSerializer::Serialize(J, TJsonWriterFactory<>::Create(&Text));
    FFileHelper::SaveStringToFile(Text, *FPaths::Combine(OutputPath, TEXT("adapter.json")), FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
}
void AObservationGameMode::EndPlay(const EEndPlayReason::Type Reason)
{
    Runner.Reset(); Probe.Reset();
    IConsoleManager::Get().UnregisterConsoleObject(TEXT("sample.tone"), false);
    if (Audio) Audio->Stop();
    Super::EndPlay(Reason);
}
