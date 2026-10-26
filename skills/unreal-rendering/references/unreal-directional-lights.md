# Two directional lights: ForwardShadingPriority and the renderer message

Written for Unreal 5.8.2 and 5.8.3. [`rp_validate.mjs`](../../../examples/unreal/rendering_probes/README.md) runs the 5.8.2 [tested] lines headless on a throwaway project, and `rp_viewport.mjs` (same folder) ran the 5.8.3 lines about the setter route and the message; [documented] lines name a file and its line numbers in the engine's `Engine/Source/Runtime` folder; [general] lines are inference. Read this when a level with a sun and a moon, or any two directional lights, shows a renderer message that directional lights are competing.

## The message

- [documented] The text is two lines, drawn orange: "Multiple directional lights are competing to be the single one used for forward shading, translucent, water or volumetric fog. Please adjust their ForwardShadingPriority." and "As a fallback, the main directional light will be selected based on overall brightness." (`Renderer/Private/LightGridInjection.cpp` 1904-1905).
- [tested] Unreal 5.8.3, a rendering editor started with `-RenderOffScreen`, a sun and a moon (two `DirectionalLight` actors), eight phases run on their Play-In-Editor copies, one `Shot showui` screenshot per phase ([`rp_viewport.mjs`](../../../examples/unreal/rendering_probes/README.md), judge 11 of 11). The orange message, with the text quoted above, was on screen in the top left of the viewport in the phases `tie`, `back_to_tie`, `back_property` and `moon_actor_hidden_in_editor`. The renderer was deferred (`r.ForwardShading` 0).
- [tested] Same run, the message was absent in `raise_setter`, `raise_property`, `moon_component_hidden` and `moon_zero_intensity`. The cause of the last two was not traced. In `moon_actor_hidden_in_editor` the hide was applied to the Play-In-Editor copy, where the message stayed on; whether hiding the actor in the level editor viewport changes it was not observed.
- [general] The phases are the probe's design (`rp_viewport.mjs` and its checks file): `raise_setter` calls `set_forward_shading_priority(1)` on the sun and `raise_property` calls `set_editor_property('forward_shading_priority', 1)`; in `moon_component_hidden` both priorities are 0 and the moon component is set invisible; in `moon_zero_intensity` both are 0 and the moon is visible with intensity 0.
- [tested] Same run, a limit of the evidence: the observations were read by an agent from the eight screenshots, not by a person watching, and the phases ran in a Play-In-Editor viewport, not in the level editor viewport. The editor's own viewport drew nothing under `-RenderOffScreen`.
- [tested] Same run, capture: a high-res screenshot (`AutomationLibrary.take_high_res_screenshot`) in the Play-In-Editor run was a black frame without the message, and the console command `Shot showui nosuffix filename=<name>` kept it. The file was written as `<name>00000.png` under `Saved/Screenshots/WindowsEditor/` (`nosuffix` did not remove the `00000`) and shows the whole editor window (1280 x 720) with the viewport inside it. [documented] A request without UI turns on-screen messages off for that shot (`FScreenshotRequest::RequestScreenshot`, `Engine/Private/UnrealClient.cpp` 258-264).
- [documented] The message is compiled only with the editor. The flag (lines 1091-1093), the counting (1501-1512), the test (1660-1663) and the message (1899-1908) are all under `WITH_EDITOR`, so a build without the editor never prints it. The selection itself is not under `WITH_EDITOR` (1513-1520): a game still picks one light the same way, silently.
- [documented] It prints when two or more directional lights tie for the highest priority. The search starts at -1, a higher priority resets the count to 1 and a lower one is not counted (1198, 1502-1511), and the count restarts for each view while any view with a tie raises the flag (1149, 1660-1662). A sun at 1 and a moon at 0 print nothing; so do two lights at 0 beside a third at 1.
- [documented] What is chosen: the highest `ForwardShadingPriority`, ties broken by the squared colour intensity (1499, 1513-1514; comment 1496-1498). That one light serves forward shading, translucency, single layer water and volumetric fog (`Engine/Classes/Components/DirectionalLightComponent.h` 126-129). The atmosphere slot does not take part in the choice: the loop reads only priority and colour.

## The property and its setter

- [documented] `int32 ForwardShadingPriority` on `UDirectionalLightComponent` is `EditAnywhere, AdvancedDisplay, BlueprintReadOnly`, `ClampMin 0`, in the Light category (`DirectionalLightComponent.h` 126-131). Its default is 0 (`Engine/Private/Components/DirectionalLightComponent.cpp` 1040).
- [documented] `SetForwardShadingPriority(int32)` is `BlueprintCallable` (`.h` 319-320), so Python calls `set_forward_shading_priority`. The body clamps below 0 to 0 and marks the render state dirty (`.cpp` 1448-1456), and does nothing on a registered component whose mobility is Static (`Engine/Classes/Components/SceneComponent.h` 1363-1366). `ADirectionalLight` defaults to Stationary (`Engine/Private/Light.cpp` 244), so the setter works on a default light.
- [tested] Unreal 5.8.2, headless (`rp_validate.mjs`, 3 of 3 including the stricter route check): two `DirectionalLight` actors read `forward_shading_priority` 0 and 0; `set_forward_shading_priority(1)` on one gave 1 and 0.
- [tested] Same run, other routes on fresh lights: `set_editor_property("forward_shading_priority", 2)` stored 2, so the setter is not the only route. Assigning the attribute raised "Property 'ForwardShadingPriority' for attribute 'forward_shading_priority' on 'DirectionalLightComponent' is read-only and cannot be set"; reading it works. The setter with -3, after 2, read back 0. A component set to Static kept 4 after the setter was called with 5. A spawned light's mobility read `STATIONARY`.
- [general] `set_editor_property` stores the value without calling the setter. Use the setter, which is the documented route.
- [tested] Unreal 5.8.3, the rendering run above: the `raise_property` phase (`set_editor_property`) removed the message and `back_property` brought it back, as the setter phases did, in a Play-In-Editor viewport on the copies of the lights.
- [tested] Unreal 5.8.3, headless extras of `rp_viewport.mjs` (3 of 3): the existing-level form (`get_all_level_actors` filtered to `DirectionalLight`) found both lights and set each one's priority; the setter on a component made with `unreal.new_object` that the world never registered recorded the value 3; `r.ForwardShading` read 0.

```python
light = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector())
light.get_component_by_class(unreal.DirectionalLightComponent).set_forward_shading_priority(1)
```

## A sun and a moon

- [documented] Two atmosphere sun lights are supported, "a sun and a moon, or two suns", through `AtmosphereSunLightIndex` 0 or 1 (`DirectionalLightComponent.h` 166-170; `SetAtmosphereSunLightIndex` is `BlueprintCallable`, line 314).
- [documented] To stop the message, leave exactly one light holding the highest priority: give the sun 1 and the moon 0 (the tie rule above).
- [general] With equal priorities the brightness ranking can change over a day and night cycle, so translucency, water and fog could follow a different light at different times. A fixed priority on the sun removes that.
- [general] Raising the moon's priority at night, so those effects follow it, is untested here.

## Not covered here

The message in the level editor viewport, and a person watching it: the 5.8.3 run read screenshots of a Play-In-Editor viewport. Day and night switching. How MegaLights and Virtual Shadow Maps treat directional lights: see [MegaLights](unreal-megalights.md) and [Virtual Shadow Maps](unreal-virtual-shadow-maps.md).
