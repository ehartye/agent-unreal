# Author Niagara systems from Python with the Niagara toolsets

Written for Unreal 5.8.2; [`nts_validate.mjs`](../../../examples/unreal/niagara_toolsets/README.md) passed 25 of 25 again on 5.8.4. It runs each [tested] line on a throwaway project; [documented] lines name a file under the engine's `Engine` folder. The route table and the other Niagara routes are in [Niagara in Unreal](unreal-niagara.md); run modes for editor Python are in [Editor Python](../../unreal-editor-scripting/references/unreal-editor-python.md).

## The plugin

- `NiagaraToolsets` is an Experimental, editor-only plugin under `Plugins/Experimental/Toolsets`, disabled by default; enabling it loads `ToolsetRegistry`. `NiagaraToolset_System` has 46 tools: create from a template, read schema and topology, add or remove emitters, renderers and modules, set stack inputs, read compile state and stack issues.
- Call a tool with `unreal.ToolsetRegistry.execute_tool("NiagaraToolsets.NiagaraToolset_System", "AddEmitter", json_input)`. Tools are `AICallable`, not Python members. `get_toolset_json_schema(unreal.NiagaraToolset_System)` returns each tool's input schema.
- Synchronous tools (`CreateNiagaraSystem`, `GetSystemSummary`, `AddEmitter`, `GetStackInputData`, `SetStackInputData`, `SetRendererData`) complete in a commandlet. Tools that wait for a compile (`GetSystemCompileState`, `GetStackIssues`) complete from an editor tick: poll `result.is_complete` as [`niagara_verify.py`](../../../examples/unreal/niagara_verify.py) does, and expect `UpToDate`.
- Verify an authored system with a simulation cache ([Niagara](unreal-niagara.md)) before building on it. Simulation stages, event handlers and local modules are C++ work.

## Call shapes

- [tested] The input is a JSON string. Argument names are the C++ parameter names in lower camel case (`AddEmitter(System, TemplateEmitter, EmitterName)` takes `system`, `templateEmitter`, `emitterName`). The result's `value` is JSON `{"returnValue": ...}`; `error` is an empty string on success.
- [tested] Asset ref: `{"refPath": "/Package/Path.Name"}`, the object path (package, dot, asset name). Template emitters are in `/Niagara/DefaultAssets/Templates/Emitters/`; `RecycleParticlesInView` and `HangingParticulates` are two of the 14.
- [tested] Stack-input ref: `{system, emitterName, scriptName, moduleName, inputNameStack: [name]}`, with `rendererIndex` for a renderer. `scriptName` is `EmitterSpawnScript`, `EmitterUpdateScript`, `ParticleSpawnScript` or `ParticleUpdateScript`; `moduleName` and the input names come from `AddEmitter`'s result or `GetEmitterTopology` (`emitterRef`: `{system, emitterName}`). [documented] The ref is `FNiagaraExt_StackItemReference` (`Plugins/FX/Niagara/Source/NiagaraEditor/Public/NiagaraExternalSystemEditorUtilities.h`); a dynamic input takes a chain of names in `inputNameStack`.
- [tested] A plain input holding a local value is read-then-write. `GetStackInputData` (`stackInputRef`) returns `{"struct": {"refPath": "/Script/Niagara.NiagaraFloat"}, "value": {"value": 5}}`; change the value and pass the whole object as `inputData` to `SetStackInputData`. The stored value persists through a save and a new process. A color is `LinearColor` with `r, g, b, a`; an enum is `NiagaraExt_StackInputData_Enum` with `enum`, `enumName` and `displayName`. An input name the module lacks returns an error naming the full path.
- [tested] An input linked to a variable or bound to a dynamic input returns a different struct (`NiagaraExt_StackInputData_Linked`, `..._DynamicInput`), and an edit of its `value` is ignored or empties the link, with no error. Replace such an input as a whole: [Linked, dynamic and hidden inputs](unreal-niagara-toolset-inputs.md).
- [tested] `GetRendererData` (`rendererRef`: `{system, emitterName, rendererIndex}`) returns `{"propertyValues": "<json string>"}` with `Material`, `SubImageSize` and the sprite bindings. `SetRendererData` (`renderer`, `rendererData`) takes `propertyValues` as a JSON string and changes only the properties it names. An object in that place returns no error and changes nothing, so read the value back.

## Worked example: create, edit an input, set the material

[tested] The snippet ran as written (with the material created first). [`nts_author.py`](../../../examples/unreal/niagara_toolsets/nts_author.py) makes the same calls and reads everything back in a new process.

```python
import json, unreal
TOOLSET = "NiagaraToolsets.NiagaraToolset_System"
def ref(path): return {"refPath": path + "." + path.rsplit("/", 1)[-1]}
def call(tool, args):
    r = unreal.ToolsetRegistry.execute_tool(TOOLSET, tool, json.dumps(args))
    if str(r.get_editor_property("error")): raise RuntimeError(str(r.get_editor_property("error")))
    return json.loads(str(r.get_editor_property("value")))["returnValue"]

unreal.AssetToolsHelpers.get_asset_tools().create_asset("NS_Worked", "/Game/FX", unreal.NiagaraSystem, unreal.NiagaraSystemFactoryNew())
system = ref("/Game/FX/NS_Worked")
template = ref("/Niagara/DefaultAssets/Templates/Emitters/HangingParticulates")
call("AddEmitter", {"system": system, "templateEmitter": template, "emitterName": "Motes"})

life = {"system": system, "emitterName": "Motes", "scriptName": "ParticleSpawnScript",
        "moduleName": "InitializeParticle", "inputNameStack": ["Lifetime Min"]}
data = call("GetStackInputData", {"stackInputRef": life})
data["value"]["value"] = 2.5
call("SetStackInputData", {"stackInputRef": life, "inputData": data})

look = json.dumps({"Material": ref("/Game/FX/M_Worked"), "SubImageSize": {"x": 4, "y": 4}})
call("SetRendererData", {"renderer": {"system": system, "emitterName": "Motes", "rendererIndex": 0}, "rendererData": {"propertyValues": look}})
unreal.EditorAssetLibrary.save_asset("/Game/FX/NS_Worked")
```

- [tested] `NiagaraSystemFactoryNew` makes an empty system (no emitters). `CreateNiagaraSystem` (`assetName`, `assetPath`, `templateSystem`) copies a template system instead.
- [documented] Epic's fundamentals skill (`NiagaraToolsets/Content/Python/skills/fundamentals.py`) says a material needs the usage flag of its renderer type; the example's material has `used_with_niagara_sprites` set before it is saved.

## Emitters added to a template-made system start dead

- [tested] On 5.8.4, an emitter added with `AddEmitter` to a system made by `CreateNiagaraSystem` from a template system counts 0 particles in a valid simulation cache, or the system completes at once and every capture is refused (`System already completed its simulation`). A system made with `NiagaraSystemFactoryNew` is not affected.
- [tested] Rule: after the last `AddEmitter`, write a Float or Int stack input to a different value (the emitter's `SpawnRate`, a burst `Spawn Count` of 5, or the system's `SystemState` `Loop Duration` of 5), then verify with a simulation-cache count before saving. 90 is the Fountain's default `SpawnRate`, so writing 90 changes nothing; 91, 60, 30 or 15 revives it and the count tracks the rate (60, 30, 15 and 0 read 97, 49, 24 and 0). Removing emitters after the write is fine; a second emitter added after a write kills the whole system again, so write again after the last add.
- [tested] On 5.8.4, a mesh emitter (`UpwardMeshBurst`) added to a template-made system was dead too: 30 refused captures, and its `Lifetime` was refused (`input is hidden by static-switch / conditional logic ... Adjust the parent switch first.`). After a write of the system's `SystemState` `Loop Duration` to 5.0 the mesh emitter counted 88 particles and the screenshot changed 116,434 of 921,600 pixels (first run).
- [tested] These do not revive it: a write before the add, a write of the value already held, an enum edit (`Loop Behavior` to Infinite), a bool, toggling the `SpawnRate` module off and on, adding three modules.
- [tested] `GetSystemCompileState` reads `UpToDate` for every one of these systems, so it does not show whether a system emits.
- [documented] The cause is not determined. The source shows Float and Int inputs are rapid iteration parameters and bool and enum inputs are not (`FNiagaraStackGraphUtilities::IsRapidIterationType`, `NiagaraStackGraphUtilities.cpp`), and `SetLocalValue` writes them into the affected scripts; a missing refresh as the cause is untested.

Deleting and recreating a system, the start-up log and what was not verified are in [Delete and recreate, and the start-up log](unreal-niagara-toolsets-lifecycle.md).
