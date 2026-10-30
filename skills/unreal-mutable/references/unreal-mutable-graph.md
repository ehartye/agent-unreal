# Authoring the Customizable Object graph: what Python cannot do, and the bridge that does

Target: Unreal Engine 5.8 on Windows. The graph is where parts become swappable options: a base node, an object group, and a mesh node per part, linked by pins. The [mutable probe](../../../examples/unreal/mutable/README.md) tried every way into it from editor Python on 2026-10-29. A second spike on 2026-10-30 added an editor C++ bridge and built a graph that way. This is the reference for both results: a script alone cannot build the graph, and a script with the bridge can.

## What Python reached

- [tested] 2026-10-29: `unreal.find_object(co, "CustomizableObjectGraph_0")` returned the graph of an object made by `new_customizable_object`.
- [tested] 2026-10-29: the object's `source` property (the editor graph) and the graph's `nodes` raised "protected and cannot be read".
- [documented] In the installed header the `Source` property is a plain `UPROPERTY()` with no edit flag.
- [tested] 2026-10-29: `unreal.new_object(unreal.CustomizableObjectNodeSkeletalMesh, outer=graph)` made a node, and `node.set_editor_property("skeletal_mesh", mesh)` worked and read back the mesh. `dir()` of the node class listed none of its properties, yet the set worked by name.
- [general] A property marked editable in the header can be set by name even when `dir()` shows nothing; try it before concluding it is closed.
- [tested] 2026-10-29: `call_method` on `AddNode` (graph), `AllocateDefaultPins`, `AutowireNewNode` and `MakeLinkTo` (node) raised "Failed to find function", and reading `node.pins` raised "Failed to find property". The graph's `nodes` could not be read, so the node's absence from the graph is shown only by the object keeping 0 parameters and 0 components. Verdict as run: build by script is invalidated, because Python cannot add a node or link a pin.
- [tested] 2026-10-29: the result was an object with 0 parameters and 0 components, and an Instance of it drew nothing. Runs 1 and 2 reached this result and run 3 repeated it.
- [tested] 2026-10-29: 144 `CustomizableObjectNode*` and `CONode*` classes appear in the `unreal` module; the five sampled (SkeletalMesh, Object, ObjectGroup, SkeletalMeshParameter, EnumParameter) add no member over `EdGraphNode`.

## The bridge route

- [tested] 2026-10-30, runs 1 and 2 of the bridge probe: the editor module `MutableBridge` added nodes by class name and linked pins through the graph's own schema, and the graph read back with the nodes and links in place. Module, calls and the messages are in [Mutable graph bridge](../../unreal-editor-scripting/references/unreal-mutable-bridge.md).
- [tested] 2026-10-30, runs 1 and 2: on a fresh object the bridge added a skeletal-mesh node and a mesh-section node and linked one to the other (1 link, 3 nodes with the base node), and 11 invalid requests were refused with a reason and the graph unchanged.
- [tested] 2026-10-30, run 2: a swappable-parts graph of 19 added nodes and 27 added links compiled with one parameter `Hat`, options `Cap` and `Tall`, and one component. The base object takes a component node, then a skeletal-mesh object-make node, then a skeletal-mesh make node whose `LOD 0` pin takes one mesh-section node per mesh pin of each skeletal-mesh node; an enum parameter feeds one switch per accessory section slot.
- [tested] 2026-10-30, run 1: the first attempt linked only section 0 of each part (11 nodes, 11 links), so its frames showed one section of each part. Run 2 linked every section (the body has 6, each hat 2) and its frames showed the whole figure.
- [tested] 2026-10-30, runs 1 and 2: the switch was added with `PinType` `material` (adding one without it was not run); linking the enum to its `Switch Parameter` input then gave it one input per value.
- [general] Other node kinds, such as materials, textures and modifiers, were not added. Read their class and pin names from the installed headers and from `get_node_pins`, as the runs did.

| Other route | What it needs | Status |
|---|---|---|
| Author the object in the editor, once, by hand | a person in a rendering editor; the Mutable Sample's Showcase level shows finished graphs | [documented] by Epic; the probes have not loaded one |
| Duplicate an object from the sample or from a hand-authored one and change it | Python reaches `set_editor_property` on existing node properties | [general] not run |

## Parts the graph will need

- [tested] 2026-10-29: three agent-meshes GLBs (one fixed body and two hats bound to the head bone) imported as one skeletal mesh each, on three separate skeletons (`person_body_Skeleton`, `hat_cap_Skeleton`, `hat_tall_Skeleton`). See [Mutable overview](unreal-mutable-overview.md).
- [tested] 2026-10-30, runs 1 and 2: the three parts were imported each with its own skeleton, and the graph compiled and drew them; a shared skeleton was not run, so whether a graph needs one is not established. Import them on one skeleton if a first graph rejects them.
- [documented] Epic's 5.8 release notes and the updated Mutable sample: in 5.8 the graph can work at skeletal-mesh level with the Skeletal Mesh pin, so a part is a skeletal mesh rather than a per-section assembly.
- [general] Name parts differently from bones: agent-meshes refuses a part and a bone with one name.

## Decide

- [general] To build many objects by script, use the bridge; hand-authoring does not scale and Python alone yields an empty object. For a quick look at what Mutable does, open Epic's sample and read its objects.
