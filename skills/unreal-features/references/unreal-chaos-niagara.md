# ChaosNiagara in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8 on Windows. ChaosNiagara lets Niagara read Chaos destruction data. The plugin descriptor: "Import destruction data from Chaos into Niagara to generate secondary destruction effects." Epic: Niagara can read Break Events and Collision Events from Chaos Destruction to spawn particles or change existing ones at runtime.

## Enable it

| Plugin | Category | Default | Flags | Dependencies |
|---|---|---|---|---|
| `ChaosNiagara` | none set | enabled | beta, not experimental, not editor-only (Runtime module) | `Niagara`, `ChaosSolverPlugin` |
| `GeometryCollectionPlugin` (the assets being destroyed) | Geometry | disabled | beta, not editor-only | `ChaosSolverPlugin`, `Dataflow`, `PlanarCut`, `Fracture`, `ProceduralMeshComponent`, `GeometryProcessing`, `GeometryDataflow`, `EditorScriptingUtilities` |

- Enable through Edit > Plugins, or add `{ "Name": "GeometryCollectionPlugin", "Enabled": true }` to the `Plugins` array of the `.uproject`. `ChaosNiagara` is already on.
- The plugin ships three data interfaces (Chaos Destruction Data, Geometry Collection, Physics Field) and content modules `ApplyChaosData`, `SpawnFromChaos`, `ReadGeometryCollection`, `SetGeometryCollectionTransform`, `GeometryCollectionSize`, plus `ChaosDestructionListenerActor`.

## Use it when

- You need dust, sparks, debris or smoke at the points where a Geometry Collection breaks, collides or trails.
- You need effect density tied to impact strength: filter by speed, mass, impulse, extent, volume or location.
- You need particles that follow the pieces of a fractured object (Geometry Collection data interface).
- You need the effect in a packaged game; the module type is Runtime.
- You need effects that react to a Physics Field; Epic notes Niagara can sample Physics Fields.

## Use something else when

- Use [unreal-chaos-destruction.md](unreal-chaos-destruction.md) to fracture, damage or configure the destructible itself.
- Use [unreal-niagara.md](unreal-niagara.md) or [unreal-niagara-templates.md](unreal-niagara-templates.md) when the effect is not driven by Chaos data.
- Use [unreal-chaos-vehicles.md](unreal-chaos-vehicles.md) for wheel and chassis effects on vehicles.
- Use [unreal-cascade.md](unreal-cascade.md) only for legacy particle assets.
- Use Blueprint or Python event delegates (below) when the response is gameplay logic rather than particles.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Build the Niagara system | Editor UI (Niagara editor); stack scripting is in [unreal-niagara.md](unreal-niagara.md) | Add the "Chaos Destruction Data" parameter under System Exposed Parameters; add the "Apply Chaos Data" module under Particle Spawn |
| Pick the event stream | Editor UI | Data Source: Collision Data, Breaking Data or Trailing Data; override per System Actor in the level |
| Pick the solver | Editor UI | Default is the world solver; set the data interface's Chaos Solver set for a custom solver |
| Thin and shape spawns | Editor UI | Data Process Frequency, Max Number of Data to Spawn, Spawn Count Min/Max, Chance to Spawn, Min/Max thresholds (impulse, speed, mass, extents, volume), location X/Y/Z filtering, Sort by Mass or Random Shuffle, velocity generation modes |
| Follow fractured pieces | Editor UI | Geometry Collection data interface; Source Mode: Default, Source, AttachParent, DefaultCollectionOnly, ParameterBinding; `bIncludeIntermediateBones` adds intermediate bones |
| Place the destructible | Python | `unreal.GeometryCollectionActor` (`geometry_collection_component`), `unreal.GeometryCollectionComponent` |
| Turn on break events | Python / Blueprint | `GeometryCollectionComponent.set_notify_breaks(True)`; Blueprint `SetNotifyBreaks`, `SetNotifyCollisions` |
| React in script | Python / Blueprint | `GeometryCollectionComponent.on_chaos_break_event`; `unreal.ChaosEventRelay` (`on_break_event`, `on_collision_event`, `on_crumbling_event`, `on_removal_event`, `on_trailing_event`); `unreal.ChaosBlueprintLibrary.get_event_relay_from_context` |
| Read event payload | Python | `unreal.ChaosBreakEvent` (`location`, `velocity`, `angular_velocity`, `mass`, `extents`, `index`, `orientation`, `component`, `from_crumble`) |
| Filter event queries | Python | `unreal.ChaosBreakingEventRequestSettings` (`min_mass`, `min_speed`, `min_radius`, `max_distance`, `max_number_of_results`, `sort_method`) |
| Custom data interface | C++ only | Subclass `UNiagaraDataInterface` in a module |

- The editor Python surface lists no Niagara data-interface classes for ChaosNiagara; configure them in the Niagara editor.
- The Geometry Collection header notes a Blueprint "Set Niagara Geometry Collection Component" for setting the source.

## Workflow

1. Create the Niagara emitter, then a Niagara System that uses it.
2. In the System, add the "Chaos Destruction Data" parameter under System Exposed Parameters and choose its Data Source.
3. Add "Apply Chaos Data" under Particle Spawn.
4. Place the system in the level; override Data Source on the System Actor. Use one actor per event type.
5. By default the system listens to every rigid body on the world solver; point it at a custom solver when needed.
6. For gameplay event delegates, enable Notify Collisions or Notify Breaks on the Geometry Collection Actor (Details > General), or call SetNotifyCollisions or SetNotifyBreaks.
7. Tune thresholds and spawn caps until effect density matches impact strength.
8. Epic's Chaos Destruction Demo project includes the ChaosExamples_04_Niagara map as a reference.

## Sources

- [Chaos Destruction Overview (versioned 4.27; step names match the 5.8 class display name "Chaos Destruction Data")](https://dev.epicgames.com/documentation/en-us/unreal-engine/chaos-destruction-overview?application_version=4.27)
- [Physics in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/physics-in-unreal-engine)
- [Destruction Overview](https://dev.epicgames.com/documentation/unreal-engine/destruction-overview?lang=en-US)
- [ChaosNiagara API](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/ChaosNiagara)
- [UNiagaraDataInterfaceChaosDestruction](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/ChaosNiagara/UNiagaraDataInterfaceChaosDestru-?lang=en-US)
- [UNiagaraDataInterfaceGeometryCollection](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/ChaosNiagara/UNiagaraDataInterfaceGeometryCol-?lang=en-US)
- [unreal.GeometryCollectionComponent (Python 5.5)](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/GeometryCollectionComponent?application_version=5.5)
- Plugin descriptors for `ChaosNiagara` and `GeometryCollectionPlugin` (the plugin descriptor).
- Plugin headers `NiagaraDataInterfaceChaosDestruction.h`, `NiagaraDataInterfaceGeometryCollection.h`; editor Python surface classes named above.
