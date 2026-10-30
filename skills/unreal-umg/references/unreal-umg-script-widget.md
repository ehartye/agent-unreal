# Scripting a widget: Epic's MCP toolsets, then a running instance

Target: Unreal Engine 5.8 on Windows. Everything marked tested was run in run B on 2026-10-30 (the full probe run, [the probe](../../../examples/unreal/umg/README.md)), in a rendering editor started with `-RenderOffScreen -unattended` in a throwaway project, unless it names run A (the later MVVM and animation runs are in [MVVM and widget animation](unreal-umg-mvvm-animation.md)). The route that worked is Epic's MCP server driven from a script over loopback. No other authoring route was run.

## Start the server and the session

- [documented] Epic's Unreal MCP in Unreal Editor page: enable the Unreal MCP and AllToolsets plugins and restart; the server binds `http://127.0.0.1:8000/mcp` by default, accepts only same-machine connections, has no authentication and runs tool calls one at a time on the game thread, so clients must not overlap calls. The launch flags `-ModelContextProtocolStartServer` and `-ModelContextProtocolPort=N` start it and set the port.
- [tested] Runs A and B: the server was started by the launch flag in a rendering editor with no window and answered the session about 16 s after launch with no click. `initialize` returned protocol 2025-11-25 and a session id, and `tools/list` named `list_toolsets`, `describe_toolset` and `call_tool`.
- [tested] Run B: the calls that worked were `tools/call` of `describe_toolset` with `toolset_name`, and of `call_tool` with `toolset_name` (the fully qualified name, for example `UMGToolSet.UMGToolSet`), `tool_name` and an `arguments` object. Answers came back as text holding `{"returnValue": ...}`.
- [general] Read the toolset with `describe_toolset` in the installed build before calling it: argument names were camel case for the C++ UMG tools (`widgetBlueprint`, `widgetClass`) and snake case for the Python object and asset tools (`instance`, `asset_paths`) in run B's calls.
- [general] Wait for each answer before the next call and never resend a write that timed out without reading the asset back; one third-party write-up advises the same, and it was not run here.

## Build the Widget Blueprint

- [tested] Run B: `CreateWidgetBlueprint` with `folderPath`, `assetName` and `parentClass` `{"refPath": "/Script/UMG.UserWidget"}` returned the new blueprint's reference.
- [tested] Run B: five `AddWidget` calls built the tree: a `CanvasPanel` root, a `TextBlock`, a `Button`, a `TextBlock` inside the button as its label, and an `Image`. Each call took `widgetBlueprint`, `widgetClass` (for example `{"refPath": "/Script/UMG.TextBlock"}`), `widgetDisplayName` and, below the root, `parentWidget`. Each returned the widget's reference and, under a canvas, its slot reference.
- [tested] Run B: `GetWidgets` after the build reported `widgetCount` 5 with the five names and classes.
- [general] Order the calls: create, add the root, add each child with its parent, set properties, compile, save, read back. Keep the references each call returns and pass them on.

## Set properties

- [tested] Run B: the UMG toolset's own description says to call `ObjectTools.list_properties`, then `get_properties` and `set_properties` with the exact names, because names vary per widget class and cannot be guessed. The probe read each property with `get_properties` before it wrote.
- [tested] Run B: `set_properties` took the widget or slot reference as `instance` and `values` as a JSON string, and returned true. It set `Text` on the text block and the button label, `Font` as the partial struct `{"size": 48}`, `BackgroundColor` on the button, and `ColorAndOpacity` on the image.
- [tested] Run B: colours read and wrote as `{"r":1,"g":0,"b":0,"a":1}`, and a canvas slot's `LayoutData` as `{"offsets":{...},"anchors":{"minimum":{"x":..,"y":..},"maximum":{...}},"alignment":{...}}`, set on the slot reference with anchors and zero offsets. Every value read back as set; a 0.3 anchor read back as 0.29999999999999999.
- [general] Read each property first and write back only the fields to change, in the spelling that was read.

## Compile, save and read back

- [tested] Run B: `CompileWidgetBlueprint` with `widgetBlueprint` returned true, and `AssetTools.save_assets` with `asset_paths` returned true.
- [tested] Run B: a new editor process loaded the saved `WBP_ProbeHud` and read its class and blueprint status as up to date.
- [general] A true return is not the check; read the compile status and the widget list back, as above.

## Make an instance in a running session

- [tested] Run B: the Python call `WidgetLibrary.create` was not available, so the probe made the instance with `unreal.new_object(widget_class, player_controller)` and `add_to_viewport()`, after which `is_in_viewport()` read true.
- [general] Load the widget class with `unreal.EditorAssetLibrary.load_blueprint_class(path)` before Play In Editor starts, and get the player controller from the running world. [Capturing a widget offscreen](unreal-umg-capture.md) shows the session.

## Not established

- [general] A widget built from Python alone, without the MCP server, was not run, so this skill cannot say that route works or fails.
- [tested] Run B: `BindToEventProperty`, named slots, `MoveWidget`, the replace-widget tools, UI components, fonts beyond the size and a texture on the image (the image was tinted only) were not called.
- [tested] MVVM and widget animation: see [MVVM and widget animation](unreal-umg-mvvm-animation.md) for what A-Q1 and A-Q2 ran and did not run.
- [general] Whether the toolsets run the same in a `-nullrhi` editor or a commandlet was not run; the editor scripting run modes are in [unreal-editor-scripting](../../unreal-editor-scripting/SKILL.md).
