#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "SkeletalMaterialsBridgeLibrary.generated.h"

class UMaterialInterface;
class USkeletalMesh;

/** Python sees this class as unreal.SkeletalMaterialsBridgeLibrary (the leading U is dropped). */
UCLASS()
class USkeletalMaterialsBridgeLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/**
	 * Set the material of every slot of a skeletal mesh, in slot order, and mark the package dirty so that a default save writes it.
	 * @param Mesh The skeletal mesh.
	 * @param Materials One entry per slot. A null entry clears that slot.
	 * @return False, with an error in the log and no change, when Mesh is null or the number of materials differs from the number of slots.
	 */
	UFUNCTION(BlueprintCallable, Category = "SkeletalMaterialsBridge")
	static bool SetSkeletalMeshMaterials(USkeletalMesh* Mesh, const TArray<UMaterialInterface*>& Materials);
};
