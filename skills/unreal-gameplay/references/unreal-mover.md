# Mover in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. Mover is a plugin for modular actor movement with rollback networking, built to succeed the Character Movement Component (CMC). ChaosMover drives Mover actors from the Chaos physics simulation.

## Enable it

| Plugin | Category | Enabled by default | Flags (descriptor) | Dependencies |
|---|---|---|---|---|
| `Mover` | Gameplay | no | experimental | NetworkPrediction, MotionWarping, PoseSearch, Water, ChaosVD |
| `ChaosMover` | Physics | no | experimental | Mover |

- Enable in Edit > Plugins, or add `{ "Name": "Mover", "Enabled": true }` (and `ChaosMover`) to the `Plugins` array in the `.uproject`, then restart the editor.
- Add the `MoverExamples` plugin for sample maps and pawns (`L_CharacterMovementBasics`, `L_LayeredMoves`, `L_PathfindingMovement`, `L_PhysicallyBasedCharacter`).
- Recommended project settings: Network Prediction / Preferred Ticking Policy = Fixed, Simulated Proxy Network LOD = Interpolated, Enable Fixed Tick Smoothing = true. For single-player, Preferred Ticking Policy = Independent.

## Use it when

- The mover is not a vertical capsule on an `ACharacter`: Mover needs only a root SceneComponent, no skeletal mesh, no collision primitive, and gravity need not point down.
- You need movement that is rolled back and resimulated across clients (Network Prediction), or networked physics-driven characters (ChaosMover).
- You need modes, temporary forces and stance changes as separate, stackable, Blueprint-extensible pieces, including modes added at runtime or from plugins.
- You need AI or path-following movement, a predicted trajectory for Motion Matching (`GetPredictedTrajectory`), or a moving platform that is an Actor and not a Pawn.
- The project is single-player and accepts an experimental plugin: use `MoverStandaloneLiaisonComponent` as the Backend Class to remove Network Prediction overhead.
- A physics-driven pawn must push objects and be pushed back: use ChaosMover (`ChaosCharacterMoverComponent`).

## Use something else when

- Use the built-in Character Movement Component when you need proven behaviour for a capsule humanoid; Epic describes CMC as battle-hardened with many shipped projects and Mover as untested in shipped projects. Epic keeps supporting CMC.
- Use CMC when you need RVO avoidance, which Mover does not support yet.
- Use [Chaos Vehicles](unreal-chaos-vehicles.md) when the mover is a wheeled vehicle.
- Use plain Kinematic Mover (Mover with a Network Prediction or standalone backend) instead of ChaosMover when you need teleport effects or interaction with non-physics moving objects; the README states teleport does not work with a physics-based character and sync with non-physics actors is poor.
- Use CMC when game code must set `Velocity` directly; Mover state is not externally writable and changes go through modes, layered moves and instant effects.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Enable plugins | `.uproject` edit / editor UI | `Plugins` array; Edit > Plugins |
| Build a Mover pawn | editor UI / Blueprint | Add `CharacterMoverComponent` (or `ChaosCharacterMoverComponent`) plus a liaison backend component; start from `AnimatedMannyPawn` in MoverExamples |
| Feed input | Blueprint / C++ | Implement the ProduceInput interface (`On Produce Input`); Python class `unreal.MoverDataModelBlueprintLibrary` has `set_directional_input`, `set_velocity_input` |
| Add or find modes | Python / Blueprint | `unreal.MoverComponent.add_movement_mode_from_class`, `find_movement_mode_by_name` |
| Crouch, jump checks | Python / Blueprint | `unreal.CharacterMoverComponent.crouch`, `can_crouch`, `can_actor_jump` |
| Read state | Python / Blueprint | `unreal.MoverComponent.get_last_input_cmd`; `unreal.MoverDataModelBlueprintLibrary.get_velocity_from_sync_state`, `get_location_from_sync_state` |
| Custom mode, layered move, instant effect, modifier, transition | C++ (Blueprint covers modes and custom input/state; some work still needs C++) | `UBaseMovementMode`, `FLayeredMoveBase`, `FInstantMovementEffect`, `FMovementModifierBase`, `UBaseMovementModeTransition` |
| Queue a layered move on a physics mover | Python / Blueprint | `unreal.ChaosMoverBlueprintLibrary.queue_layered_move_instance_authority`, `schedule_layered_move_instance_authority` |
| Debug | editor UI / console | Gameplay Debugger (`'`) Mover category; `Mover.*` console commands; `LogMover` log category |

Python exposes Mover classes for in-editor scripting; authoring pawn Blueprints and writing new modes are editor-UI and C++ work.

## Workflow

1. Enable `Mover` (and `ChaosMover` for physics movement) and `MoverExamples`; apply the Network Prediction project settings.
2. Open `L_CharacterMovementBasics` and play in editor to see the default movement set (Walking, Falling, Flying, Swimming, NavWalking), which mirrors CMC modes and assumes a capsule root with a skeletal mesh attached.
3. Copy a MoverExamples pawn. Pick the backend: Network Prediction liaison for networked play, standalone liaison for single-player, the ChaosMover liaison for physics.
4. Translate player or AI input into the input command each simulation tick; Mover does not read Enhanced Input itself.
5. Change movement through concepts, not state writes: modes execute moves, layered moves add temporary movement (like Root Motion Sources), instant effects launch or teleport, modifiers change parameters such as crouch speed, transitions switch modes.
6. Attach custom data as dynamic input and sync-state structs; no component subclass is needed.
7. Debug with the Gameplay Debugger and `Mover.*` commands.

## Sources

- [Mover in Unreal Engine](https://dev.epicgames.com/documentation/unreal-engine/mover-in-unreal-engine?lang=en-US)
- [Mover Features and Concepts](https://dev.epicgames.com/documentation/en-us/unreal-engine/mover-features-and-concepts-in-unreal-engine)
- [Comparing Mover and Character Movement Component](https://dev.epicgames.com/documentation/en-us/unreal-engine/comparing-mover-and-character-movement-component-in-unreal-engine)
- The plugin descriptors for Mover and ChaosMover; the Mover plugin README shipped with the engine
- The editor Python surface (`unreal.MoverComponent`, `CharacterMoverComponent`, `ChaosCharacterMoverComponent`, `MoverDataModelBlueprintLibrary`, `ChaosMoverBlueprintLibrary`)
