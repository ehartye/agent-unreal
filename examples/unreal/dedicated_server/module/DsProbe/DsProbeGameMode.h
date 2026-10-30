#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "DsProbeGameMode.generated.h"

/** Spawns the replicated Actor when play starts and logs what kind of process this is. */
UCLASS()
class DSPROBE_API ADsProbeGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	virtual void StartPlay() override;
};
