#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "LockProbeActors.generated.h"

class UStaticMesh;
class UMaterialInterface;
class UStaticMeshComponent;

/** Loads its mesh and material in the constructor with ConstructorHelpers, so the class default object references them. */
UCLASS()
class ALockCtorActor : public AActor
{
	GENERATED_BODY()
public:
	ALockCtorActor();
	UPROPERTY() TObjectPtr<UStaticMeshComponent> Mesh;
};

/** Loads its mesh and material with LoadObject in PostInitializeComponents, so only an instance references them. */
UCLASS()
class ALockPostActor : public AActor
{
	GENERATED_BODY()
public:
	ALockPostActor();
	virtual void PostInitializeComponents() override;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> Mesh;
};

/** Holds soft references (set in the constructor, not loaded) and resolves them with LoadSynchronous in PostInitializeComponents. */
UCLASS()
class ALockSoftActor : public AActor
{
	GENERATED_BODY()
public:
	ALockSoftActor();
	virtual void PostInitializeComponents() override;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> Mesh;
	UPROPERTY() TSoftObjectPtr<UStaticMesh> SoftMesh;
	UPROPERTY() TSoftObjectPtr<UMaterialInterface> SoftMaterial;
};
