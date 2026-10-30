#include "DsProbeGameMode.h"
#include "DsProbeActor.h"
#include "Engine/World.h"

void ADsProbeGameMode::StartPlay()
{
	Super::StartPlay();
	UWorld* World = GetWorld();
	const ENetMode Mode = World ? World->GetNetMode() : NM_MAX;
	const TCHAR* ModeName = Mode == NM_Standalone ? TEXT("Standalone") : Mode == NM_DedicatedServer ? TEXT("DedicatedServer") : Mode == NM_ListenServer ? TEXT("ListenServer") : Mode == NM_Client ? TEXT("Client") : TEXT("Unknown");
	UE_LOG(LogDsProbe, Log, TEXT("DsProbe: game mode started, net mode %s, IsRunningDedicatedServer %d"), ModeName, IsRunningDedicatedServer() ? 1 : 0);
	if (World)
	{
		World->SpawnActor<ADsProbeActor>(FVector::ZeroVector, FRotator::ZeroRotator);
	}
}
