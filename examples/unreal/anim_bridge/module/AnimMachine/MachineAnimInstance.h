#pragma once

#include "CoreMinimal.h"
#include "Animation/AnimInstance.h"
#include "MachineAnimInstance.generated.h"

/**
 * Parent class of the state machine and linked layer Animation Blueprints. Two Boolean variables are the inputs a transition rule reads;
 * Python sees the class as unreal.MachineAnimInstance and the functions below in snake case (set_machine_inputs, get_machine_names,
 * get_machine_state). The state name is read through functions of this class, so no Python access to the baked machine is needed.
 */
UCLASS(Blueprintable, BlueprintType)
class UMachineAnimInstance : public UAnimInstance
{
	GENERATED_BODY()

public:
	/** Read by the rule of the Idle to Walk transition. */
	UPROPERTY(BlueprintReadWrite, EditAnywhere, Category = "Machine")
	bool bGoWalk = false;

	/** Read by the rule of the Walk to Idle transition. */
	UPROPERTY(BlueprintReadWrite, EditAnywhere, Category = "Machine")
	bool bGoIdle = false;

	UFUNCTION(BlueprintCallable, Category = "Machine")
	void SetMachineInputs(bool bWalk, bool bIdle);

	/** The names of the baked state machines in this instance's class (IAnimClassInterface::GetBakedStateMachines). */
	UFUNCTION(BlueprintCallable, Category = "Machine")
	TArray<FName> GetMachineNames() const;

	/** The name of the current state of a state machine, or None when there is no such machine (UAnimInstance::GetStateMachineInstanceFromName). */
	UFUNCTION(BlueprintCallable, Category = "Machine")
	FName GetMachineState(FName MachineName) const;
};
