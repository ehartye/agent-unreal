# Temporal Super Resolution and anti-aliasing in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. Temporal Super Resolution (TSR) is Epic's platform-agnostic temporal upscaler: it renders at a lower internal resolution, spreads the cost across frames, and targets near-4K quality from 1080p input at roughly half the GPU frame time (Epic's TSR page). It runs after depth of field, so motion blur, bloom and later passes run at output resolution.

## Enable it

TSR is a renderer feature, not a plugin: the engine ships no plugin descriptor for it, and the 5.8 install holds no descriptors for third-party upscaler plugins.

- Project Settings > Rendering > Default Settings > "Anti-Aliasing Method" (`r.AntiAliasingMethod`). The setting is editable only while Forward Shading is off. The enum order in the 5.8 install is None, FXAA, TAA, MSAA, TSR, SMAA; Epic's TSR page uses `r.AntiAliasingMethod=4` for TSR.
- Epic's TSR page states TSR is enabled by default and is controlled by the Anti-Aliasing scalability group (`sg.AntiAliasingQuality`, 0 Low to 4 Cinematic).
- TSR runs on desktop renderers with Shader Model 5 or higher: Windows D3D11 and D3D12, Vulkan, Linux Vulkan, Mac Metal, PlayStation 5 and Xbox Series S|X. It does not need Shader Model 6 or DirectX 12.

## Use it when

- Rendering below output resolution to hit a frame budget: TSR is the built-in upscaler for deferred desktop and console projects.
- Temporal stability matters on dense geometry: Epic's page reports less ghosting on high-frequency backgrounds and less flicker on high-complexity geometry such as Nanite than UE4's TAA.
- Dynamic resolution on consoles: TSR supports it, with the frame resolution driven by Screen Percentage.
- Sharper output is worth extra cost: scalability level 3 and Cinematic use a 200 percent history resolution, which Epic says improves sharpness at higher cost.

## Use something else when

| Need | Choice | Basis |
|---|---|---|
| Forward renderer with MSAA | MSAA, `r.MSAACount` (2, 4 or 8) | Available only with the Forward Renderer; resolves geometry edges only, not material, texture or transparency aliasing; not controlled by the scalability settings |
| Low-end devices, spatial-only smoothing | FXAA, `r.FXAA.Quality` 0 to 5, default 4 | Spatial post process; Epic notes it can lose fidelity against other methods |
| Temporal anti-aliasing and upsampling through TAA | TAA / TAAU, `r.TemporalAA.Quality` 0 to 2 (default 2) | The "Temporal Upsampling" project setting (`r.TemporalAA.Upsampling`) is editable only with TAA selected (5.8 install) |
| A vendor temporal upscaler | The vendor's plugin | Epic's page names DLSS 2+, FSR 2.0+ and XeSS as plugins that work like the built-in upscalers and plug into the post chain between Depth of Field and Motion Blur |

Epic describes TSR as improving on UE4's TAAU (Temporal Anti-Aliasing Upsampling): lower render resolution, less ghosting. SMAA appears in the 5.8 enum but not on Epic's anti-aliasing page, so it is not covered here.

## How upscalers are selected

- Built-in: `r.AntiAliasingMethod` or the Anti-Aliasing Method project setting picks None, FXAA, TAA, MSAA or TSR. Quality inside the method comes from `sg.AntiAliasingQuality`.
- Plugin upscalers: Epic's Temporal Upscalers page does not describe a registration or selection step; follow the plugin's own documentation. The Summary view in that page's visualization section shows which upscaler is active.
- Regardless of upscaler, post process materials set to After Tonemapping or Replacing the Tonemapper run after upscaling at full resolution, and Automatic View Mip Bias applies only with TAA upsampling or TSR.

## Screen percentage

- `r.ScreenPercentage` sets the rendering resolution before upscaling; the editor viewport overrides it in Viewport Options > Custom Override.
- Scalability Resolution Quality presets in the 5.8 install: Default (the project default), Performance 50, Balanced 58.328, Quality 66.662, Native 100.
- Percentages below 50 are extreme upscaling, intended for displays above 4K or dynamic resolution. Above 100 with High or greater quality, the frame is supersampled.
- `r.SecondaryScreenPercentage.GameViewport` sets a final spatial upscale after the temporal upscaler; it is static at runtime.
- Dynamic resolution is controlled by `r.DynamicRes.OperationMode` (0 off, 1 follow Game User Settings, 2 always on) and `r.DynamicRes.MinScreenPercentage` and `MaxScreenPercentage`.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Pick the method | Project settings / config | Rendering > Default Settings > Anti-Aliasing Method, or `r.AntiAliasingMethod` in `DefaultEngine.ini` |
| Set quality tier | Scalability | `sg.AntiAliasingQuality`; the `[AntiAliasingQuality@N]` sections in `BaseScalability.ini`, overridable in `DefaultScalability.ini` |
| Tune TSR | Console variables | `r.TSR.History.ScreenPercentage` (100 to 200), `r.TSR.History.UpdateQuality` (0 to 3), `r.TSR.ShadingRejection.Flickering`, `r.TSR.Resurrection`, `r.TSR.AsyncCompute` |
| Change at runtime | Python | `unreal.SystemLibrary.execute_console_command`, `get_console_variable_int_value` (documented for the 5.7 Python API) |
| Dynamic resolution | Blueprint / C++ | Game User Settings node; C++ `GEngine->GetDynamicResolutionStatus()->SetEnabled(true)` |
| Visualize | Console | `r.TSR.Visualize`, `vis SceneVelocity`, `r.DumpGPU.Root *TSR*` |

## Workflow

1. Keep the project on deferred shading and set Anti-Aliasing Method to TSR; use the Forward Renderer with MSAA only when the project needs it.
2. Choose the render resolution with `r.ScreenPercentage` or a Resolution Quality preset.
3. Choose the TSR tier through `sg.AntiAliasingQuality`; levels 3 and Cinematic use 200 percent history (`BaseScalability.ini` in the 5.8 install). Use High or lower when the frame budget is tight.
4. Budget the cost: the History Update pass is the largest TSR cost because it runs at output resolution, about 4 times more at 200 percent history. `r.TSR.AsyncCompute` takes 0 to 3 (default 2); Epic reports it offset about 0.5 ms of TSR cost on consoles.
5. Give textures enough detail for the lower render resolution, because temporal upsampling needs more texture detail per pixel.
6. For extra sharpness over stability, lower `r.TSR.Velocity.WeightClampingSampleCount` (default 4.0).
7. Check the result with `r.TSR.Visualize` and the velocity visualization.

Related: [Lumen](unreal-lumen.md), [Virtual Shadow Maps](unreal-virtual-shadow-maps.md), [Movie Render Queue](unreal-movie-render-queue.md).

## Sources

- [Temporal Super Resolution](https://dev.epicgames.com/documentation/en-us/unreal-engine/temporal-super-resolution-in-unreal-engine)
- [Anti-Aliasing and Upscaling](https://dev.epicgames.com/documentation/en-us/unreal-engine/anti-aliasing-and-upscaling-in-unreal-engine)
- [Temporal Upscalers](https://dev.epicgames.com/documentation/en-us/unreal-engine/temporal-upscalers-in-unreal-engine)
- [Screen Percentage with Temporal Upscale](https://dev.epicgames.com/documentation/en-us/unreal-engine/screen-percentage-with-temporal-upscale-in-unreal-engine)
- [Dynamic Resolution](https://dev.epicgames.com/documentation/en-us/unreal-engine/dynamic-resolution-in-unreal-engine)
- [Unreal Python 5.7 SystemLibrary](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/SystemLibrary?application_version=5.7)
- The 5.8 install: `RendererSettings.h`, `SceneUtils.h`, `Engine/Config/BaseScalability.ini`.
