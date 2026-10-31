# Bridging editor Python to the Mutable graph: add a node, link a pin

Target: Unreal Engine 5.8, Windows. Python can create and compile a Customizable Object but cannot add a node to its graph or link a pin. A small editor-only module, `MutableBridge`, gives it both. The module is `examples/unreal/mutable/module/MutableBridge/` and the runner is the [mutable probe](../../../examples/unreal/mutable/README.md). The generic module recipe is [Python to C++ bridge](unreal-python-cpp-bridge.md); what a script can do once the graph exists is in [unreal-mutable](../../unreal-mutable/SKILL.md). Run 1 and run 2 below are two runs of the probe on 2026-10-30 (each: module build, editor start, graph, variants in a rendering editor, headless commandlet); both passed 26 of 26 checks.

## Module layout

- [tested] 2026-10-30, runs 1 and 2: four files in `Source/MutableBridge/` built first time and loaded as an `Editor` module (`"Type": "Editor"` in the `.uproject`, the module in the Editor target's `ExtraModuleNames`): `MutableBridge.Build.cs`, an empty module class with `IMPLEMENT_MODULE`, and `MutableBridgeLibrary.h/.cpp`, a `UBlueprintFunctionLibrary` of `UFUNCTION(BlueprintCallable)` statics. Python saw `unreal.MutableBridgeLibrary` with 9 of 9 functions and 5 of 5 result structs.
- [tested] 2026-10-30, runs 1 and 2: `Build.cs` listed `Core`, `CoreUObject`, `Engine` as public and `UnrealEd`, `CustomizableObjectEditor` as private dependencies. The Mutable plugin is enabled in the `.uproject` as for any other use.
- [tested] 2026-10-30, run 1: `get_pin_categories()` returned `object, component, material, modifier, mesh, skeletalMesh, passThroughSkeletalMesh, enum, string, materialAsset`, which are the `PC_*` constants the editor module exports, so the project module linked against that module's exports.

## What the editor module exposes

- [documented] In the installed engine, read before run 1: the Mutable plugin ships the Mutable editor module's Public, Internal and Private headers and `.cpp` files. The graph class `UCustomizableObjectGraph` and every concrete node class sit in `Private/`. The exported pieces are `UEdGraphSchema_CustomizableObject` (the `PC_*` constants, `CanCreateConnection`, `TryCreateConnection`) and the editor function library.
- [tested] B-Q3 run 1 (2026-10-31): a throwaway project-module include of `MuCOE/Nodes/CustomizableObjectNode.h` failed with `fatal error C1083: Cannot open include file: 'MuCO/CustomizableObjectPrivate.h': No such file or directory`. The delivered module continues to reach node classes by reflection.
- [tested] 2026-10-30, runs 1 and 2: the module included `MuCOE/EdGraphSchema_CustomizableObject.h` and no other Mutable header, and built with no error.

## The calls

- [tested] 2026-10-30, runs 1 and 2: `add_node(co, class_name, location, property_names, property_values)` found the class by name (`FindFirstObject<UClass>`, name without the `U`), made the node with `NewObject` in the object's graph, set the listed properties from their text form (`ImportText_Direct`) before the pins were built, and returned the node. The Customizable Object came from `new_customizable_object` and already held its base `CustomizableObjectNodeObject`.
- [tested] 2026-10-30, runs 1 and 2: `link_pins(output_node, output_pin, input_node, input_pin)` found the pins by name, called the graph schema's `CanCreateConnection` and then `TryCreateConnection`, and looked the pins up again to confirm the link.
- [tested] 2026-10-30, runs 1 and 2: `get_node_property` (text form) read back `ParameterName` and `Values`; `get_node_pins` (name, direction, category, array, hidden, orphaned, link count), `get_graph_nodes` and `get_graph_links` read back the graph; `set_node_property` and `reconstruct_node` were present on the class but not called.
- [tested] 2026-10-30, runs 1 and 2: 11 of 11 invalid requests were refused with `ok` false and a reason, with no exception and the graph unchanged: a missing input pin, a missing output pin, a link the schema disallowed (`Types are not compatible`, the schema's own message), a null node, an input pin passed as the output, an unknown class name, a class that is not a node, an abstract class, a null object, a property the class lacks, and an object that is not a Customizable Object.

```python
res = unreal.MutableBridgeLibrary.add_node(co, "CustomizableObjectNodeEnumParameter", unreal.Vector2D(0, 0),
    ["ParameterName", "Values"], ["Hat", '((Name="Cap"),(Name="Tall"))'])
ok = unreal.MutableBridgeLibrary.link_pins(enum_node, "Enum", switch_node, "Switch Parameter")
```

## The graph the runs built

- [tested] 2026-10-30, runs 1 and 2, as the probe wired it: base `CustomizableObjectNodeObject` (input array `Components`) <- `CONodeComponentSkeletalMesh` (its `ReferenceSkeletalMesh` set to the body) <- `CONodeSkeletalMeshObjectMake` <- `CONodeSkeletalMeshMake_V2` (input array `LOD 0`, category `material`, one per mesh section) <- `CONodeSkeletalMeshSection` <- `CustomizableObjectNodeSkeletalMesh` (output `mesh`, one pin per mesh section: the body 6, each hat 2).
- [tested] 2026-10-30, runs 1 and 2: the parameter was a `CustomizableObjectNodeEnumParameter` with `ParameterName` `Hat` and `Values` `((Name="Cap"),(Name="Tall"))`; the part switch was a `CONodeSwitch` with `PinType` `material`, passed to `add_node`, and its output pin read category `material`. Linking the enum to the switch gave the switch one input pin per value (`Cap`, `Tall`). The probe used the pin names it read from `get_node_pins` by direction and category.
- [tested] 2026-10-30, run 1: the first attempt linked only section 0 of each part (11 nodes, 11 links). It compiled and the frames differed, but a frame showed one section of each part: Cap a red disc above a blue leg, Tall a grey cylinder above the same blue leg. The flaw was in the probe, which linked one of each skeletal-mesh node's mesh pins.
- [tested] 2026-10-30, run 2: every section was wired, one section node per mesh output pin and one switch per accessory section slot (46 operations accepted; 19 nodes and 27 links added, as the script planned; a reload read 20 nodes and 27 links).

## Build and messages

- [tested] 2026-10-30, runs 1 and 2: the Editor target built with `Build.bat exit 0 in 37 s; Result: Succeeded; 0 error lines, 0 warnings` (compiler 14.44, Windows SDK 10.0.26100). No compiler or linker message stopped either run, and each run's editor started with the module loaded.
- [tested] 2026-10-30, runs 1 and 2: `unreal.InstanceUpdateDelegate` was not reachable from Python, so the probe waited a fixed 10 s per variant instead of for the update callback.

## What the runs showed

- [tested] 2026-10-30, run 2: the compile ran in 0.52 s, `compiled` true, 0 errors, 0 warnings, and read back one parameter `Hat` (INT) with options `Cap|Tall` and one component. Run 1 read the same.
- [tested] 2026-10-30, run 2: after a restart the saved object reloaded and recompiled; an Instance set to `Cap` and then `Tall` read both back and reported `has_any_skeletal_mesh` true. The frames showed the whole figure with a red cap and with a grey top hat, and differed in 3,341 pixels.
- [tested] 2026-10-30, runs 1 and 2: in a `-nullrhi` commandlet with the bridge module loaded, the saved graph loaded, read `is_compiled` false and no parameters, compiled with a blocking call in 0.12 s with 0 errors, and read one parameter `Hat: Cap|Tall`; the process exited 0 in about 7 s.

## Not established

- [tested] B-Q1 run 2, B-Q2 run 2, B-Q3 run 3 and B-Q4 run 3 (2026-10-31) measured a four-by-six option fixture and validated shared skeletons, a material parameter, two components and the Instance's reflected update delegate: [results and recipes](unreal-mutable-scale.md).
- [general] Not established: production-character compile cost, extra LODs, texture parameters, or the forum reports of a hang with Extension Data constants and large memory use with many morph targets and child objects.
- [general] Whether another 5.x release keeps these class, property and pin names: they were read from the installed 5.8 headers and nodes, so check them with `get_node_pins` before reusing the recipe.
