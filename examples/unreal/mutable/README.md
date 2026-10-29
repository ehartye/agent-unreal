# Mutable probe: parts, a Customizable Object, variants and a headless compile

Probes three questions about Mutable (Epic's runtime character customization plugin) on Unreal Engine 5.8, Windows: can a script put agent-meshes parts into a Customizable Object as swappable options and compile it, can an Instance be set to each option with a frame of each variant, and does the compile run headless. Nothing here needs a project or an asset of yours: the runner makes a throwaway project (PythonScriptPlugin, EditorScriptingUtilities, Mutable, Interchange) in the OS temp folder.

Status: Ran 2026-10-29, 9 of 16 checks pass, and the failing 7 are the answer. The compile by script works and the parts import, but a script cannot build the Customizable Object's graph: it can find the graph and create a mesh node and set its mesh, but cannot add the node to the graph or link a pin, so the object stays empty (0 parameters, 0 components) and there is no option to set. `build` 4 of 6, `variants` 2 of 7, `headless` 3 of 3 (the headless compile is of the empty object, so it says nothing about the cost of a real one). A fix needs an editor C++ bridge (see "Smallest next experiment").

## Run

```text
node examples/unreal/mutable/mu_probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --parts <folder of .glb files> [--only build,variants,headless] [--keep] [--plan] [--compile-timeout <seconds>]
```

`--parts` is a folder with two or more `.glb` files, here a fixed person body and two hats on the same three-bone skeleton (see "Making the parts"); `AGENT_UNREAL_MUTABLE_PARTS` sets it too. The groups run in order in one project, and `variants` and `headless` read what `build` saved, so name `build` with them. `--plan` prints what would run. `--keep` leaves the project folder (a run with a failing check keeps it anyway; it holds `Saved/*.json` reports, `Saved/Logs` and `Saved/Screenshots`). Exit code 0 when every check of the groups that ran passes, 1 when a check fails, 2 on a usage error. It is not part of `node scripts/check.mjs`; the pure checks have node tests (`mu-probe.test.mjs`) in the merge lane.

A run takes about two minutes: the editor starts twice (rendering, offscreen: `-RenderOffScreen`, no interactive session) and the commandlet once. **Every compile has a wall-clock limit** (`--compile-timeout`, default 240 s): the editor-mode compile is asynchronous and polled against that limit, and every phase's process has a limit of the compile timeout plus a margin and is killed at it. A timeout or a kill is a recorded result and is not retried. A node test pins that no compile call lacks its limit.

## Files

| File | What it does |
|---|---|
| `mu_probe.mjs` | writes the throwaway project, runs the phases, stops only processes that name that project, reads the reports and the screenshots, judges them |
| `mu-probe-checks.mjs`, `mu-probe.test.mjs` | the options and the checks as pure functions of the reports; the test changes one fact at a time and expects the matching check to fail, and pins the compile-timeout rule and the hygiene of the folder |
| `mu_probe_common.py` | the report, `run_compile` (the only compile call, under the limit), the parameter read-back and the tick driver of the editor-mode scripts |
| `mu_probe_build.py` | import the parts, `new_customizable_object`, try every way into the graph, compile, read back, create an Instance, save |
| `mu_probe_variants.py` | build a level (a Customizable Skeletal Mesh actor, a plain skeletal mesh as control, a camera), play it, attach an Instance, set each option, take a frame of each |
| `mu_probe_headless.py` | load the saved object and compile it in a `-nullrhi` commandlet with a blocking call |

## What the Python surface reaches

The installed plugin has no Python stubs and no Python example scripts, so the names come from its headers and from the reflection of the running editor (a `dir()` of the `unreal` module and one try per way in).

- `unreal.CustomizableObjectEditorFunctionLibrary.new_customizable_object(unreal.NewCustomizableObjectParameters)` with `package_path` and `asset_name` makes the object, saves it and returns it. It makes the graph with its one essential base node.
- `unreal.CompileParams` (`async_`, `skip_if_compiled`, `skip_if_not_out_of_date`, a `callback` delegate) goes to `CustomizableObject.compile`. `skip_if_not_out_of_date` defaults to true, so a script that wants a compile sets it false. The callback delegate binds from Python with `bind_callable`; its parameters carry `compiled`, `request_failed`, `skipped`, `errors` and `warnings`. An asynchronous compile needs the editor tick (the callback comes on a later tick); a commandlet has no Slate tick, so use the blocking call there.
- A freshly loaded object reads `is_compiled()` false, whatever it was when it was saved, so each new process compiles again before it can build an Instance.
- The graph is found with `unreal.find_object(co, "CustomizableObjectGraph_0")`. The object's `source` property and the graph's `nodes` are "protected and cannot be read". `unreal.new_object(unreal.CustomizableObjectNodeSkeletalMesh, outer=graph)` makes a node, and `set_editor_property("skeletal_mesh", mesh)` on it works and reads back, although `dir()` of the class lists none of its properties. The node is not in the graph, and nothing adds it: `AddNode`, `AllocateDefaultPins`, `AutowireNewNode` and `MakeLinkTo` are not functions Python can call (`call_method` reaches only reflected functions), pins are not objects, and the node's own pin reference properties have no edit flag.
- Instance calls the plugin does reflect: `create_instance`, `set_int_parameter_selected_option`, `get_int_parameter_selected_option`, `update_skeletal_mesh_async`, `has_any_skeletal_mesh`; a `CustomizableSkeletalMeshActor` has a `CustomizableSkeletalComponent` that takes an Instance with `set_customizable_object_instance`.

## What it showed

- The three agent-meshes parts (a body and two hats, each with one skeleton) import through Interchange as one skeletal mesh each, with no static mesh.
- The object made by `new_customizable_object` compiles in about half a second in the editor and about a tenth of a second in a `-nullrhi` commandlet (blocking call), reports `compiled` true with no errors or warnings, and reads back compiled. It has no components and no parameters, because its graph holds only the base node.
- The graph-building check fails on the link: the mesh node is created and its mesh is set, and nothing a script can call adds it to the graph or links a pin. The detail line of the check lists each attempt and its error text.
- With no parameter, no option is set, no variant frame is taken and no two frames differ. The control frame (the imported body on a plain skeletal mesh actor) shows 8162 lit pixels, so the offscreen capture path works and the black default frame of the Instance means the Instance drew nothing (`has_any_skeletal_mesh` false). The actor takes the Instance.
- The headless compile completes within the limit, but it compiled the empty object. The hang and the memory reports for real graphs (Extension Data constants, many morph targets and child objects) are not tested.

## Smallest next experiment

A small editor C++ module (as the Landscape bridge in the editor-scripting references does) exposing three functions to Python: add a node of a given class to an object's graph, link two pins by name, and reconstruct a node's pins. With those, the same probe builds a base node, an object group with a mesh node and a component node per part, and the variants and headless groups become testable without changing their checks. The alternative is to author the Customizable Object by hand in the editor once and let the probe load it; that tests the Instance and compile routes but not the graph question.

## Making the parts

Parts come from agent-meshes: build a person body (box and sphere parts bound rigidly to three bones, `root`, `spine`, `head`) and two hats bound to the `head` bone with the same bones, one workspace each, then export each as a `.glb`. The part names must not equal the bone names (agent-meshes refuses a part and a bone with one name). The probe imports the whole folder with a pipeline that combines the skins of one skeleton, so each part arrives as one skeletal mesh. The GLB files are not committed and the generated assets are not either; they live in the temporary project.
