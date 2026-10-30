#include "DsProbeActor.h"
#include "Net/UnrealNetwork.h"
#include "Engine/World.h"

DEFINE_LOG_CATEGORY(LogDsProbe);

ADsProbeActor::ADsProbeActor()
{
	bReplicates = true;
	bAlwaysRelevant = true;
}

void ADsProbeActor::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);
	DOREPLIFETIME(ADsProbeActor, Value);
}

void ADsProbeActor::BeginPlay()
{
	Super::BeginPlay();
	if (HasAuthority())
	{
		Value = ProbeValue;
		UE_LOG(LogDsProbe, Log, TEXT("DsProbe: server set Value=%d"), Value);
	}
	else
	{
		UE_LOG(LogDsProbe, Log, TEXT("DsProbe: client actor began with Value=%d"), Value);
	}
}

void ADsProbeActor::OnRep_Value()
{
	UE_LOG(LogDsProbe, Log, TEXT("DsProbe: client received Value=%d"), Value);
}
