# Example scenes that verify the guidance

Each scene builds a throwaway project in the OS temp folder, runs scripts on an installed Unreal 5.8, measures what it produced and prints PASS or FAIL per claim. They are manual runs, not part of `node scripts/check.mjs`, which runs only the pure check logic. The commands pass the engine folder. A line in a reference marked [tested] is one of these checks. Each folder has a README with the full results.

## Stylized looks (ink, cel, toon) (`examples/unreal/stylized/`)

Backs the Drawn, ink and cel looks section of [Niagara](unreal-niagara.md) and the Substrate Toon bullets of [Substrate](unreal-substrate.md).

```text
node examples/unreal/stylized/stylized_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--shots <folder>]
```

It builds a project with `r.Substrate=True` and the Blendable GBuffer plus a bare project, and prints 17 checks in about 2.5 minutes. Result on 5.8.2: 17 of 17 pass. A Toon sphere draws 2 flat bands against 0 for a plain lit sphere; Toon on a masked and a translucent sprite draws 3 and 2 flat bands with one silhouette; a self-emissive flipbook sprite gives identical pixels under a bright and a dark backdrop; a floor-quantized ramp draws 3 flat bands against 16 luminance levels. A Toon Profile override set with the console `Set` command survived an editor restart. The [folder README](../../../examples/unreal/stylized/README.md) lists every station.

## World Partition automation (`examples/unreal/world/`)

Scenes that back [World Partition](unreal-world-partition.md): the Open World template and a Water sample map, plus a four-cube level made with `LevelEditorSubsystem.new_level`, converted and rebuilt by commandlet, and read back by JSON report.

```
node examples/unreal/world/world_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep]
```

It builds a throwaway project in the OS temp folder, runs hidden editors and commandlets, and prints PASS or FAIL for 30 claims (the 17 from 0.3.0 and 13 new). The Landscape size rule is a pure Node check that runs in `node scripts/check.mjs`.

Checks: `new_level(path, True)` in the editor, `-run=pythonscript` and `-ExecutePythonScript`; the blank map against the template; the proxy unit (2 by 2 components of 126 quads, 252 m); the conversion flags `-ReportOnly`, `-GenerateIni`, `-ConversionSuffix`; the Resave Actors, Foliage and MiniMap builders; the `wp.Runtime.` console commands; Water Zone Local Tessellation; every size in Epic's Landscape table.

Headline (5.8.2): all 30 pass. A partitioned `new_level` works in all three modes and holds only a Data Layers and a minimap actor. The grid size counts components per proxy side, the opposite of Epic's import-page wording. `-ActorClass` is ignored (use `-ActorClassName`), `MaxLoadingLevelStreamingCells` is not registered (the name is `MaxLoadingStreamingCells`), and the MiniMap builder exits 1 under `-nullrhi`.

## PCG in a game process (`examples/unreal/pcg_game/`)

A small engine Landscape map gets two PCG volumes and five variants of the PCG World Actor and its Landscape cache. The scripts generate in the editor and in a game process (the editor binary with `-game`), run an experiment harness (graph variants generated on a test volume, instances counted) and check every claim in [PCG in a running game](unreal-pcg-game-process.md).

```
node examples/unreal/pcg_game/pcg_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--shot <png>]
```

About ten minutes, GPU needed for the offscreen runs; `pcg-validate.test.mjs` runs in `node scripts/check.mjs`. See the [folder README](../../../examples/unreal/pcg_game/README.md).

It checks: the two Landscape cache error texts and the fix (`ALWAYS_SERIALIZE`, then `pcg.BuildLandscapeCache`); the material flag on instanced meshes; the Static Mesh Spawner Python limits; Spatial Noise scale, Attribute Noise mode and the Edge Mask chain; asynchronous generation.

Result on 5.8.2: with the cache serialized the game process spawns instances; without it nothing spawns and the log names the cause. The cache build adds 12.6 MB to the map. Unflagged materials draw as the default material in the game process. A 40 m volume empties an Edge Mask chain because the default blend distance is 100 m. A save in the same tick as `generate()` holds no instances.

## Editor Python scene (`examples/unreal/editor_python/`)

`examples/unreal/editor_python/` has helpers (`soft_set`, a generator stage runner, `recreate_map`, `place_above_ground`, `allow_instancing`) and a validating scene. `ep_probe.py` runs headless; `ep_stages.py` and `ep_ground.py` run in a rendering editor (`-ExecCmds="py ..."`). Reference: [Editor Python](unreal-editor-python.md).

```text
node examples/unreal/editor_python/ep_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--shots <folder>]
```

It builds a throwaway project, copies the Open World template (the Landscape source), and checks 21 claims. Result on 5.8.2: 21 of 21 pass in about two minutes of engine time.

- `delete_asset` on the open level keeps the `.umap`, so `new_level` fails; open `/Engine/Maps/Entry`, delete, remove the file, rescan, create.
- Wrong property names raise `Failed to find property`; `soft_set` logs a warning instead. `Vector` has no `rotation()`; use `make_rot_from_x`.
- A screenshot file appears 2 ticks after the call; the stage runner skips re-entrant ticks.
- A plane cut that misses the mesh leaves 0 triangles and asset creation returns `FAILURE`; count triangles first.
- A Custom node takes `#define` macros, not helper functions; the instancing flag is `False` until set or drawn.
- A fixed camera Z was under the Landscape at 12 of 81 points; `place_above_ground` was 200 cm up at all 81.

## C++ bridge and automation test (`landscape_bridge/`, `automation_test/`)

Two throwaway code projects, built with Unreal Build Tool (compiler and SDK discovered, not hard-coded), then run headless on 5.8.2.

- `node examples/unreal/landscape_bridge/landscape_bridge.mjs --engine <UE_5.8 folder>`: an editor-only module exposes `ALandscapeProxy::Import` as `unreal.LandscapeBridgeLibrary.create_landscape_from_heights`. A 505 by 505 height array becomes a Landscape of 16 components (quad size 100); sampled heights match the input within half a height step (worst 0.379 cm). Same result in a non-partitioned map and in a `new_level(path, True)` World Partition map: grid size 0 keeps all 16 components on the Landscape actor, grid size 2 makes 4 streaming proxies. 19 of 19 checks. Reference: [Python to C++ bridge](unreal-python-cpp-bridge.md).
- `node examples/unreal/automation_test/automation_test.mjs --engine <UE_5.8 folder>`: a passing and a deliberately failing `IMPLEMENT_SIMPLE_AUTOMATION_TEST` (`EditorContext | ProductFilter`), run with `-ExecCmds="Automation RunTests <filter>; Quit"`. The failing test is reported as `failed: 1`, state `Fail`, with message and line; exit codes are 255 with `; Quit` and 0 with `-TestExit`, so `automation_report.mjs` decides from `index.json`. 9 of 9 checks. Reference: [Automation tests](../../unreal-native/references/unreal-native-automation-tests.md).

Both folders have a README and a pure Node test that runs in `node scripts/check.mjs`; the engine runs take three to five minutes each.

## Content and tooling scenes (`niagara_toolsets/`, `editor_python_friction/`, `constructor_locks/`, `anim_bridge/`, `contention/`)

Throwaway projects on 5.8.2; each folder has a README with the command and every check. Pure checks run in `node scripts/check.mjs`; the engine runs are manual.

- [`niagara_toolsets`](../../../examples/unreal/niagara_toolsets/README.md) (14 checks): create a system, edit an input, set the material, delete and recreate. Backs [Niagara toolsets](unreal-niagara-toolsets.md).
- [`editor_python_friction`](../../../examples/unreal/editor_python_friction/README.md) (8): `unreal.Box` construction and the benign Interchange alpha-mode log line.
- [`constructor_locks`](../../../examples/unreal/constructor_locks/README.md) (11): constructor-loaded asset files are locked while the editor is open. Backs [Content pipeline](../../unreal-native/references/unreal-native-content-pipeline.md).
- [`anim_bridge`](../../../examples/unreal/anim_bridge/README.md) (22): slot-only Animation Blueprints from Python and C++; states, transitions and blend-space resampling need C++. Backs [Animation Blueprints](unreal-animation-blueprints.md).
- [`contention`](../../../examples/unreal/contention/README.md): a helper that stamps other-editor count and free memory into a receipt. Backs [profiling facts](../../unreal-native/references/unreal-native-profiling-facts.md).
