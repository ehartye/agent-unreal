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

## Sources

- [Landscape Blueprint Brushes](https://dev.epicgames.com/documentation/unreal-engine/landscape-blueprint-brushes-in-unreal-engine)
- [Water Body Actors](https://dev.epicgames.com/documentation/unreal-engine/water-body-actors-in-unreal-engine) (water carving uses Landscape edit layers and the same blend modes)
- The engine plugin descriptor for Landmass and its shipped plugin content, and the editor Python class surface.
