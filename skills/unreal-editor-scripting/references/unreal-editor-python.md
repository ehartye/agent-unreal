# Scripting the Unreal editor from Python: run modes and practices

Written for Unreal 5.8 on Windows. Each statement is backed by a source listed at the end or by a script in [`examples/unreal`](../../../examples/unreal/README.md).

## Pick the run mode

| Mode | Command shape | Use it for |
|---|---|---|
| Commandlet | `UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=x.py -unattended -nullrhi ...` | Assets and levels: create, duplicate, save, place actors, headless |
| Editor, run to completion | `UnrealEditor.exe Project.uproject -ExecutePythonScript=x.py` | One-shot tasks that need the full editor |
| Editor, kept running | `UnrealEditor.exe Project.uproject /Game/Maps/M -ExecCmds="py x.py"` | A ticking world: Play-In-Editor, screenshots, camera tours |
| Game window | the same with `-game -windowed -ResX=1600 -ResY=900` | Watching a result without the editor UI |

- A commandlet does not load levels (Epic): build the level in it, then run the editor to look at it ([`niagara_build.py`](../../../examples/unreal/niagara_build.py), then [`niagara_verify.py`](../../../examples/unreal/niagara_verify.py)).
- `-ExecutePythonScript` shuts the editor down when the script ends. For a script that keeps running, launch with `-ExecCmds="py x.py"`, run the work from a Slate post-tick callback (the stage runner below), wait until the world exists before acting, and start play with `get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_begin_play()`. Epic does not recommend `ExecCmds` for ordinary scripts (it can run before the editor is ready), so wait for the world.
- In a game window use game-side APIs: find the world with `unreal.ObjectIterator(unreal.World)` and `GameplayStatics`; `unreal.EditorLevelLibrary` is the editor's API ([`showcase_run.py`](../../../examples/unreal/niagara-showcase/showcase_run.py), `NIAGARA_SHOWCASE_GAME=1`).

## Practices

- Place what play needs, such as a camera, in the level at build time. At runtime find it with `GameplayStatics.get_all_actors_of_class` and call `set_view_target_with_blend` on the player controller.
- Use keyword arguments for value types: `unreal.Rotator(roll=, pitch=, yaw=)` and `unreal.Color(r=, g=, b=, a=)`. Aim cameras with `MathLibrary.find_look_at_rotation`.
- [tested] `unreal.Box(min, max)` (or `min=`, `max=`) builds a valid box; `is_valid` is not an argument (`Box(min=, max=, is_valid=True)` raises `TypeError`), so set it with `box.set_editor_property("is_valid", ...)`. [documented] `FBox`'s native make function takes only `Min` and `Max` (`NoExportTypes.h`). [`epf_validate.mjs`](../../../examples/unreal/editor_python_friction/README.md).
- Read devices from the tick callback through the player controller: `is_input_key_down(key)`, `get_input_analog_key_state(key)` for sticks and triggers, `get_input_mouse_delta()`, `was_input_key_just_pressed(key)`; hide the cursor with the `show_mouse_cursor` property.
- Build a key from its engine name with `k = unreal.Key(); k.import_text("Gamepad_LeftX")` and check it with `unreal.InputLibrary.key_is_valid(k)`.
- Map devices to one plain input snapshot and run the motion code from scripted snapshots, so it can be tested without hardware ([`showcase_explore.py`](../../../examples/unreal/niagara-showcase/showcase_explore.py), `NIAGARA_SHOWCASE_SELFTEST=1`).
- Wrap a tick callback's body in `try`/`except` and log once. Guard it with a busy flag when it activates Niagara systems (Slate keeps ticking during a compile).
- Measure time-based behaviour against the time the script applied; editor frame rate varies.
- `AutomationLibrary.take_high_res_screenshot(width, height, name)` writes the image a few frames later: hold the camera still for a couple of seconds after the call.
- Label things with a `TextRenderActor` (front faces +X); `draw_debug_string` text is missing from high-resolution screenshots.
- Write output files to absolute paths under the project's `Saved/`, and parse a script before a commandlet run: `python -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" x.py`.
- Use Movable lights in a level with no baked lighting (Epic: light mobility).

## Build a whole map, its materials and meshes

Helpers and [`ep_validate.mjs`](../../../examples/unreal/editor_python/README.md), which runs each [tested] line on 5.8.2.

- [tested] Use `LevelEditorSubsystem` (`new_level`, `load_level`, `save_current_level`) and `UnrealEditorSubsystem.get_editor_world()`; `EditorLevelLibrary` logs a deprecation warning. `new_level` returns `False` and logs why.
- [tested] To re-create a map that is on disk call `recreate_map(path)`. `delete_asset` on the open level returns `False` and keeps the `.umap`; `new_level` then logs `NewLevel. Failed to validate the destination. An asset already exists at this location.` What works: `load_level("/Engine/Maps/Entry")`, `delete_asset`, delete the file (it stays), `AssetRegistry.scan_paths_synchronous([folder], True)`, `new_level`. Never save while that engine map is open: `save_current_level` rewrites the engine's file. A Niagara system left on disk by `delete_asset` needs the same remove-and-rescan ([Niagara toolsets](../../unreal-effects/references/unreal-niagara-toolsets.md#delete-and-recreate-a-system)).
- [tested] A wrong property name raises `<Class>: Failed to find property 'x' for attribute 'x' on '<Class>'`. `enable_volumetric_fog`, `fog_inscattering_luminance` and `fog_density` are on `ExponentialHeightFogComponent`, not the fog actor or a `PostProcessVolume`; post-process values are in `volume.settings` (`bloom_intensity` plus `override_bloom_intensity`; set the struct back). `probe(obj, "fog")` filters `dir()`, which lists script-exposed attributes only: read an `EditAnywhere` name such as `MaterialExpressionCustom.code` from its header. `soft_set(obj, name, value, warnings)` turns a wrong name into a warning line.
- [tested] `unreal.Vector` has no `rotation()`. `MathLibrary.make_rot_from_x(target - start)` (`look_at_rotation`) equals `Vector.rotator()`; the camera it aims has forward dot direction 1.
- [tested] `run_stages(stages)` drives a generator from the post-tick callback: `yield` waits a tick, `yield 5` five, `yield from wait_until(fn)` a condition. A screenshot file appears 2 ticks after `take_high_res_screenshot`, the Play-In-Editor world 1 tick after the request: same-tick reads see neither. Slate ticks again inside `create_asset` and `recompile_material`, so the runner skips re-entrant ticks.
- [tested] `recompile_material` returns with the compile done: `get_statistics(mat).num_pixel_shader_instructions` is above 0 on the same tick; errors are only in the log.
- [tested] Python cannot add a component to a level actor. `make_instancer(path)` builds a Blueprint actor with an `InstancedStaticMeshComponent`; then `set_static_mesh`, `set_material`, `add_instance`.
- [tested] `SystemLibrary.line_trace_single` returns a `HitResult` (`to_dict()`) or `None`. On the Open World template Landscape a trace hit at all 81 grid points once the proxies had loaded. `place_above_ground(world, x, y, 200)` stayed 200 cm up at all; a fixed Z was under the ground at 12.
- Custom HLSL nodes, instancing flag: [unreal-production-stack.md](../../unreal-rendering/references/unreal-production-stack.md). Plane cuts: [unreal-geometry-scripting.md](../../unreal-procedural/references/unreal-geometry-scripting.md).
- Not verified: the runner under `-game`; a cooked game without the instancing flag.

## Run the editor from an agent on Windows

- Start headless runs with `Start-Process -FilePath ... -ArgumentList ... -PassThru -WindowStyle Hidden`, then `WaitForExit(milliseconds)` on the returned process.
- Quote each argument that has a space: `-ExecCmds="py C:/path/x.py"` ([Start-Process](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process)).
- `UnrealEditor-Cmd.exe` takes a project and a command; run it with both.
- After a timed run, stop editors whose command line names your project (`Get-CimInstance Win32_Process` filtered on the `.uproject`) and no others.
- Check a window with the engine's own screenshot, not a full-screen capture.

## Sources

- Epic: [Scripting the Unreal Editor using Python](https://dev.epicgames.com/documentation/unreal-engine/scripting-the-unreal-editor-using-python) (commandlet, `-ExecutePythonScript`, `ExecCmds`, the `unreal` module, `EditorAssetLibrary`).
- Epic: [Command-line arguments](https://dev.epicgames.com/documentation/en-us/unreal-engine/command-line-arguments-in-unreal-engine).
- Epic: [PlayerController Python API](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/PlayerController) (input reads, `show_mouse_cursor`).
- Epic: [Movable light mobility](https://dev.epicgames.com/documentation/unreal-engine/movable-light-mobility-in-unreal-engine) and [light types and their mobility](https://dev.epicgames.com/documentation/unreal-engine/light-types-and-their-mobility-in-unreal-engine).
