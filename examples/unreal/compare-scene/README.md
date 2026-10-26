# Unreal side-by-side comparison scene

A game mode that sets several ways of doing the same thing in a row on an empty stage, under one camera, so you can see them next to each other and time them in the same run. A *set* is a title and a list of *candidates*; a candidate is a name, a way to spawn N copies of itself, and what it does each frame. The harness supplies everything else: the stage, labels, camera, warm-up, two filmed frames, a timed stress phase per candidate, a JSON receipt, and the exit.

Use it to choose between implementations of one visible thing (mesh components moved by code, a Niagara system, instanced meshes, a material trick) before committing a real scene to one. It is a measuring stage, not a benchmark of a shipped game. The guidance behind it, with the traps found while building it, is in [the reference](../../../skills/unreal-native/references/unreal-native-compare-scene.md).

**Status of the GPU time addition:** Prepared 2026-10-26; not yet run on an engine. A first run tests the probe before it tests the engine. The `perf` block, the `perf` set, `-Headless` and `compare_perf.mjs` below are new and unbuilt; the `example` set and the receipt fields that existed before are unchanged.

## Files

| File | What |
|---|---|
| `Source/AECompare.h`, `Source/AECompare.cpp` | The harness: `AAECompareGameMode`, the set and candidate types, the registry. Project-neutral; copy as they are. |
| `Source/ExampleSets.cpp` | The `example` set, engine content only: an empty baseline, N static mesh components animated by game code, N Niagara `FountainLightweight` systems. Use it as the model for your own set. |
| `Source/PerfSets.cpp` | The `perf` set, engine settings only: an empty baseline, a GPU-side change (`r.ScreenPercentage` 200) and a CPU-side change (a 4 ms busy-wait on the game thread). It exists to show that the receipt's perf block tells the two apart. |
| `compare.ps1` | A standalone runner (PowerShell 7) with no dependency on any project's scripts. |
| `compare_perf.mjs`, `compare-perf-checks.mjs`, `compare-perf.test.mjs` | Node (no dependencies) judge of the perf blocks in a `compare.json`, its pure checks and their test (the test runs in `node scripts/check.mjs`). |

## Verified

Built as part of a C++ project, cooked and packaged, and run with `compare.ps1` on Unreal Engine 5.8.2, Windows, with the `example` set (before the perf block was added). The runner's checks passed (valid 1920x1080 PNGs, receipt parses and names its scenario and screenshot, every candidate timed over its window), and the filmed frames were looked at: a lit stage with a label under each candidate, a dark panel behind each, the cubes turning and the fountain's particles showing against the dark panel. Not run: live mode and the gamepad bindings, the editor-launched route (`-Exe UnrealEditor.exe`), an output path containing spaces, any non-Windows platform, and everything in the GPU time section above (the perf block, the `perf` set, `-Headless`, `compare_perf.mjs` on a real receipt).

## Adopt it in a native C++ game

1. Copy `AECompare.h` and `AECompare.cpp` into your game module, and `ExampleSets.cpp` too if you want the example.
2. Module dependencies in your `*.Build.cs`: `Core`, `CoreUObject`, `Engine` (as any game module has), plus `InputCore` (the live mode's key bindings), `Json`, `RHI` and `RenderCore` for the harness (`RenderCore` for the game and render thread times, `RHI` for the GPU's frame time), and `Niagara` for the example set:

   ```csharp
   PrivateDependencyModuleNames.AddRange(new[] { "InputCore", "Json", "RHI", "RenderCore", "Niagara" });
   ```

3. `.uproject` plugins: Niagara is enabled by default. A set that uses another plugin's content lists that plugin as well.
4. Cooked game: engine-plugin content loaded by path must be cooked. Add to `Config/DefaultGame.ini`:

   ```ini
   [/Script/UnrealEd.ProjectPackagingSettings]
   +DirectoriesToAlwaysCook=(Path="/Niagara/DefaultAssets/Templates/Systems")
   ```

   (The section may already exist in your file; add the line to it.)
5. Build the Game target and package as you normally do.
6. Run it (see below). The comparison runs on its own game mode, chosen with the `game=` URL option: `<Map>?game=/Script/<YourModule>.AECompareGameMode`. The option replaces the map's game mode for that launch only, so none of your game's HUD, menus, save state or rules start, and nothing of the comparison is in your normal game. The map is only the level it runs in; any map works because the harness builds its own stage.

## Run it

```powershell
./compare.ps1 -Exe <path to your packaged game's exe> `
    -Set example -OutputDirectory <a folder that does not exist yet> `
    -GameMode /Script/<YourModule>.AECompareGameMode -Map /Game/Maps/<AnyMap>
```

Replace `YourModule` (the default `-GameMode` is the placeholder `/Script/YourModule.AECompareGameMode`). Parameters: `-Exe`, `-Set`, `-OutputDirectory` (must not exist), `-Count` (copies per candidate in the stress phase, default 332; a candidate may cap its own), `-Warmup` and `-StressSeconds` (seconds), `-Live`, `-Headless`, `-RequirePerf`, `-GameMode`, `-Map`, `-TimeoutSeconds`, and `-ExtraArguments` (placed before the map; for `UnrealEditor.exe` pass the `.uproject` path and `-game`).

The runner starts the game off-screen (`-RenderOffScreen -unattended -nosplash -notraceserver -NoGamepad -ResX=1920 -ResY=1080 -ForceRes`), waits, and then checks what was written: `compare.png` and `compare-b.png` are valid 1920x1080 PNGs (signature and IHDR), `compare.json` parses, its `scenario` is `compare` and its `screenshot` is this run's `compare.png`, and every candidate has a stress result with a screenshot. It prints a table of the candidates. A pass means the artifacts exist and are well formed. Open the images and look at them.

Live mode (`-Live`) opens the same scene in a 1600x900 window, with no capture and no time limit, and the frame time on screen:

| Input | Effect |
|---|---|
| Up / D-pad up | double the copies of every candidate |
| Down / D-pad down | halve them |
| Left / Right, D-pad left / right, left stick | orbit the camera |
| Right stick | dolly in and out |
| Esc / B / Back | quit |

A candidate that names a `StressCount` cap is held at that many copies in live mode, and the on-screen line says so.

## What it writes

- `compare.png`, `compare-b.png`: the showcase (every candidate side by side, a few copies each) filmed twice, a moment apart, so motion differs.
- `compare-stress-<id>.png`: each candidate alone at its stress count, filmed at the end of its timed window.
- `compare.json`: `scenario`, `screenshot`, `screenshot_b`, `set`, `title`, `engine_version`, `rhi_adapter`, the showcase and stress settings, `frame_time_meaning`, `null_rhi`, `perf_meaning`, and `candidates[]`. Each candidate has `id`, `label`, `note`, whatever its `Describe` added (the example adds `components`, and `available` and `asset` for Niagara), and `stress`: `copies`, `frames`, `frame_ms_mean`, `frame_ms_p50`, `frame_ms_p95`, `frame_ms_max`, its screenshot and a `perf` block (next section). `rhi_adapter` is the machine's GPU name: strip it before publishing a receipt.
- `process-stdout.log`, `process-stderr.log`: the game's output, from the runner.

## What the frame times mean

Each frame time is the wall-clock time between game ticks of the whole process: game thread, render thread and GPU together. It is not an isolated cost of the candidate and not a benchmark of your game.

- One run proves little. Repeat it, and trust a difference only when it is larger than the spread between runs.
- Order can bias the numbers. Reverse the candidate order and run again before believing that the second one is cheaper.
- The first time something is used, shaders compile and assets load. The stress warm-up absorbs most of that, not necessarily all; a large `max` on the first candidate is often that.
- A candidate that costs far more per copy than the others (one simulation per instance) should name a smaller `StressCount`. The receipt records what each was timed at; compare rows at equal copies.
- Compare the baseline row with the others: each candidate's cost over the bare stage is what you are after.

## GPU time next to the wall frame time

Each candidate's `stress.perf` holds four series, each with `mean`, `p50`, `p95` and `max` in milliseconds, plus `frames` and `gpu_time_available`:

| Series | Read from |
|---|---|
| `wall_ms` | the time between game ticks, as `frame_ms_*` |
| `game_thread_ms` | `GGameThreadTime` (`Engine/Source/Runtime/RenderCore/Public/RenderTimer.h`, module RenderCore) |
| `render_thread_ms` | `GRenderThreadTime` (same header) |
| `gpu_ms` | `FPlatformTime::ToMilliseconds(RHIGetGPUFrameCycles())`; `RHIGetGPUFrameCycles` is declared in `Engine/Source/Runtime/RHI/Public/DynamicRHI.h` (module RHI), not in `RHI.h` |

Read this way: the three engine values are those of the previous frame, so compare runs, not machines. A frame bound by the game thread reports the CPU's cost in `wall_ms` whatever the GPU does, so a GPU-side comparison read from `wall_ms` alone can be wrong in either direction; `gpu_ms` says what the GPU spent, and the pair says where the frame went. `gpu_time_available` is false when no rendering RHI runs or no GPU sample was non-zero, and the top-level `null_rhi` says which. The thread values are cycle counts converted with `FPlatformTime::ToMilliseconds`; whether `GGameThreadTime` and `GRenderThreadTime` are updated in a headless run is one of the things the first run shows.

The `perf` set checks the block on an engine: `-Set perf` times `perf-baseline`, `perf-gpu-supersample` (`r.ScreenPercentage` 200) and `perf-cpu-spin` (a 4 ms busy-wait). Judge the receipt with `node compare_perf.mjs <output directory>/compare.json`. A rendered run expects the supersample row's `gpu_ms` to rise over the baseline and its `game_thread_ms` not to, and the spin row's `game_thread_ms` to rise and its `gpu_ms` not to; the margins are first guesses in `compare-perf-checks.mjs` (`THRESHOLDS`). `node compare_perf.mjs <receipt> --shape-only` holds any other set's receipt to the shape alone.

Headless: `compare.ps1 -Headless` starts the game with `-nullrhi` and `-AECompareNoShots`, takes no screenshots and skips the PNG checks. The same `compare_perf.mjs` then expects `gpu_ms` to read 0 and the spin row's `wall_ms` to still rise by at least 2 ms. Observed on Unreal Engine 5.8.3, packaged Windows Development build: `gpu_ms` reads 0 and `gpu_time_available` is false; `game_thread_ms` and `render_thread_ms` also read 0 (the engine sets `GGameThreadTime` while it draws a viewport, `UnrealClient.cpp`, and a `-nullrhi` run does not), so they cannot show CPU work there; `wall_ms` still moves, 0.11 ms for the baseline and the supersample rows against 4.22 ms for the spin row. The judge prints the two zero series as an informational `NOTE`, not a check.

## Add your own set

A set lives in its own source file and registers itself, so adding a comparison touches no other file. See `ExampleSets.cpp` for three complete candidates.

```cpp
static AECompare::FSet MakeMine() {
    AECompare::FSet Set; Set.Name = TEXT("mine"); Set.Title = TEXT("MINE: A vs B");
    AECompare::FCandidate A;
    A.Id = TEXT("a"); A.Label = TEXT("A"); A.Note = TEXT("how A works");
    A.Spawn = [](AActor& Owner, const FTransform& Slot, int32 Count) { /* make Count copies, owned by Owner */ };
    A.Tick = [](float DeltaSeconds, double Seconds, const FVector& Camera) { /* per-frame work, if any */ };
    Set.Candidates.Add(A);
    return Set;
}
static AECompare::FRegistrar MineRegistrar(TEXT("mine"), &MakeMine);
```

Run it with `-Set mine`. The pieces:

- `Spawn(Owner, Slot, Count)` makes `Count` copies at the slot. Anything it creates must be owned by `Owner` (the harness destroys it to clear the slot) or removed by the candidate's own `Clear`.
- `Clear()` undoes what `Owner` does not own: an actor of its own, Niagara components. It runs for every candidate each time a phase is cleared. Without it, one candidate's leftovers appear in, and slow, the next one's measurement.
- `Tick(DeltaSeconds, Seconds, Camera)` runs every frame while the candidate is spawned; `Seconds` is the time since the phase began.
- `StressCount` caps the copies for an expensive candidate. `Describe(Json)` adds facts to the receipt; it is read while the candidate is still spawned.
- `GridPoints(Count, Spacing)` lays `Count` copies out on a grid about the origin, wide as it is deep for a 16:9 view.
- `FSet::SlotSpacing`, `LabelHeight`, `FocusHeight`, `DarkHeight` and `ShowcaseCopies` resize the stage for small props or large effects. `FSet::Style` (floor, wall, dark panel, post-process asset paths) left empty gives the engine's basic shape material and a lit stage, as in the example. A game with its own unlit look names its materials there.

## Optional: an authored Niagara candidate

To compare a system you authored (Python through Epic's Niagara toolsets, or in the Niagara editor) rather than an engine template: save it under `/Game/FX`, add `+DirectoriesToAlwaysCook=(Path="/Game/FX")` to `Config/DefaultGame.ini`, and call the same helper with its object path, for example `/Game/FX/NS_Authored.NS_Authored`. See [Niagara in Unreal](../../../skills/unreal-effects/references/unreal-niagara.md) for the authoring routes. Not run from this example.

## Optional: a Niagara Fluids candidate

Not part of the example, because the Niagara Fluids plugin is not enabled by default. To add one:

1. Enable the `NiagaraFluids` plugin in the `.uproject`.
2. Add `+DirectoriesToAlwaysCook=(Path="/NiagaraFluids/Templates/Gas/2D/Systems")` to `Config/DefaultGame.ini` (next to the Niagara line).
3. In `MakeExample()` in `ExampleSets.cpp`, reuse the Niagara helper with the fluid system and cap its copies, because every instance runs its own grid simulation:

   ```cpp
   AECompare::FCandidate Fluid = NiagaraSystemCandidate(TEXT("niagara-fluid-fire"), TEXT("NIAGARA: fluid fire"),
       TEXT("engine template Grid2D_Gas_MovingFire\n2D gas simulation per instance"),
       TEXT("/NiagaraFluids/Templates/Gas/2D/Systems/Grid2D_Gas_MovingFire.Grid2D_Gas_MovingFire"));
   Fluid.StressCount = 16;
   Set.Candidates.Add(Fluid);
   ```

If the plugin or the cook entry is missing, the candidate reports `available: false` and a `problem` in the receipt instead of failing the run. This addition was not run from this example; see the [Niagara facts tested on 5.8.2](../../../skills/unreal-rendering/references/unreal-production-stack.md) for what is known about that system.

## Traps

- A candidate that spawns its own actor or component must remove it in `Clear`.
- `FScreenshotRequest` writes PNGs on another thread; the harness waits before it exits. If you change the exit, keep the wait.
- Read what a candidate says about itself before clearing it.
- `UTextRenderComponent` text faces +X; rotate yaw 180 to face a camera that looks down +X.
- In PowerShell, `"$Map?game=..."` is read as the variable `$Map?game`. Write `"${Map}?game=..."`.
- The default lit stage first rendered wrongly (only the floor lit; wall, labels' background and the fronts of objects black) in a project with dynamic global illumination switched off. The stage now has a Movable key light on the camera's side aimed along the view; the cause was not isolated, so check it in a project with your renderer settings.
- `BasicShapeMaterial` is one-sided and lit; a plane turned the wrong way vanishes. A static mesh left on its own default material (the engine cube) rendered nearly black on this stage, so give your candidates' meshes a material.
- Additive white sprites vanish against a light background. The stage puts a dark panel behind each slot so an effect is seen against both.
