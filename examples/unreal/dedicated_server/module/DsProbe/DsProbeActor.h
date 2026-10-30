#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "DsProbeActor.generated.h"

DECLARE_LOG_CATEGORY_EXTERN(LogDsProbe, Log, All);

/** One Actor with one replicated integer. The server sets Value; a client logs the value it receives. */
UCLASS()
class DSPROBE_API ADsProbeActor : public AActor
{
	GENERATED_BODY()

public:
	ADsProbeActor();

	/** The value the server sets; the probe judges the client log for this number. */
	static constexpr int32 ProbeValue = 4242;

	UPROPERTY(ReplicatedUsing = OnRep_Value)
	int32 Value = 0;

	UFUNCTION()
	void OnRep_Value();

	virtual void BeginPlay() override;
	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;
};
