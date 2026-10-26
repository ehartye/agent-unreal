# World Partition example scenes (Unreal 5.8)

These scenes back the facts in `skills/unreal-procedural/references/unreal-world-partition.md` and its companions `unreal-world-partition-landscape.md` and `unreal-world-partition-commandlets.md`. Each script writes a JSON report; `world-validate-checks.mjs` turns the reports into PASS or FAIL results, and `world-validate.test.mjs` tests that logic with recorded reports (no engine needed, part of `node scripts/check.mjs`).

## Run

```
node world_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--shot overview.png]
```

It builds a throwaway project in the OS temp folder, runs every script below in a hidden editor or commandlet, and prints one result per claim (30 in all). Engine steps add up to about nine minutes once shaders are cached; the first minimap build compiles shaders and took about six minutes more. The exit code is 0 when every claim passes. It is not part of `node scripts/check.mjs`.

## Scripts

| Script | Mode | What it does |
|---|---|---|
| `world_maps.py` | commandlet | Copies the Open World template (partitioned) and a Water sample map (plain) into the project. |
| `world_inspect.py` | commandlet | Reports descriptors, proxy count, components per proxy, quads, proxy size in quads and metres, and what Python reaches for the grid size. |
| `world_newlevel.py` | editor, `-run=pythonscript`, `-ExecutePythonScript` | Calls `LevelEditorSubsystem.new_level`, reports the descriptors it creates, optionally adds cubes; a second run on the same path shows the refusal. |
| `world_place.py`, `world_place_commandlet.py` | editor, commandlet | Places Water, Landmass and PCG actors and reads their partition settings; the commandlet variant shows the Slate assertion. |
| `world_carve.py` | rendering editor | Places a river and reads the carved heights back. |
| `world_minimap.py` | commandlet | Reads the texture of the minimap actor before and after the MiniMap builder. |
| `world_console.py` | editor | Lists the `wp.Runtime.` console commands and reads the variables Python can read. |
| `world_water_props.py` | editor | Reads the Water Zone Local Tessellation setting and each water body's spatial-loading default on a map made by `new_level`. |

The validator also drives the conversion commandlet (`-ReportOnly`, `-GenerateIni`, `-ConversionSuffix`, in place) and the builder commandlets (Resave Actors, Foliage, MiniMap) on a four-cube level made by `new_level`.

## What it showed on 5.8.2

All 30 checks passed (the 17 from release 0.3.0 and 13 new).

- `new_level(path, True)` made a partitioned map in the editor (`-nullrhi -ExecCmds`), in `-run=pythonscript` and in `-ExecutePythonScript`, all exit 0. The blank map has a Data Layers actor and a minimap actor, no Landscape; the Open World template has 138 descriptors. A repeat on the same path returns False (`An asset already exists at this location.`) and the commandlet exits 1.
- A template proxy holds 2 by 2 components of 126 quads, 252 quads or 252 m per side; 64 proxies make 16 by 16 components. Python exposes no Landscape subsystem and no grid size.
- `-ReportOnly` wrote nothing, `-GenerateIni` wrote only the ini, `-ConversionSuffix` wrote `<map>_WP` and kept the source, and without it the map was converted in place.
- The Resave Actors builder saved 6 packages; `-ActorClass` was ignored and `-ActorClassName=StaticMeshActor` saved 4. The Foliage builder changed the grid size from 25600 to 512 and then 1024. The MiniMap builder exited 1 with `-nullrhi` and 0 without it.
- `DumpConsoleCommands wp.Runtime.` listed the commands Epic names; `wp.Runtime.MaxLoadingStreamingCells` is registered, `MaxLoadingLevelStreamingCells` is not.
- The Water Zone Local Tessellation setting defaults to off with a 51200 by 51200 by 10000 extent and survives save and reopen.

## Landscape size rule

`world-validate-checks.mjs` holds the eleven sizes from Epic's Landscape technical guide and checks, without the engine, that quads per component times components per side plus 1 equals the overall vertices, that section vertices are a power of two up to 256, and that the component count stays within 1024.

## Results from release 0.3.0

The first 17 checks showed on 5.8.2:
- The Open World template copy is partitioned: 138 descriptors, one Landscape actor (not spatially loaded, no components) and 64 spatially loaded proxies in an 8 by 8 grid, 2 by 2 components of 126 quads each, edit layers Base Landscape and Flat Middle. The default template and the Water sample map have no descriptors.
- Converting the Water sample map (2 by 2 components of 255 quads) gave one proxy at the default `LandscapeGridSize=4` and four proxies at 1. The commandlet refuses to run without `-AllowCommandletRendering`. Converted water actors: lake and river spatially loaded; zone and brush manager not.
- Python has no function that creates a Landscape (only render-target import and export).
- A river in the commandlet stops the engine (Slate assertion); in the editor it works. The first river adds the Water brush manager and a Water edit layer. `unreal.WaterMeshActor` is the Water Zone class.
- A Landmass manager and brush placed from Python are not attached to the Landscape (`get_landscape()` is None, the brush logs `Accessed None` for `BrushManager`).
- The river carved the flat terrain from 0 to exactly river Z minus depth (-1000) in the partitioned map, read with `render_heightmap` into an 8-bit target.
- A PCG volume set to partitioned adds the PCG World Actor (25,600 cm grid) and four spatially loaded grid actors.
- The overhead image shows the carved trench along the river. The water surface drew only in part in the offscreen capture; the carve is confirmed by the numbers, not by the image.

Not covered: carving of proxies that are not loaded (the editor loads every proxy, and `unload_actors` unloaded none), attaching Landmass brushes from Python, and running a PCG graph on the partitioned Landscape.
