# Chaos Cloth and Chaos Flesh in Unreal 5.8: when to use them and how to drive them

Target: Unreal Engine 5.8, Windows. Chaos Cloth simulates cloth on meshes; the Cloth Asset and Outfit Asset plugins author cloth in Dataflow graphs; Chaos Flesh simulates soft bodies such as muscle on tetrahedral meshes.

## Enable it

| Plugin | Category | Default | Flags (descriptor) | Dependencies |
|---|---|---|---|---|
| `ChaosCloth` | Physics | on | none | ChaosCaching, Buoyancy, Water |
| `ChaosClothAsset` | Physics | off | none | ChaosCloth, GeometryCache, Dataflow |
| `ChaosOutfitAsset` | Physics | off | beta | ChaosClothAsset, Dataflow, MeshResizing, ChaosClothAssetEditorCore |
| `ChaosFlesh` | Physics | off | experimental | ProceduralMeshComponent, Dataflow, ChaosCaching, ChaosCachingUSD, GeometryProcessing, ComputeFramework, DeformerGraph, USDImporter, TetMeshing |

- Enable in Edit > Plugins, or add `{ "Name": "ChaosClothAsset", "Enabled": true }` to the `Plugins` array of the `.uproject`; restart the editor.
- The Flesh quickstart also enables ML Deformer Framework and ML Deformer Neural Morph Model for cached-result training.

## Use it when

- Legacy Chaos Cloth (`ChaosCloth`): a skeletal mesh section becomes cloth through the Clothing Tool, with painted Max Distance masks, wind and an Animation Drive.
- Cloth Asset (`ChaosClothAsset`): you author clothing from panel meshes (separate render and simulation meshes) with a non-destructive Dataflow graph, XPBD constraints, LSV collision, and one asset reusable across characters.
- Outfit Asset (`ChaosOutfitAsset`): you assemble an outfit from several cloth assets, including sized variants for different body sizes.
- Flesh (`ChaosFlesh`): you need real-time soft-body deformation of a closed Static or Skeletal Mesh, mainly muscle deformation during animation, with optional cached playback in Sequencer and Movie Render Queue. Flesh collisions are one-way and limited to convex and analytic shapes (sphere, cube, plane).
- Machine-learning cloth: a trained model predicts cloth from the skeletal pose; the Chaos Cloth Generator in the ML Deformer Editor bakes simulations to a Geometry Cache.

## Use something else when

- Use [Hair Strands](unreal-hair-strands.md) when the goal is hair or fur grooms; the HairStrands descriptor covers rendering and simulation of grooms.
- Use legacy Chaos Cloth (Clothing Tool) when you need the lowest render cost: the Cloth Asset adds a separate component, overhead and draw calls.
- Use Chaos Cloth or the Cloth Asset instead of Flesh for garments; Flesh targets deformable solids.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Enable plugins | `.uproject` / editor UI | `Plugins` array; Edit > Plugins |
| Make legacy cloth from a mesh section | editor UI only | Skeletal Mesh Editor > Section Selection > Create Cloth Asset from Selection; Window > Clothing > Activate Cloth Paint |
| Create a Cloth, Outfit or Flesh asset | editor UI / Python | Python factories `unreal.ChaosClothAssetFactory`, `ChaosOutfitAssetFactory`, `FleshAssetFactory` |
| Build or edit the Dataflow graph | editor UI / Python | Dataflow editor; `unreal.DataflowEditorBlueprintLibrary.add_dataflow_node`, `connect_dataflow_nodes`, `set_dataflow_node_property` |
| Evaluate or rebuild from the graph | Python | `unreal.DataflowBlueprintLibrary.evaluate_dataflow`, `regenerate_asset_from_dataflow`, `override_dataflow_variable_float` and siblings |
| Inspect assets | Python | `unreal.ChaosClothAsset.dataflow_asset`, `dataflow_terminal`; `unreal.ChaosOutfitAsset`; `unreal.FleshAsset.dataflow_asset`, `skeletal_mesh` |
| Place cloth in a character | Blueprint / Python | Add `unreal.ChaosClothComponent`, set its `asset` |
| Tune cloth at runtime | Python / Blueprint | `unreal.ChaosClothingSimulationInteractor.set_num_iterations`, `set_num_substeps`, `enable_gravity_override`; `unreal.ChaosClothAssetInteractor.set_float_property_value` |
| Place and switch on flesh | Python / Blueprint | `unreal.FleshActor` (`flesh_component`, `enable_simulation`), `unreal.FleshComponent` |
| Tetrahedral meshing, surface bindings, solver tuning | editor UI (Dataflow nodes) | Dataflow nodes such as `GenerateSurfaceBindings`; Solver Actor settings |

## Workflow

Cloth Asset (Epic's Panel Cloth Editor, introduced in 5.3):
1. In a DCC package, build the clothing pieces with separate render and simulation meshes; export both as FBX.
2. Import the static meshes; create a cloth asset from each with a new Dataflow graph.
3. Build the node graph, transfer skin weights from the skeletal mesh, configure settings and weight maps, and set a Physics Asset for collision.
4. Add a Chaos Cloth Component to the character Blueprint, assign the cloth asset, and test in game.

Legacy cloth: select a section, create the cloth asset, assign the character's Physics Asset, apply the clothing asset to the section, paint Max Distance (0 keeps a vertex fixed), and tune Cloth Config.

Flesh:
1. Author the setup in a Dataflow asset.
2. Convert a closed mesh to tetrahedral geometry (iso-surface stuffing, TetWild or radial).
3. Add kinematic constraints that bind to animation, weak constraints, and per-particle damping and mass.
4. Connect a Solver Actor for sub-stepping, threading and global properties.
5. Run `GenerateSurfaceBindings` and apply the flesh deformer to the Skeletal Mesh.
6. Optionally cache results for Sequencer and Movie Render Queue playback.

## Sources

- [Panel Cloth Editor Overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/panel-cloth-editor-overview)
- [Clothing Tool in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/clothing-tool-in-unreal-engine)
- [Chaos Flesh Overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/chaos-flesh-overview)
- [Chaos Flesh Quickstart](https://dev.epicgames.com/documentation/en-us/unreal-engine/chaos-flesh-quickstart)
- [Physics in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/physics-in-unreal-engine)
- [Machine Learning Cloth Simulation Overview](https://dev.epicgames.com/documentation/unreal-engine/machine-learning-cloth-simulation-overview?lang=en-US)
- [UChaosOutfitAsset](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/ChaosOutfitAssetEngine/UChaosOutfitAsset?lang=en-US) and [FChaosSizedOutfitSource](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/ChaosOutfitAssetEngine/FChaosSizedOutfitSource?lang=en-US)
- The plugin descriptors for ChaosCloth, ChaosClothAsset, ChaosOutfitAsset, ChaosFlesh and HairStrands; the editor Python surface for the classes named above
