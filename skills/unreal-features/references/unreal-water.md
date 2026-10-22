# Water in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. The Water plugin is a "full suite of water tools and rendering techniques to easily add oceans, river, lakes or custom water bodies that carve landscape and interacts with gameplay" (plugin descriptor). Epic describes a spline-based system whose bodies work together with Landscape terrain.

## Enable it

| Plugin | Category | Enabled by default | Flags | Dependencies |
|---|---|---|---|---|
| `Water` | Water | no | experimental (not beta, not editor-only; Runtime + Editor modules) | Landmass, Niagara, GeometryProcessing, BlueprintMaterialTextureNodes |

- Enable via Edit > Plugins (search Water) or add `{"Name": "Water", "Enabled": true}` to the `Plugins` array of the `.uproject`; restart the editor.
- Landmass (see [unreal-landmass.md](unreal-landmass.md)) comes with it. Carving needs a Landscape created with Enable Edit Layers.
- Plugin content is under Water Content; turn on Show Engine Content and Show Plugin Content in the Content Browser to see it. It includes example maps, default materials, Blueprints for caustics, fluid simulation and physics buoyancy.

## Use it when

- You need an ocean with a shoreline, a lake, or a river on a Landscape, with the terrain carved to match.
- Rivers must flow: river materials carry flow, velocity and density parameters, and transition materials blend rivers into lakes and oceans.
- Gameplay must query water: swimming volumes, water surface data, underwater post process, buoyant objects.
- Water must scale to a large world: one shared tile mesh, camera-visible tiles only, morphing LOD, and a simplified far-distance mesh.
- You want ready materials: all default water materials use the Single Layer Water shading model.

## Use something else when

- Use a custom water Material (any shading model; enable the Used with Water usage flag) on your own mesh when you want full control of the look; custom water materials can use any shading model. The Water Body Custom actor also accepts a static mesh with the water material and does not carve terrain.
- Use [Niagara fluids](unreal-niagara-templates.md) when you need simulated splashes, pours or particle-based liquid rather than a surface across a level; see also [Niagara](unreal-niagara.md).
- Use [Landmass](unreal-landmass.md) alone when you only need to shape terrain, with no water surface.
- Use [Mover](unreal-mover.md) for character movement; it reads water through `unreal.ChaosCharacterWaterCheck`.
- Use [PCG](unreal-pcg.md) to scatter shoreline vegetation and rocks around bodies.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Place a water body | Editor UI / Blueprint / Python | Water Body actors (Ocean, Lake, River, Custom, Island); Python classes `unreal.WaterBodyOcean`, `WaterBodyLake`, `WaterBodyRiver`, `WaterBodyCustom`, `WaterBodyIsland` (components `unreal.WaterBodyOceanComponent`, etc.) |
| Shape a body | Editor UI | Edit its spline (`unreal.WaterSplineComponent`): ocean and lake use a closed loop at one height; river uses an open spline with per-point height and velocity |
| Generate the surface | Editor UI / Python | Place one `unreal.WaterZone` and one `unreal.WaterMeshActor`; bodies draw only inside a Water Zone |
| Carve terrain | Editor UI | Landscape with edit layers plus the water brush (`unreal.WaterBrushManager`, `unreal.WaterLandscapeBrush`); blend and falloff via `unreal.WaterBodyHeightmapSettings`, `WaterFalloffSettings`, `WaterCurveSettings`, `unreal.WaterBrushBlendType` |
| Cut a hole in a body | Editor UI | `unreal.WaterBodyExclusionVolume` |
| Waves | Python / editor UI | Gerstner waves (default): `unreal.GerstnerWaterWaves`, `GerstnerWaterWaveGeneratorSimple` (`num_waves`, `min_wavelength`, `max_wavelength`, `min_amplitude`, `max_amplitude`, `large_wave_steepness`); asset replacement: `unreal.WaterWaves`, `WaterWavesAssetFactory` |
| Runtime queries and toggles | Python / Blueprint | `unreal.WaterSubsystem` (`is_water_rendering_enabled`, `get_ocean_base_height`, `get_ocean_flood_height`, `set_ocean_flood_height`, `get_camera_underwater_depth`, `is_underwater_post_process_enabled`, `on_camera_underwater_state_changed`) |
| Floating objects | Blueprint | Water Buoyancy Component with a `Pontoons` array; example `BP_BuoyancyExample` under Water Content; events `OnPontoonEnteredWater` / `OnPontoonExitedWater` |
| Debug buoyancy | Console | `r.Water.DebugBuoyancy 1` |

## Workflow

1. Enable Water (and Landmass) and restart.
2. Create a Landscape with Enable Edit Layers checked.
3. Place a Water Zone in the level; without it no body generates a surface. The Water Mesh Actor sets tile size, tile count, LOD and tessellation (tune LODScale with the Tessellation Factor; lakes and oceans benefit most from tessellation).
4. Place a body (Ocean, Lake, River) and edit its spline; start from the default surface and underwater post-process materials already assigned.
5. For rivers keep the curve Y value at 1 so spline-point Depth stays accurate; use Min and Max blend modes where rivers intersect.
6. Enable Generate Collision on the body when you use underwater post processing.
7. Add buoyancy: Actor Blueprint, Static Mesh as root with Simulate Physics and Mass (kg) enabled, a Buoyancy Component with pontoons, then place above the water and Play.
8. Tune waves with depth attenuation (0 disables depth-based attenuation) or a Water Waves Asset.

Custom materials need the Used with Water flag. Transition-material colors are matched by hand to the neighboring water materials.

## Sources

- [Water System](https://dev.epicgames.com/documentation/unreal-engine/water-system-in-unreal-engine)
- [Water Body Actors](https://dev.epicgames.com/documentation/unreal-engine/water-body-actors-in-unreal-engine)
- [Water Meshing System and Surface Rendering](https://dev.epicgames.com/documentation/unreal-engine/water-meshing-system-and-surface-rendering-in-unreal-engine)
- [Water Buoyancy Component](https://dev.epicgames.com/documentation/unreal-engine/water-buoyancy-component-in-unreal-engine)
- The engine plugin descriptor for Water and the editor Python class surface.
