# Landscape bridge brushes: attach a Landmass brush from Python

Target: Unreal Engine 5.8, Windows (the build pinned in `engine-version.json`). Five more statics on the `LandscapeBridge` module of [Python to C++ bridge](unreal-python-cpp-bridge.md). `[tested]` marks a result of [`examples/unreal/landscape_bridge`](../../../examples/unreal/landscape_bridge/README.md) (`landscape_world.mjs`): one throwaway project, one Landscape from the bridge (505 by 505 vertices, 4 by 4 components, one default edit layer named `Layer`), a `-nullrhi` editor run and a `-RenderOffScreen` run. `[documented]` marks the engine install. What attaching showed for Landmass, including heights: [Landmass](../../unreal-procedural/references/unreal-landmass.md).

## Why a bridge function

- [documented] `ALandscape::AddBrushToLayer` is C++ only and `check()`s that the brush is on no layer yet (`Engine/Source/Runtime/Landscape/Private/LandscapeEditLayers.cpp`). `ALandmassManagerBase::SetTargetLandscape` only removes the previous Landscape (`Engine/Plugins/Experimental/Landmass/Source/Editor/Private/LandmassManagerBase.cpp`).
- [tested] No name on `unreal.Landscape` or `unreal.LandscapeProxy` adds a brush to an edit layer (the list was empty), and spawning a brush manager, `set_target_landscape` and a write of `detail_panel_landscape` each left the manager on no layer.

## The functions

Python names are the snake_case forms on `unreal.LandscapeBridgeLibrary`.

| C++ | Wraps | Returns |
|---|---|---|
| `AttachBrushToLayer(Landscape, LayerIndex, Brush)` | `ALandscape::AddBrushToLayer`, after a check that the brush is on no layer and the layer takes brushes | True when the brush is on that layer afterwards; false for a null argument, a brush already on a layer or a layer that takes no brushes |
| `DetachBrush(Landscape, Brush)` | `ALandscape::RemoveBrush` | True when the brush was on a layer and no longer is |
| `GetBrushLayerIndex(Landscape, Brush)` | `ALandscape::GetBrushLayer` | the layer index, -1 for none |
| `GetBrushCountForLayer(Landscape, LayerIndex)` | `ALandscape::GetBrushesForLayer` | the count, -1 for an invalid layer |
| `GetBrushOwningLandscape(Brush)` | `ALandscapeBlueprintBrushBase::GetOwningLandscape` | the Landscape the brush belongs to, or None |

The parameters are `ALandscape*` and `ALandscapeBlueprintBrushBase*`.

## What the runs showed

- [tested] The module compiled with the five functions on the Editor target, with the four dependencies of the original bridge.
- [tested] Before any attach the manager read layer index -1, brush counts `[0]` and owner None. `attach_brush_to_layer(landscape, 0, manager)` returned True, layer 0 then held 1 brush and the brush owner was the Landscape; `detach_brush` returned True and the manager read -1, `[0]` and None again. Both modes.
- [tested] Python's `get_landscape()` printed the written Landscape after a write of `detail_panel_landscape` while the manager was on no layer.
- [general] Read attachment through `get_brush_layer_index` or the layer count, not `get_landscape()` alone.
- Not covered by these runs: brushes with a spline, Water brushes, an attach to a layer other than layer 0.
