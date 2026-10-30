# UMG, MVVM and Common UI in 5.8: what they are and their status

Target: Unreal Engine 5.8 on Windows. Run A and run B (both 2026-10-30; [the probe](../../../examples/unreal/umg/README.md)) started a rendering editor with `-RenderOffScreen -unattended` in a throwaway project with Epic's Unreal MCP, AllToolsets, UMG and MVVM toolset plugins enabled, and read the MCP server's toolset list.

## What each one is

- [documented] Epic's UMG optimization page speaks of building a UI "with Slate and UMG" together, and Epic's Common UI input guide describes input in terms of "Unreal Motion Graphics (UMG) and Slate-based" flow. In this skill UMG is the widget layer and Widget Blueprint designer on top of Slate.
- [documented] Epic's Common UI overview: Common UI is a plugin, originally developed for UI in Fortnite, for cross-platform UIs with layered menus, submenus and popups; it is enabled from the Plugins menu. It adds activatable widgets and an input router, which [Common UI setup and input routing](unreal-umg-common-ui.md) covers.
- [general] MVVM is a separate view model and binding framework for UMG. This skill touches it only through its 5.8 status lines and its MCP toolset; the rest of the framework is not covered.

## 5.8 status

- [documented] Epic's Unreal Engine 5.8 Release Notes, UMG section: "Bring Common UI out of beta, it is now production ready."
- [documented] Epic's Unreal Engine 5.8 Release Notes, UMG section: "Exposed UMG ToolSet to EDA as Experimental." The notes do not expand "EDA" and list no methods.
- [documented] Epic's Unreal Engine 5.8 Release Notes, UMG section: a new MVVM resolver type, Context, which can pull view models from a parent widget's binding or from an external context extension on any user widget in the hierarchy.
- [documented] Epic's Unreal Engine 5.8 Release Notes, Unified Input System: Enhanced Input and Common Input/UI are unified, which "removes the need for duplicate data assets". The notes label neither UMG nor MVVM beta or production.
- [documented] Epic's Unreal MCP plugin page marks the plugin Experimental, and its usage page says many features are incomplete or missing and that APIs and data formats can change.

## What Epic's MCP server listed

- [documented] Epic's Unreal MCP in Unreal Editor page: the plugin ships no tools of its own; the AllToolsets plugin (which depends on the Toolset Registry) or individual toolset plugins supply them. With Tool Search on (the default), `tools/list` returns three meta-tools: `list_toolsets`, `describe_toolset` and `call_tool`.
- [tested] Runs A and B: `list_toolsets` returned text with 53 toolsets, one `- <module>.<class>: <description>` line each, and `describe_toolset` with the argument `toolset_name` returned JSON for a named toolset.
- [tested] Runs A and B: `UMGToolSet.UMGToolSet` listed 23 tools: `CreateWidgetBlueprint`, `AddWidget`, `MoveWidget`, `RemoveWidget`, `RenameWidget`, `WrapWidgets`, `GetWidgets`, `GetWidgetDescription`, `GetWidgetTreeDepth`, `GetNamedSlots`, `ListWidgetBlueprints`, `ListWidgetClasses`, `GetWidgetClassInfo`, `SetNamedSlotContent`, `BindToEventProperty`, `ToggleWidgetAsVariable`, `AddUIComponent`, `RemoveUIComponent`, `MoveUIComponent`, `ReplaceWidgetWithTemplate`, `ReplaceWidgetWithNamedSlot`, `ReplaceWidgetWithChild` and `CompileWidgetBlueprint`.
- [tested] Runs A and B: `MVVMToolset.MVVMToolset` listed 9 tools: `CreateViewModel`, `AddViewModelProperty`, `AddViewModelToWidget`, `CreateViewBinding`, `RemoveWidgetViewBinding`, `ListViewModels`, `ListWidgetViewModels`, `ListWidgetViewBindings` and `ListConversionFunctions`.
- [tested] Runs A and B: none of the 53 toolsets was for widget animations. The list held eight `animation_toolset.*` toolsets for Sequencer and Control Rig, and nothing named for a widget animation. The list also held `SlateInspectorToolset.SlateInspectorToolset`, `ConfigSettingsToolset.ConfigSettingsToolset` and the object, asset, Blueprint and data table toolsets that [Scripting a widget](unreal-umg-script-widget.md) and [Common UI setup](unreal-umg-common-ui.md) use.
- [general] A UEFN editor's MCP server was reported on 2026-10-29 to list a widget-animation toolset. That is a different editor, was not re-run, and does not change the Unreal result above; for UEFN see [uefn](../../uefn/SKILL.md).

## What this does not establish

- [tested] Run B: only the UMG toolset was called. The MVVM toolset was listed and described, and none of its tools was called.
- [general] Authoring a widget animation from a script was not run; no tool in either listed toolset is named for it, so a Sequencer toolset or another route would be the next experiment.
- [general] Whether the same toolset list appears in an editor without the AllToolsets plugin, or in a `-nullrhi` editor or a commandlet, was not run.
- [general] Epic's MCP server runs inside the editor process and listens on loopback; the editor's own scripting routes are in [unreal-editor-scripting](../../unreal-editor-scripting/SKILL.md).
