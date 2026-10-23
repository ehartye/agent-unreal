#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "LandscapeBridgeLibrary.generated.h"

class ALandscape;
class ALandscapeProxy;
class UWorld;

/** Python sees this class as unreal.LandscapeBridgeLibrary (the leading U is dropped). */
UCLASS()
class ULandscapeBridgeLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/**
	 * Create a Landscape from a height array.
	 * @param HeightsCm Row-major, SizeX * SizeY entries, heights in centimetres above the actor origin.
	 * @param SizeX, SizeY Vertex counts. (Size - 1) must be a multiple of QuadsPerSection * SectionsPerComponent.
	 * @param QuadsPerSection 7, 15, 31, 63, 127 or 255.
	 * @param SectionsPerComponent 1 or 2.
	 * @param Location World position of vertex (0, 0).
	 * @param Scale Actor scale. X and Y are the quad size in centimetres.
	 * @param GridSizeInComponents In a World Partition map, components per streaming proxy side. 0 leaves every component on the Landscape actor (no streaming proxies).
	 * @return The new Landscape, or null when an argument is invalid.
	 */
	UFUNCTION(BlueprintCallable, Category = "LandscapeBridge")
	static ALandscape* CreateLandscapeFromHeights(UWorld* World, const TArray<float>& HeightsCm, int32 SizeX, int32 SizeY,
		int32 QuadsPerSection, int32 SectionsPerComponent, FVector Location, FVector Scale, int32 GridSizeInComponents);

	/** Height in centimetres (world Z) of the loaded landscape at a world X/Y, read through the engine's own height query. */
	UFUNCTION(BlueprintCallable, Category = "LandscapeBridge")
	static bool GetLandscapeHeightAt(ALandscapeProxy* Landscape, FVector WorldLocation, float& OutHeight);
};
