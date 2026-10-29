# MegaLights in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. MegaLights is a stochastic direct lighting method: it traces a fixed number of rays per pixel toward the lights that matter most, then denoises the result, so many shadow casting dynamic lights cost a consistent amount of GPU time. When it is on, it replaces Shadow Maps, Distance Field Shadows, Ray Traced Shadows, Deferred Shading light evaluation, Volumetric Fog light evaluation and Virtual Shadow Map projection for the lights it handles (Epic's MegaLights page).

## Enable it

MegaLights is a renderer feature, not a plugin: the engine ships no plugin descriptor for it.

- Status: the Unreal Engine 5.8 release notes state "MegaLights is now entering Production Ready status with Unreal Engine 5.8." The MegaLights page tags and the project setting tooltip in the 5.8 install still read "experimental"; the release notes are the later statement.
- Project setting: Project Settings > Rendering > Direct Lighting > MegaLights (`r.MegaLights.EnableForProject`). Enabling it prompts you to also enable Support Hardware Ray Tracing, which Epic recommends.
- [documented] Requirements: "MegaLights requires Hardware Ray Tracing and Shader Model 6" is only a tooltip, on the Post Process Volume property (`Scene.h:1884`) and on `r.MegaLights.EnableForProject` (`MegaLights.cpp:26-31`); the renderer's `HasRequiredTracingData` accepts hardware or software tracing, so software tracing is an accepted alternative. Hardware needs `r.RayTracing` (read-only, default 0) and `r.MegaLights.HardwareRayTracing` (default 1); software is opt-in (`r.MegaLights.SoftwareRayTracing.Allow`, default 0) and needs mesh distance fields (`MegaLights.cpp:541-544`, `MegaLightsRayTracing.cpp:148-160,361-380`, `DeferredShadingRenderer.cpp:277-283`, `SceneManagement.cpp:61-69`). [general] Hardware is the route seen in practice.
- [tested] A rendering editor started with `-RenderOffScreen` on a throwaway project ([rp_rt_validate.mjs](../../../examples/unreal/rendering_probes/README.md), 8 of 8 checks, one project, one scene): with `r.RayTracing` on and `r.SkinCache.CompileShaders` left at 0 the process exited 3 in 2 s, the log held `Ray tracing requires skin cache to be enabled. Set r.SkinCache.CompileShaders>=1.` and no report was written.
- [documented] That message is logged at Fatal level. Both variables are read-only, so a config edit sets both before launch; the second is "Skin Cache Shader Support" in the editor (`RenderUtils.cpp:1038-1045`, `GPUSkinCache.cpp:92-99`, `RendererSettings.h:1534-1536`). [general] A game aborted at start this way. [tested] In a rendering editor on a throwaway project (2026-10-29), ticking Support Hardware Ray Tracing and answering Yes to the skin cache prompt wrote `r.RayTracing=True` and `r.SkinCache.CompileShaders=1` under `[/Script/Engine.RendererSettings]` in `Config/DefaultEngine.ini`; nothing else in that section changed.
- [tested] Same run, hardware and software routes: the read-back, log lines and `ProfileGPU` counts are in [MegaLights measurements](unreal-megalights-measurements.md).
- Not supported: mobile, Switch, previous-generation consoles, and the Forward Renderer (Epic's page).
- Per light: the "Allow MegaLights" light property (Advanced). Once MegaLights is on, all local lights use it unless a light opts out.
- [documented] Per volume: the Post Process Volume setting "MegaLights" overrides the project setting. Scalability or a device profile disables it with `r.MegaLights.Allowed 0` (default 1: `MegaLights.cpp:33-38,531-539`). [tested] There is no `r.MegaLights.Allow`: `get_console_variable_int_value('r.MegaLights.Allow')` returned 0 with `Failed to find console variable`, and `r.MegaLights.Allowed` returned 1 with no warning ([rp_validate.mjs](../../../examples/unreal/rendering_probes/README.md)).
- [documented] A "MegaLights is on" HUD: the view's Post Process setting is seeded from `r.MegaLights.EnableForProject` (default 0) and then overridden by a Post Process Volume (`SceneView.cpp:1717,2111-2112`); the renderer also needs `r.MegaLights.Allowed` (default 1, scalability), the show flags and tracing data (`MegaLights.cpp:531-544`). No single console variable reports the combined result in that reading: read the volume's MegaLights setting (the project setting where no volume overrides it) and `r.MegaLights.Allowed`, and call it on only when both pass. The project setting alone misses a volume override; `Allowed` alone misses the project.
- Directional lights are off by default; enable with `r.MegaLights.DirectionalLights 1`.

## Use it when

- A scene has many dynamic, shadow casting local lights (spot, point, rect, textured rect, area) and shadow map cost per light is the limit.
- Soft area shadows matter: ray traced MegaLights shadows are correct for area lights, which Virtual Shadow Maps only approximate (Epic's page).
- Lighting channels, IES profiles on volumetrics and translucency, cloud shadows, transmission and first-person weapon lighting are needed; the 5.8 release notes list these as part of the Production Ready update.
- [documented] Niagara particle lights should light and shadow the scene: set "Allow Mega Lights" (`bAllowMegaLights`) and "Mega Lights Cast Shadows" (`bMegaLightsCastShadows`, editable only while the first is on) on the emitter's Light Renderer. Header comment: use with caution, keep to a few small particle lights, watch noise and sampling cost (`NiagaraLightRendererProperties.h:73-83`). [general] About sixty live particles gave sixty shadow-casting lights.
- [general] Cost against Virtual Shadow Maps, measured once on one GPU and one synthetic scene: MegaLights stayed flat from 16 to 416 lights while shadow maps rose and met it near 400 ([figures](unreal-megalights-measurements.md)).

## Use something else when

- The renderer is Forward, or the target is mobile, Switch or previous-generation consoles: use the standard deferred lighting path where supported.
- A strong sun-like directional light carries the scene: Epic recommends Deferred Lighting with Virtual Shadow Maps for it, with MegaLights reserved for dimmer lights such as moonlight.
- [documented] Water, Clouds, Heterogeneous Volumes ([reference](unreal-heterogeneous-volumes.md)) and Local Volumetrics need direct light from these lights: MegaLights does not support them (Epic's page).

## How MegaLights relates to Lumen and Virtual Shadow Maps

- Lumen: use MegaLights with Lumen hardware ray tracing; the two share the Ray Tracing Scene. MegaLights async compute options are off by default because Lumen async compute usually gives the larger win.
- Virtual Shadow Maps: select "MegaLights Shadow Method" per light, Ray Tracing (default) or Virtual Shadow Maps. VSM casts from full Nanite detail but adds per-light CPU, memory and GPU cost, so use it sparingly.
- Ray tracing shadows use simplified Nanite fallback meshes. Tune with `r.RayTracing.Culling.*`, the Ray Tracing Group Id, and the Static Mesh Editor's Fallback Target set to Relative Error.

## Drive and tune it

The console variables, Post Process Volume and Python routes, quality tiers, debug switches and the tuning workflow are in [Driving and tuning MegaLights](unreal-megalights-driving.md). Turn it on with Rendering > Direct Lighting > MegaLights (`r.MegaLights.EnableForProject`) and keep Lumen on hardware ray tracing so the Ray Tracing Scene is shared.

Related: [Driving and tuning MegaLights](unreal-megalights-driving.md), [MegaLights measurements](unreal-megalights-measurements.md), [Lumen](unreal-lumen.md), [Virtual Shadow Maps](unreal-virtual-shadow-maps.md), [Nanite](unreal-nanite.md), [Heterogeneous Volumes](unreal-heterogeneous-volumes.md).

## Sources

- [MegaLights](https://dev.epicgames.com/documentation/en-us/unreal-engine/megalights-in-unreal-engine)
- [Unreal Engine 5.8 Release Notes](https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-5-8-release-notes)
- [documented] The installed engine: `Engine/Config/BaseScalability.ini`, `RendererSettings.h`, `Scene.h`, `LightComponent.h`, `MegaLights.cpp`, `MegaLightsRayTracing.cpp`, `RenderUtils.cpp`, `NiagaraLightRendererProperties.h`.
