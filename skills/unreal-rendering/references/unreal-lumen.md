# Lumen in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. Lumen is the fully dynamic global illumination and reflections system. Lumen GI replaces Distance Field Ambient Occlusion and Lumen Reflections replace Screen Space Reflections; precomputed lighting is disabled while Lumen is on (Epic's Lumen overview). Lumen is a renderer feature set by project settings; it has no plugin.

## Enable it

| Setting (Project Settings > Engine > Rendering) | Console variable | Value |
|---|---|---|
| Dynamic Global Illumination Method | `r.DynamicGlobalIlluminationMethod` | Lumen (`1`) |
| Reflection Method | `r.ReflectionMethod` | Lumen (`1`) |
| Generate Mesh Distance Fields (software ray tracing; restart) | `r.GenerateMeshDistanceFields` | on |
| Support Hardware Ray Tracing (restart) | `r.RayTracing` | on, for hardware ray tracing |
| Use Hardware Ray Tracing when available | `r.Lumen.HardwareRayTracing` | on, with software fallback |
| Allow Static Lighting | `r.AllowStaticLighting` | off |

- In the 5.8 install, the first-person template sets the first three and `r.AllowStaticLighting=False` under `[/Script/Engine.RendererSettings]` in `DefaultEngine.ini`; its shader formats include Shader Model 6.
- Lumen requires DirectX 12 with Shader Model 6 for software ray tracing, and is not compatible with Forward Shading; it is not supported in VR (Lumen technical details).
- Hardware ray tracing is used only where the video card, RHI and operating system support it; otherwise Lumen traces in software (Lumen overview).
- Lumen Lite is a Beta medium-quality GI setting in 5.8, about twice as fast as high-quality Lumen (5.8 release notes). It is selected through scalability, below.
- The superseded paths are Screen Space GI (marked Deprecated in the 5.8 install) and baked lightmaps, which Lumen hides and disables.

## Use it when

- Lights, the sun, geometry or emissive materials change at runtime and lighting must respond without a bake.
- You want indirect light and reflections from one system, with GI visible in reflections.
- Content is built on Nanite meshes and Virtual Shadow Maps ([Nanite](unreal-nanite.md), [Virtual Shadow Maps](unreal-virtual-shadow-maps.md)).
- You target current-generation consoles or desktop at the High and Epic scalability levels. Epic recommends hardware ray tracing as the console default (Lumen performance guide).

## Use something else when

- The project uses Forward Shading or VR: Lumen does not support them.
- Lights use Static mobility: Lumen disables their contribution; use Movable lights.
- The target is a lower-end PC or handheld: use the Medium scalability level (Lumen Lite). The Low level disables Lumen diffuse indirect in the 5.8 install.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Choose GI and reflection method, ray tracing mode | Project Settings UI or `DefaultEngine.ini` | Keys above under `[/Script/Engine.RendererSettings]`; Epic's Python 5.8 reference has no RendererSettings class, so edit the file and restart |
| Per-volume quality and overrides | Python / Blueprint / C++ | `unreal.PostProcessVolume.settings` (`unreal.PostProcessSettings`): `dynamic_global_illumination_method`, `reflection_method`, `lumen_scene_lighting_quality`, `lumen_scene_detail`, `lumen_scene_view_distance`, `lumen_final_gather_quality`, `lumen_max_trace_distance`, `lumen_ray_lighting_mode`; set the matching `override_*` flag (all documented by Epic's Python 5.8 reference) |
| Runtime tuning | Python / console | `unreal.SystemLibrary.execute_console_command` (documented by Epic) with `r.Lumen.*`, `sg.GlobalIlluminationQuality`, `sg.ReflectionQuality` |
| Per-mesh quality | Python / editor UI | Static Mesh `Max Lumen Mesh Cards` and `Distance Field Resolution Scale`; `unreal.StaticMesh.generate_mesh_distance_field` (documented by Epic) |
| Per-component | Python | `unreal.PrimitiveComponent`: `affect_distance_field_lighting`, `visible_in_ray_tracing`, `invalidate_lumen_surface_cache()` (documented by Epic) |
| Inspect | editor UI / console | Viewport View Modes > Lumen (Overview, Lumen Scene, Geometry Normals, Reflection View, Surface Cache); `stat gpu`, `ProfileGPU` |

## Workflow

1. Set both methods to Lumen, turn on Generate Mesh Distance Fields, turn off Allow Static Lighting, and restart the editor.
2. Choose the trace path. Software: Software Ray Tracing Mode defaults to Global Tracing (fastest); Detail Tracing is highest quality and costly in kitbashed levels. Hardware: leave Ray Lighting Mode on Surface Cache; use Hit Lighting for Reflections only with trivial, optimized materials.
3. For hardware ray tracing, keep the ray tracing scene under 100,000 instances on current-generation consoles (check `stat SceneRendering`), set `r.RayTracing.Culling=3`, `r.RayTracing.Culling.Radius=15000`, `r.RayTracing.Culling.Angle=0.5`, and turn off Visible In Ray Tracing on skyboxes and grass (performance guide).
4. Author for the Surface Cache: separate meshes for walls, floors and ceilings; walls at least 10 cm thick; closed geometry; Nanite for high-polygon meshes. Foliage and instanced static meshes need Nanite for Surface Cache support (technical details).
5. Verify coverage in View Modes > Lumen > Surface Cache. Pink marks uncovered areas: raise Max Lumen Mesh Cards or split the mesh.
6. Tune per Post Process Volume: splotchy indoor mirror reflections, Lumen Scene Quality; small meshes black in reflections, Lumen Scene Detail; GI gone past 200 m, Lumen Scene View Distance; light leaking, Max Trace Distance; slow response to lighting changes, Final Gather Lighting Update Speed. Keep Diffuse Color Boost below 2.
7. Scale with `sg.GlobalIlluminationQuality` and `sg.ReflectionQuality`: Low disables Lumen features; Medium is Lumen Lite (`r.Lumen.FinalGatherMethod=0`, Lumen Reflections off in favour of Screen Space Reflections); High targets 60 fps on current-generation consoles; Epic targets 30 fps; Cinematic targets Movie Render Queue.
8. Profile with `stat gpu` and `ProfileGPU`; set `r.Lumen.AsyncCompute 0` to measure Lumen alone.
9. For large worlds, Far Field (`r.LumenScene.FarField=1`, hardware ray tracing only) extends GI and reflections and requires World Partition HLOD with HLOD1 built.

Related: [MegaLights](unreal-megalights.md), [Substrate](unreal-substrate.md), [TSR and anti-aliasing](unreal-temporal-super-resolution.md).

## Sources

- [Lumen Global Illumination and Reflections](https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-global-illumination-and-reflections-in-unreal-engine)
- [Lumen Technical Details](https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-technical-details-in-unreal-engine)
- [Lumen Performance Guide](https://dev.epicgames.com/documentation/unreal-engine/lumen-performance-guide-for-unreal-engine)
- [Unreal Engine 5.8 Release Notes](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-5-8-release-notes)
- Epic Python 5.8 reference: [PostProcessVolume](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/PostProcessVolume), [PostProcessSettings](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/PostProcessSettings), [StaticMesh](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/StaticMesh), [PrimitiveComponent](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/PrimitiveComponent), [SystemLibrary](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/SystemLibrary)
- In the 5.8 install: `RendererSettings.h`, `EngineTypes.h` and `Scene.h` (engine headers), `Config/BaseScalability.ini`, and the first-person template `DefaultEngine.ini`.
