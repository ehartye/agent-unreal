#include "LockProbeActors.h"

#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInterface.h"
#include "UObject/ConstructorHelpers.h"

DEFINE_LOG_CATEGORY_STATIC(LogLockProbe, Log, All);

ALockCtorActor::ALockCtorActor()
{
	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	RootComponent = Mesh;
	static ConstructorHelpers::FObjectFinder<UStaticMesh> MeshFinder(TEXT("/Game/Lock/SM_Ctor.SM_Ctor"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> MaterialFinder(TEXT("/Game/Lock/M_Ctor.M_Ctor"));
	if (MeshFinder.Succeeded()) { Mesh->SetStaticMesh(MeshFinder.Object); }
	if (MaterialFinder.Succeeded()) { Mesh->SetMaterial(0, MaterialFinder.Object); }
}

ALockPostActor::ALockPostActor()
{
	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	RootComponent = Mesh;
}

void ALockPostActor::PostInitializeComponents()
{
	Super::PostInitializeComponents();
	UStaticMesh* LoadedMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Lock/SM_Post.SM_Post"));
	UMaterialInterface* LoadedMaterial = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Lock/M_Post.M_Post"));
	Mesh->SetStaticMesh(LoadedMesh);
	Mesh->SetMaterial(0, LoadedMaterial);
	UE_LOG(LogLockProbe, Display, TEXT("LockPost PostInitializeComponents mesh=%s material=%s"), LoadedMesh ? TEXT("loaded") : TEXT("missing"), LoadedMaterial ? TEXT("loaded") : TEXT("missing"));
}

ALockSoftActor::ALockSoftActor()
{
	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	RootComponent = Mesh;
	SoftMesh = TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(TEXT("/Game/Lock/SM_Soft.SM_Soft")));
	SoftMaterial = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Lock/M_Soft.M_Soft")));
}

void ALockSoftActor::PostInitializeComponents()
{
	Super::PostInitializeComponents();
	UStaticMesh* LoadedMesh = SoftMesh.LoadSynchronous();
	UMaterialInterface* LoadedMaterial = SoftMaterial.LoadSynchronous();
	Mesh->SetStaticMesh(LoadedMesh);
	Mesh->SetMaterial(0, LoadedMaterial);
	UE_LOG(LogLockProbe, Display, TEXT("LockSoft PostInitializeComponents mesh=%s material=%s"), LoadedMesh ? TEXT("loaded") : TEXT("missing"), LoadedMaterial ? TEXT("loaded") : TEXT("missing"));
}
