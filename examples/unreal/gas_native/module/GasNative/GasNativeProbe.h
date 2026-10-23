#pragma once

#include "Commandlets/Commandlet.h"
#include "GameFramework/Actor.h"
#include "AbilitySystemInterface.h"
#include "GasNativeProbe.generated.h"

class UAbilitySystemComponent;

/** An actor that owns an Ability System Component. */
UCLASS()
class GASNATIVE_API AGasNativeActor : public AActor, public IAbilitySystemInterface
{
	GENERATED_BODY()

public:
	AGasNativeActor();
	virtual UAbilitySystemComponent* GetAbilitySystemComponent() const override { return Asc; }

	UPROPERTY()
	TObjectPtr<UAbilitySystemComponent> Asc;
};

/**
 * Runs the whole scenario with no map: a game world made by hand, one actor, and a loop that ticks the world.
 *   UnrealEditor-Cmd.exe Project.uproject -run=GasNativeProbe -Report=<file.json> -nullrhi -unattended
 */
UCLASS()
class GASNATIVE_API UGasNativeProbeCommandlet : public UCommandlet
{
	GENERATED_BODY()

public:
	virtual int32 Main(const FString& Params) override;
};
