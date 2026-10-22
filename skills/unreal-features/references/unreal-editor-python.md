# Scripting the Unreal editor from Python: run modes and practices

Written for Unreal 5.8 on Windows. Each statement is backed by a source listed at the end or by a script in [`examples/unreal`](../../../examples/unreal/README.md), mainly the [Niagara showcase](../../../examples/unreal/niagara-showcase/README.md).

## Pick the run mode

| Mode | Command shape | Use it for |
|---|---|---|
| Commandlet | `UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=x.py -unattended -nullrhi ...` | Assets and levels: create, duplicate, save, place actors, headless |
| Editor, run to completion | `UnrealEditor.exe Project.uproject -ExecutePythonScript=x.py` | One-shot tasks that need the full editor |
| Editor, kept running | `UnrealEditor.exe Project.uproject /Game/Maps/M -ExecCmds="py x.py"` | A ticking world: Play-In-Editor, screenshots, camera tours |
| Game window | the same with `-game -windowed -ResX=1600 -ResY=900` | Watching a result without the editor UI |

- A commandlet does not load levels (Epic): build the level in it, then run the editor to look at it ([`niagara_build.py`](../../../examples/unreal/niagara_build.py), then [`niagara_verify.py`](../../../examples/unreal/niagara_verify.py)).
- `-ExecutePythonScript` shuts the editor down when the script ends. For a script that keeps running, launch with `-ExecCmds="py x.py"`, register `unreal.register_slate_post_tick_callback`, wait until the world exists before acting, and start play with `get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_begin_play()`. Epic does not recommend `ExecCmds` for ordinary scripts because it can run before the editor is ready, which is why a script that keeps running waits for the world itself.
- In a game window use game-side APIs: find the world with `unreal.ObjectIterator(unreal.World)` and `GameplayStatics`; `unreal.EditorLevelLibrary` is the editor's API ([`showcase_run.py`](../../../examples/unreal/niagara-showcase/showcase_run.py), `NIAGARA_SHOWCASE_GAME=1`).

## Practices

- Place what play needs, such as a camera, in the level at build time. At runtime find it with `GameplayStatics.get_all_actors_of_class` and call `set_view_target_with_blend` on the player controller.
- Use keyword arguments for value types: `unreal.Rotator(roll=, pitch=, yaw=)` and `unreal.Color(r=, g=, b=, a=)`. Aim cameras with `MathLibrary.find_look_at_rotation`.
- Read devices from the tick callback through the player controller: `is_input_key_down(key)`, `get_input_analog_key_state(key)` for sticks and triggers, `get_input_mouse_delta()`, `was_input_key_just_pressed(key)`; hide the cursor with the `show_mouse_cursor` property.
- Build a key from its engine name with `k = unreal.Key(); k.import_text("Gamepad_LeftX")` and check it with `unreal.InputLibrary.key_is_valid(k)`.
- Map devices to one plain input snapshot and run the motion code from scripted snapshots, so it can be tested without hardware ([`showcase_explore.py`](../../../examples/unreal/niagara-showcase/showcase_explore.py), `NIAGARA_SHOWCASE_SELFTEST=1`).
- Guard a tick callback with a busy flag when it activates Niagara systems: Slate keeps ticking while a system compiles, and the callback runs again.
- Wrap a tick callback's body in `try`/`except` and log once.
- Measure time-based behaviour against the time the script applied, since editor frame rate varies with the scene.
- `AutomationLibrary.take_high_res_screenshot(width, height, name)` writes the image a few frames later: hold the camera still for a couple of seconds after the call.
- Label things in the world with a `TextRenderActor` (its front faces +X); `draw_debug_string` text does not appear in high-resolution screenshots.
- Write output files to absolute paths under the project's `Saved/`, and parse a script before a commandlet run: `python -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" x.py`.
- Use Movable lights in a level that has no baked lighting; Stationary and Static lights are for baked lighting (Epic: light mobility).

## Run the editor from an agent on Windows

- Start headless runs with `Start-Process -FilePath ... -ArgumentList ... -PassThru -WindowStyle Hidden`, then `WaitForExit(milliseconds)` on the returned process. By default PowerShell opens a new window for a console program.
- Pass one quoted string per argument that has a space: `-ExecCmds="py C:/path/x.py"` ([Start-Process](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process): arguments with spaces need escaped double quotes).
- `UnrealEditor-Cmd.exe` takes a project and a command; run it with both.
- After a timed run, stop editors whose command line names your project (`Get-CimInstance Win32_Process` filtered on the `.uproject`) and no others.
- Check a window with the engine's own screenshot or ask the person; leave full-screen captures alone.

## Sources

- Epic: [Scripting the Unreal Editor using Python](https://dev.epicgames.com/documentation/unreal-engine/scripting-the-unreal-editor-using-python) (commandlet, `-ExecutePythonScript`, `ExecCmds`, the `unreal` module, `EditorAssetLibrary`).
- Epic: [Command-line arguments](https://dev.epicgames.com/documentation/en-us/unreal-engine/command-line-arguments-in-unreal-engine) (`-game`, `-ResX`/`-ResY`).
- Epic: [PlayerController Python API](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/PlayerController) (input reads, `show_mouse_cursor`).
- Epic: [Movable light mobility](https://dev.epicgames.com/documentation/unreal-engine/movable-light-mobility-in-unreal-engine) and [light types and their mobility](https://dev.epicgames.com/documentation/unreal-engine/light-types-and-their-mobility-in-unreal-engine).
- Microsoft: [Start-Process](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process).
