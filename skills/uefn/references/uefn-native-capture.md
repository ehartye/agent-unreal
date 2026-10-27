# UEFN editor and client capture

Read this when viewport screenshots stall or a Fortnite client window must be captured. Observed in one consuming UEFN project on an earlier UEFN build; not reproduced in this repo. Every claim is labelled `[general]` for that reason. Inspect the installed schemas after upgrades; these observations are not an API contract for every project. Use the [authoring reference](uefn-authoring.md) for connection setup.

## Bounded editor screenshots when viewport capture stalls

**[general]** Viewport screenshot tasks stalled after two images. Smaller batches
and uncovering the editor did not establish a cause. A temporary native
`SceneCapture2D` with `SceneCaptureComponent2D` and a transient RGBA8 render
target successfully exported 16 views at 1920 x 1080.

The working configuration used `capture_every_frame=False`,
`capture_on_movement=False`, `always_persist_rendering_state=True`, FOV 80,
`SCS_FINAL_COLOR_LDR` and `RenderingLibrary.create_render_target2d`. A bounded
Slate post-tick callback positioned the camera, allowed editor frames to settle,
called `capture_scene()` and `RenderingLibrary.export_render_target`.
Use named `unreal.Rotator(pitch=..., yaw=..., roll=...)` arguments.

Preflight for an existing temporary actor before starting. On completion or any
failure, independently attempt all cleanup: detach the texture target, release
the render target, destroy the capture actor and unregister the callback.
Collect cleanup failures rather than allowing the first failure to skip the
remaining actions. Inspect the image files and require a receipt confirming
actor removal. Do not save or push while temporary capture actors exist.

These images established geometry and editor framing. Exposure differed from
the main viewport. They did not prove color fidelity, game camera framing or
interaction. Do not label an editor SceneCapture image as a Fortnite screenshot.

## Actual client capture across Windows sessions

**[general]** The agent shell ran in Windows session 0 while UEFN and Fortnite
ran in session 1. Shell-side `EnumWindows` found no game windows. Running a
read-only ctypes inspection through native editor Python found the sole window
belonging to `FortniteClient-Win64-Shipping.exe` in the editor's session.

Record the actual client rectangle, foreground status and method. Foreground
screen `BitBlt` produced a readable game image. Background `PrintWindow` may
return success with blank DirectX content; inspect the PNG. Do not assume an
earlier 1920 x 1080 sign-in screen implies that a later 853 x 640 gameplay window
meets a full-resolution readability requirement. Capture does not require
focusing another window or sending input.
