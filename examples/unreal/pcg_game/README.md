# PCG in a game process (Unreal 5.8)

A test scene and an experiment harness behind [PCG in a running game](../../../skills/unreal-features/references/unreal-pcg-game-process.md). It copies a small engine Landscape map into a throwaway project, builds maps that differ only in the PCG World Actor and its Landscape cache, generates PCG in the editor and in a game process (the editor binary with `-game`), and checks every claim in that reference.

## Run it

```
node examples/unreal/pcg_game/pcg_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--shot <png path>]
```

It makes the project in the OS temp folder, runs the editor many times (about ten minutes, and a GPU for the offscreen runs), prints PASS or FAIL per claim with the measured values, and exits 0 when all pass. `--keep` leaves the project and its logs; `--shot` copies the game-process screenshot. `node --test examples/unreal/pcg_game/pcg-validate.test.mjs` tests the check logic without Unreal and is part of `node scripts/check.mjs`.

## What each script does

| Script | Mode | Role |
|---|---|---|
| `pcg_maps.py` | commandlet | Copies the Water sample map `Fluidsim_Terrain` (one 510 m Landscape) to `/Game/Maps/PcgBase`. Python cannot create a Landscape, so a map that has one is the start. `PCG_SOURCE_MAP=/Engine/Maps/Templates/OpenWorld` uses the World Partition template instead. |
| `pcg_build.py` | editor, `-nullrhi` | Builds two materials (unlit, with and without `used_with_instanced_static_meshes`), two graphs and five maps: no PCG World Actor, a Python-spawned one, the editor-created one with the default cache mode, `ALWAYS_SERIALIZE` without a build, and `ALWAYS_SERIALIZE` with `pcg.BuildLandscapeCache`. Each map has two on-demand PCG volumes and a camera. |
| `pcg_game_run.py` | game process | Generates every volume, waits for the generated event, counts instances, reads the world actor and the material flags, and writes an engine screenshot with `HighResShot`. |
| `pcg_experiments.py` | editor, `-nullrhi` | The harness: builds graph variants after Get Landscape Data, generates each on a volume, and records point count, density spread and ISM instance count. Covers the mesh selector, noise scale, contrast, tiling, Attribute Noise modes, the Edge Mask chain and the console variable defaults. |
| `pcg_async.py` | editor, `-nullrhi` | `generate()` then save in the same tick against waiting for the generated event; also run under `-ExecutePythonScript`, where no tick callback runs. |
| `pcg_flag_editor.py` | editor, offscreen | Shows that the rendering editor sets the material flag itself on first use. |
| `pcg_common.py` | shared | Report writer, generator stage runner, soft property setter, graph variant builder, volume spawner, instance counter, point reader. |

## What it showed on 5.8.2

- Without a PCG World Actor the game process logs the "unable to access the landscape cache" error and spawns nothing. With one and the default cache mode it logs the "not set to be serialized" error and spawns nothing. With `ALWAYS_SERIALIZE` both volumes spawn (17 instances each). With the mode alone the editor-binary game process generated too; the cache build adds 12.6 MB to the map (1.2 MB to 13.8 MB).
- Cubes whose material lacks the instanced-meshes flag render with the default material in the game process (a red material on one side, grey cubes on the other); the rendering editor sets the flag itself.
- Spatial Noise: one noise cell is 100 m divided by the transform scale; 5e-5 gives one value. Perlin values sit in 0.29 to 0.64 (10th to 90th percentile) until contrast is applied. Attribute Noise defaults to `Set`: 1,140 of 2,401 points survive a 0.5 filter with `Set`, 155 with `Multiply`.
- Edge Mask, Attribute Noise `MULTIPLY`, Density Filter spawns instances on a Landscape-wide volume and none on a 40 m volume, because the default blend distance is 100 m; the filter alone after the Edge Mask is empty there too. Blend distance 0.1 or transform scale 10 fixes it.
- Saving in the same tick as `generate()` saves a map with no instances; saving after the generated event saves them.
- In the editor, `pcg.BuildLandscapeCache` after a Python-spawned PCG World Actor leaves two actors in the world; the maps use the actor an editor generation creates. The console variable defaults on 5.8.2 are `pcg.FrameTime` 5.0 ms and `pcg.EditorFrameTime` 15.0 ms, not the 16.667 and 50 ms on Epic's generation-modes page.

## Run one script by hand

In Git Bash set `MSYS_NO_PATHCONV=1` so `/Game/...` is not rewritten. Editor scripts that keep ticking use `-ExecCmds="py <absolute path>"`, not `-ExecutePythonScript`, and every script reads its output path from `PCG_REPORT`:

```
UnrealEditor.exe Project.uproject /Game/Maps/PcgBase -nullrhi -ExecCmds="py <path>/pcg_experiments.py" -unattended -nosplash -nosound -notraceserver
UnrealEditor.exe Project.uproject /Game/Maps/PcgCacheOn -game -windowed -ResX=1280 -ResY=720 -RenderOffScreen -ExecCmds="py <path>/pcg_game_run.py" -unattended -nosplash -nosound -notraceserver
```

Start editors detached from any console window and stop only the processes whose command line names your project.
