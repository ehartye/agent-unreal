# Smart Objects at run time from C++ in Unreal 5.8: a definition and objects made in code

Target: Unreal Engine 5.8, Windows. Headers were read in a 5.8.2 install under `Engine/Plugins/Runtime/SmartObjects/`. The recipe was used once on 5.8.2 and 5.8.3 in a native C++ project with no authored assets. No run in this repository covers it, so no line here is `[tested]`. For the editor route (a SmartObjectDefinition asset and a Smart Object Component) see [AI](unreal-ai-behavior.md).

## Enable it

- [documented] Enable the `SmartObjects` plugin. `SmartObjects.uplugin` leaves it off by default and marks it neither beta nor experimental; it enables GameplayAbilities, TargetingSystem, WorldConditions, PropertyAccessEditor and PropertyBindingUtils.
- [documented] Add `SmartObjectsModule` to the game module's dependencies. `SmartObjectsModule.Build.cs` lists `MassCore` and `MassEntity` as public dependencies, so it needs no Mass plugin and sits beside a hand-run pipeline ([native Mass](unreal-mass-native.md)).

## Build a definition and an object

1. [documented] Make one `USmartObjectDefinition` with `NewObject` and add slots with `DebugAddSlot()`. It is public and, in `SmartObjectDefinition.h`, "used for testing purposes". `GetMutableSlots()` is inside `WITH_EDITOR`, so it is not a route in a game process. [general] Whether `DebugAddSlot` stays across releases is unknown; read it again on each engine release.
2. [documented] Give each slot a behaviour: add an instance of your own `USmartObjectBehaviorDefinition` subclass to the slot's `BehaviorDefinitions` (an instanced array, not editor-only data). The definition's `DefaultBehaviorDefinitions` serve a slot that has none, and the first definition of a type wins. [general] An empty subclass was enough to name what a slot offers.
3. [documented] `USmartObjectSubsystem::GetCurrent(World)` returns the subsystem. `CreateSmartObject(Definition, Transform, OwnerData)` returns an `FSmartObjectHandle` (`OwnerData` is an `FConstStructView`). Before the subsystem's runtime is initialised it ensures and returns an invalid handle, so test `IsValid()` on the result.

## Find, claim, occupy and free

- [documented] `FindSlots(Handle, Filter, OutSlots)` lists the object's slots that match an `FSmartObjectRequestFilter`. Its `BehaviorDefinitionClasses` restricts the search to those behaviour classes, so two kinds of user can share one object by the behaviour they use. The filter also takes `UserTags`, `ClaimPriority`, `ActivityRequirements`, `bShouldEvaluateConditions` and `bShouldIncludeClaimedSlots` (false by default, so slots already claimed are left out of a find).
- [documented] `MarkSlotAsClaimed(SlotHandle, Priority)` returns an `FSmartObjectClaimHandle` and is `[[nodiscard]]`. `MarkSlotAsOccupied(ClaimHandle, BehaviourClass)` returns the slot's behaviour definition (a template overload takes the type). `MarkSlotAsFree(ClaimHandle)` returns a bool and releases a claimed or occupied slot.
- [documented] Keep each claim handle: it is the only argument `MarkSlotAsFree` takes.

## What to check

- [general] Observed once: with many users, claim in batches. The swarm claimed twelve slots a frame, and a replay asserted that the claimed count never passed the object's slot count.
- [general] Run one cycle per change: create, find with the behaviour filter, claim, occupy, free, and assert the counts at each step.

## Not covered

- Smart Objects driven from StateTree or Behavior Tree tasks, collections and serialization, world conditions, the editor-authored path, replication and the subsystem's debugger.
