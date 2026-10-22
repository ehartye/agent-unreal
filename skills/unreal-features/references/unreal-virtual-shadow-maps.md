# Virtual Shadow Maps in Unreal 5.8: when to use them and how to drive them

Target: Unreal Engine 5.8, Windows. Virtual Shadow Maps (VSM) are very high-resolution shadow maps: each has a virtual resolution of 16k x 16k pixels, split into 128x128 pages that are allocated only where the view needs them (Epic's VSM page). They are designed to be used with [Nanite](unreal-nanite.md).

## Enable it

- Project Settings > Engine > Rendering > Shadows > Shadow Map Method = Virtual Shadow Maps, backed by `r.Shadow.Virtual.Enable=1` (5.8 install header).
- New projects use VSM by default; projects created before UE 5.0 must opt in (Epic). The 5.8 Blank and First Person templates set `r.Shadow.Virtual.Enable=1` under `[/Script/Engine.RendererSettings]`.
- VSM requires DirectX 12 with Shader Model 6.6 atomics, or Vulkan with `VK_KHR_shader_atomic_int64` (Epic). With Forward Shading the project automatically uses Shadow Maps, because VSM is not supported there (5.8 install header).
- No plugin is involved.
- VSM supersedes Cascaded Shadow Maps, stationary precomputed shadows, pre-shadows, per-object shadows and movable dynamic shadows for local lights. Distance Field Shadows are not replaced, and ray traced shadows take precedence (Epic).

## Use it when

- The scene uses Nanite geometry: Nanite always renders into VSM regardless of distance, with efficient culling.
- You want consistent high-resolution shadows from one setup across a large dynamic world, with no cascade distances to tune.
- Lights are Directional, Spot or Point and movable. Spot lights use one 16k VSM with a mip chain; Point lights use a cube of 16k VSMs.
- Soft shadows are wanted from Source Radius or Source Angle (Shadow Map Ray Tracing, SMRT).

## Use something else when

- The project uses Forward Shading: use Shadow Maps.
- The scene has no Nanite geometry: Epic says VSM is likely not a good fit. Epic advises full mesh LODs on non-Nanite meshes.
- The scene holds many small shadow-casting local lights: Epic lists this case as work in progress for VSM.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Choose the shadow method | Project Settings UI or `DefaultEngine.ini` | `r.Shadow.Virtual.Enable=1` under `[/Script/Engine.RendererSettings]`; restart. Epic's Python 5.8 reference has no RendererSettings class |
| Per-light softness | Python / Blueprint | `unreal.DirectionalLightComponent.light_source_angle`; `unreal.PointLightComponent` `source_radius` through `set_source_radius()` (the property entry is read-only) (documented by Epic's Python 5.8 reference) |
| Directional light non-Nanite handoff | Python / Blueprint | `dynamic_shadow_distance_movable_light` on the directional light component |
| Per-primitive invalidation | Python / editor UI | `unreal.PrimitiveComponent.shadow_cache_invalidation_behavior` (Auto, Always, Rigid, Static per Epic) |
| Quality and cost | Console / `DefaultEngine.ini` / Python | `unreal.SystemLibrary.execute_console_command` (documented by Epic) with `r.Shadow.Virtual.*`; scalability group `ShadowQuality` |
| Inspect | editor UI / console | Viewport View Modes > Virtual Shadow Map (Shadow Mask, Clipmap/Mip Level, Virtual Page, Cached Page, Nanite Overdraw, Shadow Casters); `r.Shadow.Virtual.Visualize cache` or `vpage` |
| Profile | console / Insights | profiler categories Shadow Depths and Shadow Projection (under Lights); `trace.enable counters, vsm`; `CsvCategory VSM enable` |

## Workflow

1. Set Shadow Map Method to Virtual Shadow Maps, enable Nanite on static geometry and restart.
2. Prefer Directional Lights where possible: very large local lights can exhaust virtual resolution. Directional light clipmap levels centre on the camera, each covering twice the radius of the last; levels 6 to 22 are allocated by default, about 64 cm to 40 km (`r.Shadow.Virtual.Clipmap.FirstLevel`, `r.Shadow.Virtual.Clipmap.LastLevel`).
3. Set shadow softness with Source Radius (local lights) or Source Angle (Directional Lights). Ray counts: `r.Shadow.Virtual.SMRT.RayCountLocal` and `RayCountDirectional` (0 gives hard shadows); samples per ray: `SamplesPerRayLocal` and `SamplesPerRayDirectional` (Epic suggests 4 to 8). Reduce Source Radius or Source Angle before lowering ray counts.
4. Scale cost through the `ShadowQuality` group. In the 5.8 install, `r.Shadow.Virtual.MaxPhysicalPages` runs 512 (Low, Medium), 2048 (High), 4096 (Epic), 8192 (Cinematic). Directional ray counts run 0, 4, 8, 8, 16 and local ray counts 0, 4, 4, 8, 16 across Low, Medium, High, Epic, Cinematic.
5. Use bias controls for resolution: `r.Shadow.Virtual.ResolutionLodBiasDirectional` and `ResolutionLodBiasLocal` (and the `Moving` variants for moving lights); `r.Shadow.Virtual.MaxDOFResolutionBias` lets out-of-focus regions use lower resolution in cutscenes.
6. Keep the cache valid. Caching is on by default. Moving or rotating a light, moving shadow casters, World Position Offset and Pixel Depth Offset invalidate cached pages. Set Shadow Cache Invalidation Behavior per primitive, and give meshes correct bounds: bounds that are too small cause missing shadows, too large cause needless invalidation.
7. Use `r.Shadow.Virtual.Cache 0` only for debugging.
8. Add polygons to low-poly geometry to remove terminator artifacts; `r.Shadow.Virtual.NormalBias` (default 0.5) is the fallback.
9. Lit translucent surfaces: `r.Shadow.Virtual.TranslucentQuality` above 1 gives high-quality shadows at high cost. Only simple subsurface is supported; Subsurface Profile and transmission are not.
10. Profile with visualization off, since it has a small cost. Shadow Depths cost follows rendered pages and geometry, so use Nanite wherever possible; Shadow Projection cost follows shadow samples across the screen, not caching. Cull small non-Nanite objects with `r.Shadow.RadiusThreshold`.

Related: [Lumen](unreal-lumen.md), [MegaLights](unreal-megalights.md).

## Sources

- [Virtual Shadow Maps](https://dev.epicgames.com/documentation/en-us/unreal-engine/virtual-shadow-maps-in-unreal-engine)
- [Nanite Virtualized Geometry](https://dev.epicgames.com/documentation/en-us/unreal-engine/nanite-virtualized-geometry-in-unreal-engine)
- Epic Python 5.8 reference: [DirectionalLightComponent](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/DirectionalLightComponent), [PointLightComponent](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/PointLightComponent), [PrimitiveComponent](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/PrimitiveComponent), [SystemLibrary](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/SystemLibrary)
- In the 5.8 install: `RendererSettings.h` and `EngineTypes.h` (engine headers), `Config/BaseScalability.ini` (`ShadowQuality` levels) and the Blank and First Person template `DefaultEngine.ini` files.
