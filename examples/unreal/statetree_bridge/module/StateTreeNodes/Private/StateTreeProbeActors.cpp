#include "StateTreeProbeActors.h"
#include "Components/StateTreeAIComponent.h"
#include "StateTree.h"

AStateTreeProbePawn::AStateTreeProbePawn()
{
	AIControllerClass = AStateTreeProbeController::StaticClass();
	AutoPossessAI = EAutoPossessAI::PlacedInWorldOrSpawned;
}

AStateTreeProbeController::AStateTreeProbeController()
{
	StateTreeComponent = CreateDefaultSubobject<UStateTreeAIComponent>(TEXT("StateTreeAIComponent"));
	// The tree is set when the controller possesses a pawn, so the component must not start one at BeginPlay.
	StateTreeComponent->SetStartLogicAutomatically(false);
}

void AStateTreeProbeController::OnPossess(APawn* InPawn)
{
	Super::OnPossess(InPawn);
	AStateTreeProbePawn* Probe = Cast<AStateTreeProbePawn>(InPawn);
	if (Probe && Probe->Tree)
	{
		Probe->Events.Add(TEXT("started"));
		StateTreeComponent->SetStateTree(Probe->Tree);
		StateTreeComponent->StartLogic();
	}
}
