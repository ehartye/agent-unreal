#include "LandscapeBridgeLibrary.h"

#include "Engine/World.h"
#include "Landscape.h"
#include "LandscapeBlueprintBrushBase.h"
#include "LandscapeDataAccess.h"
#include "LandscapeEditLayer.h"
#include "LandscapeInfo.h"
#include "LandscapeProxy.h"
#include "LandscapeSubsystem.h"

DEFINE_LOG_CATEGORY_STATIC(LogLandscapeBridge, Log, All);

ALandscape* ULandscapeBridgeLibrary::CreateLandscapeFromHeights(UWorld* World, const TArray<float>& HeightsCm, int32 SizeX, int32 SizeY,
	int32 QuadsPerSection, int32 SectionsPerComponent, FVector Location, FVector Scale, int32 GridSizeInComponents)
{
	const int32 QuadsPerComponent = QuadsPerSection * SectionsPerComponent;
	const bool bValidSection = QuadsPerSection == 7 || QuadsPerSection == 15 || QuadsPerSection == 31 || QuadsPerSection == 63 || QuadsPerSection == 127 || QuadsPerSection == 255;
	if (!World || !bValidSection || (SectionsPerComponent != 1 && SectionsPerComponent != 2) || SizeX < 2 || SizeY < 2
		|| (SizeX - 1) % QuadsPerComponent != 0 || (SizeY - 1) % QuadsPerComponent != 0 || HeightsCm.Num() != SizeX * SizeY || Scale.Z == 0.0)
	{
		UE_LOG(LogLandscapeBridge, Error, TEXT("CreateLandscapeFromHeights: invalid arguments (%d x %d, %d quads, %d sections, %d heights)"), SizeX, SizeY, QuadsPerSection, SectionsPerComponent, HeightsCm.Num());
		return nullptr;
	}

	// A stored height is a uint16 around 32768. Local height = (value - 32768) / 128, and the actor scale multiplies it.
	TArray<uint16> Heights;
	Heights.SetNumUninitialized(HeightsCm.Num());
	for (int32 Index = 0; Index < HeightsCm.Num(); ++Index)
	{
		const float Local = HeightsCm[Index] / static_cast<float>(Scale.Z);
		Heights[Index] = static_cast<uint16>(FMath::Clamp(FMath::RoundToInt(Local / LANDSCAPE_ZSCALE + LandscapeDataAccess::MidValue), 0, 65535));
	}

	ALandscape* Landscape = World->SpawnActor<ALandscape>(Location, FRotator::ZeroRotator);
	if (!Landscape)
	{
		return nullptr;
	}
	Landscape->SetActorRelativeScale3D(Scale);

	TMap<FGuid, TArray<uint16>> HeightData;
	HeightData.Add(FGuid(), MoveTemp(Heights));
	TMap<FGuid, TArray<FLandscapeImportLayerInfo>> LayerData;
	LayerData.Add(FGuid(), TArray<FLandscapeImportLayerInfo>());

	// The signature of ALandscapeProxy::Import is in Runtime/Landscape/Classes/LandscapeProxy.h.
	Landscape->Import(FGuid::NewGuid(), 0, 0, SizeX - 1, SizeY - 1, SectionsPerComponent, QuadsPerSection, HeightData, TEXT(""), LayerData,
		ELandscapeImportAlphamapType::Layered, TArrayView<const FLandscapeLayer>());

	ULandscapeInfo* Info = Landscape->GetLandscapeInfo();
	if (Info)
	{
		Info->UpdateLayerInfoMap(Landscape);
		ULandscapeSubsystem* Subsystem = World->GetSubsystem<ULandscapeSubsystem>();
		if (GridSizeInComponents > 0 && Subsystem && Subsystem->IsGridBased())
		{
			Subsystem->ChangeGridSize(Info, GridSizeInComponents);
		}
	}
	return Landscape;
}

bool ULandscapeBridgeLibrary::GetLandscapeHeightAt(ALandscapeProxy* Landscape, FVector WorldLocation, float& OutHeight)
{
	const TOptional<float> Height = Landscape ? Landscape->GetHeightAtLocation(WorldLocation) : TOptional<float>();
	OutHeight = Height.Get(0.0f);
	return Height.IsSet();
}

// The brush functions below call ALandscape's edit layer API, which is C++ only (Runtime/Landscape/Classes/Landscape.h, inside WITH_EDITOR).
bool ULandscapeBridgeLibrary::AttachBrushToLayer(ALandscape* Landscape, int32 LayerIndex, ALandscapeBlueprintBrushBase* Brush)
{
	if (!Landscape || !Brush || Landscape->IsTemplate())
	{
		return false;
	}
	// ALandscape::AddBrushToLayer begins with check(GetBrushLayer(Brush) == INDEX_NONE), which stops the editor for a brush that is attached already.
	if (Landscape->GetBrushLayer(Brush) != INDEX_NONE)
	{
		return false;
	}
	const ULandscapeEditLayerBase* Layer = Landscape->GetEditLayerConst(LayerIndex);
	if (!Layer || !Layer->SupportsBlueprintBrushes())
	{
		return false;
	}
	Landscape->AddBrushToLayer(LayerIndex, Brush);
	return Landscape->GetBrushLayer(Brush) == LayerIndex;
}

bool ULandscapeBridgeLibrary::DetachBrush(ALandscape* Landscape, ALandscapeBlueprintBrushBase* Brush)
{
	if (!Landscape || !Brush || Landscape->GetBrushLayer(Brush) == INDEX_NONE)
	{
		return false;
	}
	Landscape->RemoveBrush(Brush);
	return Landscape->GetBrushLayer(Brush) == INDEX_NONE;
}

int32 ULandscapeBridgeLibrary::GetBrushLayerIndex(ALandscape* Landscape, ALandscapeBlueprintBrushBase* Brush)
{
	return (Landscape && Brush) ? Landscape->GetBrushLayer(Brush) : INDEX_NONE;
}

int32 ULandscapeBridgeLibrary::GetBrushCountForLayer(ALandscape* Landscape, int32 LayerIndex)
{
	if (!Landscape || !Landscape->GetEditLayerConst(LayerIndex))
	{
		return -1;
	}
	return Landscape->GetBrushesForLayer(LayerIndex).Num();
}

ALandscape* ULandscapeBridgeLibrary::GetBrushOwningLandscape(ALandscapeBlueprintBrushBase* Brush)
{
	return Brush ? Brush->GetOwningLandscape() : nullptr;
}
