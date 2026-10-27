# Editor Python scene: build a map, materials and meshes from scripts

Helpers and a validating scene for the practices in [Scripting the Unreal editor from Python: maps](../../../skills/unreal-editor-scripting/references/unreal-editor-python-maps.md) and the plane-cut note in [Geometry Scripting](../../../skills/unreal-procedural/references/unreal-geometry-scripting.md). Verified on Unreal Engine 5.8, Windows. Nothing here needs a project of yours: the validator makes a throwaway project in the OS temp folder.

## Run

```text
node examples/unreal/editor_python/ep_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--shots <folder>]
```

It takes a few minutes and is not part of `node scripts/check.mjs`; the pure check logic is tested there (`ep-validate.test.mjs`). The exit code is 0 when every check passes. `--shots` copies the pictures; `--keep` keeps the project and logs.

## Files

| File | Run mode | What it does |
|---|---|---|
| `editor_python_helpers.py` | imported | `soft_set`, `probe`, `run_stages`, `wait_until`, `recreate_map`, `triangle_count`, `look_at_rotation`, `place_above_ground`, `make_instancer`, `allow_instancing` |
| `ep_probe.py` | headless commandlet | map re-creation order, wrong and right property names, `soft_set`, `Vector` rotation, plane cuts and the asset check, the instancing flag without a render |
| `ep_ground_map.py` | headless commandlet | copies the Open World template (it holds a Landscape; Python cannot create one) |
| `ep_stages.py` | rendering editor, `-ExecCmds="py ..."` | one generator run by `run_stages`: sky, fog and a post-process volume through `soft_set`, a noise rock with a plane-cut base, Custom-node materials, instanced boulders, a camera that faces its target, a screenshot and Play-In-Editor wait |
| `ep_flags.py` | headless commandlet | reads the saved instancing flags back in a new process |
| `ep_ground.py` | rendering editor | traces ground height on the Landscape, compares a fixed-Z camera with `place_above_ground`, exports two pictures |
| `ep-validate-checks.mjs`, `ep-validate.test.mjs` | Node | one check per claim; the test changes one fact at a time and expects the matching check to fail |

## What it showed

- Deleting a level that is open returns `False` and keeps the `.umap`; `new_level` then fails with `NewLevel. Failed to validate the destination. An asset already exists at this location.` The working order is: open `/Engine/Maps/Entry`, `delete_asset`, remove the file, `AssetRegistry.scan_paths_synchronous`, `new_level`. `recreate_map` does it.
- Property names fail with `<Class>: Failed to find property 'x' for attribute 'x' on '<Class>'`. `enable_volumetric_fog` and `fog_inscattering_luminance` exist on `ExponentialHeightFogComponent`, not on the fog actor or the post-process volume; post-process values go through the `settings` struct. `soft_set` turns a wrong name into a warning line.
- `Vector` has no `rotation()`; `MathLibrary.make_rot_from_x(direction)` equals `Vector.rotator()` and the camera's forward vector matches the direction.
- A generator that yields once per tick keeps stage code linear. A screenshot file appears two ticks after the call, the Play-In-Editor world one tick after the request. Slate ticks again inside `create_asset` and `recompile_material`, so the runner skips re-entrant ticks.
- A plane cut that misses the mesh on the kept side leaves 0 triangles; `get_num_triangle_i_ds` keeps the old count; the asset call returns `(None, FAILURE)`. A Boolean subtract and a noise-displaced sphere make the same prop.
- A Custom node body takes `#define` macros (about 275 pixel instructions) and rejects a helper function (`function definition is not allowed here`, 0 instructions, default material in game). The instancing flag is `False` on a Python-made material, stays `False` in a commandlet, and is set by a rendering editor that draws instances or by `allow_instancing`.
- On the template Landscape a fixed world Z puts the camera under the ground at 12 of 81 grid points; `place_above_ground` stays 200 cm above it at all 81. The pictures `ep-ground-fixed.png` (sky and a floating target, no terrain) and `ep-ground-traced.png` (terrain and the target over the crest) show the difference; `ep-scene.png` shows the scene from `ep_stages.py`.

## Not verified

The same stages under `-game`; what a cooked game draws when the instancing flag is missing; Landscape traces before the proxies have loaded.
