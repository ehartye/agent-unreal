# Measurement conditions and budgets

Source for every `[documented]` line here: Epic's 5.8 pages "Introduction to Performance Profiling and Configuration in Unreal Engine", "Scalability and the Developer for Unreal Engine", "Scalability Reference for Unreal Engine", "Stat Commands in Unreal Engine", "PSO Precaching for Unreal Engine", "Manually Creating Bundled PSO Caches in Unreal Engine" and "Common Memory and CPU Performance Considerations in Unreal Engine". Running a capture or profile is [unreal-native](../../unreal-native/SKILL.md); this page says what makes a number trustworthy.

## What Epic documents

- `[documented]` Performance is measured as frames per second and as frame time in milliseconds; applications generally target 30, 60 and 120 frames per second, and Epic wants the rate higher and also consistent. Epic prefers milliseconds: "it became 5ms faster" is meaningful where "it became 10FPS faster" is not.
- `[documented]` A drop comes from too much processing in one frame. It is a hitch when momentary and a low frame rate when consistent. Establish whether the application is CPU-bound, GPU-bound or, with Vsync on, display-bound before optimizing.
- `[documented]` `stat unit` is "a great stat command to start with": Frame close to Game means the game thread is the likely bottleneck, close to Draw the rendering thread, and GPU and RHIT times typically sync to the frame. Run it in a non-debug build.
- `[documented]` "There is no substitute for profiling directly on your target hardware." Profiling uses the same CPU, RAM and disk as the game, so a profiled game runs slightly worse; Epic frames that as a safety margin.
- `[documented]` Define low and recommended specs early. Test on a matrix of low, medium and high GPU, CPU and memory, on reproducible scenes. "Disabling things is a powerful way to isolate a performance issue."
- `[documented]` Scalability: `sg.*` groups map levels 0 to 3 onto console variables; defaults are in `BaseScalability.ini` and a project overrides them in `DefaultScalability.ini`. "Ideally, no scalability setting should affect gameplay," and when balancing it is "generally better to optimize than to create more scalability".
- `[documented]` For hitch tests use `-clearPSODriverCache` "consistently for all test runs that assess the smoothness of your game", and limit many-core machines with `-corelimit=n` and `-processaffinity=n`. Validate with `r.PSOPrecache.Validation` 1 or 2 and `stat PSOPrecache`. The runtime hitch threshold is 20 ms by default (`r.PSO.RuntimeCreationHitchThreshold`).
- `[documented]` On bundled PSO caches: "never measure the performance of a build that does not have an up-to-date cache, or at least don't use those measurements in comparisons". Epic says runtime precaching "should be enough" in most cases and a bundled cache is for when more is wanted.
- `[documented]` `stat DumpHitches` logs frames over `t.HitchFrameTimeThreshold`.
- `[documented]` Common causes of spikes: garbage collection after many objects were destroyed, synchronous work on large data, many Actors spawned in one frame, and shader compilation (counter with PSO caching).

## A trustworthy claim

- `[general]` State five things with every number: build configuration (Development, Test or Shipping, not a Debug or editor build), where it ran (packaged or editor), the scenario, the metric (average, a percentile such as the 99th, or the maximum, and in milliseconds) and the conditions (machine class, cache state, resolution, settings, number of runs).
- `[general]` An editor viewport reading of `stat fps` is a hint about the editor, not a statement about the game. A claim like "it felt smoother" is an observation, not a measurement.
- `[general]` A claim with no stated bottleneck cannot guide a fix. Run `stat unit` or a capture first to say which thread is bound.
- `[general]` Report the tail, not just the mean: a game can average 60 fps and still stutter. Percentile and maximum frame times come from a capture; the Insights capture reference in [unreal-native](../../unreal-native/references/unreal-native-insights-capture.md) says how to export them.

## Budgets

- `[general]` Epic's pages set no frame budget for a project; a budget is the owner's decision, set after a baseline exists and expressed in milliseconds per thread where possible. Record absent budgets as unknown instead of inventing one.
- `[general]` Check a budget claim against its measurement: the budget, the scenario it applies to, the percentile it is judged at and the machine it was set on.

Next: [profiling tools](unreal-quality-profiling-tools.md).
