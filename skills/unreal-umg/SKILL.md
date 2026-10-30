---
name: unreal-umg
description: "Script and set up Unreal Engine 5.8 UI: UMG widgets and Widget Blueprints, MVVM, and Common UI. Covers Epic's MCP UMG toolset, building and compiling a widget from a script, capturing a widget in an offscreen Play In Editor frame, the Common UI setup pieces and input routing, and UMG cost rules and focus traps. Not for a native game's build, capture loop and profiling (use unreal-native), Enhanced Input bindings or other gameplay systems (unreal-gameplay), editor Python run modes (unreal-editor-scripting) or Verse UI in UEFN (use uefn)."
when_to_use: "Use when asked to build, script or compile a UMG widget or Widget Blueprint, or to add a text block, button or image to one from a script; whether Epic's MCP server lists a UMG, MVVM or widget-animation toolset; to capture or screenshot a widget or HUD offscreen, or when a high-resolution screenshot leaves the UI out; to set up Common UI (the Game Viewport Client Class, Common Input Settings, an input action data table, an activatable widget); about input routing, focus or gamepad navigation in a menu; or about UMG cost such as bound attributes, Canvas Panels, Rich Text and widget animation."
---

# Scripting and setting up UMG and Common UI in Unreal 5.8

Unreal 5.8 on Windows. UMG is the widget system on Slate; MVVM binds view models to widgets; Common UI adds activatable widgets and input routing for menus. This skill says what an agent can script, how to capture the result with nobody at the screen, what Common UI needs and what costs frame time. Labels: [tested] is a result of one of two probe runs dated 2026-10-30, run A (the toolsets only) or run B (all four questions), each in a rendering editor started with `-RenderOffScreen -unattended` and nobody at the screen ([the probe](../../examples/unreal/umg/README.md)); [documented] names Epic's page; [general] is judgement. Other Unreal skills: `unreal-native`, `unreal-gameplay`, `unreal-editor-scripting`, `unreal-rendering`, `unreal-import`, `uefn`.

| You are about to | Read |
|---|---|
| Ask what UMG, MVVM and Common UI are in 5.8, how mature each is, or which toolsets Epic's MCP server lists for them | [Overview and status](references/unreal-umg-overview.md) |
| Create a Widget Blueprint, add a text block, button or image, set properties, compile and save, or create a widget instance in a running session | [Scripting a widget](references/unreal-umg-script-widget.md) |
| Save a frame that shows a widget, check it against a frame without the widget, or find out why a screenshot has no UI | [Capturing a widget offscreen](references/unreal-umg-capture.md) |
| Set the Game Viewport Client Class, Common Input Settings or an input action data table, make an activatable widget, or ask how input reaches a widget | [Common UI setup and input routing](references/unreal-umg-common-ui.md) |
| Cut the cost of a UI, or meet a focus, navigation or gamepad problem | [Cost rules and traps](references/unreal-umg-cost-and-traps.md) |

## What the runs showed

- [tested] Runs A and B: a rendering editor started with `-RenderOffScreen -unattended` and the launch flag `-ModelContextProtocolStartServer` answered Epic's MCP server on loopback about 16 s later with nobody at the screen. `list_toolsets` listed 53 toolsets, among them `UMGToolSet.UMGToolSet` (23 tools) and `MVVMToolset.MVVMToolset` (9 tools). None of the 53 was a widget-animation toolset.
- [tested] Run B: the MCP route created a Widget Blueprint with a canvas, a text block, a button with a label and an image, set their properties, compiled and saved it, and a fresh editor loaded it with status up to date.
- [tested] Run B: the console command `Shot showui` in a Play In Editor session saved a frame that shows the text, the button and the image; `take_high_res_screenshot` saved the scene without the widget.
- [tested] Run B: a script set all four Common UI quickstart pieces it tried, and an activatable widget with a Common button read inactive and then active, with its text and button in the saved frame.

## The decision for an agent

- [tested] Run B: build the widget through the UMG toolset and Epic's object and asset toolsets, then read it back. No other authoring route was run. [Scripting a widget](references/unreal-umg-script-widget.md) has the call order.
- [general] Capture with `Shot showui` and judge a region of the frame against the same frame without the widget; do not rely on a high-resolution screenshot for UI. [Capturing a widget offscreen](references/unreal-umg-capture.md).
- [documented] Common UI needs the Game Viewport Client Class set to `CommonGameViewportClient` for its input routing; Epic's Common UI Quickstart Guide lists the other pieces. [Common UI setup](references/unreal-umg-common-ui.md).
- [general] Treat Epic's MCP server as one editor process that runs one call at a time: send a call, wait for its answer, read the result back before the next write.

## Rules of thumb

- [documented] Epic's 5.8 release notes: Common UI is out of beta and production ready, and "Exposed UMG ToolSet to EDA as Experimental". Epic's Unreal MCP plugin page marks the plugin Experimental.
- [documented] Epic's Optimization Guidelines for UMG: never use raw attribute binding, use Canvas Panels sparingly and prefer events to Tick. [Cost rules and traps](references/unreal-umg-cost-and-traps.md).
- [general] Enhanced Input bindings, input actions and mapping contexts belong to [unreal-gameplay](../unreal-gameplay/SKILL.md); this skill covers only Common UI's own input data.
- [general] A native game's build, capture loop and frame-time profiling belong to [unreal-native](../unreal-native/SKILL.md), and editor Python run modes and enabling a plugin to [unreal-editor-scripting](../unreal-editor-scripting/SKILL.md). Verse UI on a Fortnite island is a different system: [uefn](../uefn/SKILL.md).
- [general] Keep generated assets in a throwaway project and out of source control.

## Not established

- [tested] Run B: that the running viewport client is the Common one. Only the saved setting was read back, by the next editor process. Input routing, gamepad and mouse behaviour, button style assets and the quickstart's controller data assets (Platform Input) were not run.
- [tested] Run B: no MVVM tool was called (the toolset was listed and described only), and no widget animation was authored.
- [general] A widget made by a route other than the MCP toolsets, a headless `-nullrhi` run, a packaged build and any measurement of UI cost were not run.
- [general] Whether Epic's quickstart (Common UI's data tables "are not related" to Enhanced Input) or its release notes (Enhanced Input and Common Input/UI unified) describes 5.8 setup is not established; see [Common UI setup](references/unreal-umg-common-ui.md).
