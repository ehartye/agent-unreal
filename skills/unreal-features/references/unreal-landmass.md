# Landmass in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. Landmass is the plugin that supplies the Landscape Blueprint brushes: non-destructive, spline-shaped terrain brushes that sit in a Landscape's edit-layer stack. The plugin descriptor carries no description text; Epic's Landscape Blueprint Brushes page names it as the source of the brushes.

## Enable it

| Plugin | Category | Enabled by default | Flags | Dependencies |
|---|---|---|---|---|
| `Landmass` | Other | no | beta (not experimental, not editor-only; Runtime + Editor modules) | none |

- Enable via Edit > Plugins, or add `{"Name": "Landmass", "Enabled": true}` to the `Plugins` array of the `.uproject`.
- Create the Landscape with Enable Edit Layers checked; Blueprint brushes need edit layers.
- The [Water](unreal-water.md) plugin depends on Landmass, so enabling Water enables it.

## Use it when

- You want terrain shaped by splines: plateaus, peaks, ridges, craters, valleys, roads and river channels cut into a Landscape.
- The terrain must stay editable: brushes are a stack, and a change to a lower brush flows through to the brushes above it.
- You need heightmap effects applied by rule: curl noise, terracing, blurring, displacement, smooth blending.
- You want a procedural base terrain from a Material: `CustomBrush_MaterialOnly` applies material noise across the whole terrain.
- Another system must carve the terrain: Water bodies use the same brush machinery to carve rivers, lakes and oceans.

## Use something else when

- Use the Landscape sculpt tools directly when you want freehand, one-off height edits with no stack to maintain.
- Use [PCG](unreal-pcg.md) when you need to populate terrain with instances (trees, rocks, props); PCG reads Landscape data through Get Landscape Data.
- Use [Water](unreal-water.md) when the shape is a river, lake or ocean with water rendering and gameplay queries.
- Use [Geometry Scripting](unreal-geometry-scripting.md) when the result is a mesh asset rather than Landscape heightmap data.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Add a brush to a Landscape | Editor UI | Landscape mode > Sculpt tab > Blueprint; pick a type from the Blueprint Brush dropdown; click the Landscape |
| Choose a brush | Editor UI | `CustomBrush_Landmass` (spline shape plus effects), `CustomBrush_LandmassRiver` (static mesh extruded along a spline; roads and rivers), `CustomBrush_MaterialOnly` (material noise base) |
| Reshape a brush's spline | Editor UI | Edit the brush actor's spline in the viewport |
| Set blend mode, falloff and effects | Python / editor UI | `unreal.LandmassTerrainCarvingSettings` (`blend_mode`, `priority`, `invert_shape`, `falloff_settings`, `effects`); `unreal.LandmassFalloffSettings` (`falloff_mode`, `falloff_angle`, `falloff_width`, `edge_offset`, `z_offset`); `unreal.LandmassBrushEffectsList` (`blurring`, `curl_noise`, `displacement`, `smooth_blending`, `terracing`) |
| Read or tune brush actors | Python | `unreal.LandmassActor`, `unreal.LandmassManagerBase` (`add_brush_to_array`, `add_brush_to_tree`, `consolidate_nodes`, `affect_heightmap`, `affect_weightmap`, `affected_weightmap_layers`), `unreal.LandmassErosionBrushBase` |
| Landscape sizing data | Python | `unreal.LandmassLandscapeInfo` (`landscape_quads`, `landscape_transform`, `render_target_resolution`), `unreal.LandmassBlueprintFunctionLibrary` (`combine_world_extents`, `world_extents_to_canvas_coordinates`) |
| Create the Landscape with edit layers | Editor UI | the Enable Edit Layers option when creating the Landscape |

Brush authoring happens through the editor; Python reaches the settings structs and brush actor classes, and the brush Blueprints ship as plugin content (`CustomBrush_Landmass`, `CustomBrush_Landmass_River`, `CustomBrush_MaterialOnly`, `LandmassBrushManager`, an erosion brush folder).

## Workflow

Epic's documented steps:
1. Enable the Landmass plugin in the Plugins browser.
2. Create a Landscape with Enable Edit Layers checked.
3. In Landscape mode, open the Sculpt tab and select Blueprint.
4. Choose a brush type from the Blueprint Brush dropdown.
5. Click the Landscape in the viewport to add the brush.

Tuning `CustomBrush_Landmass`:
- Blend mode: Alpha Blend raises and lowers terrain using the shape and its inverse; Min only lowers; Max only raises.
- Shape capping: a capped shape forms a flat-topped plateau, an uncapped shape forms a peak.
- Falloff: Angle (steeper at higher values) or Width (steeper at smaller distances).
- Noise: up to two octaves of curl noise, set with Curl Strength (amplitude) and Curl Tiling (frequency).
- Order brushes in the stack so lower brushes form the base and upper brushes refine it.

## Large landscapes in World Partition

Order for a large landscape with a river and scattered content: get a partitioned map, shape the terrain (Landmass brushes in Landscape mode, [Water](unreal-water.md) bodies), read the heights back, then scatter with [PCG](unreal-pcg.md) (partitioned generation).

Get a partitioned map:
- [tested] Copy Epic's Open World template: `EditorLoadingAndSavingUtils.load_map("/Engine/Maps/Templates/OpenWorld")`, then `save_map(world, "/Game/Maps/Name")`; Save As writes the external actor files under the new name. [documented] The template holds a 2 km by 2 km Landscape ([World Partition in Unreal Engine](https://dev.epicgames.com/documentation/unreal-engine/world-partition-in-unreal-engine)).
- [tested] Python creates no Landscape: `Landscape` and `LandscapeProxy` expose only heightmap and weightmap render-target import and export. Use the template, or convert a Landscape map: `UnrealEditor-Cmd.exe Project -run=WorldPartitionConvertCommandlet /Game/Maps/Map -SCCProvider=None -ConversionSuffix -AllowCommandletRendering -nullrhi` writes `Map_WP` and `Map.ini`; without `-AllowCommandletRendering` it exits 1. [documented] Epic: any level can be converted.
- [tested] A map is partitioned when `unreal.WorldPartitionBlueprintLibrary.get_actor_descs()` returns descriptors, including for unloaded actors (`is_spatially_loaded`, `runtime_grid`, `data_layer_assets`, `bounds`); the default template and the Water sample map return none.

How the Landscape is built there:
- [tested] One Landscape actor, always loaded, holding no components, plus spatially loaded `LandscapeStreamingProxy` actors holding them. The template has 64 proxies in an 8 by 8 grid, each 25,200 cm square with 2 by 2 components of 126 quads (256 components); edit layers Base Landscape and Flat Middle. A converted Landscape of 2 by 2 components of 255 quads became one proxy.
- [tested] `LandscapeGridSize` in the `Map.ini` the commandlet writes is the components per proxy side: 4 gave one proxy for that Landscape, 1 gave four.
- [tested] In a commandlet no proxy is in the world until `WorldPartitionBlueprintLibrary.load_actors` is called with the proxy descriptor guids. The rendering editor loaded all 64 proxies at open.

Read the result:
- [tested] In a rendering editor (`-RenderOffScreen`), `landscape.render_heightmap(Transform(), Box2D, render_target)` into an `RTF_RGBA8` target (float formats return False) gives the final heights after `force_layers_full_update()` and editor ticks (the example waits 25 s): height = R*256 + G, world Z = Landscape Z + (height - 32768) / 128 * scale Z.
- [tested] Python spawns `LandmassBrushManager` and `CustomBrush_Landmass` (`EditorAssetLibrary.load_blueprint_class`); neither is spatially loaded, and neither attaches: the manager's `get_landscape()` stays None, `Landscape` has no brush members in Python, the brush logs `Accessed None` for `BrushManager`. Add Landmass brushes in Landscape mode.

Scatter afterwards:
- [tested] Setting `is_component_partitioned` on a PCG volume's component adds the PCG World Actor (always loaded, 25,600 cm grid) and spatially loaded `PCGPartitionGridActor` actors. Generation modes are in [PCG](unreal-pcg.md).

Not verified: carving of proxies that are not loaded (the editor loaded every proxy and `unload_actors` did not unload them); attaching a Landmass brush to an edit layer from Python; running a PCG graph on the partitioned Landscape.

The scene that checks all of this is `examples/unreal/world/world_validate.mjs`.

## Sources

- [Landscape Blueprint Brushes](https://dev.epicgames.com/documentation/unreal-engine/landscape-blueprint-brushes-in-unreal-engine)
- [Water Body Actors](https://dev.epicgames.com/documentation/unreal-engine/water-body-actors-in-unreal-engine) (water carving uses Landscape edit layers and the same blend modes)
- [World Partition in Unreal Engine](https://dev.epicgames.com/documentation/unreal-engine/world-partition-in-unreal-engine)
- The engine plugin descriptor for Landmass and its shipped plugin content, and the editor Python class surface.
