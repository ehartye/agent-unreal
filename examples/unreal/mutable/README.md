# Mutable probe: an editor bridge that authors a Customizable Object's graph, swappable parts, variants and a headless compile

Probes Mutable (Epic's runtime character customization plugin) on Unreal Engine 5.8, Windows. A script can create and compile a Customizable Object, but Python reaches no call that adds a node to its graph or links a pin, so the object has no parameter. This probe tests the smallest fix: a small editor C++ module, `MutableBridge`, that gives Python those two operations, and then checks that an object built with it offers swappable agent-meshes parts through a parameter, shows a different part for each option, and compiles headless. Nothing here needs a project or an asset of yours: the runner makes a throwaway code project (PythonScriptPlugin, EditorScriptingUtilities, Mutable, Interchange and the bridge module) in the OS temp folder.

Status: Ran 2026-10-30, twice, 26 of 26 checks pass (`bridge` 3, `build` 5, `graph` 7, `variants` 7, `headless` 4). The module builds against the Mutable plugin's editor module in about 40 s with no compiler or linker message and `unreal.MutableBridgeLibrary` appears in Python with its nine functions. On an object made by `new_customizable_object` the bridge adds nodes and links pins and the graph reads back; eleven invalid requests are refused with a reason. A graph of 19 added nodes and 27 links gives a compiled object with one parameter `Hat` whose options are `Cap` and `Tall`; a captured frame of each option shows the whole figure with that hat and the frames differ. The same compile runs in a `-nullrhi` commandlet in 0.12 s. The compile of three small meshes says nothing about the cost of a large object.

## Run

```text
node examples/unreal/mutable/mu_probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --parts <folder of .glb files> [--only bridge,build,graph,variants,headless] [--keep] [--plan] [--compile-timeout <seconds>] [--compiler <x.y.z>] [--sdk <10.0.n.n>]
```

Windows with Visual Studio 2022 Build Tools (the compiler and Windows SDK are found by `discoverToolchain` in `../native-build.mjs`; `--compiler` and `--sdk` override). `--parts` is a folder with two or more `.glb` files, here a fixed person body and two hats on the same three-bone skeleton (see "Making the parts"); `AGENT_UNREAL_MUTABLE_PARTS` sets it too. The groups run in order in one project: `bridge` builds the module and starts the editor, `build` imports the parts, `graph` builds on them, and `variants` and `headless` read what `graph` saved, so `--only` must name what a group needs (`graph` needs `bridge` and `build`; `variants` and `headless` need `graph`). `--plan` prints what would run. `--keep` leaves the project folder (a run with a failing check keeps it anyway; it holds `Saved/*.json` reports, `Saved/build.log`, `Saved/Logs` and `Saved/Screenshots`). Exit code 0 when every check of the groups that ran passes, 1 when a check fails, 2 on a usage error. It is not part of `node scripts/check.mjs`; the pure checks have node tests (`mu-probe.test.mjs`) in the merge lane.

A run takes about four minutes: Unreal Build Tool builds the Editor target once, the editor starts four times (rendering, offscreen: `-RenderOffScreen`, no interactive session) and the commandlet once. **Every compile has a wall-clock limit** (`--compile-timeout`, default 240 s): the editor-mode compile is asynchronous and polled against that limit, every editor and commandlet phase has a process limit of the compile timeout plus a margin and is killed at it, and the module build has its own limit (1200 s). A timeout or a kill is a recorded result and is not retried. If the module does not build, the later phases do not run (the project names a module with no binary) and the check shows the compiler or linker message word for word. A node test pins that no compile call lacks its limit.

## Files

| File | What it does |
|---|---|
| `module/MutableBridge/` | the editor module: `MutableBridge.Build.cs`, an empty module class and `MutableBridgeLibrary` (`UFUNCTION(BlueprintCallable)` statics; Python sees `unreal.MutableBridgeLibrary`). The source is committed; nothing it builds is |
| `mu_probe.mjs` | writes the throwaway project (a code project when `bridge` runs), builds the Editor target, runs the phases, stops only processes that name that project, reads the reports and the screenshots, judges them |
| `mu-probe-checks.mjs`, `mu-probe.test.mjs` | the options, the build-log summary and the checks as pure functions of the reports; the test changes one fact at a time and expects the matching check to fail, pins the compile-timeout rule, the module's function names against the probe's and the hygiene of the folder |
| `mu_probe_common.py` | the report, `run_compile` (the only compile call, under the limit), the parameter read-back and the tick driver of the editor-mode scripts |
| `mu_probe_bridge.py` | after the build: is `unreal.MutableBridgeLibrary` there with every function, and does a call read the editor module's exported pin categories |
| `mu_probe_build.py` | import the parts, `new_customizable_object`, try every way into the graph from Python alone, compile the bare object, read back, create an Instance, save |
| `mu_probe_graph.py` | through the bridge: add and link on a throwaway object and ask for what must be refused; then build the swappable-parts graph, compile it, read its parameter, save |
| `mu_probe_variants.py` | build a level (a Customizable Skeletal Mesh actor, a plain skeletal mesh as control, a camera), play it, attach an Instance, set each option, take a frame of each |
| `mu_probe_headless.py` | load the saved object and compile it in a `-nullrhi` commandlet with a blocking call |

## The bridge

The Mutable plugin's editor module (`CustomizableObjectEditor`) exports the graph schema (`UEdGraphSchema_CustomizableObject`, with its pin-category constants and connection rules) and the base node class, but every concrete node class sits in its Private folder, and the base node header includes one from the CustomizableObject module's `Internal` folder, which Unreal Build Tool makes visible only to modules of the same scope. So the bridge includes only the schema header and reaches the nodes through reflection: a node class is found by name (`FindFirstObject<UClass>`), made with `NewObject` in the object's graph, given properties from their text form (`FProperty::ImportText_Direct`) and linked through the schema (`CanCreateConnection`, then `TryCreateConnection`).

| Python (`unreal.MutableBridgeLibrary`) | What it does |
|---|---|
| `add_node(co, class_name, location, property_names, property_values)` | adds a node of that class (`CustomizableObjectNodeSkeletalMesh`, `CONodeSkeletalMeshSection`, `CONodeSwitch` and so on, without the `U`) to the object's graph; the property pairs are set before the node builds its pins; refuses an unknown, abstract or non-node class, a property the class lacks and an object that is not a Customizable Object |
| `set_node_property(node, name, text)`, `get_node_property(node, name)` | write or read a property by its text form, including properties Python cannot reach (private or not editable); the node is notified and rebuilds its pins |
| `reconstruct_node(node)` | rebuild a node's pins from its properties |
| `get_node_pins(node)` | name, direction, category, array, hidden, orphaned and link count of each pin; pin names are what `link_pins` takes |
| `link_pins(output_node, output_pin, input_node, input_pin)` | links through the schema; a missing node or pin, pins of different kinds or a link the schema disallows is refused with the schema's reason |
| `get_graph_nodes(co)`, `get_graph_links(co)` | read the graph back |
| `get_pin_categories()` | the schema's exported category names (`mesh`, `material` for a mesh section, `enum`, `component`, `object`, ...) |

Every result struct carries `ok` and `message`. To build the module into a project of your own, copy `module/MutableBridge/` to its `Source/`, list it as `{ "Name": "MutableBridge", "Type": "Editor", "LoadingPhase": "Default" }` in the `.uproject`, enable the Mutable plugin there and add the module to the Editor target's `ExtraModuleNames`; `../native-build.mjs` (`writeCodeProject`, `buildEditor`) does that for the probe.

## What the runs showed

- The graph of a swappable-parts object, as the bridge built it (class names as above): the base `CustomizableObjectNodeObject` (made by `new_customizable_object`) takes a `CONodeComponentSkeletalMesh` on its `Components` pin; the component takes a `CONodeSkeletalMeshObjectMake` (its passthrough skeletal mesh pin), which takes a `CONodeSkeletalMeshMake_V2` (its `LOD 0` pin takes every mesh section); each mesh section is a `CONodeSkeletalMeshSection` fed by one mesh output pin of a `CustomizableObjectNodeSkeletalMesh`. A skeletal-mesh node has one mesh output pin per section of the mesh (the body 6, each hat 2), so a part needs one section node per pin. The component's `ReferenceSkeletalMesh` is set to the body mesh.
- The parameter is a `CustomizableObjectNodeEnumParameter` (`ParameterName` and `Values`, written as `((Name="Cap"),(Name="Tall"))`); the switch is a `CONodeSwitch` with `PinType` set to `material` (the category of a mesh section), set when the node is added so its output pin has the right kind. Linking the enum to the switch's `Switch Parameter` pin gives the switch one input per value, named after it. One switch per section slot of the accessories.
- The compile reports `compiled` with no errors; the object lists one component and the parameter `Hat` (an INT) with its two options. The Instance set to each option builds a skeletal mesh, and the captured frames show the whole figure with the red cap and with the grey top hat.
- The saved object reloads with its graph (20 nodes, 27 links): a fresh process reads `is_compiled` false and no parameter until it compiles, so each process compiles before it builds an Instance.
- The headless compile of the real graph completes in the commandlet with a blocking call (an asynchronous compile needs the editor tick); the bridge module loads in the commandlet too.
- `unreal.InstanceUpdateDelegate` is not reachable from Python, so the variants script waits a fixed time after each Instance update instead of for its callback.
- Not established: the compile cost of a large object (the runs use three small meshes and a fraction of a second), the forum reports of a hang with Extension Data constants and of large memory use with many morph targets and child objects, more than one component or LOD, materials and textures, a graph that needs the nodes' own editor-only helpers.

## What Python alone reaches (the premise)

The `build` group keeps the earlier finding as a check that passes while it holds: `new_customizable_object` makes the object and its graph with the base node; `unreal.find_object(co, "CustomizableObjectGraph_0")` finds the graph; `unreal.new_object(<node class>, outer=graph)` makes a node whose editable properties (`skeletal_mesh`) can be set by name; and nothing adds that node to the graph or links a pin (`call_method` reaches only reflected functions; `AddNode`, `AllocateDefaultPins`, `AutowireNewNode` and `MakeLinkTo` are not). If a later engine reflects those calls, the check fails and the bridge is no longer needed for them.

## Making the parts

Parts come from agent-meshes: build a person body (box and sphere parts bound rigidly to three bones, `root`, `spine`, `head`) and two hats bound to the `head` bone with the same bones, one workspace each, then export each as a `.glb`. The part names must not equal the bone names (agent-meshes refuses a part and a bone with one name). The probe imports the whole folder with a pipeline that combines the skins of one skeleton, so each part arrives as one skeletal mesh with one section per original part. The GLB files are not committed and the generated assets are not either; they live in the temporary project.
