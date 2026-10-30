# Capturing a widget offscreen

Target: Unreal Engine 5.8 on Windows. Everything marked tested was run in run B on 2026-10-30 ([the probe](../../../examples/unreal/umg/README.md)): a rendering editor started with `-RenderOffScreen` and no window on screen, the widget saved by the [scripting route](unreal-umg-script-widget.md), and the project's own blank saved map (a black scene). The editor started with `-ExecCmds="py <script>"` and ran a script that played the map, saved frames and quit.

## The session

- [tested] Run B: a new editor process loaded the saved widget class, opened the blank map, started Play In Editor and settled; the script then saved a frame with no widget, created the widget, added it to the viewport and saved the same frame again. Each frame was saved by two routes.
- [tested] Run B: the Play In Editor viewport read 1014 by 550 and the player controller was found; the instance came from `unreal.new_object(widget_class, player_controller)` and `add_to_viewport()` read back in the viewport, as in [Scripting a widget](unreal-umg-script-widget.md).
- [tested] Run B: the capture editor took 46 to 47 s from launch to exit, and the session editor before it 16 to 17 s.
- [general] The probe's script runs from `-ExecCmds="py <abs path>"`, because the script's own header says `-ExecutePythonScript` exits when the script ends and this script yields across ticks. The other run modes are in [unreal-editor-scripting](../../unreal-editor-scripting/SKILL.md).

## The two routes

- [tested] Run B: the console command `Shot showui filename=<stem>`, executed with `unreal.SystemLibrary.execute_console_command(world, ...)`, saved a 1280 by 720 PNG with `00000` added after the stem. The frame is the editor window with the Play In Editor viewport inside it, so the widget is smaller than the frame and offset from its corner. I read the frame: it shows the title text "UMG PROBE", the red button labelled "GO" and the green block of the image.
- [tested] Run B: `unreal.AutomationLibrary.take_high_res_screenshot(1280, 720, name)` saved a 1280 by 720 PNG of the scene with no widget: the frame with the widget in the viewport reads all black, as the frame without it does. The capture route that shows the widget is `Shot showui`.
- [tested] Run B (Common UI project): the high-resolution shot again left the widget out; no button-coloured pixel changed between its two frames, while `Shot showui` showed the widget. See [Common UI setup](unreal-umg-common-ui.md).
- [general] That agrees with the native skill's note that a Canvas HUD in a world-target capture does not establish offscreen Slate or UMG capture: [unreal-native](../../unreal-native/references/unreal-native-game.md).
- [general] The mechanism that leaves the widget out of the high-resolution shot was not read from the engine here; use `Shot showui` for UI and treat the high-resolution shot as a scene shot.

## Judge the frame

- [tested] Run B: the probe compared the frame with the widget against the frame without it, by region. The widget's anchors are fractions of the viewport, so the regions do not depend on the DPI scale; the viewport was placed inside the window frame by the solid blob of button colour that appeared between the two frames (scale 0.99).
- [tested] Run B: in the `Shot showui` pair, 5.6 percent of the text region held new bright pixels against 0.0 percent in a control region beside it; 96.9 percent of the button region was button colour with the widget and 0.0 percent without; 99.1 percent of the image region gained green.
- [general] Compare the same frame with and without the widget, in the same session, rather than a frame against a reference image. Judge the text by new bright pixels in its region and a control region, and a solid control such as a tinted button by its colour share.
- [general] Wait after each shot before the next step or before quitting; the probe waits 2.5 s after each. Confirm the PNG exists on disk before reporting success.
- [general] A region check shows that text and a button drew, not that the UI looks good or is legible; judging the look needs a person.

## Not established

- [tested] Run B: capture of a widget with no editor window around it, in a `-nullrhi` run or in a packaged build, and a capture of a single widget to a texture, were not run. Only the editor window frame was saved.
- [general] A background that is not black was not captured in the counted runs. In an earlier trial outside them a template level's sky moved between frames, which would break a with-and-without comparison, so use a static map.
- [general] Other resolutions and DPI scales, a widget animation mid-frame and the gamepad focus highlight were not captured. Input and focus checks need a person: [Cost rules and traps](unreal-umg-cost-and-traps.md).
