#include "MachineAnimInstance.h"

#include "Animation/AnimClassInterface.h"
#include "Animation/AnimNode_StateMachine.h"

void UMachineAnimInstance::SetMachineInputs(bool bWalk, bool bIdle)
{
	bGoWalk = bWalk;
	bGoIdle = bIdle;
}

TArray<FName> UMachineAnimInstance::GetMachineNames() const
{
	TArray<FName> Names;
	if (const IAnimClassInterface* AnimClass = IAnimClassInterface::GetFromClass(GetClass()))
	{
		for (const FBakedAnimationStateMachine& Machine : AnimClass->GetBakedStateMachines())
		{
			Names.Add(Machine.MachineName);
		}
	}
	return Names;
}

FName UMachineAnimInstance::GetMachineState(FName MachineName) const
{
	// source: Engine/Source/Runtime/Engine/Classes/Animation/AnimInstance.h GetStateMachineInstanceFromName; AnimNode_StateMachine.h GetCurrentStateName.
	if (const FAnimNode_StateMachine* Machine = GetStateMachineInstanceFromName(MachineName))
	{
		return Machine->GetCurrentStateName();
	}
	return NAME_None;
}
