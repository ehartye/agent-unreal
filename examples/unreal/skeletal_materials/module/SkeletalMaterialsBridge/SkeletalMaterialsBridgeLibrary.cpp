#include "SkeletalMaterialsBridgeLibrary.h"

#include "Engine/SkeletalMesh.h"
#include "Engine/SkinnedAssetCommon.h"
#include "Materials/MaterialInterface.h"

DEFINE_LOG_CATEGORY_STATIC(LogSkeletalMaterialsBridge, Log, All);

bool USkeletalMaterialsBridgeLibrary::SetSkeletalMeshMaterials(USkeletalMesh* Mesh, const TArray<UMaterialInterface*>& Materials)
{
	if (!Mesh)
	{
		UE_LOG(LogSkeletalMaterialsBridge, Error, TEXT("SetSkeletalMeshMaterials: no mesh"));
		return false;
	}

	// source: Engine/Source/Runtime/Engine/Classes/Engine/SkeletalMesh.h  USkeletalMesh::GetMaterials() returns TArray<FSkeletalMaterial>&
	// source: Engine/Source/Runtime/Engine/Classes/Engine/SkinnedAssetCommon.h  FSkeletalMaterial::MaterialInterface
	TArray<FSkeletalMaterial>& Slots = Mesh->GetMaterials();
	if (Slots.Num() != Materials.Num())
	{
		UE_LOG(LogSkeletalMaterialsBridge, Error, TEXT("SetSkeletalMeshMaterials: %s has %d material slots and %d materials were given"), *Mesh->GetPathName(), Slots.Num(), Materials.Num());
		return false;
	}

	Mesh->Modify();
	for (int32 Index = 0; Index < Slots.Num(); ++Index)
	{
		Slots[Index].MaterialInterface = Materials[Index];
	}
	// PostEditChange refreshes the mesh's material info cache, which feeds the hidden asset-registry "Materials" tag
	// (USkeletalMesh::PostEditChangeProperty calls UpdateSkeletalMaterialsInfoCache in SkeletalMesh.cpp).
	Mesh->PostEditChange();
	Mesh->MarkPackageDirty();
	return true;
}
