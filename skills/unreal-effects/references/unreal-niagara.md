# Niagara in Unreal 5.8: author, drive and verify from an agent

Each statement below is backed by Epic documentation, the installed engine's source or Python API, or a script in [`examples/unreal`](../../../examples/unreal/README.md). `node examples/unreal/niagara_validate.mjs --engine <UE_5.8 folder>` runs the scripts and checks 15 of the statements. Template choice is in [Niagara templates](unreal-niagara-templates.md); running editor Python is in [Editor Python](../../unreal-editor-scripting/references/unreal-editor-python.md).

## Pick a route

| Need | Route |
|---|---|
| Make a system from an engine template, tune properties, place it | Python: AssetTools, `EditorAssetLibrary`, `get_editor_property` |
| Add emitters, renderers, modules, set stack inputs, read compile state | Python through `unreal.ToolsetRegistry.execute_tool` (Experimental NiagaraToolsets; [call shapes](unreal-niagara-toolsets.md)), else C++ |
| Drive a running effect (user parameters, mesh overrides) | Python on `NiagaraComponent` |
| Prove an effect spawned N particles without a screenshot | Python simulation cache |
| Simulation stages, event handlers, custom data interfaces, graph edits | C++ |
| Let an external agent call all of it | Epic's MCP server over the toolset registry |

Use the cheapest route that covers the need. [`niagara_build.py`](../../../examples/unreal/niagara_build.py) needs PythonScriptPlugin, EditorScriptingUtilities and Niagara; the stack-authoring script also needs NiagaraToolsets.

## Make and place a system from Python

- Create an empty system with `AssetTools.create_asset(name, path, unreal.NiagaraSystem, unreal.NiagaraSystemFactoryNew())`, or duplicate a template such as `/Niagara/DefaultAssets/Templates/Systems/SimpleExplosion` into `/Game` with `duplicate_asset`.
- In a commandlet, scan the registry first (`AssetRegistry.search_all_assets(True)`), pass the source as an object path (`Package.Name`), and `save_asset` each duplicate before saving the map that places it.
- Assign a system to a placed `NiagaraActor` through the component's `asset` editor property.
- Spawn at runtime (`spawn_system_at_location`) in a ticking world: the editor or Play-In-Editor. A commandlet's blank map has no ticking world ([`niagara_traps.py`](../../../examples/unreal/niagara_traps.py)).
- Drive a running effect with the typed `NiagaraComponent` setters (`set_variable_float`, `_vec3`, `_linear_color`, `_static_mesh`, `_texture`, `_object`) and `NiagaraFunctionLibrary` overrides. `NiagaraSystem` itself exposes editor properties (warmup, fixed bounds, effect type) and almost no methods.

## Author the stack from Python (NiagaraToolsets)

Epic's Experimental NiagaraToolsets plugin adds emitters, renderers and modules and sets stack inputs through `unreal.ToolsetRegistry.execute_tool`. The call shapes, a worked create, edit-input and set-material example are in [Niagara toolsets from Python](unreal-niagara-toolsets.md); the delete-and-recreate rule and the start-up log are in [Niagara toolsets lifecycle](unreal-niagara-toolsets-lifecycle.md). [`niagara_toolset_author.py`](../../../examples/unreal/niagara_toolset_author.py) shows the add-emitter flow; the showcase adds modules to an emitter of a system that already emits ([README](../../../examples/unreal/niagara-showcase/README.md)). Simulation stages, event handlers and local modules are C++ work.

## C++

- `UNiagaraExternalEditUtilities` (`NiagaraEditor/Public/NiagaraExternalSystemEditorUtilities.h`) is the authoring API the toolsets wrap. Its header marks it experimental, and its functions are not `UFUNCTION`s, so Python does not see it.
- `NiagaraPythonEmitter` and `NiagaraPythonModule` exist for version-upgrade scripts: they read an emitter's modules and read or set its properties, and cannot add an emitter, renderer or module.
- Custom data interfaces are C++; Epic ships `ExampleCustomDataInterface` as the model. Niagara Data Channels have a Python library (`NiagaraDataChannelLibrary`: write, read, subscribe).
- To add an operation, write a small editor module with a `BlueprintCallable` wrapper, or register a toolset (`AICallable` in C++, or the `toolset_registry.tool_call` decorator in Python) and call it through `execute_tool`.

## MCP

Epic's MCP server exposes the toolset registry through `list_toolsets`, `describe_toolset` and `call_tool`, and needs the `ModelContextProtocol` and `AllToolsets` plugins. It runs the same tools as `execute_tool`.

## Bring generated assets into Niagara

- A mesh renderer takes a static mesh from the system or a user parameter (`override_system_user_variable_static_mesh`); the Static Mesh data interface also binds an actor or component. The Audio Player data interface plays a `SoundBase` from particle data.
- Turn a sprite atlas into a flipbook: import it, use a Sprite Renderer with the Sub UV Animation module, and set Sub Image Size to the atlas grid. Epic advises a power-of-two texture and a tile count that divides it evenly. The Niagara Baker, which bakes a simulation to a flipbook, is an editor UI workflow.

## Drawn, ink and cel looks

Choose by what must stay drawn. [`stylized_validate.mjs`](../../../examples/unreal/stylized/stylized_validate.mjs) runs each [tested] line.

- Drawn frames that ignore the lighting: a self-emissive sprite that plays a flipbook. [tested] An Unlit, Masked material (Texture Sample Parameter SubUV into Emissive Color and Opacity Mask) drew the same colours and area under a bright backdrop with a strong sun and a dark backdrop with no sun.
- [tested] Set the Sprite Renderer's Sub Image Size to the grid (`SetRendererData`, `{"SubImageSize":{"x":4,"y":4}}`). SubUV Animation in Linear mode writes `Particles.SubImageIndex` as normalized age x frame count (0 to 16 over the lifetime). Direct Index mode with a constant Direct Frame Index shows that cell.
- [documented] Turn Sub UV Blending Enabled off for hard cuts: on, it blends with the next cell by the fractional index (`NiagaraSpriteRendererProperties.h`).
- Stepped light on an unlit particle: quantize a light term, `floor(term x N) / (N - 1)`, into a Lerp. [tested] It drew flat bands next to a smooth control.
- [tested] The Dynamic Material Parameters module's Index 0 Param 1 (3) reached the material's Dynamic Parameter node (default 4): three bands rendered.
- Lit toon on a particle: [tested] Substrate Toon works on sprites ([Substrate](../../unreal-rendering/references/unreal-substrate.md)).
- Not verified: linking Direct Frame Index to a user parameter; the frame stayed age-driven.

## Fluids

- Enable Generate Mesh Distance Fields (Project Settings > Rendering; `r.GenerateMeshDistanceFields=True`) and restart the editor before using the 3D fluid templates ([Epic: Mesh Distance Fields](https://dev.epicgames.com/documentation/unreal-engine/mesh-distance-fields-in-unreal-engine)).
- A system compiles the first time it is activated, on the game thread. Activate it ahead of the moment it is needed; the result is cached.
- Hide a fluid's grid-bounds overlay with the `User.DrawBounds` variable.
- The templates and their render settings are in [Epic's Niagara Fluids reference](https://dev.epicgames.com/documentation/unreal-engine/niagara-fluids-reference-in-unreal-engine).

## Verify and profile

- Count what spawned: `NiagaraSimCacheFunctionLibrary.create_niagara_sim_cache`, then `capture_niagara_sim_cache_immediate(cache, params, component, True, dt)` in Play-In-Editor, then `read_position_attribute("Position", emitter, frame)`. Call `activate(True)` on a one-shot burst before capturing. A stateless (lightweight) template keeps no per-particle data, so read stateful templates this way.
- Cost and scalability: Effect Types share scalability rules; the Niagara Debugger (`fx.Niagara.Debug.Hud`, `fx.Budget.*`) and Unreal Insights with `-StatNamedEvents` are interactive tools. See [profiling facts](../../unreal-native/references/unreal-native-profiling-facts.md).
- Particle counts show that an effect ran. Pair them with a native screenshot and the review in [Unreal production stack](../../unreal-rendering/references/unreal-production-stack.md).
