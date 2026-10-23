# Landscape from Python through a C++ bridge

Backs [Bridging editor Python to C++](../../../skills/unreal-features/references/unreal-python-cpp-bridge.md). Unreal Engine 5.8.2, Windows, Visual Studio 2022 Build Tools.

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
