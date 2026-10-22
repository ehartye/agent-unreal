# Cascade in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8 on Windows. Cascade is Unreal's legacy particle system (`ParticleSystem` assets). The plugin descriptor describes the Cascade plugin as the "Editor for (legacy) Cascade effect systems". Niagara is the current system. Epic's converter page says the converter "will continue to be updated until Cascade is deprecated and removed in a future release of the engine".

## Enable it

| Plugin | Category | Default | Flags | Dependencies |
|---|---|---|---|---|
| `Cascade` ("Cascade Editor") | FX | enabled | not beta, not experimental, editor-only | none |
| `CascadeToNiagaraConverter` | FX | disabled | beta, editor-only | `Niagara`, `PythonScriptPlugin`, `EditorScriptingUtilities` |

- Per the plugin descriptor, Cascade assets still run in a game with the `Cascade` plugin disabled; the plugin only provides the editor.
- Enable the converter: Edit > Plugins > Built-In > FX > Cascade To Niagara Converter, then restart the editor. Or add `{ "Name": "CascadeToNiagaraConverter", "Enabled": true }` to the `Plugins` array of the `.uproject`.

## Use it when

- You are playing, inspecting or maintaining an existing Cascade asset that must keep working unchanged.
- You are migrating Cascade content: Cascade is the conversion input, Niagara is the output.
- You need a quick read of what an old effect contains (emitters, module types, warmup time) before deciding how to rebuild it.

## Use something else when

- Use Niagara ([unreal-niagara.md](unreal-niagara.md)) for every new effect; Epic names it the replacement and Cascade is slated for removal.
- Use the Niagara template catalog ([unreal-niagara-templates.md](unreal-niagara-templates.md)) to start a new effect from a ready emitter.
- Use [unreal-chaos-niagara.md](unreal-chaos-niagara.md) for effects driven by destruction data.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Author Cascade emitters and modules | Editor UI only | Cascade editor; `unreal.ParticleSystem` exposes no emitter or module authoring members |
| Create an empty Cascade asset | Python | `unreal.ParticleSystemFactoryNew` as the factory for an asset-tools `create_asset` call |
| Inspect a Cascade asset | Python | `unreal.ParticleSystem`: `get_cascade_system_emitters()`, `contains_emitter_type()`, `get_warmup_time()` |
| Play a Cascade effect on an actor | Python / Blueprint / C++ | `unreal.ParticleSystemComponent` and `unreal.CascadeParticleSystemComponent` |
| Convert one asset | Editor UI | Content Browser right-click > Convert To Niagara System |
| Convert by script | Python | `CascadeToNiagaraConverter.convert_cascade_to_niagara(cascade_system, conversion_results)` from the plugin's Python folder; `conversion_results` is an `unreal.ConvertCascadeToNiagaraResults` (`cancelled_by_user`, `cancelled_by_python_error`) |
| Read the conversion report | Editor UI | Niagara Log window of the new system |
| Support a custom module, renderer or property | Python (plugin folder) | Subclass `ModuleConverterInterface`, `RendererConverterInterface` or `EmitterPropertiesConverterInterface`; put the script in `ModuleConversionScripts`, `RendererConversionScripts` or `PropertiesConversionScripts` |

- The menu entry runs `ConvertCascadeToNiagara.py` once per selected asset with the asset path and a results object path.
- The converter duplicates the source: output is a new `NiagaraSystem` named `<source>_Converted` in the same folder, created through `NiagaraSystemFactoryNew`. The Cascade asset is untouched.
- The conversion script opens a progress dialog (`ScopedSlowTask`), so run it in an interactive editor session.

## Workflow

1. Enable `CascadeToNiagaraConverter` and restart the editor.
2. Convert a representative asset first, or a copy.
3. Open the `_Converted` system and read the Niagara Log for the conversion report.
4. Resolve every warning and error. Use the "Fix issue" prompt where offered (for example reordering the Particle Update stack to meet module dependencies).
5. Rebuild unsupported features by hand in Niagara. Epic lists as not supported: Event Generator, EventReceiver Kill all, EventReceiver Spawn, Particle Attractor, Source Movement, Emitter Initial Location, Emitter Direct Location, Seeded Modules, and Beam and AnimTrail renderers.
6. Check partial support manually: Ribbon UVs are not guaranteed to match, and LOD conversion covers LOD 0 only.
7. Treat the result as a starting point. Epic describes the converter as "a starting point for upgrading".

## Sources

- [Cascade to Niagara Effects Converter Plugin](https://dev.epicgames.com/documentation/en-us/unreal-engine/cascade-to-niagara-effects-converter-plugin-for-unreal-engine)
- [Unreal Engine 5 Migration Guide](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-5-migration-guide)
- [Getting Started in Niagara Effects](https://dev.epicgames.com/documentation/en-us/unreal-engine/getting-started-in-niagara-effects-for-unreal-engine)
- Engine plugin descriptors for `Cascade` and `CascadeToNiagaraConverter` (the plugin descriptor).
- Editor Python surface: `ParticleSystem`, `ParticleSystemFactoryNew`, `ParticleSystemComponent`, `CascadeParticleSystemComponent`, `ConvertCascadeToNiagaraResults`.
- Converter plugin source: `ConvertCascadeToNiagara.py`, `CascadeToNiagaraConverter.py`, `CascadeToNiagaraConverterModule.cpp`.
