#include "StateTreeProbeNodes.h"
#include "StateTreeProbeActors.h"
#include "StateTreeExecutionContext.h"

#include UE_INLINE_GENERATED_CPP_BY_NAME(StateTreeProbeNodes)

EStateTreeRunStatus FProbeWorkTask::EnterState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const
{
	const FInstanceDataType& Data = Context.GetInstanceData(*this);
	if (AStateTreeProbePawn* Pawn = Cast<AStateTreeProbePawn>(Data.Actor))
	{
		Pawn->Events.Add(FString::Printf(TEXT("enter:%s"), *Data.Label.ToString()));
	}
	return EStateTreeRunStatus::Running;
}

EStateTreeRunStatus FProbeWorkTask::Tick(FStateTreeExecutionContext& Context, const float DeltaTime) const
{
	const FInstanceDataType& Data = Context.GetInstanceData(*this);
	if (AStateTreeProbePawn* Pawn = Cast<AStateTreeProbePawn>(Data.Actor))
	{
		if (Data.bCountTicks)
		{
			++Pawn->WorkTicks;
		}
	}
	return EStateTreeRunStatus::Running;
}

void FProbeWorkTask::ExitState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const
{
	const FInstanceDataType& Data = Context.GetInstanceData(*this);
	if (AStateTreeProbePawn* Pawn = Cast<AStateTreeProbePawn>(Data.Actor))
	{
		Pawn->Events.Add(FString::Printf(TEXT("exit:%s"), *Data.Label.ToString()));
	}
}

bool FProbeCounterCondition::TestCondition(FStateTreeExecutionContext& Context) const
{
	const FInstanceDataType& Data = Context.GetInstanceData(*this);
	const AStateTreeProbePawn* Pawn = Cast<AStateTreeProbePawn>(Data.Actor);
	return Pawn && Pawn->WorkTicks >= Data.MinTicks;
}
