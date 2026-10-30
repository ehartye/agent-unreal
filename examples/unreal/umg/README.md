# UMG probe: script a widget through Epic's MCP server, capture it offscreen, set up Common UI

Probes four questions about UMG and Common UI on Unreal Engine 5.8, Windows: which UMG, MVVM and widget-animation toolsets Epic's MCP server lists, whether a script can build, compile and save a Widget Blueprint through them, whether that widget can be captured in a Play-In-Editor session run offscreen, and whether the Common UI quickstart's requirements can be set from a script and an activatable widget activated. Nothing here needs a project of yours: the runner makes throwaway projects in the OS temp folder.

Status: Ran 2026-10-30 from a session with no desktop (SSH, one engine process at a time), 23 of 24 checks pass; the one failing check is the answer to the first question. `toolsets` 5 of 6: Epic's MCP server answered over loopback 16 s after launch and listed `UMGToolSet.UMGToolSet` (23 tools) and `MVVMToolset.MVVMToolset` (9 tools) among 53 toolsets, and no widget-animation toolset (the 53 hold eight Sequencer and Control Rig toolsets and nothing for widget animations); a toolsets-only run before it gave the same list. `widget` 4 of 4, `capture` 6 of 6, `commonui` 8 of 8: a script built, compiled and saved a Widget Blueprint through the toolsets, a Play-In-Editor session run offscreen showed it in the frame saved by the console command `Shot showui` (the frame of the editor window; the high-resolution screenshot route saved the scene without the widget), and every Common UI quickstart piece the probe tried was set from a script through Epic's toolsets, an activatable widget read back inactive and then active, and its frame shows its text and button. Not shown: that the running viewport client is the Common one beyond the saved setting read back by the next editor, input routing, button styles.

## Run

```text
node examples/unreal/umg/umg_probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--only toolsets,widget,capture,commonui] [--keep] [--plan] [--port <number>]
```

`--plan` prints what would run. `--keep` leaves the project folders (a run with a failing check keeps them anyway; they hold `Saved/*.json` reports, the MCP traces of the session phases, `Saved/Logs` and `Saved/Screenshots`). The exit code is 0 when every check of the groups that ran passes, 1 when a check fails and 2 on a usage error. A clean run deletes the projects.

| Group | Question | Phases |
|---|---|---|
| `toolsets` | Over loopback, do `list_toolsets` and `describe_toolset` list the UMG, MVVM and widget-animation toolsets with their tools? | session |
| `widget` | Can a Widget Blueprint with a canvas, a text block, a button and an image be created, given properties, compiled and saved through those toolsets, and does it read back? | session (with `toolsets`) |
| `capture` | Is that widget visible in a frame saved from a Play-In-Editor session run offscreen, and by which capture route? | capture (a new editor loads the saved widget) |
| `commonui` | Can the Common UI quickstart's pieces (the Game Viewport Client Class, Common Input Settings, an input action data table) be set from a script, and does an activatable widget with a Common button read back active and show in a frame? | session, capture (a second project with the Common UI plugin) |

`toolsets` and `widget` share one editor session; `capture` runs after it and needs the widget the session saved, so naming `capture` runs the session first. The Common UI pieces live in their own project so that the first project's frames are not taken under another game viewport client.

## How a run works

- **Session phase.** A rendering editor starts with `-RenderOffScreen -unattended` (no window, no interactive session) and the MCP server started by launch flag on a free port (`-ModelContextProtocolStartServer -ModelContextProtocolPort=<port>`). The runner polls until the server answers, then drives it over loopback with the session handshake: an `initialize` POST (`Accept: application/json, text/event-stream`, the `Mcp-Session-Id` response header kept), the `notifications/initialized` notification, then `tools/call` of `list_toolsets`, `describe_toolset` (argument `toolset_name`) and `call_tool` (arguments `toolset_name`, `tool_name`, `arguments`). The server runs calls serially on the game thread, so calls never overlap and a write is never sent twice: only a call refused because the tool name was not found is sent again, with the other spelling of the name.
- **The tools are found, not assumed.** `list_toolsets` is read for the toolset names (the UMG toolset, an MVVM toolset, a widget-animation toolset, and the object, asset, Blueprint, data table and settings toolsets the other steps use), `describe_toolset` for the tool names and argument names. Argument names are matched against the described schemas. Property values are never written blind: each property is read with `get_properties`, and a struct is written back in the spelling that was read (only the changed fields, then the whole value if that is refused).
- **Stage phase.** A second editor runs `umg_stage.py` with `-ExecCmds="py ..."`: a blank saved map, Play In Editor, a frame with no widget, the widget created and added to the viewport, the same frame again, each by two routes (the console command `Shot showui`, and `AutomationLibrary.take_high_res_screenshot`). The runner reads the PNGs and judges regions of them.
- **Judging.** The checks are pure functions of the reports (`umg-probe-checks.mjs`); the widget's anchors are fractions of the viewport, so the regions do not depend on the DPI scale. A window frame holds the editor around the viewport, so a solid blob of the button colour that appeared between the two frames places the viewport, and the text region is judged inside it against a control region beside it.
- Video memory is sampled with `nvidia-smi` (when it is on the PATH) before and after each editor phase; a log that reports a video-memory failure is printed as `not run: memory`.

## Files

| File | What it does |
|---|---|
| `umg_probe.mjs` | the runner: options, one throwaway project per group set, the editor phases, the frames read back, the judging |
| `umg-probe-checks.mjs` | the options, the phase plan, the MCP response and property-shape helpers, the frame judging and one check per claim |
| `umg-mcp.mjs` | the MCP client over loopback (handshake, `tools/list`, `tools/call`, event-stream and JSON responses, timeouts) |
| `umg-session.mjs` | the session steps: discovery, the widget build and read-back, the Common UI pieces |
| `umg_stage.py` | the Play-In-Editor half: plays a blank map, creates the widget, activates it (Common UI), takes the frames, quits |
| `umg-probe.test.mjs` | canned reports with a failing case per check, generated frames, and the client and the session run against a fake MCP server |

## What the runs showed

- **MCP server.** Started by launch flag in a rendering editor with `-RenderOffScreen -unattended`; it answered about 16 s later with no click. `initialize` returned protocol 2025-11-25 and a session id; `tools/list` names the three meta tools; `list_toolsets` answers with text (one `- <module>.<class>: <description>` line per toolset), `describe_toolset` with JSON (the toolset and its tools, each with an input schema, camel-case argument names for C++ tools, snake-case for Python ones); `call_tool` takes the tool name without its toolset prefix and an `arguments` object, and returns `{"returnValue": ...}` as text.
- **Properties.** The UMG toolset returns widget and slot references; the object toolset reads and writes their properties as JSON (`values` is a JSON string). Colours and structs read back as JSON strings with lower-case keys; a struct is written back with only the changed fields.
- **Creating a widget in Play In Editor.** Python has no `WidgetLibrary.create`; `unreal.new_object(widget_class, player_controller)` followed by `add_to_viewport` made an instance that drew.
- **Frames.** The console command `Shot showui` saves the editor window (the widget is inside the Play-In-Editor viewport, smaller than the frame); `AutomationLibrary.take_high_res_screenshot` saves the scene only.
- **Common UI settings.** The settings toolset (`ConfigSettingsToolset`) finds Game Viewport Client Class in Project / Engine / General and Input Data in Project / Game / CommonInputSettings, sets and saves them; the viewport class is read at the next editor start.
