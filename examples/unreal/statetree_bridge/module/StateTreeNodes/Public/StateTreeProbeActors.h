#pragma once

#include "CoreMinimal.h"
#include "AIController.h"
#include "GameFramework/Pawn.h"
#include "StateTreeProbeActors.generated.h"

class UStateTree;
class UStateTreeAIComponent;

/** A pawn that records what its StateTree did: a tick counter and an ordered event list that Python reads back. */
UCLASS()
class STATETREENODES_API AStateTreeProbePawn : public APawn
{
	GENERATED_BODY()

public:
	AStateTreeProbePawn();

	/** The tree the AI controller runs when it possesses this pawn. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Probe")
	TObjectPtr<UStateTree> Tree;

	/** Ticks counted by tasks whose bCountTicks is set. */
	UPROPERTY(BlueprintReadOnly, Category = "Probe")
	int32 WorkTicks = 0;

	/** "started", then "enter:<label>" and "exit:<label>" in the order the tasks ran. */
	UPROPERTY(BlueprintReadOnly, Category = "Probe")
	TArray<FString> Events;
};

/** An AI controller that owns a StateTree AI component and starts the pawn's tree when it possesses the pawn. */
UCLASS()
class STATETREENODES_API AStateTreeProbeController : public AAIController
{
	GENERATED_BODY()

public:
	AStateTreeProbeController();

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Probe")
	TObjectPtr<UStateTreeAIComponent> StateTreeComponent;

protected:
	virtual void OnPossess(APawn* InPawn) override;
};
