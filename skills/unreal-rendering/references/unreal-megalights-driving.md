# Driving and tuning MegaLights in Unreal 5.8: variables, volume overrides and workflow

Target: Unreal Engine 5.8, Windows. The console variables, Python routes and tuning order for MegaLights. Status, requirements, when to use it and how it relates to Lumen and Virtual Shadow Maps are in [MegaLights](unreal-megalights.md).

## How an agent drives it

The table rows are `[documented]` from the 5.8 install and Epic's pages unless a row says otherwise; the Python names from the 5.7 API page were not found in the 5.8 clippings and are unchecked.

| Task | Route | What to call |
|---|---|---|
| Turn it on for the project | Project settings | Rendering > Direct Lighting > MegaLights; the console variable is `r.MegaLights.EnableForProject` |
| Override per volume | Editor UI / Python | Post Process Volume "MegaLights" (`bMegaLights`, with `bOverride_bMegaLights`, in the 5.8 install); Epic's 5.7 Python API page lists `mega_lights` and `override_b_mega_lights` on `PostProcessSettings` |
| Per light opt out, shadow method | Editor UI | Light Details: Allow MegaLights, MegaLights Shadow Method (Blueprint read-only properties in the 5.8 header) |
| Quality tiers | Scalability ini | `[ShadowQuality@N]` in `BaseScalability.ini`: `r.MegaLights.NumSamplesPerPixel` is 2 at levels 0 and 1 and 4 at levels 2, 3 and Cinematic; `r.MegaLights.DownsampleMode` is 2 below Cinematic and 0 at Cinematic (in the 5.8 install) |
| Set or read a variable at runtime | Python | `unreal.SystemLibrary.execute_console_command`, `get_console_variable_int_value` (5.7 Python API). [documented] An unknown name returns 0 and only warns (`LogBlueprintUserMessages: Warning: Failed to find console variable '<name>'.`), so a wrong name reads as off (`KismetSystemLibrary.cpp:627-641`) |
| Debug | Console / view mode | `r.MegaLights.Visualize 1`, `r.MegaLights.Debug 1`, the Light Complexity view mode, `ShowFlag.MegaLightsScreenTraces 0` |

Python reaches console variables and Post Process Volume settings. Project Settings are editor UI or config edits; the class surface dump used for this repo does not cover the rendering classes.

## Workflow

1. [documented] Enable Support Hardware Ray Tracing and MegaLights in Project Settings, with `r.SkinCache.CompileShaders >= 1`; confirm Shader Model 6 and the Deferred renderer.
2. [general] Keep Lumen on hardware ray tracing so the Ray Tracing Scene is shared.
3. [general] Leave lights on the Ray Tracing shadow method; reserve Virtual Shadow Maps for the few lights that need Nanite detail.
4. [general] Keep lights small and sparse: narrow attenuation radius, cone angle and barn doors, no lights inside geometry, and merge clusters into single area lights.
5. [documented] `r.Visibility.LocalLightPrimitiveInteraction` defaults to 2, which Epic and the renderer source describe as enabled only while MegaLights is disabled; with MegaLights enabled for the project the per-light primitive interaction is already off, so there is nothing to set. Set it to 1 only to bring the old behaviour back for a comparison.
6. [general] Tune with `r.MegaLights.NumSamplesPerPixel` and `r.MegaLights.DownsampleMode`; use `r.MegaLights.LightAttenuationFalloff` to tighten light influence.
7. [general] Profile with `r.RDG.AsyncCompute 0`, then A/B test `r.MegaLights.AsyncCompute.Volume`, `.GenerateSamples` and `r.StochasticLighting.AsyncCompute`.
8. [documented] Inspect shadow mismatches with `r.MegaLights.Visualize 1` and the Light Complexity view.

Related: [MegaLights](unreal-megalights.md), [Lumen](unreal-lumen.md), [Virtual Shadow Maps](unreal-virtual-shadow-maps.md), [Nanite](unreal-nanite.md).

## Sources

- [MegaLights](https://dev.epicgames.com/documentation/en-us/unreal-engine/megalights-in-unreal-engine)
- [Unreal Python 5.7 PostProcessSettings](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/PostProcessSettings?application_version=5.7)
- [Unreal Python 5.7 SystemLibrary](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/SystemLibrary?application_version=5.7)
- The installed engine: `Engine/Config/BaseScalability.ini`, `Scene.h`, `LightComponent.h`, `KismetSystemLibrary.cpp`.
