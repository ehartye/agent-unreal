# Scripting the Unreal editor from Python: run modes and practices

Unreal 5.8, Windows. Each statement is backed by a source below or a script in [`examples/unreal`](../../../examples/unreal/README.md).

## Pick the run mode

| Mode | Command shape | Use it for |
|---|---|---|
| Commandlet | `UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=x.py -unattended -nullrhi ...` | Assets and levels: create, duplicate, save, place actors |
| Editor, run to completion | `UnrealEditor.exe Project.uproject -ExecutePythonScript=x.py` | One-shot tasks needing the full editor |
| Editor, kept running | `UnrealEditor.exe Project.uproject /Game/Maps/M -ExecCmds="py x.py"` | A ticking world: play, screenshots, camera tours |
| Game window | the same with `-game -windowed -ResX=1600 -ResY=900` | Watching a result without the editor UI |

- A commandlet does not load levels (Epic): build the level there, then run the editor to look at it ([`niagara_build.py`](../../../examples/unreal/niagara_build.py), then [`niagara_verify.py`](../../../examples/unreal/niagara_verify.py)).
- `-ExecutePythonScript` shuts the editor down when the script ends. A script that keeps running needs `-ExecCmds="py x.py"` (Epic: not for ordinary scripts, it can run before the editor is ready); run the work from a Slate post-tick callback, wait for the world, and start play with `get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_begin_play()`.
- In a game window use game-side APIs: find the world with `unreal.ObjectIterator(unreal.World)` and `GameplayStatics`, not the editor's `EditorLevelLibrary` ([`showcase_run.py`](../../../examples/unreal/niagara-showcase/showcase_run.py), `NIAGARA_SHOWCASE_GAME=1`).

## Practices

- Place what play needs (a camera) in the level at build time; at runtime find it with `GameplayStatics.get_all_actors_of_class` then `set_view_target_with_blend` on the player controller.
- Use keyword arguments for value types: `unreal.Rotator(roll=, pitch=, yaw=)`, `unreal.Color(r=, g=, b=, a=)`. Aim cameras with `MathLibrary.find_look_at_rotation`.
- [tested] `unreal.Box(min, max)` (or `min=`, `max=`) builds a valid box; `Box(min=, max=, is_valid=True)` raises `TypeError`, so use `box.set_editor_property("is_valid", ...)`. [documented] `FBox`'s native make takes only `Min` and `Max` (`NoExportTypes.h`). [`epf_validate.mjs`](../../../examples/unreal/editor_python_friction/README.md).
- Read devices in the tick callback through the player controller: `is_input_key_down(key)`, `get_input_analog_key_state(key)` (sticks, triggers), `get_input_mouse_delta()`, `was_input_key_just_pressed(key)`; hide the cursor with `show_mouse_cursor`.
- Build a key from its engine name, `k = unreal.Key(); k.import_text("Gamepad_LeftX")`, and check `unreal.InputLibrary.key_is_valid(k)`.
- Map devices to one plain input snapshot and drive motion code from scripted snapshots; tests need no hardware ([`showcase_explore.py`](../../../examples/unreal/niagara-showcase/showcase_explore.py), `NIAGARA_SHOWCASE_SELFTEST=1`).
- Wrap a tick callback's body in `try`/`except` and log once; add a busy flag when it activates Niagara systems (Slate ticks during a compile).
- Measure time-based behaviour against the time the script applied; editor frame rate varies.
- `AutomationLibrary.take_high_res_screenshot(width, height, name)` writes the image a few frames later: hold the camera still for 2 seconds.
- Label things with a `TextRenderActor` (faces +X); `draw_debug_string` text is absent from high-resolution screenshots.
- Write output files to absolute paths under the project's `Saved/`; parse a script before a commandlet run: `python -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" x.py`.
- Use Movable lights where no lighting is baked (Epic: light mobility).

## Build a whole map, its materials and meshes

Helpers and [`ep_validate.mjs`](../../../examples/unreal/editor_python/README.md), which runs each [tested] line.

- [tested] Use `LevelEditorSubsystem` (`new_level`, `load_level`, `save_current_level`) and `UnrealEditorSubsystem.get_editor_world()`; `EditorLevelLibrary` logs a deprecation. `new_level` returns `False` and logs why.
- [tested] To re-create a map on disk call `recreate_map(path)`. `delete_asset` on the open level returns `False` and keeps the `.umap`; `new_level` then logs `NewLevel. Failed to validate the destination. An asset already exists at this location.` What works: `load_level("/Engine/Maps/Entry")`, `delete_asset`, delete the file that stays, `AssetRegistry.scan_paths_synchronous([folder], True)`, `new_level`. Never save while that engine map is open: `save_current_level` rewrites the engine's file. A Niagara system on disk needs the same ([Niagara toolsets](../../unreal-effects/references/unreal-niagara-toolsets.md#delete-and-recreate-a-system)).
- [tested] A wrong property name raises `<Class>: Failed to find property 'x' for attribute 'x' on '<Class>'`. `enable_volumetric_fog`, `fog_inscattering_luminance`, `fog_density` are on `ExponentialHeightFogComponent`, not the fog actor or a `PostProcessVolume`; post-process values are in `volume.settings` (`bloom_intensity` and `override_bloom_intensity`; set the struct back). `probe(obj, "fog")` filters `dir()`, which lists script-exposed attributes only; read an `EditAnywhere` name such as `MaterialExpressionCustom.code` from its header. `soft_set(obj, name, value, warnings)` warns on a wrong name.
- [tested] `unreal.Vector` has no `rotation()`; `MathLibrary.make_rot_from_x(target - start)` (`look_at_rotation`) equals `Vector.rotator()`; the aimed camera's forward dot direction is 1.
- [tested] `run_stages(stages)` drives a generator from the post-tick callback: `yield` waits a tick, `yield 5` five, `yield from wait_until(fn)` a condition. A screenshot file appears 2 ticks after `take_high_res_screenshot` and the Play-In-Editor world 1 tick after the request; same-tick reads see neither. Slate ticks inside `create_asset` and `recompile_material`, so the runner skips re-entrant ticks.
- [tested] `recompile_material` returns with the compile done (`get_statistics(mat).num_pixel_shader_instructions` is above 0 that tick); errors are only in the log.
- [tested] Python cannot add a component to a level actor; `make_instancer(path)` builds a Blueprint actor with an `InstancedStaticMeshComponent`; then `set_static_mesh`, `set_material`, `add_instance`.
- [tested] `SystemLibrary.line_trace_single` returns a `HitResult` (`to_dict()`) or `None`. On the Open World template Landscape it hit at all 81 grid points once the proxies loaded; `place_above_ground(world, x, y, 200)` stayed 200 cm up at all, a fixed Z was under the ground at 12.
- Custom HLSL nodes, instancing flag: [production stack](../../unreal-rendering/references/unreal-production-stack.md). Plane cuts: [geometry scripting](../../unreal-procedural/references/unreal-geometry-scripting.md).
- Not verified: the runner under `-game`; a cooked game without the instancing flag.

## Read back what was saved

[tested] Each [`editor_probes`](../../../examples/unreal/editor_probes/README.md) script writes a JSON report keyed by name; absent entries say `missing` or `unavailable`.

- Before calling an unfamiliar function: `doc_probe.py` prints its docstring, which starts with the signature (parameter names, defaults); a class docstring has none.
- After any Niagara authoring: `inspect_system.py` reads the saved system, emitters and named modules' input values.
- After any import or material build: `asset_probe.py` reads a mesh's slots, bounds and Nanite flag, a material's blend mode, shading model and flags, an instance's parent and scalars.

## Run the editor from an agent on Windows

- Start headless runs with `Start-Process -FilePath ... -ArgumentList ... -PassThru -WindowStyle Hidden`, then `WaitForExit(ms)`.
- Quote each argument that has a space: `-ExecCmds="py C:/path/x.py"` ([Start-Process](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process)).
- `UnrealEditor-Cmd.exe` needs a project and a command.
- After a timed run, stop only editors whose command line names your project (`Get-CimInstance Win32_Process` filtered by `.uproject`).
- Check a window with the engine's screenshot, not a full-screen capture.

## Sources

- Epic: [Scripting the Unreal Editor using Python](https://dev.epicgames.com/documentation/unreal-engine/scripting-the-unreal-editor-using-python).
- Epic: [Command-line arguments](https://dev.epicgames.com/documentation/en-us/unreal-engine/command-line-arguments-in-unreal-engine).
- Epic: [PlayerController Python API](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/PlayerController).
- Epic: [Movable light mobility](https://dev.epicgames.com/documentation/unreal-engine/movable-light-mobility-in-unreal-engine), [light types and mobility](https://dev.epicgames.com/documentation/unreal-engine/light-types-and-their-mobility-in-unreal-engine).
