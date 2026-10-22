# Movie Render Queue in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. Movie Render Queue (MRQ, the Movie Render Pipeline) is Epic's offline image-sequence and movie renderer. It queues jobs and renders them with presets, scripts and settings, with temporal subsampling for motion blur, translucent pixels and 16-bit linear HDR output. Movie Render Graph (MRG) is the newer graph-based way to describe a render; the UI labels it Beta, and legacy presets can be used interchangeably with it.

## Enable it

| Plugin | Category | Enabled by default | Flags (descriptor) | Dependencies |
|---|---|---|---|---|
| `MovieRenderPipeline` (shown as Movie Render Queue) | Rendering | no | not beta, not experimental | ConsoleVariables, OpenColorIO, SequencerScripting, EditorScriptingUtilities, ActorLayerUtilities, NamingTokens, ChaosClothAsset; LevelSequenceEditor optional |
| `MoviePipelineMaskRenderPass` | Rendering | no | beta, editor-only | see note |

- Enable in Edit > Plugins under Rendering, then restart the editor (Epic).- `MoviePipelineMaskRenderPass` adds the Object ID (Cryptomatte) and panoramic passes.
- Open Window > Cinematics > Movie Render Queue, or use the ellipsis next to Render Movie in Sequencer.
- Alpha: turn on Alpha Output in Project Settings > Rendering > Default Settings (5.5 and later).

## Use it when

- A Level Sequence must become an image sequence or video at fixed quality, independent of real-time frame rate.
- Motion blur or anti-aliasing quality matters more than speed.
- Many sequences render as a batch, from a saved Movie Pipeline Queue asset or a script.
- A render must start from a command line or a farm: Render (Remote) writes its command to the Output Log.
- A packaged build renders on the user's device (Blueprint API).

## Use something else when

- Epic's command-line page says the MRQ command line replaces the arguments of the Render Movie feature, whose page is marked Deprecated.
- Use a legacy preset where MRG lacks support: Epic lists nDisplay rendering, High Resolution rendering, Apple ProRes, Final Cut Pro XML, Prestreaming Recorder and 32-bit post-process materials as not yet supported in MRG.
- Use [Sequencer](unreal-sequencer.md) to author the sequence being rendered.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Queue and job | Python (documented by Epic) | `unreal.get_editor_subsystem(unreal.MoviePipelineQueueSubsystem)`, `get_queue()`, `queue.allocate_new_job(unreal.MoviePipelineExecutorJob)`; set `sequence`, `map`, `job_name`, `author`, `comment` with `set_editor_property` |
| Graph job | Python (documented) | `job.set_graph_preset(graph)`, `job.get_or_create_variable_overrides(graph)`, `set_value_serialized_string`, `set_variable_assignment_enable_state` |
| Legacy job | Python (5.8 install example) | `job.get_configuration().find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)` (`output_resolution`, `file_name_format`), `unreal.MoviePipelineDeferredPassBase`, `unreal.MoviePipelineImageSequenceOutput_PNG` |
| Anti-aliasing | Python, Blueprint | `MoviePipelineAntiAliasingSetting`: `SpatialSampleCount`, `TemporalSampleCount`, `bOverrideAntiAliasing`, `AntiAliasingMethod`, `RenderWarmUpCount`, `EngineWarmUpCount` (BlueprintReadWrite in the 5.8 install; Python names follow snake case, not run here) |
| Console variables | Python, Blueprint | `MoviePipelineConsoleVariableSetting`: `AddOrUpdateConsoleVariable(name, value)`, `StartConsoleCommands`, `EndConsoleCommands` (BlueprintCallable in the 5.8 install) |
| Render and wait | Python (documented) | `unreal.MoviePipelinePIEExecutor(subsystem)`, `executor.on_executor_finished_delegate.add_callable_unique(cb)`, `subsystem.render_queue_with_executor_instance(executor)` |
| Per-job and per-shot hooks | Python (documented) | subclass `unreal.MovieGraphScriptBase` (`@unreal.uclass()`, `on_job_start`, `on_job_finished`, `on_shot_start`, `on_shot_finished`), pick it in an Execute Script Node |
| Command line | Command line (documented) | below |
| Runtime build | Blueprint (documented) | Movie Pipeline Queue Engine Subsystem: Allocate Job, Set Configuration, Render Job, On Render Finished |

Command line (Epic's page for 5.8 documents MRQ flags and no MRG flags):
- One sequence: `UnrealEditor-Cmd.exe Project.uproject MapName -game -LevelSequence="/Game/Seq.Seq" -MoviePipelineConfig="/Game/Preset.Preset" -windowed -resx=1280 -resy=720 -log -notexturestreaming`
- A saved queue: omit `-LevelSequence` and point `-MoviePipelineConfig` at the Movie Pipeline Queue asset.
- Custom Python executor: `-MoviePipelineLocalExecutorClass=/Script/MovieRenderPipelineCore.MoviePipelinePythonHostExecutor -ExecutorPythonClass=<python class path>`.

The 5.8 install ships Python examples in `Engine/Plugins/MovieScene/MovieRenderPipeline/Content/Python/`. Process handling for editor runs is in [Editor Python](unreal-editor-python.md).

## Workflow

1. Enable the plugin and restart. Create the job with a Level Sequence and a map; MRQ opens the level for the job.
2. A job needs a render pass and an output format. Add Deferred Rendering and an output such as `.png Sequence [8bit]`; the default output is `.jpg Sequence [8bit]`.
3. Choose the format for the destination: EXR keeps HDR (linear, no sRGB); PNG and JPG are 8-bit sRGB; PNG transparency needs the alpha project setting; Command Line Encoder pipes frames to an external encoder such as FFmpeg; WAV exports audio.
4. Set resolution and the Output directory; build file names with `{token}` format strings.
5. Set anti-aliasing. Epic's high-quality worked example uses Spatial Sample Count 1, Temporal Sample Count 64, Override Anti Aliasing on with method None, and Render and Engine Warm Up Count 120. Higher counts raise time per frame: time a few frames before raising them. In the 5.8 header, Engine Warm Up costs less than Render Warm Up and suits particle warm-up.
6. In MRG, set temporal samples on the Sampling Method node, spatial samples and AA method on the Renderer node, warm up on its own node, and file naming on the File Type Output node. Connect the Path Tracer or Deferred node to choose the render path. The default Game Overrides node controls overrides; removing it removes them (Epic).
7. Raise quality with the Console Variables setting. Epic's example sets `r.MotionBlurQuality 4`, `r.MotionBlurSeparable 1`, `r.DepthOfFieldQuality 4`, `r.BloomQuality 5`, `r.Tonemapper.Quality 5`. Values apply at render start and revert when it finishes.
8. Render (Local) runs in the editor process (no save needed); Render (Remote) runs a separate process (save the project first).
9. Keep executor and callback objects in module-level Python variables for the render's duration (5.8 install example).
10. Confirm outputs in `on_job_finished`: read `in_output_data.graph_data`, each shot's `render_layer_data` and its `file_paths` (Epic).

Related: [TSR and anti-aliasing](unreal-temporal-super-resolution.md), [Lumen](unreal-lumen.md).

## Sources

- [Movie Render Pipeline](https://dev.epicgames.com/documentation/unreal-engine/movie-render-pipeline-in-unreal-engine?lang=en-US)
- [Render Settings and Formats](https://dev.epicgames.com/documentation/unreal-engine/cinematic-render-settings-and-formats-in-unreal-engine)
- [Rendering High Quality Frames with Movie Render Queue](https://dev.epicgames.com/documentation/unreal-engine/rendering-high-quality-frames-with-movie-render-queue-in-unreal-engine?lang=en-US)
- [Using Command Line Rendering with Movie Render Queue](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-command-line-rendering-with-move-render-queue-in-unreal-engine)
- [Transitioning to Movie Render Graph from Movie Render Queue](https://dev.epicgames.com/documentation/unreal-engine/transitioning-to-the-movie-render-graph-from-movie-render-queue-in-unreal-engine)
- [Programming a Render in Movie Render Graph](https://dev.epicgames.com/documentation/unreal-engine/programming-a-render-in-mrg-in-unreal-engine)
- [Movie Render Graph Callback Scripts](https://dev.epicgames.com/documentation/unreal-engine/movie-render-graph-callback-scripts-in-unreal-engine)
- [Movie Render Queue in Runtime Builds](https://dev.epicgames.com/documentation/unreal-engine/movie-render-queue-in-runtime-in-unreal-engine)
- [Old Render Movie](https://dev.epicgames.com/documentation/unreal-engine/old-render-movie-in-unreal-engine)
- The MovieRenderPipeline and MoviePipelineMaskRenderPass descriptors, the plugin's Python examples and its Core and Settings headers in the 5.8 install.
