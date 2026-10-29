# Authoring the Customizable Object graph: what Python cannot do, and the routes around it

Target: Unreal Engine 5.8 on Windows. The graph is where parts become swappable options: a base node, an object group, and a mesh node per part, linked by pins. The [mutable probe](../../../examples/unreal/mutable/README.md) tried every way into it from editor Python on 2026-10-29. This is the reference for the result that decides the skill: a script alone cannot build the graph.

## What Python reached

- [tested] 2026-10-29: `unreal.find_object(co, "CustomizableObjectGraph_0")` returned the graph of an object made by `new_customizable_object`.
- [tested] 2026-10-29: the object's `source` property (the editor graph) and the graph's `nodes` raised "protected and cannot be read".
- [documented] In the installed header the `Source` property is a plain `UPROPERTY()` with no edit flag.
- [tested] 2026-10-29: `unreal.new_object(unreal.CustomizableObjectNodeSkeletalMesh, outer=graph)` made a node, and `node.set_editor_property("skeletal_mesh", mesh)` worked and read back the mesh. `dir()` of the node class listed none of its properties, yet the set worked by name.
- [general] A property marked editable in the header can be set by name even when `dir()` shows nothing; try it before concluding it is closed.
- [tested] 2026-10-29: `call_method` on `AddNode` (graph), `AllocateDefaultPins`, `AutowireNewNode` and `MakeLinkTo` (node) raised "Failed to find function", and reading `node.pins` raised "Failed to find property". The graph's `nodes` could not be read, so the node's absence from the graph is shown only by the object keeping 0 parameters and 0 components. Verdict as run: build by script is invalidated, because Python cannot add a node or link a pin.
- [tested] 2026-10-29: the result was an object with 0 parameters and 0 components, and an Instance of it drew nothing. Runs 1 and 2 reached this result and run 3 repeated it.
- [tested] 2026-10-29: 144 `CustomizableObjectNode*` and `CONode*` classes appear in the `unreal` module; the five sampled (SkeletalMesh, Object, ObjectGroup, SkeletalMeshParameter, EnumParameter) add no member over `EdGraphNode`.

## Routes that remain

| Route | What it needs | Status |
|---|---|---|
| Author the object in the editor, once, by hand | a person in a rendering editor; the Mutable Sample's Showcase level shows finished graphs | [documented] by Epic; the probe has not loaded one |
| An editor C++ bridge exposing add-node, link-pins by name and reconstruct-pins to Python | a small editor module like the plugin's other bridges | [general] not built, so not tested |
| Duplicate an object from the sample or from a hand-authored one and change it | Python reaches `set_editor_property` on existing node properties | [general] not run |

- [general] The bridge is the route that keeps an agent in the loop. Build it as the plugin does elsewhere: [Python to C++ bridge](../../unreal-editor-scripting/references/unreal-python-cpp-bridge.md) for the module layout and build loop, and [AnimGraph from C++](../../unreal-animation/references/unreal-animgraph-from-cpp.md) for the same gap on another graph, where `FGraphNodeCreator` created a node, its pins were connected with the graph schema's `TryCreateConnection`, and the asset was marked structurally modified and compiled. The runnable counterpart is [anim_bridge](../../../examples/unreal/anim_bridge/README.md).
- [general] A Mutable bridge would follow the same shape: three statics taking the object, a node class and a name, then two pins and a node to rebuild. The node classes, their pin names and the Mutable editor module's dependency name have to be read from the installed headers; none was verified.
- [general] With the bridge, the same probe groups can run unchanged, because build, variants and headless judge only the object's parameters, frames and compile.

## Parts the graph will need

- [tested] 2026-10-29: three agent-meshes GLBs (one fixed body and two hats bound to the head bone) imported as one skeletal mesh each, on three separate skeletons (`person_body_Skeleton`, `hat_cap_Skeleton`, `hat_tall_Skeleton`). See [Mutable overview](unreal-mutable-overview.md).
- [general] Whether the graph needs the parts on one shared skeleton was not run; import them on one skeleton if a first graph rejects them.
- [documented] Epic's 5.8 release notes and the updated Mutable sample: in 5.8 the graph can work at skeletal-mesh level with the Skeletal Mesh pin, so a part is a skeletal mesh rather than a per-section assembly.
- [general] Name parts differently from bones: agent-meshes refuses a part and a bone with one name.

## Decide

- [general] If the task is only a quick look at what Mutable does, open Epic's sample and read its objects. If the task is to build many objects by script, build the bridge first; hand-authoring does not scale and Python alone yields an empty object.
