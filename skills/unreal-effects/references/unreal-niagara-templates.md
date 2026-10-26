# Choosing a Niagara template: the shipped catalog

Written for Unreal 5.8. The descriptions below are the text Epic ships on each template system, listed by [`niagara_templates.py`](../../../examples/unreal/niagara_templates.py). Authoring and driving a system is in [Niagara in Unreal](unreal-niagara.md).

## Choose from the shipped description

Every template system carries a one-line `template_asset_description`, the text the editor shows in its New System picker. Read it before choosing, and run `niagara_templates.py` to list it for the fluid, sand and core templates. Epic's [Niagara Fluids reference](https://dev.epicgames.com/documentation/unreal-engine/niagara-fluids-reference-in-unreal-engine) covers the plugin's design and render settings, with the 3D gas fire as its worked example.

## Gas (Niagara Fluids)

| Template | Shipped description |
|---|---|
| `Grid2D_Gas_MovingFire` | 2D fire simulation that can be parented in a map |
| `Grid2D_Gas_SmokeFire` | Standing fire with smoke |
| `Grid2D_Gas_Smoke` | 2D smoke plume |
| `Grid2D_Gas_Explosion` | 2D gas explosion system |
| `Grid2D_Gas_Color` | Colored smoke |
| `Grid3D_Gas_Fire`, `Grid3D_Gas_ColoredFire` | Fire from a static mesh without smoke |
| `Grid3D_MovingGridFire` | A gas simulation which can be attached to an animating actor and behaves as though simulating in world space; for torches |
| `Grid3D_Gas_Smoke` | Smoke plume from a procedural source |
| `Grid3D_Gas_Explosion` | Gas explosion; particle sourcing is not deterministic (but faster) |
| `Grid3D_Gas_DivergenceExplosion` | Gas expansion explosion; uses divergence to expand the initial blast |
| `Grid3D_Gas_DustExplosion` | Dust explosion from a particle source |
| `Grid3D_Gas_SimpleParticleSource` | A 3D gas simulation sourced from a simple particle emitter; a good starting point for most effects |
| `Grid3D_Gas_ParticleAdvection` | Particle advection through a gas simulation |
| `Grid3D_Gas_ColoredSmoke` | Colored smoke advection; colour comes from particles |

## Liquid, sand and the core templates

- `Grid3D_Flip_Hose`: a static pool plus constant emission. `Grid3D_Flip_Pool`: a static pool; moving static meshes act as collisions and cause splashes. `Grid3D_Flip_Splash`: one splash burst. `Grid3D_FLIP_Coupled` and `SandSystem` ship without a description.
- Core (`/Niagara/DefaultAssets/Templates/Systems`): `DirectionalBurst` (a burst of sprites in a direction), `RadialBurst` (omnidirectional burst with ribbon trails), `SimpleExplosion` (sprite core, velocity-aligned sparks, oriented meshes). `AttributeReaderTrails` and the three lightweight systems ship without a description.

## Template emitters: which one covers which effect

The 14 emitters in `/Niagara/DefaultAssets/Templates/Emitters/` go into a system with `AddEmitter` ([Niagara toolsets](unreal-niagara-toolsets.md)). [`nts_author.py`](../../../examples/unreal/niagara_toolsets/nts_author.py) adds all 14 and reads each one's description, renderer, modules, spawn rate or burst count and loop behaviour; [`nts_validate.mjs`](../../../examples/unreal/niagara_toolsets/README.md) checks the [tested] lines below on 5.8.4.

| Emitter | Shipped description | Renderer, spawn |
|---|---|---|
| `SingleLoopingParticle` | Emits a single particle whose lifetime is linked to emitter loop duration | Sprite, burst of 1 per loop (`Once`) |
| `SimpleSpriteBurst` | A simple sprite burst with no location or velocity, ready for customization | Sprite, burst of 1 |
| `OmnidirectionalBurst` | An Omnidirectional Burst | Sprite, burst of 100 |
| `DirectionalBurst` | Emits a burst of sprites in the specified direction | Sprite, burst of 75 |
| `ConfettiBurst` | A template which utilizes aerodynamic drag to emulate the tumbling, organic motion of a burst of lightweight flat particles such as confetti, paper, or leaves. | Sprite on the GPU, burst of 100 |
| `UpwardMeshBurst` | An burst of meshes spawning upwards in an explosive shape | Mesh, burst of 80 |
| `Fountain` | A looping fountain spray | Sprite, 90 per second (`Infinite`) |
| `HangingParticulates` | Hanging Particulates Swirling in a rectangular area | Sprite, 50 per second |
| `BlowingParticles` | A template which emulates blowing leaves or other flat particle shapes such as paper. Utilizes aerodynamic drag and wind turbulence for a natural, organic look. | Sprite on the GPU, 15 per second |
| `RecycleParticlesInView` | Looping particles being recycled in view | Sprite on the GPU, burst of 1000, a `ViewRecycler` module |
| `StaticBeam` | Basic Static Beam without dynamically recalculated start and endpoints | Ribbon, burst of 100, `SpawnBeam` |
| `DynamicBeam` | (none shipped) | Ribbon, as `StaticBeam` plus `UpdateBeam` |
| `LocationBasedRibbon` | (none shipped) | Ribbon, no spawn module |
| `Minimal` | A minimal, almost empty Emitter that helps you with building an Emitter from scratch | Sprite, no spawn module |

- [tested] Choose by what spawns and what renders: a burst is `SpawnBurst_Instantaneous`, a stream is `SpawnRate`, a beam or ribbon needs the `Ribbon` renderer. Every template emitter runs in world space (`bLocalSpace` false); switch to local space for anything that moves with its owner ([inputs](unreal-niagara-toolset-inputs.md)).
- [tested] For a held orb, glow or marker use `SingleLoopingParticle`: its `Lifetime` is linked to `Emitter.CurrentLoopDuration` (1 s), so replace the lifetime as a whole for a fixed time, or set `Loop Duration` after `Life Cycle Mode` is `Self` ([inputs](unreal-niagara-toolset-inputs.md)).
- [tested] For a burst use `OmnidirectionalBurst` or `DirectionalBurst`; for a stream use `Fountain`. In world space a stream's particles stay where they spawned, so on a moving emitter they form a trail.
- [tested] `Fountain`'s rate is the `SpawnRate` input of its `SpawnRate` module (`scriptName` `EmitterUpdateScript`, `inputNameStack` `["SpawnRate"]`): a plain `NiagaraFloat` that reads 90.
- [general] Set the rate with the read-change-write of a plain input in [Niagara toolsets](unreal-niagara-toolsets.md) and read it back; that recipe was run on a particle lifetime, not on this input.
- [tested] For a straight light column use `StaticBeam`: `Beam Start` is the `SimulationPosition` dynamic input and `Beam End` is (200, 0, 0), which you change for the column's length and direction; its width is a `FloatFromCurve` dynamic input.
- [tested] `LocationBasedRibbon` has a `Ribbon` renderer and no spawn module, so nothing creates its particles until a spawn module is added.

## Choosing

- Use the 2D gas templates for games and real-time effects and the 3D ones for hero effects and cinematics; 3D costs more memory and GPU time (Epic's Niagara Fluids reference).
- For a fire parented in a map, use `Grid2D_Gas_MovingFire`; for one that stands in place with smoke, `Grid2D_Gas_SmokeFire`; for one that follows an animated actor in 3D, `Grid3D_MovingGridFire`.
- Use the 3D fire when you want a volume to tune through its Controls emitter (render temperature, density, step size).
- Compare candidates side by side on a plain stage: [`stage_build.py`](../../../examples/unreal/niagara-showcase/stage_build.py) places any list of systems on a flat plane and [`showcase_explore.py`](../../../examples/unreal/niagara-showcase/showcase_explore.py) flies you between them.
- Use the 3D fluid templates with Generate Mesh Distance Fields enabled ([Niagara in Unreal](unreal-niagara.md#fluids)).
- Bake a fluid to a flipbook when only its look is needed in real time; Epic's reference describes that route.
