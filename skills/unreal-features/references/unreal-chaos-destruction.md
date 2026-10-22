# Chaos destruction in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. Chaos is the engine's rigid-body physics; Chaos Destruction fractures pre-built Geometry Collection assets into pieces held by a connection graph that breaks under collisions and physics fields (Epic: Destruction Overview, Physics in Unreal Engine).

## Enable it

| Plugin | Category | Default | Flags | Depends on |
|---|---|---|---|---|
| `GeometryCollectionPlugin` | Geometry | off | beta | ProceduralMeshComponent, ChaosSolverPlugin, Dataflow, PlanarCut, GeometryProcessing, GeometryDataflow, Fracture, EditorScriptingUtilities |
| `Fracture` (Fracture mode) | Physics | off | beta | PlanarCut |
| `PlanarCut` | Physics | off | beta | GeometryProcessing |
| `FieldSystemPlugin` | Geometry | off | beta | none |
| `ChaosSolverPlugin` | Physics | on | beta | none |
| `ChaosCaching` | Physics | off | experimental | Takes |
| `ChaosVD` | Physics | on | beta | EditorDataStorage, EditorDataStorageFeatures, GeometryProcessing |

Enable in Edit > Plugins (Physics and Geometry categories), or add `{ "Name": "GeometryCollectionPlugin", "Enabled": true }` to the `Plugins` array of the `.uproject`, then restart the editor. `GeometryCollectionPlugin` lists Fracture, PlanarCut and Dataflow as dependencies, so enabling it brings them in.

## Use it when

- A prop, wall or building must break into pieces from impacts or a blast.
- Artists need control over how a mesh fractures (Voronoi, radial, planar, slice, brick, mesh-shaped cuts).
- A structure must collapse progressively: pieces stay joined until strain exceeds a threshold.
- A fixed destruction sequence must replay cheaply: record it with Chaos Caching and play it back.
- A physics simulation needs frame-by-frame inspection: record it with the Chaos Visual Debugger.

## Use something else when

- Use [unreal-chaos-niagara.md](unreal-chaos-niagara.md) when you need dust, debris or sparks driven by break and collision events (the `ChaosNiagara` descriptor: "Import destruction data from Chaos into Niagara to generate secondary destruction effects").
- Use [unreal-chaos-cloth-and-flesh.md](unreal-chaos-cloth-and-flesh.md) when the object deforms (cloth, soft bodies) instead of breaking.
- Use [unreal-chaos-vehicles.md](unreal-chaos-vehicles.md) when the object is a driven vehicle; the modular vehicle plugin builds vehicles from Geometry Collections.
- Use [unreal-mover.md](unreal-mover.md) when you need character movement.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Create a Geometry Collection from meshes | Editor UI | Fracture mode (Shift-6) > Generate > New; the source actors are replaced by the collection |
| Fracture and cluster | Editor UI | Fracture mode tools: Uniform, Cluster, Radial, Planar, Slice, Brick (experimental), Mesh, Custom; Reset undoes a fracture |
| Fracture in a graph | Editor UI | Dataflow asset: Static Mesh To Collection, Voronoi Fracture, Auto Cluster, Geometry Collection Terminal. Python has `unreal.DataflowAssetFactory`; the collection links the graph through `unreal.GeometryCollection` `dataflow_asset` and `dataflow_terminal` |
| Edit collection settings | Python | `unreal.GeometryCollection`: `damage_model`, `collision_type`, `mass`, `enable_nanite` |
| Place a collection in a level | Python | `unreal.GeometryCollectionActor` with `unreal.GeometryCollectionComponent` |
| Break on demand | Blueprint / C++ | `GeometryCollectionComponent`: Apply External Strain (item index, location, radius, propagation depth, propagation factor, strain), Apply Linear Velocity, Set Anchored By Index, Crumble Cluster |
| Break with a field | Blueprint | Field System Component Blueprint: Apply External Strain, Apply Uniform Force, Apply Radial Force. Python has `unreal.FieldSystemComponent` and `unreal.FieldSystemActor` |
| Listen for breaks | Blueprint / C++ | `GeometryCollectionComponent` event `OnChaosBreakEvent`; Python has the data types `unreal.ChaosBreakEvent` and `unreal.ChaosBreakingEventRequestSettings` |
| Solver settings | Python | `unreal.ChaosSolverActor`, `unreal.ChaosSolverFactory`, `unreal.ChaosPhysicsSettings` |
| Record and replay destruction | Python | `unreal.ChaosCacheManager` (`find_or_add_observed_component`, `enable_playback`, `enable_playback_by_cache`, `clear_observed_components`) and `unreal.ChaosCacheCollection`; cache modes are Static Pose, Play, Record; start modes are Timed and Triggered |
| Debug a simulation | Editor UI | Tools > Debug > Chaos Visual Debugger; recordings are `.utrace` files |
| Annotate a CVD recording | Python | `unreal.ChaosVDRuntimeBlueprintLibrary`: `record_debug_draw_box`, `record_debug_draw_line`, `record_debug_draw_sphere`, `record_debug_draw_vector`, `set_trace_relevancy_volume` |

Fracture mode and Dataflow graph editing are editor UI; the Python surface has no fracture-tool class.

## Workflow

1. Prepare source meshes: watertight (no open faces or edges) and non-intersecting. Each object in a collection simulates separately and the solver pushes overlapping objects apart.
2. Build the Geometry Collection from Static Meshes, Blueprints with Static Mesh components, or other collections. The first selected actor sets the pivot.
3. Fracture. Each fracture adds a hierarchy level and each level can use a different tool. Use Random Seed -1 for a new pattern each time and a fixed value to reproduce one. Preview with Explode Amount.
4. Set Damage Thresholds per cluster level (the Dataflow quickstart uses 5000, 500 and 50).
5. Place the collection above the ground and run Simulate; it fractures on impact.
6. Trigger breaks with an external strain at the hit location or with a Field System Component. Use World Support (kinematic parts) or Anchor Fields to hold a structure up.
7. For repeatable sequences, add a Cache Manager, observe the collection, record, then play back. Cached parts can still become live after interaction.
8. For debugging, choose Data Channels before recording; fewer channels give smaller files. Recording needs console access, as in Development or Test builds.
9. To show original materials, disable Show Bone Colors (Details > General under Chaos Physics). Elements 1 and 3 duplicate element 0; element 2 is the internal surface.

## Sources

- [Destruction Overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/destruction-overview)
- [Destruction Quick Start](https://dev.epicgames.com/documentation/en-us/unreal-engine/destruction-quick-start)
- [Geometry Collections User Guide](https://dev.epicgames.com/documentation/en-us/unreal-engine/geometry-collections-user-guide)
- [Fracturing Geometry Collections User Guide](https://dev.epicgames.com/documentation/en-us/unreal-engine/fracturing-geometry-collections-user-guide)
- [Dataflow for Destruction Quickstart](https://dev.epicgames.com/documentation/unreal-engine/dataflow-for-destruction-quickstart)
- [Overview of Physics Fields](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-physics-fields-in-unreal-engine)
- [Physics in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/physics-in-unreal-engine)
- [Getting Started with Chaos Visual Debugger](https://dev.epicgames.com/documentation/unreal-engine/getting-started-with-chaos-visual-debugger)
- [Capturing Data with Chaos Visual Debugger](https://dev.epicgames.com/documentation/en-us/unreal-engine/capturing-data-with-chaos-visual-debugger)
- Plugin descriptors (`.uplugin`) for the plugins above; engine headers `GeometryCollectionComponent.h`, `FieldSystemComponent.h`, `CacheManagerActor.h`, `ChaosVDRuntimeBlueprintLibrary.h`.
