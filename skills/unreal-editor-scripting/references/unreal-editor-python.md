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

Recreating a map, property-name errors, the stage runner and ground traces: [Editor Python: maps, materials and meshes](unreal-editor-python-maps.md).

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
