# Landscape from Python through a C++ bridge

Backs [Bridging editor Python to C++](../../../skills/unreal-editor-scripting/references/unreal-python-cpp-bridge.md). Unreal Engine 5.8.2, Windows, Visual Studio 2022 Build Tools.

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

## Brush, partition and unload probes (prepared, not yet run on an engine)

The module also holds five brush functions on the same library, and `landscape_world.mjs` runs three probes built on it. Nothing in this section has run on an engine: the expectations were written from the install's sources, and the first run is expected to need fixes. The new functions have not been compiled; if `Build.bat` fails, the original `landscape_bridge.mjs` checks fail with it until the new code is fixed.

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

The runner builds a throwaway project with the module and the Landmass and PCG plugins, then starts one editor per phase and prints one line per check: `PASS` or `FAIL` for an assert, `OBSERVE` for a value that source reading does not decide (never fails the run). Use `--keep` for the first run so the JSON reports stay on disk. Build 40 s to 5 min; editors start with `-nullrhi` and each run takes 1 to 4 min. `--rendering` starts them with `-RenderOffScreen` instead (a machine with no desktop session needs that flag for any rendering editor) and the landmass phase then waits for the edit layer merge; the first merge compiles the brush materials, so allow 10 to 20 minutes. Heights need a rendering editor because the merge draws on the GPU.

| Phase and script | Question | Asserted from source | Observed only |
|---|---|---|---|
| `landmass_probe.py` (row L1) | Is there a Python route that puts a Landmass brush manager on a Landscape edit layer? | Rungs on a Landscape from the bridge (one default edit layer): spawning the brush leaves the manager unattached (negative control); `set_target_landscape` and a write of `detail_panel_landscape` do not attach (`ALandmassManagerBase::SetTargetLandscape` has no `AddBrushToLayer` call); `attach_brush_to_layer(landscape, 0, manager)` does: layer index 0, one brush on the layer, `get_landscape()` equals the brush owner; `detach_brush` undoes it | Whether the heights change (a brush Blueprint's defaults decide, and it needs `--rendering`), the nudge that made them change, whether `get_landscape()` mirrors the property write, the second brush class (`LandmassBrush_ProceduralNoise`, tried only after a rendering run saw no change) |
| `pcg_partition_probe.py` (row L2) | Does a PCG graph with a Landscape input and a Surface Sampler produce points across the proxies of a partitioned Landscape in the editor? | A grid size 2 map with four loaded proxies; a non-partitioned control volume completes with points; the partitioned volume reads back as partitioned, adds at least two grid actors and produces points in at least two of them | Counts per grid actor, partitioned total against the control, the Landscape data each cell received (count and the Landscapes it lists), instances on the grid actors against the volume, point height against the input surface, the completion event of the original component |
| `wp_unload_probe.py` (row L3) | Does any Python route leave a Landscape proxy unloaded in the editor? | Four proxy descriptors; `unload_actors` on guids that `load_actors` never loaded changes nothing (`WorldPartitionBlueprintLibrary.cpp` removes only from its own list) | Proxies loaded after `load_map`; after `load_actors` then `unload_actors`; after setting `disable_loading_of_last_loaded_regions` and reopening; whether any step left a proxy unloaded |

The pure checks are in `landscape-world-checks.mjs`; `landscape-world.test.mjs` feeds them canned reports (pass, a missing report, an expectation broken) and is part of `node scripts/check.mjs`. The canned reports are what a run that agrees with the source would write, not recorded results.

Not covered: carving of a proxy that is genuinely unloaded (the unload phase only finds out whether Python can make one; if a step does, the Water river carve in `../world/world_carve.py` is the follow-up), PCG on a Landscape in a game process or with runtime generation, and Landmass brushes other than the two classes named above.
