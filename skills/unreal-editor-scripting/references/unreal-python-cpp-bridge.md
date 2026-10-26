# Bridging editor Python to C++: an editor-only module for what Python does not expose

Target: Unreal Engine 5.8.2, Windows. When an editor Python script needs a function the `unreal` module does not have, add a small editor-only C++ module whose `UFUNCTION(BlueprintCallable)` statics Python then calls. Everything else (materials, water, PCG, placement) stays in Python. The worked example creates a Landscape from a height array; `examples/unreal/landscape_bridge/` holds the module and `landscape_bridge.mjs`, which builds it and ran 19 of 19 checks on 5.8.2.

## When the bridge is needed

- [tested] On 5.8.2 the members of `unreal.Landscape` and `unreal.LandscapeProxy` whose names contain create, import, export, spawn, new or build were only `landscape_export_heightmap_to_render_target`, `landscape_import_heightmap_from_render_target` and `landscape_import_weightmap_from_render_target`. None creates a Landscape. Check the same way (`dir(unreal.<Class>)`) before writing a bridge.
- [documented] The C++ route is `ALandscapeProxy::Import`, declared inside `#if WITH_EDITOR` in `Engine/Source/Runtime/Landscape/Classes/LandscapeProxy.h` (line 1418) with `LANDSCAPE_API` and no `UFUNCTION`, so Python cannot reach it. Class page: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Landscape/ALandscapeProxy

```cpp
LANDSCAPE_API void Import(const FGuid& InGuid, int32 InMinX, int32 InMinY, int32 InMaxX, int32 InMaxY, int32 InNumSubsections, int32 InSubsectionSizeQuads, const TMap<FGuid, TArray<uint16>>& InImportHeightData,
	const TCHAR* const InHeightmapFileName, const TMap<FGuid, TArray<FLandscapeImportLayerInfo>>& InImportMaterialLayerInfos, ELandscapeImportAlphamapType InImportMaterialLayerType,
	const TArrayView<const struct FLandscapeLayer>& InImportLayers);
```

- [documented] Epic's New Landscape panel (`Editor/LandscapeEditor/Private/LandscapeEditorDetailCustomization_NewLandscape.cpp`, `OnCreateButtonClicked`) spawns an `ALandscape`, sets its scale, calls `Import(NewGuid, 0, 0, SizeX-1, SizeY-1, sections, quadsPerSection, {FGuid(): heights}, ...)` with an empty `FLandscapeLayer` view, then `UpdateLayerInfoMap` and `ChangeGridSize`. The example repeats that sequence.
- [documented] A stored height is a `uint16` around 32768: local height is `(value - 32768) / 128` (`LandscapeDataAccess.h`), and the actor scale multiplies it. Sizes are `components * quadsPerSection * sectionsPerComponent + 1` vertices per side.

## The module

Three files in `Source/LandscapeBridge/`, plus the module entry in the `.uproject` (`"Type": "Editor"`) and in the Editor target's `ExtraModuleNames`.

- `LandscapeBridge.Build.cs`: `PublicDependencyModuleNames` of `Core`, `CoreUObject`, `Engine`, `Landscape`.
- `LandscapeBridgeModule.cpp`: an empty `IModuleInterface` and `IMPLEMENT_MODULE`.
- `LandscapeBridgeLibrary.h/.cpp`: a `UBlueprintFunctionLibrary` with the statics.

```cpp
UFUNCTION(BlueprintCallable, Category = "LandscapeBridge")
static ALandscape* CreateLandscapeFromHeights(UWorld* World, const TArray<float>& HeightsCm, int32 SizeX, int32 SizeY,
	int32 QuadsPerSection, int32 SectionsPerComponent, FVector Location, FVector Scale, int32 GridSizeInComponents);
```

The body converts centimetres to `uint16`, spawns the `ALandscape`, calls `Import`, then `ULandscapeSubsystem::ChangeGridSize` when `IsGridBased()` and the grid size is above 0. It returns null for sizes that do not divide into components. A second static, `GetLandscapeHeightAt`, wraps `GetHeightAtLocation` so Python can read heights back.

- [tested] The module compiled with those four dependencies on the Editor target: 47 to 101 s for the first build in a new project. The versions passed to `Build.bat` come from the installed Visual Studio and SDK (see the `unreal-native` skill for the flags).
- [tested] A `.cpp` added to a module that was already built was not compiled until the module's `.Build.cs` was touched.
- [tested] The example does not use Live Coding or hot reload: each run builds with `Build.bat` while no editor of the project is open, then starts a fresh editor. After changing the module, close the editor, rebuild the Editor target and start the editor again.

## Call it from Python

```python
lib = unreal.LandscapeBridgeLibrary
unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).new_level("/Game/Maps/Terrain", False)   # True makes a World Partition map
world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
landscape = lib.create_landscape_from_heights(world, heights_cm, 505, 505, 63, 2,
    unreal.Vector(-25200, -25200, 0), unreal.Vector(100, 100, 100), 0)   # heights_cm: row-major, index = y * 505 + x
```

- [tested] `ULandscapeBridgeLibrary` appeared as `unreal.LandscapeBridgeLibrary`; `CreateLandscapeFromHeights` and `GetLandscapeHeightAt` appeared as `create_landscape_from_heights` and `get_landscape_height_at`, both listed by `dir()`. A Python list of 255,025 floats passed as the `TArray<float>`.
- [tested] `get_landscape_height_at(landscape, location)` has a `bool` return and a `float&` output; Python received the float itself, and `None` when the query missed. A query at the last vertex of the grid (504, 504) missed; the example samples (503, 503).
- [tested] `LevelEditorSubsystem.new_level(asset_path, is_partitioned_world=False)` returned True for both settings and created the map the script then worked in.

## What the runs showed

All three runs used `UnrealEditor.exe -nullrhi -ExecCmds="py <script>"` (no rendering) and took 16 to 32 s each, with a 505 by 505 vertex surface (4 by 4 components of 126 quads, quad size 100 cm).

- [tested] Non-partitioned map: 16 components on the Landscape actor, component step 126 quads, quad size 100 by 100. The height from `get_landscape_height_at` at 7 sampled vertices matched the input within 0.379 cm; one stored step is 0.78 cm at Z scale 100, so the error stays within half a step.
- [tested] World Partition map (`new_level(path, True)`), grid size 0: the same 16 components stay on the Landscape actor, 0 streaming proxies, 3 actor descriptors (Landscape, WorldDataLayers, WorldPartitionMiniMap), and the same heights.
- [tested] World Partition map, grid size 2: 4 `LandscapeStreamingProxy` actors with 4 components each, 7 actor descriptors, 7 external actor files after `save_current_level()`, and the same heights, including vertices on proxy borders.
- [tested] In the non-partitioned map a grid size of 2 produced no proxies, because the call is guarded by `IsGridBased()`.
- [tested] The new Landscape has one edit layer, named `Layer`.

## A second example: Animation Blueprints

- [tested] `examples/unreal/anim_bridge/` ([README](../../../examples/unreal/anim_bridge/README.md)) uses the same layout for an `AnimBridge` editor module and a `SlotClip` runtime module. Probe Python first: on 5.8.2 `unreal.BlueprintGraphEditor` already places Slot, Sequence Player and Blend Space Player nodes, so the bridge only adds what `dir()` and the action list do not reach: `AddState`, `AddTransition` and `ResampleBlendSpace`. Routes, numbers and the Animation Blueprint rules are in [Animation Blueprints](../../unreal-animation/references/unreal-animation-blueprints.md).
- [tested] A bridge function that returns a `USTRUCT` reaches Python as a struct with snake_case fields (`unreal.SlotBridgeResult`), and a `UEdGraph*` parameter accepts the state machine graph Python found with `BlueprintEditorLibrary.list_graphs`.

## A third example: skeletal mesh material slots

- [tested] `examples/unreal/skeletal_materials/` ([README](../../../examples/unreal/skeletal_materials/README.md)) ran 15 of 15 checks on 5.8.2, headless and with `--rendering`. Python reads a skeletal mesh's slots with `get_editor_property("materials")`; `slots[0].material_interface = m` on the returned array raises nothing and changes nothing, saved or not. The editor-module route is a `UFUNCTION(BlueprintCallable)` static, `USkeletalMaterialsBridgeLibrary::SetSkeletalMeshMaterials(USkeletalMesh*, const TArray<UMaterialInterface*>&)`.
- [tested] It writes `GetMaterials()[i].MaterialInterface` between `Modify()` and `PostEditChange()`, then `MarkPackageDirty()`. Python calls `unreal.SkeletalMaterialsBridgeLibrary.set_skeletal_mesh_materials(mesh, [materials])`. A wrong count returns False with an error logged and the slots unchanged; one and two slots are set in order, a default save writes the file and a fresh process reads the same materials.
- [tested] Python-side findings for the same example (the slot-name read, the registry-tag read, the commandlet scan before `duplicate_asset`, the assign-back route) are in [Unreal import policy](../../unreal-import/references/unreal-import-policy.md).

## Not verified

Landscape materials, weight layers, Nanite, Water and Landmass brushes on a bridged Landscape, heights beyond what `uint16` stores, and the module in a packaged game or a commandlet were not run.
