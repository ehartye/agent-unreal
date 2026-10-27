# Heterogeneous Volumes in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. A Heterogeneous Volume is a placed volume (`AHeterogeneousVolume`, whose component is `UHeterogeneousVolumeComponent`) that the renderer ray-marches and lights. Its density comes from a Volume-domain material, procedural or a Sparse Volume Texture. It is a renderer feature, not a plugin. Class and cvar facts below are from the installed engine source; no Epic 5.8 page for the feature was read.

## Enable it

- [documented] The project setting is Rendering > Heterogeneous Volumes, labelled Beta: "Heterogeneous Volumes" (`r.HeterogeneousVolumes`, default 1, no restart), "Shadow Casting" (`r.HeterogeneousVolumes.Shadows`, default 0) and "Composite with Translucency" (`r.Translucency.HeterogeneousVolumes`, default 0, restart) (`RendererSettings.h`, `HeterogeneousVolumes.cpp`).
- [documented] Scalability gates it with `r.HeterogeneousVolumes.Allowed` (default 1; `BaseScalability.ini` sets 0 at EffectsQuality 0 and 1). The 5.8 release notes spell it `r.HeterogeneousVolumes.Allow`; the source registers only `Allowed`. An unknown name read from Python returns 0 and only warns (see [MegaLights](unreal-megalights-driving.md)).
- [documented] The material needs the Heterogeneous Volumes usage flag, or it works on volumetric fog only (`bUsedWithHeterogeneousVolumes`, `Material.h`; the 5.8 header deprecates direct access in favour of `GetUsageByFlag()`). [general] Observed once in a consuming project on an earlier engine build: without it nothing drew and the log said "missing usage flag HeterogeneousVolumes! Default Material will be used in game". The Python property is probably `used_with_heterogeneous_volumes`, named like the other usage flags; not run.
- [documented] In a Volume-domain material the Subsurface Color input is labelled Extinction (`MaterialAttributeDefinitionMap.cpp`). [general] Observed once in a consuming project on an earlier engine build: two procedural volumes drew from editor Python with a Volume-domain, additive material, albedo, extinction and emissive outputs, and a Custom HLSL density from world position and time. The Python class names were not checked.

## Size and cost

- [documented] `VolumeResolution` (default 128 on each axis) is the voxel grid, not a size in centimetres. `CalcBounds` makes the local box that many units across and the actor scale then stretches it; voxel size is the bounds over the resolution (`HeterogeneousVolumeComponent.cpp`). The lighting cache is a 3D texture of `VolumeResolution / LightingDownsampleFactor` (component default 2), clamped to 1024 per axis and 512 in Z; the preshaded volume clamps to 1024 per axis (`HeterogeneousVolumes.cpp`, `GetLightingCacheResolution`, `GetVolumeResolution`).
- [general] Keep `VolumeResolution` at the grid wanted and scale the actor to the world size. A resolution entered in centimetres is clamped by the renderer and still large.
- [general] Measured once on one high-end GPU at 1920 x 1080, on an earlier engine build: a 15,000 x 15,000 x 6,000 cm box entered as the resolution cost 221 ms a frame and drew a bright white bank; the same box as a 160 x 160 x 64 grid scaled up cost 0.3 to 0.4 ms (a second volume 0.1 ms). One scene and one GPU, not a rule.
- [documented] Ray-march length is `r.HeterogeneousVolumes.MaxStepCount` (default 512); the scalability levels lower it (96 at EffectsQuality 2, 256 at 3).

## Lighting

- [documented] Per volume the renderer gathers directional, point, spot and rect lights, each behind `r.HeterogeneousVolumes.LightType.<Type>` (default 1), that affect its bounds and match the view's lighting channels (`GatherLights`, `SupportsLightType`).
- [general] Observed once in a consuming project on an earlier engine build, in a MegaLights-heavy scene: the volumes took the sun, and a point light added only emission. Epic's MegaLights page lists Heterogeneous Volumes as unsupported, so a MegaLights-owned light may not reach a volume; this was not isolated. Test one point light with MegaLights off before ruling point lights out.

## Use it when

- [documented] Density is a material graph or a Sparse Volume Texture, optionally an animated one (`Frame`, `FrameRate`, `bPlaying` on the component), and the volume should be lit and optionally cast shadows.
- [general] Judge the look before the cost. The spike was cheap to author and its gain small: a mist added a faint haze over fog the scene already had, and a self-lit column darkened what stood behind it and added a soft halo, with no swirling column that read against the sky. A Niagara beam did that job ([Niagara templates](../../unreal-effects/references/unreal-niagara-templates.md)). One idea was not tried: a denser, higher-contrast volume lit by a low sun.

## Use something else when

- [general] A light haze over existing fog or a beam against the sky is the goal: fog or a Niagara beam did the job in the spike above.
- [general] The scene's light is mostly MegaLights lights (see Lighting above).

Related: [MegaLights](unreal-megalights.md), [Directional lights](unreal-directional-lights.md), [Substrate](unreal-substrate.md).

## Sources

- The installed engine: `Engine/Source/Runtime/Renderer/Private/HeterogeneousVolumes/HeterogeneousVolumes.cpp`, `HeterogeneousVolumesLiveShadingPipeline.cpp`, `Engine/Source/Runtime/Engine/Classes/Components/HeterogeneousVolumeComponent.h`, `Engine/Source/Runtime/Engine/Private/Components/HeterogeneousVolumeComponent.cpp`, `RendererSettings.h`, `Material.h`, `Engine/Config/BaseScalability.ini`.
- [Unreal Engine 5.8 Release Notes](https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-5-8-release-notes)
