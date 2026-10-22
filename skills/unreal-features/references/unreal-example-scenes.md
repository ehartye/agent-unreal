# Example scenes that verify the stylized and large-world guidance

Each scene builds a throwaway project in the OS temp folder, runs scripts on an installed Unreal 5.8, measures what it produced and prints PASS or FAIL per claim. They are manual runs, not part of `node scripts/check.mjs`, which runs only the pure check logic. Run them on a machine with Unreal 5.8 installed; the commands pass the engine folder. A line in a reference marked [tested] is one of these checks.

## Stylized looks (ink, cel, toon)

[`examples/unreal/stylized/`](../../../examples/unreal/stylized/stylized_validate.mjs) backs the Drawn, ink and cel looks section of [Niagara](unreal-niagara.md) and the Substrate Toon bullets of [Substrate](unreal-substrate.md). It builds one probe level with six stations (each has its own camera and a backdrop wall) from a throwaway project and measures engine screenshots; no external art.

```text
node examples/unreal/stylized/stylized_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--shots <folder>]
```

It makes a project in the OS temp folder with `r.Substrate=True` and the Blendable GBuffer, plus a bare project, and runs five scripts: `stylized_cvar.py` (what a bare project gets), `stylized_build.py` (commandlet: procedural 4x4 ink-blob flipbook PNG, Toon Profile, Toon and unlit materials, six Niagara systems authored through the toolsets, the level), `stylized_render.py` (offscreen Play-In-Editor, one engine screenshot per look, a simulation-cache read of `SubImageIndex`, compile states) and `stylized_persist.py` twice (write, then read in a new process). About 2.5 minutes on 5.8.2; exit code 0 when all 17 checks pass. Pass `--shots` to copy nine screenshots out. The run is manual; `node scripts/check.mjs` runs only the pure part: `png-tools.mjs` (a small PNG reader, luminance bands, colour counts), `stylized-measure.mjs`, `stylized-validate-checks.mjs` and `stylized-validate.test.mjs`.

Stations and what they showed on 5.8.2:

| Station | Check | Measured |
|---|---|---|
| `meshes`: Toon sphere beside a plain lit sphere | flat bands vs gradient | Toon 2 flat bands (53% of its pixels), plain 0 |
| `toon_masked`, `toon_translucent`: Toon BSDF on a sprite | lit and stepped, same silhouette | 3 and 2 flat bands; both 164,144 sprite pixels; no log errors |
| `drawn`: age-driven flipbook | frames advance | 5 to 7 distinct drawn areas in 8 shots (it varies with capture timing); `SubImageIndex` rose 0.27 to 16.0 in 120 steps (16 distinct frames) |
| `frame_2`, `frame_9`, `frame_13`: SubUV Direct Index | the chosen cell shows | on-screen fill area / cell area spread 0.001 across the three |
| `frame_9` bright and dark | sprite ignores light | same 38,201 pixels and centre colour with sun 10 and a light backdrop vs sun 0 and a dark one |
| `stepped`, `smooth`: floor-quantized ramp | flat bands | 3 bands (Dynamic Material Parameter 3; material default 4) vs 16 luminance levels |

Other results: all six systems compile `UpToDate`; a bare project has `r.Substrate=0` and the Adaptive GBuffer; the Python name `toon_profile_override` does not exist, and a `Set <instance name> ToonProfileOverride` override survived a save and a new editor process (`GetAll` with `-LogCmds="global Log"`). Not run: Toon on the Adaptive GBuffer, linking Direct Frame Index to a user parameter (the frame stayed age-driven), frame cost.

## World Partition landscape with water and PCG 

One scene ([`examples/unreal/world/`](../../../examples/unreal/world/world_validate.mjs)) builds a large landscape with a river in a World Partition map and checks the guidance in [Landmass](unreal-landmass.md) and [Water](unreal-water.md). It makes a throwaway project in the OS temp folder (Python, Landmass, Water, PCG) and runs the scripts below. It needs Unreal 5.8 and takes about four minutes (no GPU needed for the commandlets; the last step renders offscreen).

```
node examples/unreal/world/world_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--shot overview.png]
```

Exit code 0 means all 17 checks passed. The judging logic is `world-validate-checks.mjs`, tested without Unreal by `world-validate.test.mjs` (part of `node scripts/check.mjs`).

| Script | Runs in | Does |
|---|---|---|
| `world_maps.py` | commandlet | loads the engine Open World template and a Water sample map, Save As into the project |
| `WorldPartitionConvertCommandlet` | commandlet | converts the sample map (not partitioned) into a partitioned map; run again with `LandscapeGridSize=1` in its `.ini` |
| `world_inspect.py` | commandlet | reports descriptors, Landscape actor, proxies, components, edit layers, runtime grids and Data Layers of a map |
| `world_place_commandlet.py` | commandlet | places a Water Zone, then a River; the River spawn stops the process (expected) |
| `world_place.py` | editor `-nullrhi` | places Zone, River, a River moved to a runtime grid and a Data Layer, Landmass manager and brush, a partitioned PCG volume; saves, reopens, reads descriptors |
| `world_carve.py` | editor `-RenderOffScreen` | reads heights along the river path, places the river, reads again, captures an overhead image |

What it showed on Unreal 5.8.2:
- The Open World template copy is partitioned: 138 descriptors, one Landscape actor (not spatially loaded, no components) and 64 spatially loaded proxies in an 8 by 8 grid, 2 by 2 components of 126 quads each, edit layers Base Landscape and Flat Middle. The default template and the Water sample map have no descriptors.
- Converting the Water sample map (2 by 2 components of 255 quads) gave one proxy at the default `LandscapeGridSize=4` and four proxies at 1. The commandlet refuses to run without `-AllowCommandletRendering`. Converted water actors: lake and river spatially loaded; zone and brush manager not.
- Python has no function that creates a Landscape (only render-target import and export).
- A river in the commandlet stops the engine (Slate assertion); in the editor it works. The first river adds the Water brush manager and a Water edit layer. `unreal.WaterMeshActor` is the Water Zone class.
- A Landmass manager and brush placed from Python are not attached to the Landscape (`get_landscape()` is None, the brush logs `Accessed None` for `BrushManager`).
- The river carved the flat terrain from 0 to exactly river Z minus depth (-1000) in the partitioned map, read with `render_heightmap` into an 8-bit target.
- A PCG volume set to partitioned adds the PCG World Actor (25,600 cm grid) and four spatially loaded grid actors.
- The overhead image shows the carved trench along the river. The water surface drew only in part in the offscreen capture; the carve is confirmed by the numbers, not by the image.

Not covered: carving of proxies that are not loaded (the editor loads every proxy, and `unload_actors` unloaded none), attaching Landmass brushes from Python, and running a PCG graph on the partitioned Landscape.
