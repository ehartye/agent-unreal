# Mutable in Unreal 5.8: what it is and how the pieces fit

Target: Unreal Engine 5.8 on Windows. Mutable is Epic's real-time character customization toolset: it "combines and transforms meshes, materials, and textures" so a wardrobe of separate parts becomes one character, vehicle or object at runtime. Epic's documentation page is titled "Mutable Skeletal Mesh Generation"; Epic's Mutable Sample on Fab is the worked example. Names of the plugin classes below come from the installed 5.8 headers and a listing of the running editor's `unreal` module; the run is in the [mutable probe](../../../examples/unreal/mutable/README.md).

## The pieces

- [documented] A **Customizable Object** is the authored asset: a graph of nodes that name parts (skeletal meshes, materials, textures, clothing, hair), groups of options and the parameters that choose between them. It is edited in the editor and compiled.
- [documented] Epic's 5.8 release notes: a **dataless** Customizable Object, new in 5.8, evaluates parameter inputs at runtime instead of compile time, for faster iteration, graph reuse and patching.
- [general] **Compiling** turns the graph into data Mutable evaluates at runtime, and it is an editor-time step: a packaged game assembles instances and does not compile. No page the wiki holds states this, and it was not run.
- [general] An **Instance** (`CustomizableObjectInstance`) holds one choice of parameter values for an object; setting a parameter and updating the instance is expected to build the skeletal mesh and materials for that choice. This was not run: the instance drew nothing because the object had no parameters.
- [documented] An **actor component** shows the result: `CustomizableSkeletalComponent` on a `CustomizableSkeletalMeshActor`, or `CustomizableObjectInstanceUsage`, which Epic's 5.8 upgrade notes recommend over the wrapper component.
- [tested] 2026-10-29: the Python names found on the installed plugin were `CustomizableObjectEditorFunctionLibrary.new_customizable_object`, `CompileParams`, `CustomizableObject.compile`, `create_instance`, `set_int_parameter_selected_option`, `get_int_parameter_selected_option`, `update_skeletal_mesh_async`, `has_any_skeletal_mesh`, and the actor and component classes. The installed plugin shipped no Python stubs and no Python example scripts, only binaries, config, one clip-mesh material and source.

## What 5.8 changed

- [documented] Epic's release notes call Mutable production-ready in 5.8, and the Mutable Sample post repeats it. Epic still marks custom External Operations "Very experimental!", so maturity is per feature.
- [documented] A Skeletal Mesh pin and node type let graphs work at skeletal-mesh level rather than per section; Skeletal Mesh Modify, Break and Make nodes, Asset User Data nodes, Material Override on components, and clothing in Skeletal Mesh parameters were added. Updates of MIPs and LODs run in parallel, and game-thread work dropped.
- [documented] The sample's Showcase level has one object each for Basic, Color Patterns, Skin Tone, Projectors, Edit Material, Data Tables, Macros and Material Merging, plus body shape morphs with automatic cloth refitting and a MetaHuman example. Use it as the reference graph.

## How it fits the rest of the plugin's skills

- [general] The parts reach Mutable as skeletal meshes; whether they must share one skeleton was not run. Import them with `unreal-import`; build them with agent-meshes (`mesh-build`, `mesh-tool-selection` in agent-meshes).
- [tested] 2026-10-29: three agent-meshes GLBs (a fixed body and two hats, each on the same three bones) imported as one skeletal mesh and one skeleton each (`person_body_Skeleton`, `hat_cap_Skeleton`, `hat_tall_Skeleton`), with no static mesh. A mesh node accepted the body as its mesh. Whether Mutable combines parts on separate skeletons was not run.
- [general] Animation of the composed mesh is `unreal-animation`; a MetaHuman as a Mutable object is `unreal-metahuman`. Neither is covered here.

## Choose it when

- [general] Choose Mutable when many characters must differ by wardrobe, hair, body shape or colour and one skeletal mesh per combination is too many assets.
- [general] Skip it for a fixed character, a single swap of one mesh (set the mesh on a Skeletal Mesh component), or a material-only change (a material parameter is cheaper). Mutable also combines geometry, which a material variant never does.

## Next

- [general] [Build and compile](unreal-mutable-build-compile.md) for what a script can create; [Authoring the graph](unreal-mutable-graph.md) for what it cannot; [Known bugs and open questions](unreal-mutable-bugs.md) for what is not established.
