# Two directional lights: ForwardShadingPriority and the renderer message

Written for Unreal 5.8.2. [`rp_validate.mjs`](../../../examples/unreal/rendering_probes/README.md) runs each [tested] line headless on a throwaway project; [documented] lines name a file and its line numbers in the engine's `Engine/Source/Runtime` folder; [general] lines are inference. Read this when a level with a sun and a moon, or any two directional lights, shows a renderer message that directional lights are competing.

## The message

- [documented] The text is two lines, drawn orange: "Multiple directional lights are competing to be the single one used for forward shading, translucent, water or volumetric fog. Please adjust their ForwardShadingPriority." and "As a fallback, the main directional light will be selected based on overall brightness." (`Renderer/Private/LightGridInjection.cpp` 1904-1905).
- [documented] The message is compiled only with the editor. The flag (lines 1091-1093), the counting (1501-1512), the test (1660-1663) and the message (1899-1908) are all under `WITH_EDITOR`, so a build without the editor never prints it. The selection itself is not under `WITH_EDITOR` (1513-1520): a game still picks one light the same way, silently.
- [documented] It prints when two or more directional lights tie for the highest priority. The search starts at -1, a higher priority resets the count to 1 and a lower one is not counted (1198, 1502-1511), and the count restarts for each view while any view with a tie raises the flag (1149, 1660-1662). A sun at 1 and a moon at 0 print nothing; so do two lights at 0 beside a third at 1.
- [documented] What is chosen: the highest `ForwardShadingPriority`, ties broken by the squared colour intensity (1499, 1513-1514; comment 1496-1498). That one light serves forward shading, translucency, single layer water and volumetric fog (`Engine/Classes/Components/DirectionalLightComponent.h` 126-129). The atmosphere slot does not take part in the choice: the loop reads only priority and colour.

## The property and its setter

- [documented] `int32 ForwardShadingPriority` on `UDirectionalLightComponent` is `EditAnywhere, AdvancedDisplay, BlueprintReadOnly`, `ClampMin 0`, in the Light category (`DirectionalLightComponent.h` 126-131). Its default is 0 (`Engine/Private/Components/DirectionalLightComponent.cpp` 1040).
- [documented] `SetForwardShadingPriority(int32)` is `BlueprintCallable` (`.h` 319-320), so Python calls `set_forward_shading_priority`. The body clamps below 0 to 0 and marks the render state dirty (`.cpp` 1448-1456), and does nothing on a registered component whose mobility is Static (`Engine/Classes/Components/SceneComponent.h` 1363-1366). `ADirectionalLight` defaults to Stationary (`Engine/Private/Light.cpp` 244), so the setter works on a default light.
- [tested] Unreal 5.8.2, headless (`rp_validate.mjs`, 3 of 3 including the stricter route check): two `DirectionalLight` actors read `forward_shading_priority` 0 and 0; `set_forward_shading_priority(1)` on one gave 1 and 0.
- [tested] Same run, other routes on fresh lights: `set_editor_property("forward_shading_priority", 2)` stored 2, so the setter is not the only route. Assigning the attribute raised "Property 'ForwardShadingPriority' for attribute 'forward_shading_priority' on 'DirectionalLightComponent' is read-only and cannot be set"; reading it works. The setter with -3, after 2, read back 0. A component set to Static kept 4 after the setter was called with 5. A spawned light's mobility read `STATIONARY`.
- [general] `set_editor_property` stores the value without calling the setter. Use the setter, which is the documented route; whether a rendering viewport follows a value stored through `set_editor_property` was not run.

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

The message in a rendered viewport: the probe runs with `-nullrhi`, and the message is drawn only by a rendering editor viewport, so it was not seen and its disappearance was not observed. Day and night switching. How MegaLights and Virtual Shadow Maps treat directional lights: see [MegaLights](unreal-megalights.md) and [Virtual Shadow Maps](unreal-virtual-shadow-maps.md).
