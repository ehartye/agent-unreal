#include "ChaosBreakBuildCommandlet.h"

#include "AssetRegistry/AssetRegistryModule.h"
#include "Dataflow/DataflowSelection.h"
#include "Engine/StaticMesh.h"
#include "FractureEngineFracturing.h"
#include "GeometryCollection/GeometryCollection.h"
#include "GeometryCollection/GeometryCollectionConvexUtility.h"
#include "GeometryCollection/GeometryCollectionEngineConversion.h"
#include "GeometryCollection/GeometryCollectionObject.h"
#include "HAL/FileManager.h"
#include "Materials/Material.h"
#include "Math/RandomStream.h"
#include "Misc/EngineVersion.h"
#include "Misc/FileHelper.h"
#include "Misc/PackageName.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "UObject/Package.h"
#include "UObject/SavePackage.h"

DEFINE_LOG_CATEGORY_STATIC(LogChaosBreakBuild, Log, All);

namespace
{
	FString JsonEscape(const FString& In)
	{
		return In.Replace(TEXT("\\"), TEXT("\\\\")).Replace(TEXT("\""), TEXT("\\\""));
	}

	struct FVariantResult
	{
		FString Name;
		FString Package;
		FString Steps;
		FString Error;
		bool bOk = false;
		bool bAppended = false;
		bool bSimulationDataDirty = false;
		int32 GeometryIndex = INDEX_NONE;
		int32 Transforms = 0;
		int32 HullTransforms = 0;
		int32 HullObjects = 0;
		int64 FileBytes = 0;
		double Seconds = 0.0;
	};

	struct FVariantPlan
	{
		bool bHulls = true;               // run a hull step
		bool bEngineHulls = false;        // use UpdateGeometryDependentProperties instead of GetValidConvexHullData
		bool bSimDataBeforeHulls = false; // CreateSimulationData first, hulls after, no second invalidate
		float PointSpacing = 250.f;
	};

	bool PlanFor(const FString& Name, FVariantPlan& Plan)
	{
		if (Name == TEXT("healthy")) { return true; }
		if (Name == TEXT("nohull")) { Plan.bHulls = false; return true; }
		if (Name == TEXT("update_hulls")) { Plan.bEngineHulls = true; return true; }
		if (Name == TEXT("simdata_first")) { Plan.bSimDataBeforeHulls = true; return true; }
		if (Name == TEXT("fine_spacing")) { Plan.PointSpacing = 1.f; return true; }
		return false;
	}

	// Counts the transforms that carry at least one convex hull, and the hull objects the collection holds.
	void CountHulls(FGeometryCollection& Collection, FVariantResult& Result)
	{
		Result.Transforms = Collection.NumElements(FTransformCollection::TransformGroup);
		if (FGeometryCollectionConvexUtility::HasConvexHullData(&Collection))
		{
			if (TOptional<FGeometryCollectionConvexUtility::FGeometryCollectionConvexData> Data = FGeometryCollectionConvexUtility::GetConvexHullDataIfPresent(&Collection))
			{
				Result.HullObjects = Data->ConvexHull.Num();
				for (int32 Index = 0; Index < Data->TransformToConvexIndices.Num(); ++Index)
				{
					if (Data->TransformToConvexIndices[Index].Num() > 0)
					{
						++Result.HullTransforms;
					}
				}
			}
		}
	}

	bool SaveAsset(UPackage* Package, UObject* Asset, const FString& PackageName, FVariantResult& Result)
	{
		const FString File = FPackageName::LongPackageNameToFilename(PackageName, FPackageName::GetAssetPackageExtension());
		FSavePackageArgs Args;
		Args.TopLevelFlags = RF_Public | RF_Standalone;
		if (!UPackage::SavePackage(Package, Asset, *File, Args))
		{
			Result.Error = TEXT("SavePackage returned false");
			return false;
		}
		Result.FileBytes = IFileManager::Get().FileSize(*File);
		return true;
	}

	FVariantResult BuildVariant(const FString& Name, UStaticMesh* Mesh, const TArray<UMaterialInterface*>& Materials, const FString& OutDir, int32 NumSites, int32 Seed)
	{
		FVariantResult Result;
		Result.Name = Name;
		const double Started = FPlatformTime::Seconds();
		FVariantPlan Plan;
		if (!PlanFor(Name, Plan))
		{
			Result.Error = TEXT("unknown variant");
			return Result;
		}
		const FString AssetName = TEXT("GC_") + Name;
		Result.Package = OutDir / AssetName;

		UPackage* Package = CreatePackage(*Result.Package);
		UGeometryCollection* Asset = NewObject<UGeometryCollection>(Package, UGeometryCollection::StaticClass(), FName(*AssetName), RF_Public | RF_Standalone | RF_Transactional);
		if (!Asset)
		{
			Result.Error = TEXT("NewObject<UGeometryCollection> failed");
			return Result;
		}

		// source: GeometryCollectionEngineConversion.h, the AppendStaticMesh overload that fills a UGeometryCollection (WITH_EDITORONLY_DATA body).
		Result.bAppended = FGeometryCollectionEngineConversion::AppendStaticMesh(Mesh, Materials, FTransform::Identity, Asset);
		Result.Steps += TEXT("append;");
		if (!Result.bAppended)
		{
			Result.Error = TEXT("AppendStaticMesh returned false");
			return Result;
		}

		// source: FractureEngineFracturing.h, FFractureEngineFracturing::VoronoiFracture (defaults copied from the Voronoi Dataflow node).
		FGeometryCollection& Collection = *Asset->GetGeometryCollection();
		FDataflowTransformSelection Selection;
		Selection.InitializeFromCollection(Collection, true);
		const FBox Bounds = Mesh->GetBounds().GetBox();
		FRandomStream Stream(Seed);
		TArray<FVector> Sites;
		for (int32 Index = 0; Index < NumSites; ++Index)
		{
			Sites.Add(FVector(Stream.FRandRange(Bounds.Min.X, Bounds.Max.X), Stream.FRandRange(Bounds.Min.Y, Bounds.Max.Y), Stream.FRandRange(Bounds.Min.Z, Bounds.Max.Z)));
		}
		Result.GeometryIndex = FFractureEngineFracturing::VoronoiFracture(Collection, Selection, Sites, FTransform::Identity, Seed, 1.0f, FIslandSplitSettings(),
			/*Grout*/ 0.f, /*Amplitude*/ 0.f, /*Frequency*/ 0.1f, /*Persistence*/ 0.5f, /*Lacunarity*/ 2.f, /*OctaveNumber*/ 4, Plan.PointSpacing,
			/*AddSamplesForCollision*/ false, /*CollisionSampleSpacing*/ 50.f);
		Result.Steps += TEXT("voronoi;");
		if (Result.GeometryIndex == INDEX_NONE)
		{
			Result.Error = TEXT("VoronoiFracture returned INDEX_NONE");
			return Result;
		}

		FGeometryCollection& Fractured = *Asset->GetGeometryCollection();   // fetched again: the fracture replaces the collection's contents
		if (Plan.bSimDataBeforeHulls)
		{
			Asset->InvalidateCollection();
			Asset->CreateSimulationData();
			Result.Steps += TEXT("simdata;");
		}
		if (Plan.bHulls)
		{
			if (Plan.bEngineHulls)
			{
				// source: GeometryCollectionObject.h, UGeometryCollection::UpdateGeometryDependentProperties (editor build: UpdateConvexGeometry).
				Asset->UpdateGeometryDependentProperties();
				Result.Steps += TEXT("update_geometry_dependent;");
			}
			else
			{
				// source: GeometryCollectionConvexUtility.h, FGeometryCollectionConvexUtility::GetValidConvexHullData.
				FGeometryCollectionConvexUtility::GetValidConvexHullData(&Fractured);
				Result.Steps += TEXT("valid_hulls;");
			}
		}
		if (!Plan.bSimDataBeforeHulls)
		{
			Asset->InvalidateCollection();
			Asset->CreateSimulationData();
			Result.Steps += TEXT("invalidate;simdata;");
		}
		CountHulls(*Asset->GetGeometryCollection(), Result);
		Result.bSimulationDataDirty = Asset->IsSimulationDataDirty();

		FAssetRegistryModule::AssetCreated(Asset);
		Asset->MarkPackageDirty();
		Result.bOk = SaveAsset(Package, Asset, Result.Package, Result);
		Result.Steps += TEXT("save;");
		Result.Seconds = FPlatformTime::Seconds() - Started;
		return Result;
	}

	// A project material with the Geometry Collections usage flag set, saved without a shader compile. Returns null when it cannot be made.
	UMaterialInterface* MakeUsageFlaggedMaterial(const FString& OutDir, FString& OutPackage, FString& OutError)
	{
		const FString PackageName = OutDir / TEXT("M_Piece");
		UPackage* Package = CreatePackage(*PackageName);
		UMaterial* Material = NewObject<UMaterial>(Package, TEXT("M_Piece"), RF_Public | RF_Standalone | RF_Transactional);
		if (!Material)
		{
			OutError = TEXT("NewObject<UMaterial> failed");
			return nullptr;
		}
		// source: Materials/Material.h, UMaterial::SetUsageByFlag (sets the flag directly, no recompile); EMaterialUsage::MATUSAGE_GeometryCollections.
		Material->SetUsageByFlag(MATUSAGE_GeometryCollections, true);
		FAssetRegistryModule::AssetCreated(Material);
		Material->MarkPackageDirty();
		FVariantResult Scratch;
		if (!SaveAsset(Package, Material, PackageName, Scratch))
		{
			OutError = Scratch.Error;
			return nullptr;
		}
		OutPackage = PackageName;
		return Material;
	}
}

UChaosBreakBuildCommandlet::UChaosBreakBuildCommandlet(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	LogToConsole = true;
}

int32 UChaosBreakBuildCommandlet::Main(const FString& Params)
{
	FString MeshPath = TEXT("/Engine/BasicShapes/Cube.Cube");
	FString OutDir = TEXT("/Game/Chaos");
	FString Variants = TEXT("healthy+nohull+update_hulls+simdata_first");
	FString ReportPath;
	FString MaterialMode = TEXT("engine");
	int32 NumSites = 24;
	int32 Seed = 7;
	FParse::Value(*Params, TEXT("Mesh="), MeshPath);
	FParse::Value(*Params, TEXT("OutDir="), OutDir);
	FParse::Value(*Params, TEXT("Variants="), Variants);
	FParse::Value(*Params, TEXT("Report="), ReportPath);
	FParse::Value(*Params, TEXT("Material="), MaterialMode);
	FParse::Value(*Params, TEXT("Sites="), NumSites);
	FParse::Value(*Params, TEXT("Seed="), Seed);

	TArray<FString> Errors;
	TArray<FVariantResult> Results;
	FString MaterialPackage;

	UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, *MeshPath);
	if (!Mesh)
	{
		Errors.Add(FString::Printf(TEXT("static mesh %s did not load"), *MeshPath));
	}
	else
	{
		TArray<UMaterialInterface*> Materials;
		for (const FStaticMaterial& Slot : Mesh->GetStaticMaterials())
		{
			Materials.Add(Slot.MaterialInterface);
		}
		if (MaterialMode == TEXT("project"))
		{
			FString MaterialError;
			if (UMaterialInterface* Flagged = MakeUsageFlaggedMaterial(OutDir, MaterialPackage, MaterialError))
			{
				for (UMaterialInterface*& Slot : Materials)
				{
					Slot = Flagged;
				}
			}
			else
			{
				Errors.Add(FString::Printf(TEXT("project material: %s"), *MaterialError));
			}
		}
		TArray<FString> Names;
		Variants.ParseIntoArray(Names, TEXT("+"), true);   // a comma would end the value: FParse::Value stops an unquoted value at "," and ")"
		for (const FString& Name : Names)
		{
			Results.Add(BuildVariant(Name, Mesh, Materials, OutDir, NumSites, Seed));
			UE_LOG(LogChaosBreakBuild, Display, TEXT("variant %s: ok=%d transforms=%d hullTransforms=%d bytes=%lld %s"), *Name, Results.Last().bOk ? 1 : 0,
				Results.Last().Transforms, Results.Last().HullTransforms, Results.Last().FileBytes, *Results.Last().Error);
		}
	}

	FString Json = TEXT("{\n");
	Json += FString::Printf(TEXT("  \"engine\": \"%s\",\n  \"mesh\": \"%s\",\n  \"material\": \"%s\",\n  \"materialPackage\": \"%s\",\n  \"sites\": %d,\n  \"seed\": %d,\n"),
		*JsonEscape(FEngineVersion::Current().ToString()), *JsonEscape(MeshPath), *JsonEscape(MaterialMode), *JsonEscape(MaterialPackage), NumSites, Seed);
	Json += TEXT("  \"variants\": [\n");
	for (int32 i = 0; i < Results.Num(); ++i)
	{
		const FVariantResult& R = Results[i];
		Json += FString::Printf(TEXT("    {\"name\": \"%s\", \"package\": \"%s\", \"ok\": %s, \"appended\": %s, \"geometryIndex\": %d, \"transforms\": %d, \"hullTransforms\": %d, \"hullObjects\": %d, \"simulationDataDirty\": %s, \"fileBytes\": %lld, \"seconds\": %.2f, \"steps\": \"%s\", \"error\": \"%s\"}%s\n"),
			*JsonEscape(R.Name), *JsonEscape(R.Package), R.bOk ? TEXT("true") : TEXT("false"), R.bAppended ? TEXT("true") : TEXT("false"), R.GeometryIndex, R.Transforms,
			R.HullTransforms, R.HullObjects, R.bSimulationDataDirty ? TEXT("true") : TEXT("false"), R.FileBytes, R.Seconds, *JsonEscape(R.Steps), *JsonEscape(R.Error),
			i + 1 < Results.Num() ? TEXT(",") : TEXT(""));
	}
	Json += TEXT("  ],\n  \"errors\": [");
	for (int32 i = 0; i < Errors.Num(); ++i)
	{
		Json += FString::Printf(TEXT("%s\"%s\""), i ? TEXT(", ") : TEXT(""), *JsonEscape(Errors[i]));
	}
	Json += TEXT("]\n}\n");
	if (!ReportPath.IsEmpty())
	{
		IFileManager::Get().MakeDirectory(*FPaths::GetPath(ReportPath), true);
		FFileHelper::SaveStringToFile(Json, *ReportPath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
	}
	return Errors.Num() == 0 ? 0 : 1;
}
