#pragma once

#include "CoreMinimal.h"
#include "StateTreeTaskBase.h"
#include "StateTreeConditionBase.h"
#include "StateTreeProbeNodes.generated.h"

/**
 * Instance data of the work task. A property in category "Context" whose type matches a context object of the schema is bound by the
 * compiler without a manual binding: the AI component schema offers the controlled pawn as "Actor" and the controller as "AIController".
 */
USTRUCT()
struct STATETREENODES_API FProbeWorkTaskInstanceData
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Context")
	TObjectPtr<AActor> Actor;

	UPROPERTY(EditAnywhere, Category = "Parameter")
	FName Label = NAME_None;

	/** True: every tick adds one to the pawn's WorkTicks. */
	UPROPERTY(EditAnywhere, Category = "Parameter")
	bool bCountTicks = true;
};

/** Notes entry and exit on the pawn and, while the state is active, counts ticks. It never finishes on its own. */
USTRUCT(meta = (DisplayName = "Probe Work"))
struct STATETREENODES_API FProbeWorkTask : public FStateTreeTaskCommonBase
{
	GENERATED_BODY()

	using FInstanceDataType = FProbeWorkTaskInstanceData;

	virtual const UStruct* GetInstanceDataType() const override { return FInstanceDataType::StaticStruct(); }
	virtual EStateTreeRunStatus EnterState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const override;
	virtual EStateTreeRunStatus Tick(FStateTreeExecutionContext& Context, const float DeltaTime) const override;
	virtual void ExitState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const override;
};

USTRUCT()
struct STATETREENODES_API FProbeCounterConditionInstanceData
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Context")
	TObjectPtr<AActor> Actor;

	UPROPERTY(EditAnywhere, Category = "Parameter")
	int32 MinTicks = 3;
};

/** True when the pawn's WorkTicks has reached MinTicks. */
USTRUCT(meta = (DisplayName = "Probe Ticks Reached"))
struct STATETREENODES_API FProbeCounterCondition : public FStateTreeConditionCommonBase
{
	GENERATED_BODY()

	using FInstanceDataType = FProbeCounterConditionInstanceData;

	virtual const UStruct* GetInstanceDataType() const override { return FInstanceDataType::StaticStruct(); }
	virtual bool TestCondition(FStateTreeExecutionContext& Context) const override;
};

USTRUCT()
struct STATETREENODES_API FProbeNeedsComponentTaskInstanceData
{
	GENERATED_BODY()

	/** No context object of the AI schema is a component, so the compiler reports this property as unbound. */
	UPROPERTY(EditAnywhere, Category = "Context")
	TObjectPtr<UActorComponent> Component;
};

/** A task with a Context property that no schema context object can satisfy; it exists to show a compile error in the log. */
USTRUCT(meta = (DisplayName = "Probe Needs Component"))
struct STATETREENODES_API FProbeNeedsComponentTask : public FStateTreeTaskCommonBase
{
	GENERATED_BODY()

	using FInstanceDataType = FProbeNeedsComponentTaskInstanceData;

	virtual const UStruct* GetInstanceDataType() const override { return FInstanceDataType::StaticStruct(); }
};
