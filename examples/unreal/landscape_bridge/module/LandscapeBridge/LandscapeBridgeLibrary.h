#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "LandscapeBridgeLibrary.generated.h"

class ALandscape;
class ALandscapeBlueprintBrushBase;
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

	/**
	 * Put a Blueprint brush (for example the Landmass brush manager) on an edit layer of the Landscape, the call the Landscape mode makes
	 * when a brush is assigned to a layer. ALandscape::AddBrushToLayer is C++ only and stops the editor when the brush is already on a layer,
	 * so this checks first.
	 * @param LayerIndex Position in the Landscape's edit layer list (the order Python's get_edit_layers returns).
	 * @return True when the brush is on that layer afterwards. False for a null argument, a brush that is already on a layer, or a layer that does not take brushes.
	 */
	UFUNCTION(BlueprintCallable, Category = "LandscapeBridge")
	static bool AttachBrushToLayer(ALandscape* Landscape, int32 LayerIndex, ALandscapeBlueprintBrushBase* Brush);

	/** Take the brush off whichever edit layer holds it. True when the brush was on a layer and is no longer. */
	UFUNCTION(BlueprintCallable, Category = "LandscapeBridge")
	static bool DetachBrush(ALandscape* Landscape, ALandscapeBlueprintBrushBase* Brush);

	/** Index of the edit layer that holds the brush, or -1 when it is on none. */
	UFUNCTION(BlueprintCallable, Category = "LandscapeBridge")
	static int32 GetBrushLayerIndex(ALandscape* Landscape, ALandscapeBlueprintBrushBase* Brush);

	/** Number of brushes on the edit layer, or -1 for an invalid layer index. */
	UFUNCTION(BlueprintCallable, Category = "LandscapeBridge")
	static int32 GetBrushCountForLayer(ALandscape* Landscape, int32 LayerIndex);

	/** The Landscape the brush believes it belongs to (set by the Landscape when the brush is added to a layer), or null. */
	UFUNCTION(BlueprintCallable, Category = "LandscapeBridge")
	static ALandscape* GetBrushOwningLandscape(ALandscapeBlueprintBrushBase* Brush);
};
