# Build and compile a Customizable Object from a script

Target: Unreal Engine 5.8 on Windows. The probe in [examples/unreal/mutable](../../../examples/unreal/mutable/README.md) ran this on a throwaway project with the Mutable, PythonScriptPlugin, EditorScriptingUtilities and Interchange plugins, in a rendering editor started with `-RenderOffScreen` and in a `-nullrhi` commandlet. Everything marked tested here was run on 2026-10-29, and only up to the point where the graph stayed empty.

## Create the object

- [tested] 2026-10-29: `unreal.CustomizableObjectEditorFunctionLibrary.new_customizable_object(params)` with an `unreal.NewCustomizableObjectParameters` carrying `package_path` and `asset_name` created and returned the object. Its graph was found by name (`CustomizableObjectGraph_0`).
- [tested] 2026-10-29: the new object read `is_compiled()` false before the first compile.
- [tested] 2026-10-29: a freshly loaded object read `is_compiled()` false in a new editor process, although it was saved after a compile, so the probe compiled again in each process.
- [documented] Epic's Python 5.8 pages for `CompileParams` and `CustomizableObjectEditorFunctionLibrary`: the older `compile_customizable_object_synchronously` is deprecated. Epic says to use `UCustomizableObject::Compile`, and a synchronous compile of an object that is not ready fails.

## Compile it

- [documented] Epic's Python 5.8 page for `unreal.CompileParams`: it carries `async_`, `callback`, `skip_if_compiled`, `skip_if_not_out_of_date`, `gather_references`, `optimization_level`, `texture_compression` and `compile_only_selected_instance`.
- [tested] 2026-10-29: `CustomizableObject.compile(params)` with `async_` true and a bound callback finished the empty object in about 0.5 second in the editor, with `compiled` true, `request_failed` false, no errors and no warnings. The callback is a dynamic delegate; bind it from Python with `bind_callable`.
- [documented] In the installed header `skip_if_not_out_of_date` defaults to true, so a script that wants a compile of an up-to-date object sets it false (the probe did).
- [tested] 2026-10-29: the asynchronous compile with a callback ran in the rendering editor, and the blocking form ran in the `-nullrhi` commandlet ([Headless and editor](unreal-mutable-headless.md)).
- [general] An asynchronous compile needs the editor tick, so poll for the callback from a tick callback; a commandlet has no Slate tick, so use the blocking form there.
- [tested] 2026-10-29: `is_compiled()` read true after the compile and the compile reported 0 errors.
- [general] That reading is the check; do not infer success from the call returning.

## The timeout rule

- [general] Give every compile a wall-clock limit and poll against it, and give the editor or commandlet process that runs it a limit a little longer than the compile's. The probe default is 240 seconds for the compile. A timeout is a recorded result and is not retried; stop the process by its project path, never by name alone.
- [general] The empty object's half second says nothing about a real graph. Forum reports, not run here, describe a compile that hangs when the graph holds Extension Data constants and one that needs very large memory with many morph targets and child objects. Treat the limit as the protection, not the estimate.
- [general] Compile in a throwaway process when possible: a hung compile then costs a process and not an open editor session of yours. Keep the compiled object out of source control; the project's `.uasset` files are generated.

## What this does not give you

- [tested] 2026-10-29: the compiled object had 0 parameters and 0 components, because no node could be added to its graph from Python (build/compile invalidated as run). Compiling a graph with real options was not run. See [Authoring the graph](unreal-mutable-graph.md).
- [general] Compile options such as `optimization_level` and `texture_compression` change cost and quality. Their effect was not measured.

## Related

- [Parameters and variants](unreal-mutable-variants.md) for the step after a compile; the editor Python run modes are in `unreal-editor-scripting`.
