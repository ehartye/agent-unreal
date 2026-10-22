# Hair Strands (Groom) in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. Groom is Epic's strand-based hair system: import, edit, render and simulate hair as individual curves, with cards and meshes as lower-cost geometry inside the same asset. Its plugin descriptor reads "Rendering and simulation of grooms".

## Enable it

| Plugin | Category | Default | Flags | Depends on |
|---|---|---|---|---|
| `HairStrands` (Groom) | Geometry | off | not beta, not experimental, not editor-only | Niagara, GeometryCache, DeformerGraph, Dataflow, ComputeFramework |
| `AlembicHairImporter` (Alembic Groom Importer) | Geometry | off | not beta; editor module | HairStrands |
| `HairCardGenerator` | Geometry | off | experimental, editor-only | HairStrands, PythonMLPackages, Dataflow |
| `HairModelingToolset` | Geometry | no default set | experimental; editor module, Win64 | GeometryProcessing, MeshModelingToolset, ModelingToolsEditorMode, HairStrands |

- Enable in Edit > Plugins (search "groom"), then restart the editor. Or add `{ "Name": "HairStrands", "Enabled": true }` entries to the `Plugins` array of the `.uproject`.
- Epic's quick start enables Alembic Groom Importer and Groom, and Project Settings > Rendering > Optimization > Support Compute Skin Cache.
- The Hair Card Generator page asks for the Editor Dataflow Graph and Geometry Dataflow plugins first.

## Use it when

- You need individual-strand hair, eyebrows, eyelashes, beards or fur on a character, with physically based motion.
- You have a groom authored in a DCC tool and exported as Alembic (.abc).
- The target platform renders strands: Windows (DirectX 11, DirectX 12 or Vulkan), macOS (Shader Model 6, M2 and later), Linux, PS5, Xbox Series S/X.
- The frame budget has room for strands. Cost grows with curve count in simulation, interpolation, voxelization and primary visibility.
- You want one asset that carries strands, cards and meshes per LOD.

## Use something else when

- Use hair cards (or groom meshes) when the platform does not render strands. Cards and meshes run on all platforms. A LOD can hold both strands and cards, and the Use Cards option on the component switches to cards.
- Use the Hair Card Generator (experimental, editor-only) to build cards from existing strands. Use cards authored in a DCC tool if the card groups are already exported in the Alembic file.
- Use a DCC tool (XGen, Ornatrix, Yeti, Houdini and similar) to shape hair. Epic states the groom system provides import, editing, rendering and simulation, and no hair-shaping solution.
- For simulated fabric or soft bodies, see [unreal-chaos-cloth-and-flesh.md](unreal-chaos-cloth-and-flesh.md).
- For particle effects, see [unreal-niagara.md](unreal-niagara.md).

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Import an Alembic groom | Editor UI (Content Browser import, Groom Import Options); Python classes exist | `unreal.GroomFactory`, `unreal.GroomImportOptions` (`conversion_settings`, `interpolation_settings`), `unreal.InterchangeGenericGroomPipeline` |
| Create a Groom Binding | Editor UI (right-click groom > Create Binding); Python | `unreal.GroomLibrary.create_new_groom_binding_asset(_with_path)`, `unreal.GroomBindingAsset` (`groom`, `target_skeletal_mesh`, `build`) |
| Set LOD, cards, materials, physics on the asset | Python properties; Groom Asset Editor | `unreal.GroomAsset`: `hair_groups_lod`, `hair_groups_cards`, `hair_groups_materials`, `hair_groups_physics`, `hair_groups_rendering` |
| Place a groom | Python / Blueprint | `unreal.GroomActor`, `unreal.GroomComponent` |
| Create the card-generation graph | Python | `unreal.GroomAsset.create_groom_dataflow` |
| Evaluate the card graph, preview cards | Editor UI only | Evaluate Dataflow Graph, then LOD Geometry Type = Cards |
| Groom cards editor, groom-to-mesh, LOD mesh generation | Editor UI only (Modeling Tools Mode); no Python class | HairModelingToolset tools: `UGroomCardsEditorTool`, `UGroomToMeshTool`, `UGenerateLODMeshesTool` (C++ names) |
| Hair material | Editor UI | Shading Model = Hair, Use with Hair Strands on; `HairDefaultMaterial` ships with the engine |

## Workflow

1. Enable HairStrands and AlembicHairImporter, turn on Support Compute Skin Cache, restart.
2. Export the groom from the DCC tool as Alembic using the Alembic for Grooms naming conventions. Epic's Importing Grooms page links the specification.
3. Import. Set Rotation and Scale so units convert to centimeters. Choose guide type (Imported, Generated or Rigged) and interpolation quality (High, Medium, Low). Use Curve and Vertex Decimation to cut strand and point count.
4. Add a Groom component to the skeletal mesh (or attach it to a socket with Transfer Skinning) and assign the Groom Asset.
5. Create a Groom Binding: Target Skeletal Mesh is required, Source Skeletal Mesh is optional and should have similar topology. Assign it to the component's Binding Asset slot. Without a binding, projection runs at startup and costs GPU time.
6. Assign a material with the Hair shading model. In the Groom Asset Editor, tick Enable Simulation on the Physics tab to simulate.
7. Set per-LOD geometry (strands, cards, meshes). Reduce curve count with decimation and auto LOD bias. Simulation runs on all platforms. Rigid attachment runs on all platforms. Skinned binding and global interpolation (RBF) run on every platform except Nintendo Switch and mobile.
8. For cards, create a Dataflow asset from the groom (template Cards), set BuildCardSettings, run Evaluate Dataflow Graph, set LOD Geometry Type to Cards.
9. Spend shadow and lighting cost deliberately: voxelization shadows by default, Deep Opacity Shadow for important lights, hair ray tracing only per asset where it matters.

## Sources

- [Hair Rendering and Simulation](https://dev.epicgames.com/documentation/unreal-engine/hair-rendering-and-simulation-in-unreal-engine?lang=en-US)
- [Groom Components and Assets](https://dev.epicgames.com/documentation/unreal-engine/groom-components-and-assets-in-unreal-engine)
- [Groom Platform Support](https://dev.epicgames.com/documentation/unreal-engine/groom-platform-support-in-unreal-engine?lang=en-US)
- [Groom Scalability and Performance](https://dev.epicgames.com/documentation/unreal-engine/groom-scalability-and-performance-with-unreal-engine)
- [Importing Grooms](https://dev.epicgames.com/documentation/unreal-engine/importing-grooms-into-unreal-engine)
- [Hair Simulation and Rendering Quick Start](https://dev.epicgames.com/documentation/en-us/unreal-engine/hair-simulation-and-rendering-quick-start-guide-in-unreal-engine)
- [Hair Card Generator for Grooms](https://dev.epicgames.com/documentation/unreal-engine/hair-card-generator-for-grooms-in-unreal-engine?lang=en-US)
- [HairModelingToolset API module](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/HairModelingToolset?lang=en-US)
- Engine plugin descriptors (`.uplugin`) for the four plugins above, and the editor Python module surface for the `unreal.` names.
