# Common UI: setup from a script and how input reaches a widget

Target: Unreal Engine 5.8 on Windows. Everything marked tested was run in run B on 2026-10-30, or in the viewport run A-Q3 (same date, same kind of editor) ([the probe](../../../examples/unreal/umg/README.md)), in a second throwaway project with the Common UI plugin, in a rendering editor started with `-RenderOffScreen -unattended`. The pieces were set through Epic's MCP toolsets (see [Scripting a widget](unreal-umg-script-widget.md)); the widget was shown with the capture route in [Capturing a widget offscreen](unreal-umg-capture.md).

## The setup pieces

- [documented] Epic's Common UI Quickstart Guide: set Project Settings > Engine > General Settings > Game Viewport Client Class to `CommonGameViewportClient`; a custom viewport class must extend it. Epic's CommonUI Input Technical Guide says routing starts in `UCommonGameViewportClient::InputKey`, which is why this class must be set.
- [tested] Run B: `ConfigSettingsToolset` found the property under Project / Engine / General, `SetSectionProperties` set it and `SaveSection` saved it. A new editor process then read `/Script/CommonUI.CommonGameViewportClient` back.
- [general] A reflection check outside the counted runs marked the property as needing a restart, so set it, save, and restart the editor before relying on it. The counted run read the saved value back in the same session, which shows the setting and not that the running viewport client changed.
- [documented] Epic's quickstart: create a data table with the row struct `CommonInputActionDataBase`; each row names an action with a display name and the keyboard, gamepad and touch keys that trigger it.
- [tested] Run B: `DataTableTools.create` with `CommonInputActionDataBase` made the table and `add_rows` added a Confirm row and a Back row.
- [documented] Epic's quickstart: create a Blueprint of `CommonUIInputData`, give it the default Click and Back actions from a data table, and assign it under Project Settings > Game > Common Input Settings > Input Data.
- [tested] Run B: `BlueprintTools.create` made a `CommonUIInputData` Blueprint, its `DefaultClickAction` and `DefaultBackAction` were set to the two rows and read back, `ConfigSettingsToolset` found Project / Game / CommonInputSettings and set and saved Input Data, and a new editor read the Blueprint class back.
- [tested] Run B: the new editor read both settings with the toolset library's reflection reader, `unreal.ToolsetLibrary.get_object_properties`, on the class default objects `/Script/Engine.Default__Engine` and `/Script/CommonInput.Default__CommonInputSettings`.
- [general] Python did not expose `unreal.Engine` or `unreal.CommonInputSettings` in a reflection check outside the counted runs, which is why the reader above was used.
- [documented] Epic's quickstart: create `CommonInputBaseControllerData` Blueprints for each input type and gamepad and add them under Common Input Settings > Platform Input; the Default Gamepad Name must exactly match a Gamepad Name or the icons do not appear. It also styles Common widgets with Common Style assets or the Template Styles under Project Settings > Plugins > Common UI Editor.
- [tested] Run B: the controller data assets, Platform Input and Common Style assets were not tried; the button was a `CommonButtonBase` Widget Blueprint whose look was a tinted border.

## An activatable widget

- [documented] Epic's Common UI overview and input guide: only activatable widgets become input nodes, and only active ones receive input; a deactivated widget is not added to the node list and is never considered for routing.
- [tested] Run B: a Widget Blueprint with the parent `CommonActivatableWidget` held a canvas, a text block and an instance of a `CommonButtonBase` Widget Blueprint; both blueprints compiled and saved.
- [tested] Run B: the instance came from `unreal.new_object(widget_class, player_controller)`. It read as an activatable widget; `is_activated()` read false before and after `add_to_viewport()`, and true after `activate_widget()`.
- [tested] Run B: the `Shot showui` frame with the widget active shows the title text "COMMON UI" and the button labelled "GO" (99.1 percent of the button region was button colour with the widget and 0.0 percent without, new bright pixels in 5.5 percent of the text region against 0.0 percent in the control). The high-resolution shot did not show the widget.
- [general] Activate explicitly after adding to the viewport and read `is_activated()` back, as the probe did; adding it alone left it inactive in run B.

## How input reaches a widget

- [documented] Epic's Common UI overview: widgets become nodes in trees that match the Slate hierarchy; once per tick Common UI finds the tree painted above all others and sends input to its root, which forwards it to the first leaf ready to handle it. A background layer still exists but cannot be interacted with while a top layer is active.
- [documented] Epic's CommonUI Input Technical Guide: input processors such as `FCommonAnalogCursor` get the first chance to handle a key; otherwise it reaches `UCommonGameViewportClient::InputKey`, which offers it to the action router (`UCommonUIActionRouterBase::ProcessInput`), then to the root node and its children and their action bindings, and falls back to the normal path when nothing handles it.
- [documented] The same guide: a gamepad Accept that no bound action captures becomes a synthetic mouse click, navigation behaves as in base UMG, and `FCommonAnalogCursor::Tick` moves the synthetic cursor onto the focused widget. Its listed click problems are the wrong user, a cursor far from the expected position and another widget holding capture.
- [documented] The same guide: the supported ways to change routing are a class derived from `UCommonGameViewportClient` or one derived from `UCommonUIActionRouterBase`.
- [documented] Epic's 5.8 release notes: `CommonUI.DumpActivatableTree` now prints each node's `SupportsActivationFocus`, which helps to see why an activatable widget is not receiving focus; `FCommonInputTypeInfo::AdditionalKeys` adds extra keys to an input action.
- [general] Enhanced Input action bindings and mapping contexts are in [unreal-gameplay](../../unreal-gameplay/SKILL.md); this skill covers only Common UI's own data tables and input data.

## The running viewport client

- [tested] A-Q3 runs 1 to 3, 2026-10-30: in an offscreen Play In Editor session of the Common UI project the running game viewport client was `CommonGameViewportClient`, equal to the saved setting (`/Script/CommonUI.CommonGameViewportClient`, read by the same editor). The engine's own listing, the console command `obj list class=GameViewportClient` issued from the stage script, named one object of that class, `/Engine/Transient.UnrealEdEngine_0:CommonGameViewportClient_0`, in all three runs. From run 2 the stage script also read the class itself, with `unreal.find_object(None, <that path>)` and `get_class()`, and logged `viewport_client class=CommonGameViewportClient`.
- [tested] A-Q3 runs 1 and 2: reading the client by reflection (the controller's `Player` property, then its viewport client) returned an empty result, so Python could not reach it that way; the console listing and the object path did.

## Not established

- [tested] A-Q4 runs 1 to 3: a simulated key or click changing a Common button is partial, not established ([Simulated key and click](unreal-umg-simulated-input.md)); which widget receives input and how focus returns after a popup are not established. Gamepad events were not sent, and button style assets and the quickstart's controller data assets (Platform Input) were not run.
- [general] Epic's quickstart says Common UI's input action data tables "are not related to" Enhanced Input, while its 5.8 release notes say Enhanced Input and Common Input/UI are unified without duplicate data assets. Which describes 5.8 setup is not established; check the installed editor before building both.
- [general] Gamepad and mouse behaviour on a physical device needs a person and was not run.
