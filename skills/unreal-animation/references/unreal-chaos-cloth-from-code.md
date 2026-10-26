# Building a Chaos Cloth Asset from Python and C++ in Unreal 5.8: the Dataflow route and what draws the default grid

Target: Unreal Engine 5.8, Windows. Route for a Cloth Asset made from a script instead of by hand in the Dataflow editor; the editor workflow is in [Cloth and flesh](unreal-chaos-cloth-and-flesh.md). Names were read in the 5.8 install. `[general]` lines were observed once in a native C++ project on 5.8.x (a scarf panel pinned along one row, followed through a scripted run, strafe and jump) and have not been run from this repo.

## Enable it

- [documented] Plugin `ChaosClothAsset` holds the runtime modules `ChaosClothAsset` and `ChaosClothAssetEngine` and an editor module. The node structs live in plugin `ChaosClothAssetDataflowNodes`, whose single module is of type Editor and whose descriptor calls it "required to edit a Cloth Asset"; it depends on `ChaosClothAsset`.
- [general] Both plugins were enabled in the `.uproject` `Plugins` array. Whether the nodes plugin alone is enough was not tried.
- [documented] A game module that makes the component adds `ChaosClothAssetEngine` to its `Build.cs`: `ChaosClothAsset/ClothComponent.h` (`UChaosClothComponent`) and `ChaosClothAsset/ClothAssetBase.h` (`UChaosClothAssetBase`).

## Build the panel and the graph

- [general] The panel is one layer made with Geometry Script: a grid of vertices with explicit topology, a planar UV projection, saved as a non-Nanite static mesh (7 by 30 particles for a scarf). Do not assume source vertex IDs survive the import.
- [general] `create_asset(name, path, unreal.ChaosClothAsset, unreal.ChaosClothAssetFactory())`. The graph is `asset.get_editor_property("dataflow_instance").get_editor_property("dataflow_asset")` and the terminal name is the same instance's `dataflow_terminal`.
- [documented] `DataflowEditorBlueprintLibrary.add_dataflow_node(graph, node_type, base_name, location)` takes the registered struct name, type first, and returns the new node's name. An unregistered type (a display name, say) returns a null name and the path read logs nothing (`DataflowEditorBlueprintLibrary.cpp`, `DataflowAssetEditUtils.cpp`).
- [documented] Struct names used: `FChaosClothAssetStaticMeshImportNode_v2`, `FChaosClothAssetSelectionNode_v2`, `FChaosClothAssetTransferSkinWeightsNode`, `FChaosClothAssetSimulationDefaultConfigNode`, `FChaosClothAssetSimulationMaxDistanceConfigNode`, terminal `FChaosClothAssetTerminalNode_v2` (headers under `Engine/Plugins/ChaosClothAssetDataflowNodes/Source/ChaosClothAssetDataflowNodes/Public/ChaosClothAsset/`). Older nodes carry a deprecation marker; the `_v2` suffix is what a later patch is likeliest to change.
- [documented] `set_dataflow_node_property(graph, node, property, text)` returns false for an unknown node or property; otherwise `text` goes through `FBlueprintEditorUtils::PropertyValueFromString`, so struct values are text.
- [general] Properties set: import node `StaticMesh` (asset path) and `UVChannel`; selection node `Indices` and `OutputName` (`'(StringValue="Pinned")'`); skin-weights node `SkeletalMesh`; max-distance node `InKinematic` (the selection's name) and `MaxDistance` (`'(bIsAnimatable=False,Low=150.0,High=150.0,WeightMap="")'`). Pinning is a selection fed to `InKinematic`.
- [general] Pins: every node's input and output is named `Collection`; the terminal's input is `CollectionLods[0]` (the terminal's `CollectionLods` is an array). The script tried `"CollectionLods[0]"`, `"Collection Lods[0]"`, `"CollectionLods"` and `"Collection"` in turn and kept the first that `connect_dataflow_nodes` accepted, which returns false for a missing node or pin.
- [documented] `DataflowBlueprintLibrary.regenerate_asset_from_dataflow(asset, False)` rebuilds the asset. `evaluate_dataflow(graph, asset)` returns true when an error was logged, the opposite of its header comment (`DataflowBlueprintLibrary.cpp`). Do not treat it as a success flag.
- [general] Establish the build by reading the asset back: its render material, the pinned set, the weight values. On 5.8.3 a 210-vertex panel imported with reordered simulation IDs: source IDs 0 to 6 selected a triangular patch across three rows. Read `SimPosition3D` after a provisional regeneration to find the true seven-vertex edge, rebuild the selection, then check the final kinematic indices and skin weights.
- [general] Python did not expose the collection, the physics shapes or the weight-map edit surface; a small editor C++ bridge supplied them. Weight values went in through `FDataflowVertexAttributeEditableNode::SetVertexAttributeValues` with an engine context, which creates the topology snapshots the modern weight-map node needs, in preference to writing the obsolete `VertexWeights` field. The snapshot requirement is unchecked in source.

## Why the game drew the wrong thing

1. [documented] The default grid. Without the clothing usage flag on the material, the log says `Material ... missing usage flag Clothing! Default Material will be used in game.` (`Material.cpp`). In Python the property is `used_with_clothing`; the header marks `bUsedWithClothing` deprecated in 5.8 in favour of `GetUsageByFlag`.
2. [general] Invisible from behind. A one-layer panel is single-sided; wound to face away from a camera behind the character it cannot be seen. Wind it toward the camera or make the material two-sided.
3. [general] No material. The static mesh importer did not carry the material into the cloth asset (the one slot read back empty). Set the asset's `materials` after the last regeneration and the component's material at run time (`SetMaterial(0, ...)`).
4. [documented] "Removed from graph on load". The node module is Editor-only, so a process without it logs `Missing registered node type ... will be removed from graph on load` for each node (`DataflowGraph.cpp`). [general] The asset was built in the editor and played without the nodes; a later Development package and a normal start ran the cooked cloth. Do not read that log as a missing simulation.

## Wire it at run time (C++)

- [documented] `NewObject<UChaosClothComponent>`, `SetupAttachment` to the skeletal mesh, `RegisterComponent`, `SetAsset`, `SetLeaderPoseComponent(mesh)`, `SetClothGeometryScale(scale)` with the mesh's scale, `AddCollisionSource(mesh, physicsAsset, bUseSphylsOnly)` (default false, so fitted boxes are used), `SetCollideWithEnvironment(false)`, `SetEnableSimulation(true)`. `USkinnedMeshComponent::ShowMaterialSection(MaterialID, SectionIndex, bShow, LODIndex)` hides a skeleton's own fallback sections for the same part.
- [documented] A collision source holds its physics asset as a `TWeakObjectPtr` (`ChaosClothAssetEngine/Private/ChaosClothAsset/CollisionSources.h`). [general] A separately loaded contact asset needs a reflected strong owner (a transient `UPROPERTY` on the character); a forced-GC run lost it in three checks until one held it. Test real object liveness, not a setup flag.
- [general] Imported collision can be much larger than the authored body and include hidden fallback geometry: read the shapes, compare them in the bone or component frame, and prefer a separate collision-only asset to changing gameplay body physics.
- [general] Measure completed particles through `FClothSimulData::Transform` into the mesh frame, allowing for display scale. Component bounds mix render, simulation and conservative caching and cannot show a flat rest shape.
- Not verified: 5.7, separate render and simulation meshes, wind authoring, other skeletons, cost against an AnimDynamics chain ([AnimGraph from C++](unreal-animgraph-from-cpp.md)).

## Sources

- Engine source in the 5.8 install: `DataflowEditorBlueprintLibrary.cpp`, `DataflowAssetEditUtils.cpp`, `DataflowBlueprintLibrary.cpp`, `DataflowGraph.cpp`, `ClothComponent.h`, `CollisionSources.h`, `TerminalNode.h`, `Material.cpp`, the plugin descriptors for `ChaosClothAsset` and `ChaosClothAssetDataflowNodes`.
