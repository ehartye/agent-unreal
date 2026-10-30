---
name: unreal-umg
description: "Script and set up Unreal Engine 5.8 UI: UMG widgets and Widget Blueprints, MVVM, and Common UI. Covers Epic's MCP UMG toolset, building and compiling a widget from a script, capturing a widget in an offscreen Play In Editor frame, the Common UI setup pieces and input routing, and UMG cost rules and focus traps. Not for a native game's build, capture loop and profiling (use unreal-native), Enhanced Input bindings or other gameplay systems (unreal-gameplay), editor Python run modes (unreal-editor-scripting) or Verse UI in UEFN (use uefn)."
when_to_use: "Use when asked to build, script or compile a UMG widget or Widget Blueprint, or to add a text block, button or image to one from a script; to create an MVVM view model and bind it to a widget; whether Epic's MCP server lists a UMG, MVVM or widget-animation toolset; to capture or screenshot a widget or HUD offscreen, or when a high-resolution screenshot leaves the UI out; to set up Common UI (the Game Viewport Client Class, Common Input Settings, an input action data table, an activatable widget); about input routing, focus or gamepad navigation in a menu, or sending a simulated key or click to a button; or about UMG cost such as bound attributes, Canvas Panels, Rich Text and widget animation."
---

# Scripting and setting up UMG and Common UI in Unreal 5.8

Unreal 5.8 on Windows. UMG is the widget system on Slate; MVVM binds view models to widgets; Common UI adds activatable widgets and input routing for menus. This skill says what an agent can script, how to capture it with nobody at the screen, what Common UI needs and what costs frame time. Labels: [tested] is a result of a probe run dated 2026-10-30, run A (the toolsets only) or run B (all four questions), or of the later runs named A-Q1 run 1 to A-Q4 run 3 (animation, MVVM, viewport class, simulated input), each in a rendering editor started with `-RenderOffScreen -unattended` and nobody at the screen ([the probe](../../examples/unreal/umg/README.md)); [documented] names Epic's page; [general] is judgement. Other Unreal skills: `unreal-native`, `unreal-gameplay`, `unreal-editor-scripting`, `unreal-rendering`, `unreal-import`, `uefn`.

| You are about to | Read |
|---|---|
| Ask what UMG, MVVM and Common UI are in 5.8, how mature each is, or which toolsets Epic's MCP server lists for them | [Overview and status](references/unreal-umg-overview.md) |
| Create a Widget Blueprint, add a text block, button or image, set properties, compile and save, or create a widget instance in a running session | [Scripting a widget](references/unreal-umg-script-widget.md) |
| Save a frame that shows a widget, check it against a frame without the widget, or find out why a screenshot has no UI | [Capturing a widget offscreen](references/unreal-umg-capture.md) |
| Set the Game Viewport Client Class, Common Input Settings or an input action data table, make an activatable widget, or ask how input reaches a widget | [Common UI setup and input routing](references/unreal-umg-common-ui.md) |
| Bind a view model to a widget, or ask whether a script can add a widget animation | [MVVM and widget animation](references/unreal-umg-mvvm-animation.md) |
| Send a simulated key or click to a Common button | [Simulated key and click](references/unreal-umg-simulated-input.md) |
| Cut the cost of a UI, or meet a focus, navigation or gamepad problem | [Cost rules and traps](references/unreal-umg-cost-and-traps.md) |

## What the runs showed

- [tested] Runs A and B: a rendering editor started with `-RenderOffScreen -unattended` and `-ModelContextProtocolStartServer` answered Epic's MCP server on loopback about 16 s later. `list_toolsets` listed 53 toolsets, among them `UMGToolSet.UMGToolSet` (23 tools) and `MVVMToolset.MVVMToolset` (9 tools); none was a widget-animation toolset.
- [tested] Run B: the MCP route created a Widget Blueprint (canvas, text block, labelled button, image), set properties, compiled and saved it; a fresh editor loaded it up to date.
- [tested] Run B: `Shot showui` in a Play In Editor session saved a frame showing the text, button and image; `take_high_res_screenshot` saved the scene without the widget.
- [tested] Run B: a script set the four Common UI quickstart pieces it tried; an activatable widget with a Common button read inactive, then active, with its text and button in the frame.
- [tested] A-Q2 run 3, 2026-10-30: the MVVM toolset's tools bound a view model property to a text block; the binding read back and a fresh editor loaded it. The view model blueprint must be compiled before the binding is created; the scripted run failed at that step and was repaired by hand in a hold session, so the corrected chain is unit-tested but was not re-run end to end. [MVVM and widget animation](references/unreal-umg-mvvm-animation.md).
- [tested] A-Q1 runs 1 to 3, invalidated: no tool adds a track and a key to a widget animation; routes and messages are in [MVVM and widget animation](references/unreal-umg-mvvm-animation.md). Next: a C++ bridge.
- [tested] A-Q3 runs 1 to 3: the running game viewport client in an offscreen Play In Editor session was `CommonGameViewportClient`, as saved. [Common UI setup](references/unreal-umg-common-ui.md).
- [tested] A-Q4 runs 1 to 3, partial: the Slate inspector calls returned true and clicked an editor widget but changed nothing on the Common button; a miss by aim is not ruled out; Python has no `input_key`. [Simulated key and click](references/unreal-umg-simulated-input.md).

## The decision for an agent

- [tested] Run B: build the widget through the UMG toolset and Epic's object and asset toolsets, then read it back. No other authoring route was run. [Scripting a widget](references/unreal-umg-script-widget.md) has the call order.
- [general] Capture with `Shot showui` and judge a region against the same frame without the widget; a high-resolution screenshot leaves UI out. [Capturing a widget offscreen](references/unreal-umg-capture.md).
- [documented] Common UI needs the Game Viewport Client Class set to `CommonGameViewportClient` for its input routing; Epic's Common UI Quickstart Guide lists the other pieces. [Common UI setup](references/unreal-umg-common-ui.md).
- [general] Epic's MCP server runs one call at a time: wait for each answer and read the result back before the next write.

## Rules of thumb

- [documented] Epic's 5.8 release notes: Common UI is production ready; the UMG ToolSet is "Experimental", as is the Unreal MCP plugin.
- [documented] Epic's UMG optimization guide: no raw attribute binding, few Canvas Panels, events over Tick. [Cost rules and traps](references/unreal-umg-cost-and-traps.md).
- [general] Enhanced Input bindings and mapping contexts belong to [unreal-gameplay](../unreal-gameplay/SKILL.md); this skill covers only Common UI's own input data.
- [general] A native game's build, capture loop and profiling belong to [unreal-native](../unreal-native/SKILL.md), editor Python run modes to [unreal-editor-scripting](../unreal-editor-scripting/SKILL.md), Verse UI on a Fortnite island to [uefn](../uefn/SKILL.md).
- [general] Keep generated assets in a throwaway project, out of source control.

## Not established

- [tested] A-Q4 runs 1 to 3: a simulated key or click changing a Common button is not established. Gamepad and mouse on a device, button styles and Platform Input data assets were not run.
- [tested] A-Q1 runs 1 to 3: no widget animation was authored. A-Q2: `RemoveWidgetViewBinding` and `ListConversionFunctions` were not called.
- [general] A widget made by another route than the MCP toolsets, a `-nullrhi` run, a packaged build and any UI cost measurement were not run.
- [general] Whether Epic's quickstart (Common UI data tables "are not related" to Enhanced Input) or its release notes (the two unified) describes 5.8 setup is not established; see [Common UI setup](references/unreal-umg-common-ui.md).
