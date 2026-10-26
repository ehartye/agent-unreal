#include "StateTreeProbeActors.h"
#include "Components/StateTreeAIComponent.h"
#include "Components/StateTreeComponent.h"
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

AStateTreeComponentProbePawn::AStateTreeComponentProbePawn()
{
	// No AI controller: the base pawn would spawn one for a placed or spawned pawn. The component runs the tree and its owner is this pawn.
	AutoPossessAI = EAutoPossessAI::Disabled;
	StateTreeComponent = CreateDefaultSubobject<UStateTreeComponent>(TEXT("StateTreeComponent"));
	// The tree is set at BeginPlay from the Tree property, so the component must not start an empty one itself.
	StateTreeComponent->SetStartLogicAutomatically(false);
}

void AStateTreeComponentProbePawn::BeginPlay()
{
	Super::BeginPlay();
	if (Tree)
	{
		Events.Add(TEXT("started"));
		StateTreeComponent->SetStateTree(Tree);
		StateTreeComponent->StartLogic();
	}
}
