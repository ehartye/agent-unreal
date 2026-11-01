# Editor Python: Windows processes and remote rendering

Current engine work uses the [shared launcher](../../unreal-native/references/unreal-engine-launcher.md), whose owned Job and receipts establish cleanup. Do not treat a matching command line or a disappeared PID as proof of ownership or drain. Return to [Editor Python](unreal-editor-python.md) for run modes and scripting practices.

The low-level launch/cleanup notes in the first section describe the earlier probe implementation; use the shared launcher for new runs. The tested timeout result remains historical evidence.

## Run the editor from an agent on Windows

- Start headless runs with `Start-Process -FilePath ... -ArgumentList ... -PassThru -WindowStyle Hidden`, then `WaitForExit(ms)`.
- Quote each argument that has a space: `-ExecCmds="py C:/path/x.py"` ([Start-Process](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process)).
- `UnrealEditor-Cmd.exe` needs a project and a command.
- After a timed run, stop only editors whose command line names your project (`Get-CimInstance Win32_Process` filtered by `.uproject`).
- [tested] [`probe.mjs`](../../../examples/unreal/editor_probes/README.md) with `--timeout 60000` and a script holding 600 s exited 1 after 60.3 s. Its message named the limit, the missing report path and the editor log; no report was left, the editor log showed the script was running, and no editor process naming the project remained. A hold shorter than the limit exited 0 and wrote its report (`probe_timeout.mjs`, 7 of 7).
- Check a window with the engine's screenshot, not a full-screen capture.

## A rendering editor in a session with no desktop (SSH, a service)

- [general] Observed on an earlier engine build; not repeated on the pinned build: `UnrealEditor.exe` without `-nullrhi` started from a non-interactive SSH session ended with exit 3 and a `Fatal error` at `WindowsD3D12Viewport.cpp:162` (`DXGI_ERROR_NOT_CURRENTLY_AVAILABLE`) while it created the editor window's swap chain; the adapter lines read 0 outputs.
- [tested] With `-RenderOffScreen` the rendering editors ran in such a session: [`skeletal_materials.mjs --rendering`](../../../examples/unreal/skeletal_materials/README.md), [`rp_rt_validate.mjs --offscreen`](../../../examples/unreal/rendering_probes/README.md) and [`rp_viewport.mjs --offscreen`](../../../examples/unreal/rendering_probes/README.md) add the flag for this reason.
- [general] Observed on an earlier engine build; not repeated on the pinned build: with `-RenderOffScreen` the editor's own level viewport drew nothing: `ProfileGPU` taken in the editor listed only Slate frames (`Frame Time : 0.10ms`) and no scene passes. The same scene seen through a Play-In-Editor viewport (`editor_request_begin_play()` from a Slate post-tick callback 5 s after the level script, then a 120 s warm-up) profiled with a MegaLights pass.
- [general] Observed on an earlier engine build; not repeated on the pinned build: `AutomationLibrary.take_high_res_screenshot` in that Play-In-Editor run gave a black frame with no on-screen message. The console command `Shot showui nosuffix filename=<name>` kept the message; the file was written as `<name>00000.png` under `Saved/Screenshots/WindowsEditor/` (`nosuffix` did not remove the `00000`) and shows the whole editor window (1280 by 720) with the viewport inside it. See [Two directional lights](../../unreal-rendering/references/unreal-directional-lights.md).
- [documented] A screenshot requested without UI turns on-screen messages off for that shot: `FScreenshotRequest::RequestScreenshot` sets `GAreScreenMessagesEnabled` false when `bInShowUI` is false (`Engine/Source/Runtime/Engine/Private/UnrealClient.cpp`).
