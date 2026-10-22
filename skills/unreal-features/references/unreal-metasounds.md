# MetaSounds in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. MetaSounds is a node-graph, sample-accurate audio DSP system: each MetaSound is its own rendering graph, driven by named input parameters and triggers from gameplay.

## Enable it

| Item | Value (plugin descriptor) |
|---|---|
| Plugin | `Metasound` ("MetaSound"), category Audio |
| Enabled by default | yes; not beta, not experimental, not editor-only |
| Modules | Runtime, UncookedOnly |
| Dependencies | AudioWidgets, AudioSynesthesia, ContentBrowserAssetDataSource, WaveTable, ModelViewViewModel |

- Enable through Edit > Plugins, or add `{ "Name": "Metasound", "Enabled": true }` to the `Plugins` array of the `.uproject`.
- Related Audio plugins, all off by default: `AudioModulation` (default Audio Modulation implementation), `AudioSynesthesia` (offline analyzers exposing extracted audio metadata to Blueprints; beta), `WaveTable` (beta). `Metasound` lists AudioSynesthesia, WaveTable and AudioWidgets as dependencies.

## Use it when

- A sound must be generated or shaped at runtime from game data (speed, health, distance, a random seed) through named parameters.
- Timing must be sample-accurate: triggers, rhythmic or concatenated playback, loop points, cue points.
- One graph should serve many variations: Presets override a parent's input defaults; Patches are reusable sub-graphs.
- You need synthesis, filters, dynamics or spatialization nodes inside the sound itself.
- An agent must build sounds from code: the Builder API creates Sources and Patches in the editor and at runtime.
- New sound sources in a project: Epic positions MetaSounds as the replacement for Sound Cues, with feature parity.

## Use something else when

- Use an imported WAV (Sound Wave asset) when the sound is fixed and rendered offline. The sibling plugin agent-beeps renders game sounds and songs as WAV; import them with the `engine-asset-import` skill. A MetaSound can still play the imported wave through its Wave Player node when it needs triggers, loop points or pitch-scale modulation.
- Build a MetaSound when the sound must respond to live parameters. Render a WAV with agent-beeps when the sound is a one-shot cue, a loop or a song.
- Use Sound Cues only to maintain existing legacy content; they are not sample-accurate and cannot run arbitrary DSP.
- Use the Audio Modulation plugin when runtime-adjustable parameter buses should replace static Sound Class and Sound Mix settings. MetaSounds can read its parameter buses.
- Use the audio analysis plugin (AudioSynesthesia) when audio data should drive gameplay or visuals, in real time or offline; Epic lists Niagara and Blueprint as consumers, see [unreal-niagara.md](unreal-niagara.md).

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Create a Source or Patch asset | Editor UI; Python factories | Content Browser Add > Audio > MetaSound Source / MetaSounds > MetaSound Patch. Python has `unreal.MetaSoundSourceFactory` and `unreal.MetaSoundFactory`. |
| Build a graph in code | Python, Blueprint (Audio > MetaSound > Builder), C++ | `unreal.MetaSoundBuilderSubsystem.create_source_builder` or `create_patch_builder`, then on the builder: `add_graph_input_node`, `add_graph_output_node`, `add_node_by_class_name`, `connect_nodes`, `add_interface`, `build_new_meta_sound`. Classes: `MetaSoundSourceBuilder`, `MetaSoundPatchBuilder` (both derive `MetaSoundBuilderBase`). |
| Literal values for pins | Python | `MetaSoundBuilderSubsystem.create_float_meta_sound_literal` and the bool, int, string, object and array variants; `MetaSoundBuilderNodeInputHandle` / `MetaSoundBuilderNodeOutputHandle`; `MetaSoundBuilderResult` (SUCCEEDED, FAILED). |
| Save a built graph as an asset | Python (editor) | `unreal.MetaSoundEditorSubsystem.build_to_asset`; `build_and_overwrite_meta_sound` on the builder. |
| Edit an existing asset | Python (editor) | `MetaSoundEditorSubsystem.find_or_begin_building`; `MetaSoundSource`, `MetaSoundPatch` expose the document `graph`. |
| Presets | Python, editor UI | `convert_to_preset` / `convert_from_preset`, `create_source_preset_builder`, `create_patch_preset_builder`; or right-click a parent > Create MetaSound Preset. |
| Audition | Python / Blueprint | `MetaSoundSourceBuilder.audition`. |
| Send parameters during play | Blueprint, C++, Python | Audio Component parameter interface; `MetasoundParameterPack` (`make_metasound_parameter_pack`, `set_float`, `set_bool`, `set_int`, `set_string`, `set_trigger`); `MetasoundGeneratorHandle.apply_parameter_pack`. |
| Read graph outputs in gameplay | Blueprint, C++, Python | Watch Output node; `MetaSoundOutputSubsystem.watch_output`; `MetasoundGeneratorHandle.watch_output`. Source must be playing; Patch outputs cannot be watched. |
| Randomizer template | Python | `MetaSoundRandomizerTemplate` / `MetaSoundRandomizerDocumentConfiguration` (`sounds`, `pitch`). |
| Search registered classes | Python | `MetaSoundAssetSubsystem.find_asset_class_info`. |
| Custom DSP nodes | C++ only | Node API: a C++ class defining inputs, outputs and an execute callback. |
| Visual graph layout, in-graph widgets, wiring by hand | Editor UI only | MetaSound Editor. The `MetasoundEditorGraph*` classes in the Python module are editor graph objects; the Builder classes are the scripting route. |

Python names in the surface: about 146 `Metasound`/`MetaSound` names. Building and editing: the builder, subsystem, handle, literal and result classes above. The rest are editor-graph node and default-value classes, `MetasoundFrontend*` document structs and enums (read-only data), view-model and widget classes, and delegate types.

## Workflow

1. Choose the asset type: Source plays on its own; Patch is referenced by other MetaSounds; Preset overrides a parent's input defaults.
2. Define Inputs and Outputs in the Members panel. Use Inputs for values that change during play; Variable changes are not registered during playback. Use constructor pins (set before playback) for values fixed at start; they improve performance.
3. Keep the `UE.Source.OneShot` interface for one-shot sounds (On Finished stops the sound); remove it for loops and ambience. Add `UE.Attenuation` for a Distance input, `UE.Spatialization` for Azimuth and Elevation.
4. Build the graph in the MetaSound Editor, or through the Builder API (editor: Editor Subsystem; runtime: Builder Subsystem).
5. Audition with live parameter preview and the output meter; use Live Updates when auditioning from a builder.
6. Reuse through Patches and Presets; edits to a base graph propagate to every reference.
7. Connect gameplay through Audio Component parameters, and watch outputs where gameplay needs to react.

## Sources

- [Introducing MetaSounds](https://dev.epicgames.com/documentation/unreal-engine/metasounds-the-next-generation-sound-sources-in-unreal-engine)
- [MetaSounds Reference Guide](https://dev.epicgames.com/documentation/unreal-engine/metasounds-reference-guide-in-unreal-engine)
- [Audio in Unreal Engine 5](https://dev.epicgames.com/documentation/unreal-engine/audio-in-unreal-engine-5)
- [UMetaSoundBuilderBase](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/MetasoundEngine/UMetaSoundBuilderBase)
- [Build New MetaSound](https://dev.epicgames.com/documentation/unreal-engine/BlueprintAPI/Audio/MetaSound/Builder/BuildNewMetaSound)
- Plugin descriptors: Metasound, AudioModulation, AudioSynesthesia, WaveTable, AudioWidgets.
- The editor Python module's class and member listing (`unreal.MetaSound*`, `unreal.Metasound*`).
