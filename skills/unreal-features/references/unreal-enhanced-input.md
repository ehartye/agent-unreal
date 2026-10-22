# Enhanced Input in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. Enhanced Input is the input system built from four concepts: Input Actions, Input Mapping Contexts, Input Modifiers and Input Triggers (Epic). Input Actions are the equivalent of the older Action and Axis mappings, "except they are data assets", and binding Input Actions replaces the Action and Axis bindings (Epic). The legacy Action/Axis mappings are superseded; this page covers only Enhanced Input.

## Enable it

| Plugin | Category | Enabled by default | Flags (descriptor) | Dependencies |
|---|---|---|---|---|
| `EnhancedInput` | Input | yes | not beta | DataValidation |

- Modules: Runtime (`EnhancedInput`), UncookedOnly (`InputBlueprintNodes`) and Editor (`InputEditor`).
- In the 5.8 install the editor module sets Default Player Input Class to `EnhancedPlayerInput` and Default Input Component Class to `EnhancedInputComponent` when a project still has the standard classes; the console variable `EnhancedInput.bEnableAutoUpgrade` (default true) controls it. Epic's setting is Project Settings > Input > Default Classes.
- Project Settings > Enhanced Input holds user settings (remapping), default mapping contexts, input-mode filtering and the world subsystem, which the 5.8 install labels Experimental.

## Use it when

- Input must change with the situation: on foot, in a vehicle, in a menu. Contexts are added, removed and prioritized per user (Epic).
- Players remap keys, or one action must work on several devices.
- An action needs a pattern, such as hold, tap, repeated tap, pulse or chord, or processed values, such as dead zones, smoothing, axis swizzle or world-space conversion.
- Input must be injected for tests or scripted control (`InjectInputForAction`).

## Use something else when

- A script only reads raw device state each tick, such as editor tooling or a camera tour: read keys from the player controller, as in [Editor Python](unreal-editor-python.md).
- A plugin supplies its own input path: [Mover](unreal-mover.md) takes an input command produced by your code each tick.
- The Combo trigger is deprecated in 5.8 (`InputTriggers.h`); build sequences from the other triggers.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Create an Input Action asset | Python (named in Epic's 5.7 Python pages) | `AssetTools.create_asset(name, path, unreal.InputAction, unreal.InputAction_Factory())` |
| Create a Mapping Context asset | Python (named in Epic's 5.7 Python pages) | `unreal.InputMappingContext_Factory` with `unreal.InputMappingContext` |
| Set the value type, description, consume-input flag | Python property | `value_type` is an editor property (EditAnywhere in the 5.8 header) that Epic's Python page lists as read-only for attribute access; set it with `set_editor_property`, which Epic documents for editor properties. Verify the result in the editor |
| Map keys to actions | Python (named in Epic's 5.7 Python pages) | `unreal.InputMappingContext.map_key(action, key)`, `unmap_key`, `unmap_all_keys_from_action`, `unmap_all`; build a key with `unreal.Key().import_text("Gamepad_LeftX")` |
| Add triggers and modifiers | Python (named, partly undocumented) | `triggers` and `modifiers` arrays exist on `unreal.InputAction` and `unreal.EnhancedActionKeyMapping`; classes such as `unreal.InputModifierDeadZone` (`lower_threshold`, `upper_threshold`) have constructors taking `outer` and `name`. Epic does not document instancing them into those arrays; add them in the editor UI when that route fails |
| Add or remove a context at runtime | Blueprint / C++ / Python (named) | `AddMappingContext(context, priority, options)` and `RemoveMappingContext` on `UEnhancedInputLocalPlayerSubsystem`; Python names `add_mapping_context`, `remove_mapping_context`, `has_mapping_context`, `clear_all_mappings` |
| React to an action | Blueprint / C++ | Blueprint: Input Action event node. C++: `BindAction` on `UEnhancedInputComponent` with an `ETriggerEvent`; the callback gets an `FInputActionInstance` (Epic). No Python binding route is documented |
| Custom modifier or trigger | Blueprint / C++ | Subclass `UInputModifier` (override `ModifyRaw`) or `UInputTrigger`; both are Blueprintable (Epic; headers) |
| Player remapping | Project Settings / C++ | Enable User Settings; `PlayerMappableKeySettings` on the action; Player Mappable Input Config groups contexts into presets (Epic) |
| Per-platform contexts | Project Settings | Enhanced Input Platform Data, Mapping Context Redirect (Epic) |
| Test and debug | Console / Blueprint / C++ | `showdebug enhancedinput`, `showdebug devices`, `Input.+key` and `Input.-key`, `InjectInputForAction` |

This reference does not claim any of the Python calls were run; the 5.7 pages are the newest Python pages fetched.

## Workflow

1. Keep the default classes at `EnhancedPlayerInput` and `EnhancedInputComponent`.
2. Create one Input Action per user action, such as Crouch or Fire. Choose the value type: Bool for on/off, Axis1D (float), Axis2D (`FVector2D`) for sticks and movement, Axis3D (`FVector`) (Epic).
3. Create one Input Mapping Context per situation. Keep contexts that cannot overlap, such as on-foot and vehicle, mutually exclusive so inputs do not collide (Epic).
4. Map keys in the context. Map WASD to a 2D axis with Negate and Swizzle Input Axis Values modifiers; add a Dead Zone to sticks. Modifiers run in listed order, and modifiers on the action run after those on the mapping (Epic).
5. Put hold, tap and chord logic in Triggers, not in game code. Bind game code to Triggered, the event Epic says most code uses. Trigger types are explicit, implicit and blocker (Epic).
6. Add the base context when the local player is ready, through `UEnhancedInputLocalPlayerSubsystem`, with a priority. The highest-priority context is considered first and, because actions consume input by default (`bConsumeInput` in the 5.8 header), blocks lower ones.
7. Switch situations by adding and removing contexts at runtime. By default, keys held when a context is added are ignored until released (`FModifyContextOptions` in the 5.8 header).
8. Bind in Blueprint with the Input Action event, or in C++ with `BindAction`.
9. Script asset creation from Python as above, save the assets, then open the editor to confirm triggers and modifiers; test with injected input and `showdebug enhancedinput`.

Related: [Gameplay Ability System](unreal-gameplay-ability-system.md), [Mover](unreal-mover.md), [Networking and replication](unreal-networking-and-replication.md).

## Sources

- [Enhanced Input in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/enhanced-input-in-unreal-engine)
- [Input Overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/input-overview-in-unreal-engine) (Default Classes)
- [Scripting the Unreal Editor using Python](https://dev.epicgames.com/documentation/en-us/unreal-engine/scripting-the-unreal-editor-using-python) (editor properties, `set_editor_property`)
- Epic Python API 5.7: [InputAction](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/InputAction?application_version=5.7), [InputAction_Factory](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/InputAction_Factory?application_version=5.7), [InputMappingContext](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/InputMappingContext?application_version=5.7), [InputMappingContext_Factory](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/InputMappingContext_Factory?application_version=5.7), [EnhancedActionKeyMapping](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/EnhancedActionKeyMapping?application_version=5.7), [InputModifierDeadZone](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/InputModifierDeadZone?application_version=5.7), [EnhancedInputLocalPlayerSubsystem](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/EnhancedInputLocalPlayerSubsystem?application_version=5.7)
- The `EnhancedInput` plugin descriptor and headers in the 5.8 install
