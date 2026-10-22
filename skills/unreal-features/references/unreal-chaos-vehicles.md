# Chaos vehicles in Unreal 5.8: when to use them and how to drive them

Target: Unreal Engine 5.8, Windows. Two vehicle systems sit on Chaos physics: `ChaosVehiclesPlugin` ("Chaos Vehicle Integration", wheeled vehicles on a skeletal mesh) and `ChaosModularVehicle` ("Modular Vehicle Integration", vehicles assembled from Geometry Collection parts). Both coexist in one project.

## Enable it

| Plugin | Category | Default | Flags | Depends on | Modules |
|---|---|---|---|---|---|
| `ChaosVehiclesPlugin` | Physics | off | experimental | none | Runtime, UncookedOnly |
| `ChaosModularVehicle` | Physics | off | experimental | EnhancedInput | Runtime, UncookedOnly |
| `ChaosModularVehicleExamples` | Physics | off | beta | Mover, ChaosMover | content only |

Enable in Edit > Plugins (Physics category), or add `{ "Name": "ChaosVehiclesPlugin", "Enabled": true }` to the `Plugins` array of the `.uproject`, then restart the editor. The modular plugin is separate from the wheeled plugin and does not need it. The wheeled plugin requires Chaos physics.

Modular vehicles also need Project Settings > Engine > Physics > Physics Prediction and Physics History Capture turned on (server-authoritative client prediction with rewind resimulation).

## Use it when

Use `ChaosVehiclesPlugin` when:
- You need a car, truck, buggy or similar vehicle with a fixed skeletal mesh, any number of wheels and any number of gears.
- Wheel collision comes from a Physics Asset and wheels animate through an Animation Blueprint.
- You need aerofoils (downforce or lift) or thrust forces on the vehicle.

Use `ChaosModularVehicle` when:
- Parts must be added or removed at runtime, or the vehicle must break apart when a collision or code detaches a component.
- The vehicle is built from separate parts (chassis, wheels, engine, thrusters, wings) that each carry their own simulation module.
- You need native client-predicted, server-authoritative networking through the Network Physics component and resimulation.

## Use something else when

- Use [unreal-chaos-destruction.md](unreal-chaos-destruction.md) when the object breaks or collapses but is not driven.
- Use [unreal-mover.md](unreal-mover.md) when you need character movement; `ChaosMover` is the descriptor's Chaos-physics character movement on the Mover framework.
- Use [unreal-chaos-niagara.md](unreal-chaos-niagara.md) when a vehicle crash needs secondary particle effects from Chaos events.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Wheel Blueprint | Editor UI | Blueprint on `ChaosVehicleWheel`: Axle Type, Wheel Radius (cm, matches the render model), Affected by Handbrake / Engine / Steering, Max Steer Angle |
| Wheeled vehicle Blueprint | Editor UI | Blueprint on `WheeledVehiclePawn`; Vehicle Movement Component > Wheel Setups (Wheel Class and Bone Name per wheel), Engine Setup > Torque Curve |
| Torque curve | Editor UI | Curve Float asset: X is RPM, Y is torque in Newton meters |
| Physics Asset | Editor UI | Single Convex Hull body; wheel bones as Spheres; suspension bones as No Collision |
| Animation | Editor UI | Anim Blueprint on `VehicleAnimationInstance`: Mesh Space Ref Pose > Wheel Controller for WheeledVehicle > Component To Local |
| Wheeled input | Blueprint | Set Throttle / Brake / Steering / Pitch / Roll / Yaw Input, Gear Up and Gear Down, Handbrake (pressed and released nodes) |
| Inspect wheeled classes | Python | `unreal.WheeledVehiclePawn`, `unreal.ChaosWheeledVehicleMovementComponent`, `unreal.ChaosVehicleWheel`, `unreal.ChaosWheelSetup`, `unreal.VehicleEngineConfig`, `unreal.VehicleTransmissionConfig`, `unreal.VehicleSteeringConfig`, `unreal.VehicleDifferentialConfig` |
| Modular vehicle Blueprint | Editor UI | Blueprint on `ModularVehicleClusterPawn`; Geometry Collection parts placed under the Cluster Union Vehicle Component |
| Simulation modules | Editor UI | `VehicleSimSuspension` under each wheel part, `VehicleSimWheel` under each suspension, `VehicleSimEngine` under the chassis, `VehicleSimClutch` under the engine, `VehicleSimTransmission` under the clutch; also Thruster and Aerofoil |
| Modular input | Editor UI | Enhanced Input actions (Brake, Handbrake, Reverse, Steering, Throttle) mapped on the Vehicle Simulation component's Vehicle Input array |
| Inspect modular classes | Python | `unreal.ModularVehicleClusterPawn`, `unreal.ModularVehicleBaseComponent`, `unreal.ClusterUnionVehicleComponent`, `unreal.VehicleSimWheelComponent`, `unreal.VehicleSimEngineComponent`, `unreal.VehicleSimSuspensionComponent`, `unreal.ModularVehicleAnimationInstance` |
| Parts as Geometry Collections | Editor UI | Fracture mode > Generate > New for each part ([destruction reference](unreal-chaos-destruction.md)) |

Authoring Blueprints, Animation Blueprints, Physics Assets and curves is editor UI; the Python rows above name classes the editor module exposes.

## Workflow

Wheeled vehicle:
1. Enable `ChaosVehiclesPlugin` and restart.
2. Prepare a Skeletal Mesh, a Physics Asset, an Animation Blueprint, a torque curve and wheel Blueprints (vehicles share a wheel Blueprint only when wheel dimensions and suspension limits match).
3. Set the wheel flags: engine on the rear wheels for rear-wheel drive, the front for front-wheel drive, all for all-wheel drive; steering on the front wheels; handbrake on the rear wheels.
4. Build the vehicle Blueprint on `WheeledVehiclePawn`, assign the mesh and Animation Blueprint, enable Simulate Physics, fill Wheel Setups, assign the torque curve.
5. Add a camera with Use Pawn Control Rotation off, map inputs to the Set Input nodes, and set a Game Mode whose Default Pawn Class is the vehicle.

Modular vehicle:
1. Enable `ChaosModularVehicle`, then Physics Prediction and Physics History Capture.
2. Convert each part (at least a chassis and a wheel) to a Geometry Collection and set its mass and damage threshold.
3. Create the Blueprint on `ModularVehicleClusterPawn` and place the parts (X forward, Y right, Z up).
4. Enable Force Update Active Transforms (Chaos Physics > Clustering) so detached pieces do not follow the vehicle.
5. Add the simulation components in the hierarchy above, name the Vehicle Input entries to match each module (Engine: Throttle; Clutch: Clutch; Transmission: ChangeUp, ChangeDown; Wheels: Steering, Brake, Handbrake), and add a Dead Zone to Steering.
6. For skeletal animation, use an Animation Blueprint on `ModularVehicleAnimationInstance` with a Modular Vehicle Controller node and set Bone Name on each wheel and suspension.

## Sources

- [How to Set up Vehicles in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/how-to-set-up-vehicles-in-unreal-engine)
- [Chaos Modular Vehicles Overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/chaos-modular-vehicles-overview)
- [Chaos Modular Vehicles Quickstart](https://dev.epicgames.com/documentation/en-us/unreal-engine/chaos-modular-vehicles-quickstart)
- [Physics in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/physics-in-unreal-engine)
- Plugin descriptors (`.uplugin`) for `ChaosVehiclesPlugin`, `ChaosModularVehicle`, `ChaosModularVehicleExamples` and `ChaosMover`.
