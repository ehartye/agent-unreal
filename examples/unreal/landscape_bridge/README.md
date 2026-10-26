# Landscape from Python through a C++ bridge

Backs [Bridging editor Python to C++](../../../skills/unreal-editor-scripting/references/unreal-python-cpp-bridge.md). Unreal Engine 5.8.2 (the creation checks) and 5.8.3 (the brush, partition and unload probes), Windows, Visual Studio 2022 Build Tools.

Python has no function that creates a Landscape. `ALandscapeProxy::Import` does, but it is C++ only. This example adds a small editor-only module, `LandscapeBridge`, whose `UFUNCTION(BlueprintCallable)` statics Python calls:

| C++ (`ULandscapeBridgeLibrary`) | Python |
|---|---|
| `CreateLandscapeFromHeights(World, HeightsCm, SizeX, SizeY, QuadsPerSection, SectionsPerComponent, Location, Scale, GridSizeInComponents)` | `unreal.LandscapeBridgeLibrary.create_landscape_from_heights(...)` |
| `GetLandscapeHeightAt(Landscape, WorldLocation, float& OutHeight)` | `unreal.LandscapeBridgeLibrary.get_landscape_height_at(landscape, location)` (returns the float, or `None` on a miss) |

## Files

- `module/LandscapeBridge/` is the module: `LandscapeBridge.Build.cs`, `LandscapeBridgeModule.cpp`, `LandscapeBridgeLibrary.h/.cpp`.
- `landscape_bridge.mjs` is the runner. It writes a throwaway code project in the OS temp folder (`../native-build.mjs` writes the descriptor and the two target files), discovers the installed Visual Studio 2022 toolset and Windows SDK, builds the Editor target with `Build.bat`, and starts the editor three times with `bridge_probe.py`.
- `bridge_probe.py` makes a new map with `LevelEditorSubsystem.new_level(path, is_partitioned_world)`, calls the bridge with a 505 by 505 vertex surface (4 by 4 components, 63 quads per section, 2 sections per component, quad size 100 cm), and reads back the component count, the quad size, the component step and the height at seven vertices. It writes a JSON report and quits the editor.
- `landscape-bridge-checks.mjs` judges the reports; `landscape-bridge.test.mjs` tests that logic with no Unreal (it runs in `node scripts/check.mjs`).

## Run

```text
node examples/unreal/landscape_bridge/landscape_bridge.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
```

`--compiler` and `--sdk` override the discovered versions. The build and three editor runs take about three to five minutes. The build is hidden and logs to the project's `Saved/build.log`. The editors start with `-nullrhi`, so nothing is rendered. After changing the module the runner builds again and starts new editors; it does not use Live Coding or hot reload.

## What it checks (19 checks, all passed on 5.8.2)

- The module compiles; `dir(unreal.LandscapeBridgeLibrary)` lists `create_landscape_from_heights` and `get_landscape_height_at`.
- Three maps: not partitioned; World Partition (`new_level(path, True)`) with grid size 0; World Partition with grid size 2.
- In each: the Landscape is created, it has 16 components, quad size 100 by 100 and a component step of 126 quads, and the height at the sampled vertices matches the input within half a height step (0.39 cm at Z scale 100; the worst error seen was 0.379 cm).
- Proxies: 0 streaming proxies in the non-partitioned map and with grid size 0; 4 proxies of 4 components each with grid size 2, saved as 7 external actor files (the 4 proxies plus the Landscape actor, the data layers actor and the minimap actor).

## Brush, partition and unload probes (run on 5.8.3)

The module also holds five brush functions on the same library, and `landscape_world.mjs` runs three probes built on it. They ran on 5.8.3, in a `-nullrhi` editor (16 of 18 checks, 15 observations) and with `--rendering` (18 of 18 checks, 16 observations). The module compiled with the five functions in 36 s. The Landscape came from `LandscapeBridge` (505 by 505 vertices, 4 by 4 components, grid size 2: 4 streaming proxies, quad size 100 cm); both runs held one Landscape actor, four proxies, sixteen components and one default edit layer named "Layer".

| C++ (`ULandscapeBridgeLibrary`) | Python | What it wraps |
|---|---|---|
| `AttachBrushToLayer(Landscape, LayerIndex, Brush)` | `attach_brush_to_layer` | `ALandscape::AddBrushToLayer`, which is C++ only and stops the editor when the brush is already on a layer, so the function checks first and returns false |
| `DetachBrush(Landscape, Brush)` | `detach_brush` | `ALandscape::RemoveBrush` |
| `GetBrushLayerIndex(Landscape, Brush)` | `get_brush_layer_index` | `ALandscape::GetBrushLayer` (-1 for none) |
| `GetBrushCountForLayer(Landscape, LayerIndex)` | `get_brush_count_for_layer` | `ALandscape::GetBrushesForLayer` (-1 for an invalid layer) |
| `GetBrushOwningLandscape(Brush)` | `get_brush_owning_landscape` | `ALandscapeBlueprintBrushBase::GetOwningLandscape` |

```text
node examples/unreal/landscape_bridge/landscape_world.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--only landmass|pcg|unload] [--rendering] [--keep]
```

The runner builds a throwaway project with the module and the Landmass and PCG plugins, then starts one editor per phase and prints one line per check: `PASS` or `FAIL` for an assert, `OBSERVE` for a value that source reading does not decide (never fails the run). Use `--keep` to leave the JSON reports on disk. The build took 36 s in the recorded run. Editors start with `-nullrhi`; `--rendering` starts them with `-RenderOffScreen` instead (a machine with no desktop session needs that flag for any rendering editor) and the landmass phase then waits for the edit layer merge. In the `-nullrhi` run the collision heightfield peak delta was 0 and the height was not judged. In the recorded rendering run the Landmass step took 486 s.

What the runs showed (one throwaway project each time; details and labels in [Landmass](../../../skills/unreal-procedural/references/unreal-landmass.md), [World Partition Landscape](../../../skills/unreal-procedural/references/unreal-world-partition-landscape.md) and [Landscape bridge brushes](../../../skills/unreal-editor-scripting/references/unreal-landscape-bridge-brushes.md)):

| Phase and script | Question | Result on 5.8.3 |
|---|---|---|
| `landmass_probe.py` (row L1) | Is there a Python route that puts a Landmass brush manager on a Landscape edit layer? | Both modes: spawning the manager and a brush, `set_target_landscape` and a write of `detail_panel_landscape` each left the manager on no layer; `attach_brush_to_layer(landscape, 0, manager)` returned True (layer 0 held 1 brush, the brush owner and `get_landscape()` were the Landscape) and `detach_brush` undid it. After the property write `get_landscape()` printed the Landscape while the manager was on no layer. Rendering run, heights: `CustomBrush_Landmass` left the heightmap unchanged (peak delta 0 cm); `LandmassBrush_ProceduralNoise` gave a peak delta of 1569.55 cm after 43 s and the original returned after the detach; no nudge was needed. The `-nullrhi` collision heightfield peak delta was 0 and not judged |
| `pcg_partition_probe.py` (row L2) | Does a PCG graph with a Landscape input and a Surface Sampler produce points across the proxies of a partitioned Landscape in the editor? | Rendering editor: the control gave 1209 points and 1209 instances; the partitioned volume gave 1209 points over 4 cells (289, 303, 302, 315), 0 instances on the volume, points within 0.37 cm (maximum) of the input surface. `-nullrhi` editor: 0 points in the control and in all four cells, with the Landscape data present, in every variant tried (density, `unbounded`, legacy grid creation, a Python-spawned PCG World Actor with `pcg.BuildLandscapeCache` first). The cause is not isolated |
| `wp_unload_probe.py` (row L3) | Does any Python route leave a Landscape proxy unloaded in the editor? | Both modes: after `load_map` of the saved map 0 proxies loaded, 4 descriptors; `unload_actors` of guids `load_actors` had not loaded changed nothing; `load_actors` on the four proxies then `unload_actors`: 4 loaded, then 0. `bDisableLoadingOfLastLoadedRegions` was not exposed to Python |

The pure checks are in `landscape-world-checks.mjs`; `landscape-world.test.mjs` feeds them canned reports (pass, a missing report, an expectation broken) and is part of `node scripts/check.mjs`. The canned reports are what a run that agrees with the source would write, not recorded results.

Not covered by these runs: carving heights through unloaded proxies (if a follow-up is wanted, the Water river carve in `../world/world_carve.py` is the starting point), the Open World template Landscape, Landmass brushes with a spline, Water, PCG on a Landscape in a game process or with runtime generation, and Landmass brushes other than the two classes named above.
