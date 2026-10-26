# Side-by-side comparison scene for a native Unreal game

A reusable C++ game mode that sets several ways of doing one thing in a row on an empty stage under one camera, films them, times each alone at N copies, and writes a receipt. Source, an engine-only example set, a standalone runner and a longer README: [`examples/unreal/compare-scene`](../../../examples/unreal/compare-scene/README.md). Built, cooked, packaged and run on Unreal 5.8.2, Windows, as a packaged game in a throwaway C++ project with the `example` set: the runner's checks passed and the filmed images were looked at. Not run: live mode, gamepad input, a non-Windows platform, the editor-launched route. The `perf` block (GPU, game thread and render thread time next to wall time) was run later on 5.8.3: [GPU time in the comparison scene](unreal-native-compare-gpu-time.md).

## When to use it

- [general] Use it when you must choose between implementations of one visible thing (mesh components moved by code, a Niagara system, an instanced mesh, a material trick) and want to see them next to each other and time them in the same run, before committing the real scene to one.
- [general] Do not use it to prove a shipped game meets a frame budget, to rank small differences from one run, or as a visual-quality verdict. A candidate on a bare stage says nothing about the same candidate in a full scene; use the profiling method for that: [native profiling](unreal-native-profiling.md).

## The pattern

- [tested] A set is a title and a list of candidates. A candidate is an id, a label and note shown in the scene, a `Spawn` (make N copies at a slot), an optional `Tick` (what runs every frame), an optional `Clear` (remove what the slot's owner does not own), an optional `StressCount` cap and an optional `Describe` (add facts to the receipt).
- [tested] The harness owns the rest: stage (floor, wall, a dark panel behind each slot, labels, camera, lights), warm-up, two filmed frames a moment apart (`compare.png`, `compare-b.png`), then each candidate alone at N copies (warm-up, timed window, `compare-stress-<id>.png`), then `compare.json`, then exit.
- [general] Make the first candidate an empty baseline. Every other row then reads as a cost over the bare stage and the harness.
- [general] Live mode (`-AECompareLive`) keeps the showcase on screen in a window with the frame time. Up/Down or D-pad up/down doubles/halves the copies of every candidate; Left/Right, D-pad or left stick orbit; right stick dollies; Esc, B or Back quits. Live mode, its keys and the gamepad bindings were read from the code, not run, in the verification pass above.

## Adopt it in a native C++ game

- [tested] Copy `AECompare.h` and `AECompare.cpp` into the game module. Add `InputCore` (`AECompare.cpp` uses `EKeys`; the first Editor build on 5.8.3 failed to link without it), `Json`, `RHI` and `RenderCore` to the module's dependency lists (`Niagara` too if a set spawns Niagara systems, as the example does). The `?game=` class path names that module: `/Script/<Module>.AECompareGameMode`.
- [tested] Enable the plugins your candidates need in the `.uproject` (Niagara is on by default; the Niagara Fluids plugin is not). Engine-plugin content a cooked game loads by path must be cooked: add `+DirectoriesToAlwaysCook=(Path="/Niagara/DefaultAssets/Templates/Systems")` to `Config/DefaultGame.ini`.
- [general] To compare an authored Niagara system instead of an engine template, create it in the editor project first (the Python routes are in [Niagara in Unreal](../../unreal-effects/references/unreal-niagara.md)), save it under `/Game/FX`, add `+DirectoriesToAlwaysCook=(Path="/Game/FX")` to `Config/DefaultGame.ini` and pass its object path to the Niagara candidate helper. Stateless and stateful systems cost differently, which a row here measures; per-emitter particle counts come from the editor-only simulation cache, not from this packaged harness. This was not run from the example.
- [tested] Register a set from its own source file, so adding a comparison touches no other file:

```cpp
static AECompare::FSet MakeMine() {
    AECompare::FSet Set; Set.Name=TEXT("mine"); Set.Title=TEXT("MINE: A vs B");
    AECompare::FCandidate A; A.Id=TEXT("a"); A.Label=TEXT("A"); A.Note=TEXT("how A works");
    A.Spawn=[](AActor& Owner,const FTransform& Slot,int32 Count) { /* make Count copies, owned by Owner */ };
    Set.Candidates.Add(A);
    return Set;
}
static AECompare::FRegistrar MineRegistrar(TEXT("mine"),&MakeMine);
```

- [tested] Launch with the map plus `?game=/Script/<Module>.AECompareGameMode`. The URL option picks the game mode for this launch only, so none of the game's own HUD, menus, save state or rules run. The runner is `compare.ps1` beside the source; run `-Set mine`.
- [general] `FStyle` paths (floor, wall, dark panel, post-process) left empty give the engine's basic shape material on a lit stage. A game with an unlit house style names its own materials to see candidates the way its players would.

## The receipt

- [tested] `compare.json` holds `scenario` (`compare`), `screenshot` and `screenshot_b` (full paths), `set`, `title`, `engine_version`, `rhi_adapter`, the showcase and stress settings, `frame_time_meaning`, and `candidates[]`: id, label, note, whatever `Describe` added, and `stress` with `copies`, `frames`, `frame_ms_mean`, `frame_ms_p50`, `frame_ms_p95`, `frame_ms_max` and its screenshot.
- [tested] The runner fails unless both showcase PNGs are valid 1920x1080 PNGs (signature and IHDR), the receipt parses and names this scenario and screenshot, and every candidate has at least 10 timed frames and a stress screenshot. Passing proves the artifacts exist and are well formed; look at the images.
- [tested] `rhi_adapter` carried the GPU adapter name in a 5.8.3 receipt.
- [general] Strip `rhi_adapter` from receipts you publish.

## What the frame times mean

- [tested] Each is the wall-clock time between game ticks of the whole process (game thread, render thread and GPU together), sampled over a timed window after a warm-up. It is not the isolated cost of a candidate, and the same candidate in a real scene will differ.
- [general] One run proves little. Repeat it, compare candidates only when their gap exceeds the spread between runs, and report the spread. Candidate order can bias results (earlier candidates meet colder caches, later ones a warmer machine): run again with the order reversed.
- [general] First use compiles shaders and loads assets. The stress warm-up absorbs most of it, not all; a large `max` on a first candidate is often that, not its steady cost.
- [general] Cost per copy differs by orders of magnitude between kinds of candidate (a per-instance simulation against a stateless particle). Cap such a candidate with `StressCount`; the receipt records the number each was timed at, so compare rows at equal copies.

## Traps found while building it

- [tested] A candidate that spawns something its slot owner does not own (a Niagara component, an actor of its own) must destroy it in `Clear`. Otherwise its leftovers appear in, and slow, the next candidate's measurement.
- [tested] The default lit stage first rendered wrongly in a project with dynamic global illumination switched off: only the up-facing floor was lit, so the wall, the fronts of objects and the labels' background were black and the text was invisible. A Movable key light on the camera's side, aimed along the view and down 35 degrees, fixed it. The cause was not isolated; check a lit stage in a project with your renderer settings.
- [tested] `BasicShapeMaterial` is one-sided and lit, and its plane's front face is +Z: a wall plane turned the wrong way vanishes. A static mesh left on its own default material (the engine cube) rendered nearly black on this stage, so give each candidate's meshes a material.
- [tested] `FScreenshotRequest` writes the PNG on another thread. Wait for it before exiting, or the file is truncated or missing.
- [tested] Read what a candidate says about itself (`Describe`) before clearing it; after the clear it describes nothing.
- [tested] `UTextRenderComponent` text faces +X. Rotate it by yaw 180 to face a camera that looks down +X.
- [tested] In PowerShell, `"$Map?game=..."` parses as the variable `$Map?game`. Write `"${Map}?game=..."`.
- [general] A candidate that needs plugin content logs a clear "did not load" problem and reports `available: false` in the receipt. Check that field before reading its timings.

## Related

- [Niagara families and stock content, tested on 5.8.2](../../unreal-effects/references/unreal-niagara-stock-content.md), [Unreal production stack](../../unreal-rendering/references/unreal-production-stack.md)
- [Native game loop](unreal-native-game.md), [native profiling](unreal-native-profiling.md)
