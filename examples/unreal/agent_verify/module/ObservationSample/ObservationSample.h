#pragma once
#include "CoreMinimal.h"
#include "AgentVerifyRunner.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/Pawn.h"
#include "ObservationSample.generated.h"

class IAgentVerifyProbe;
class UAudioComponent;
class USoundWaveProcedural;

UCLASS()
class AObservationPawn : public APawn
{
    GENERATED_BODY()
public:
    AObservationPawn();
    virtual void SetupPlayerInputComponent(UInputComponent* Input) override;
    virtual void Tick(float DeltaSeconds) override;
    double Axis = 0;
    int32 Presses = 0;
    int32 Releases = 0;
    bool Held = false;
private:
    void Move(float Value);
    void Press();
    void Release();
};

UCLASS()
class AObservationGameMode : public AGameModeBase
{
    GENERATED_BODY()
public:
    AObservationGameMode();
    virtual ~AObservationGameMode();
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;
    virtual void EndPlay(const EEndPlayReason::Type Reason) override;
    AObservationPawn* SamplePawn() const;
    bool SceneReady = false;
    int32 Commands = 0;
private:
    void SetTone(const TArray<FString>& Args);
    void WriteAdapterObservation();
    UPROPERTY() TObjectPtr<UAudioComponent> Audio;
    UPROPERTY() TObjectPtr<USoundWaveProcedural> Tone;
    TSharedPtr<IAgentVerifyProbe> Probe;
    TUniquePtr<FAgentVerifyRunner> Runner;
    FString RequestPath, OutputPath;
    double Started = 0;
    float CancelAfter = 0;
    int32 FramesAfter = 0;
    bool Cancelled = false;
};
