# Parameters, Instances and variant frames

Target: Unreal Engine 5.8 on Windows. An Instance holds one choice per parameter of a compiled Customizable Object, and an actor component shows it. The [mutable probe](../../../examples/unreal/mutable/README.md) reached the Instance and the actor on 2026-10-29 and stopped there, because the object it compiled had no parameter to set. Lines marked tested describe that run; the rest is what the class names and Epic's pages support.

## Create the Instance and show it

- [tested] 2026-10-29: `create_instance` on a compiled object returned an Instance, after the probe had recompiled the freshly loaded object ([Build and compile](unreal-mutable-build-compile.md)). Creating one from an uncompiled object was not run.
- [tested] 2026-10-29: a `CustomizableSkeletalMeshActor` has a `CustomizableSkeletalComponent`, and `set_customizable_object_instance` on it accepted the Instance. Both were spawned in a level that ran in Play In Editor, offscreen.
- [documented] Epic's 5.8 upgrade notes recommend `CustomizableObjectInstanceUsage` over `CustomizableSkeletalComponent`. The probe used the component; the Usage class was not run.
- [tested] 2026-10-29: an Instance of the empty object drew nothing: `has_any_skeletal_mesh` read false and the default frame was black.

## Set a parameter

- [tested] 2026-10-29: the Instance class lists `set_int_parameter_selected_option`, `get_int_parameter_selected_option` and `update_skeletal_mesh_async`. They were found by listing, and not called against a real option, because the object had no parameter.
- [general] The order is: set each parameter's option by name, call `update_skeletal_mesh_async`, then wait until `has_any_skeletal_mesh` reads true and the component has a mesh before taking a frame. Poll against a wall-clock limit, as for a compile; the update builds meshes and textures and can take a while on a real graph.
- [general] An object-group parameter that offers one part of several (for example one hat of two) is an integer parameter: its options are the child names. Read the parameter names and their option names back from the compiled object instead of guessing them.
- [general] Read the selected option back after setting it, and read the mesh back after the update; a frame is the last check, not the only one.

## One frame per variant

- [tested] 2026-10-29: a plain skeletal mesh actor holding the imported body gave a control frame of 8,162 lit pixels in the same offscreen Play In Editor session. The capture path works, so a black frame of the Instance is the Instance's and not the capture's. Always take a control frame first.
- [general] To judge variants, take one frame per option from a fixed camera, then compare the frames pixel by pixel. All frames identical means the options did not change what drew; one all-black frame means that update had not finished.
- [tested] 2026-10-29: no two variant frames were compared, because no option existed to set. Variants are invalidated as run (nothing to set).

## Not established

- [general] Not run: whether setting an option changes the drawn mesh, whether `update_skeletal_mesh_async` completes within a bound on a real graph, and whether the Usage class draws the same. The next experiment is in [Authoring the graph](unreal-mutable-graph.md).
