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

## Choosing

- Use the 2D gas templates for games and real-time effects and the 3D ones for hero effects and cinematics; 3D costs more memory and GPU time (Epic's Niagara Fluids reference).
- For a fire parented in a map, use `Grid2D_Gas_MovingFire`; for one that stands in place with smoke, `Grid2D_Gas_SmokeFire`; for one that follows an animated actor in 3D, `Grid3D_MovingGridFire`.
- Use the 3D fire when you want a volume to tune through its Controls emitter (render temperature, density, step size).
- Compare candidates side by side on a plain stage: [`stage_build.py`](../../../examples/unreal/niagara-showcase/stage_build.py) places any list of systems on a flat plane and [`showcase_explore.py`](../../../examples/unreal/niagara-showcase/showcase_explore.py) flies you between them.
- Use the 3D fluid templates with Generate Mesh Distance Fields enabled ([Niagara in Unreal](unreal-niagara.md#fluids)).
- Bake a fluid to a flipbook when only its look is needed in real time; Epic's reference describes that route.
