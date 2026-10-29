# MegaLights measurements: tracing-route probe records and cost against Virtual Shadow Maps

Target: Unreal Engine 5.8, Windows. The records behind [MegaLights](unreal-megalights.md): what the tracing-route probe read back on each route, and one cost comparison. Each is one project, one scene and one machine; measure in the project's own scene ([profiling](../../unreal-native/references/unreal-native-profiling.md)).

## Tracing-route probe records

- [tested] A rendering editor started with `-RenderOffScreen` on a throwaway project ([rp_rt_validate.mjs](../../../examples/unreal/rendering_probes/README.md), 8 of 8 checks), hardware route (`r.RayTracing` 1, `r.SkinCache.CompileShaders` 1, MegaLights on): the log held "Ray tracing is enabled", the script ran and exited 0 in about 160 s, and the read-back was `r.RayTracing.EnableOnDemand` 1, `r.GenerateMeshDistanceFields` 0, `r.MegaLights.EnableForProject` 1, `r.MegaLights.Allowed` 1, `r.MegaLights.HardwareRayTracing` 1, `r.MegaLights.HardwareRayTracing.Inline` 1, `r.MegaLights.SoftwareRayTracing.Allow` 0, `r.ForwardShading` 0.
- [tested] Same run, software route (`r.RayTracing` 0, mesh distance fields and `r.MegaLights.SoftwareRayTracing.Allow` on): the log held "Ray tracing is disabled. Reason: disabled through project setting (r.RayTracing=0)" and the read-back was `r.RayTracing` 0, `r.GenerateMeshDistanceFields` 1, `r.MegaLights.SoftwareRayTracing.Allow` 1, `r.MegaLights.EnableForProject` 1.
- [tested] Same run, both routes: `ProfileGPU` listed 14 lines naming MegaLights. The scene was profiled through a Play-In-Editor viewport; with `-RenderOffScreen` the editor's own level viewport drew nothing and its profile held only Slate frames.

## Cost against Virtual Shadow Maps

- [general] Measured once on one high-end GPU at 1920 x 1080 with hardware ray tracing (on an earlier engine build; a scene with 16 shadow-casting point lights as the base, small point lights scattered in steps, each step a 2.5 s mean). MegaLights GPU time stayed near 7.5 ms from 16 to 416 lights; Virtual Shadow Maps (MegaLights off) went from 5.35 ms at 16 to 7.17 ms at 416 and 24.7 ms at 816, where MegaLights read 5.5 ms for a reason not found. Shadow maps were about 2 ms cheaper at a small count and the two met near 400 lights. One GPU, one resolution, one synthetic scene; the base scene's other costs are in every figure.

Related: [MegaLights](unreal-megalights.md), [Driving and tuning MegaLights](unreal-megalights-driving.md).
