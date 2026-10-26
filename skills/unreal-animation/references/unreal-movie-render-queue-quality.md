# Movie Render Queue render passes and quality in Unreal 5.8: Deferred, Path Tracer, samples, anti-aliasing and console variables

Target: Unreal Engine 5.8, Windows. Companion to [Movie Render Queue](unreal-movie-render-queue.md), which covers the queue, jobs, formats and scripting. This page covers the render path and the quality settings of a job.

## Choose the render path

- [documented] A job needs a render pass. In the legacy configuration add Deferred Rendering; in Movie Render Graph connect the Path Tracer or the Deferred node to the render (Epic).
- [general] Observed once on 5.8.x: a Deferred Rendering job on a Lumen scene lost the D3D device within seconds, in a compute pass, in an editor play session and in a standalone game process, at 1080p and at 4K. These did not help: MegaLights, hardware ray tracing, Virtual Shadow Maps and Nanite off; leaving out the quality console variables and the anti-aliasing override; multisample effects off; a stripped configuration. Switching off water, landscape, clouds, fog, particles, instanced meshes or skeletal meshes one at a time did not cure it either (twice it got one picture further, so the failure moves).
- [general] Observed once: with Lumen off the same job rendered every shot, and on the engine's empty map even the plain configuration rendered. Lumen under the queue in that scene was the trigger; the cause below it was not found. If a Deferred job loses the device on a Lumen scene, switch Lumen off for the render ([Lumen](../../unreal-rendering/references/unreal-lumen.md)). Not run on this repo's example scenes or on 5.8.3.
- [general] Observed once: the Path Tracer pass does not use Lumen and rendered the same scene without trouble. A path-traced still needs the project's Substrate and ray-tracing settings. One scene showed a water body as a flat red-brown sheet under the path tracer where the game's own renderer drew it correctly; not investigated.

## Anti-aliasing and samples

- [documented] Epic's high-quality worked example uses Spatial Sample Count 1, Temporal Sample Count 64, Override Anti Aliasing on with method None, and Render and Engine Warm Up Count 120. Higher counts raise time per frame: time a few frames before raising them. In the 5.8 header, Engine Warm Up costs less than Render Warm Up and suits particle warm-up.
- [documented] In Movie Render Graph, set temporal samples on the Sampling Method node, spatial samples and the anti-aliasing method on the Renderer node, warm up on its own node, and file naming on the File Type Output node. The default Game Overrides node controls overrides; removing it removes them (Epic).
- Related: [TSR and anti-aliasing](../../unreal-rendering/references/unreal-temporal-super-resolution.md).

## Console variables

- [documented] Raise quality with the Console Variables setting. Epic's example sets `r.MotionBlurQuality 4`, `r.MotionBlurSeparable 1`, `r.DepthOfFieldQuality 4`, `r.BloomQuality 5`, `r.Tonemapper.Quality 5`. Values apply at render start and revert when it finishes.

## Sources

- [Rendering High Quality Frames with Movie Render Queue](https://dev.epicgames.com/documentation/unreal-engine/rendering-high-quality-frames-with-movie-render-queue-in-unreal-engine?lang=en-US)
- [Transitioning to Movie Render Graph from Movie Render Queue](https://dev.epicgames.com/documentation/unreal-engine/transitioning-to-the-movie-render-graph-from-movie-render-queue-in-unreal-engine)
- The MovieRenderPipeline plugin's Core and Settings headers in the 5.8 install.
