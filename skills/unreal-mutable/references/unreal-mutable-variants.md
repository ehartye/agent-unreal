# Parameters, Instances and variant frames

Target: Unreal Engine 5.8 on Windows. An Instance holds one choice per parameter of a compiled Customizable Object, and an actor component shows it. The [mutable probe](../../../examples/unreal/mutable/README.md) reached the Instance and the actor on 2026-10-29 with an object that had no parameter to set, and on 2026-10-30 (bridge runs 1 and 2) with one that had. Lines marked tested give the date; the rest is what the class names and Epic's pages support.

## Create the Instance and show it

- [tested] 2026-10-29: `create_instance` on a compiled object returned an Instance, after the probe had recompiled the freshly loaded object ([Build and compile](unreal-mutable-build-compile.md)). Creating one from an uncompiled object was not run.
- [tested] 2026-10-29: a `CustomizableSkeletalMeshActor` has a `CustomizableSkeletalComponent`, and `set_customizable_object_instance` on it accepted the Instance. Both were spawned in a level that ran in Play In Editor, offscreen.
- [documented] Epic's 5.8 upgrade notes recommend `CustomizableObjectInstanceUsage` over `CustomizableSkeletalComponent`. The probe used the component; the Usage class was not run.
- [tested] 2026-10-29: an Instance of the empty object drew nothing: `has_any_skeletal_mesh` read false and the default frame was black.

## Set a parameter

- [tested] 2026-10-29: the Instance class lists `set_int_parameter_selected_option`, `get_int_parameter_selected_option` and `update_skeletal_mesh_async`. They were found by listing in that spike.
- [tested] 2026-10-30, bridge run 2: an Instance of the compiled object, after a restart and a recompile, was set to `Cap` and then `Tall`; each read back as set and `has_any_skeletal_mesh` read true after each update.
- [general] The order is: set each parameter's option by name, call `update_skeletal_mesh_async`, then wait until `has_any_skeletal_mesh` reads true and the component has a mesh before taking a frame. Poll against a wall-clock limit, as for a compile; the update builds meshes and textures and can take a while on a real graph.
- [general] An object-group parameter that offers one part of several (for example one hat of two) is an integer parameter: its options are the child names. Read the parameter names and their option names back from the compiled object instead of guessing them.
- [general] Read the selected option back after setting it, and read the mesh back after the update; a frame is the last check, not the only one.

## One frame per variant

- [tested] 2026-10-29: a plain skeletal mesh actor holding the imported body gave a control frame of 8,162 lit pixels in the same offscreen Play In Editor session. The capture path works, so a black frame of the Instance is the Instance's and not the capture's. Always take a control frame first.
- [general] To judge variants, take one frame per option from a fixed camera, then compare the frames pixel by pixel. All frames identical means the options did not change what drew; one all-black frame means that update had not finished.
- [tested] 2026-10-30, bridge run 2: the frame for `Cap` showed the whole figure wearing a red cap and the frame for `Tall` the same figure wearing a grey top hat; the two differed in 3,341 pixels. The control frame had 8,979 lit pixels.
- [tested] 2026-10-30, bridge run 1: the frames differed in 2,711 pixels but showed one section of each part, a red disc above a blue leg and a grey cylinder above the same leg, because the graph linked only the first mesh section of each part.
- [tested] 2026-10-30, bridge runs 1 and 2: `unreal.InstanceUpdateDelegate` was not reachable from Python, so each variant waited a fixed 10 s before its frame.

## Not established

- [general] Not run: whether the update completes within a bound on a large graph, an update callback from Python, and whether the Usage class draws the same. Graph recipe: [Authoring the graph](unreal-mutable-graph.md).
