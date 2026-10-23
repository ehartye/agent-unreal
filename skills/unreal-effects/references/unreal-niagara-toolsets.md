# Author Niagara systems from Python with the Niagara toolsets

Written for Unreal 5.8.2. [`nts_validate.mjs`](../../../examples/unreal/niagara_toolsets/README.md) runs each [tested] line on a throwaway project; [documented] lines name a file under the engine's `Engine` folder. The route table and the other Niagara routes are in [Niagara in Unreal](unreal-niagara.md); run modes for editor Python are in [Editor Python](../../unreal-editor-scripting/references/unreal-editor-python.md).

## The plugin

- `NiagaraToolsets` is an Experimental, editor-only plugin under `Plugins/Experimental/Toolsets`, disabled by default; enabling it loads `ToolsetRegistry`. `NiagaraToolset_System` has 46 tools: create from a template, read schema and topology, add or remove emitters, renderers and modules, set stack inputs, read compile state and stack issues.
- Call a tool with `unreal.ToolsetRegistry.execute_tool("NiagaraToolsets.NiagaraToolset_System", "AddEmitter", json_input)`. Tools are `AICallable`, not Python members. `get_toolset_json_schema(unreal.NiagaraToolset_System)` returns each tool's input schema.
- Synchronous tools (`CreateNiagaraSystem`, `GetSystemSummary`, `AddEmitter`, `GetStackInputData`, `SetStackInputData`, `SetRendererData`) complete in a commandlet. Tools that wait for a compile (`GetSystemCompileState`, `GetStackIssues`) complete from an editor tick: poll `result.is_complete` as [`niagara_verify.py`](../../../examples/unreal/niagara_verify.py) does, and expect `UpToDate`.
- Verify an authored system with a simulation cache ([Niagara](unreal-niagara.md)) before building on it. Simulation stages, event handlers and local modules are C++ work.

## Call shapes

- [tested] The input is a JSON string. Argument names are the C++ parameter names in lower camel case (`AddEmitter(System, TemplateEmitter, EmitterName)` takes `system`, `templateEmitter`, `emitterName`). The result's `value` is JSON `{"returnValue": ...}`; `error` is an empty string on success.
- [tested] Asset ref: `{"refPath": "/Package/Path.Name"}`, the object path (package, dot, asset name). Template emitters are in `/Niagara/DefaultAssets/Templates/Emitters/`; `RecycleParticlesInView` and `HangingParticulates` are two of the 14.
- [tested] Stack-input ref: `{system, emitterName, scriptName, moduleName, inputNameStack: [name]}`, with `rendererIndex` for a renderer. `scriptName` is `EmitterSpawnScript`, `EmitterUpdateScript`, `ParticleSpawnScript` or `ParticleUpdateScript`; `moduleName` and the input names come from `AddEmitter`'s result or `GetEmitterTopology` (`emitterRef`: `{system, emitterName}`). [documented] The ref is `FNiagaraExt_StackItemReference` (`Plugins/FX/Niagara/Source/NiagaraEditor/Public/NiagaraExternalSystemEditorUtilities.h`); a dynamic input takes a chain of names in `inputNameStack`.
- [tested] A write is read-then-write. `GetStackInputData` (`stackInputRef`) returns `{"struct": {"refPath": "/Script/Niagara.NiagaraFloat"}, "value": {"value": 5}}`; change the value and pass the whole object as `inputData` to `SetStackInputData`. The stored value persists through a save and a new process. A color is `LinearColor` with `r, g, b, a`; an enum is `NiagaraExt_StackInputData_Enum` with `enum`, `enumName` and `displayName`. An input name the module lacks returns an error naming the full path.
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

## Delete and recreate a system

- [tested] A system created and saved in the same process deletes cleanly: `delete_asset` removes the file and the registry entry, and a new system at the path saves.
- [tested] A system saved by an earlier process does not: `delete_asset` returns `True` while the `.uasset` and the registry entry stay. `CreateNiagaraSystem` and `AddEmitter` then report success and `save_asset` ends the process with `EXCEPTION_ACCESS_VIOLATION` (exit code 3; the stack runs through Engine, CoreUObject, UnrealEd and EditorScriptingUtilities). A `scan_paths_synchronous` alone does not clear it; the same crash follows.
- [tested] What works: after `delete_asset`, check the file. If it remains, remove it, call `AssetRegistry.scan_paths_synchronous([folder], True)` and confirm `does_asset_exist` is `False`, then create. The map-recreation order in [Editor Python](../../unreal-editor-scripting/references/unreal-editor-python.md) is the same remove-and-rescan step.
- Name a recreated system differently when the old name does not matter.

## The start-up log

- [documented] `NiagaraToolsets/Content/Python/init_unreal.py` imports seven modules under `skills/`. Each declares a class that derives from `unreal.AgentSkill` and registers it with `toolset_registry.agent_skill.agent_skill` (`ToolsetRegistry/Content/Python/toolset_registry/agent_skill.py`). `AgentSkill` is the Python name of `UAgentSkill` in `ToolsetRegistry/Source/ToolsetRegistry/Public/ToolsetRegistry/AgentSkill.h`: a description and an instructions string for AI assistants.
- [tested] With the plugin enabled the seven skills are listed by `ToolsetRegistry.AgentSkillToolset` `ListSkills`; the C++ toolsets log `Registering Toolset NiagaraToolsets.NiagaraToolset_System` before the Python start-up scripts run, so they do not depend on those skills.
- [tested] A start-up script that raises is logged as `LogPython: Error: Traceback ...` ending in `AttributeError: module 'unreal' has no attribute '<name>'`. The other `init_unreal.py` files and your script still run, the toolset registers and answers, and a commandlet exits with 1 because an error was logged.
- Judge the plugin by `unreal.ToolsetRegistry.is_toolset_registered("NiagaraToolsets.NiagaraToolset_System")` and a successful `GetSystemSummary`, not by the start-up log.

## Not verified

- A start-up traceback naming `unreal.AgentSkill` did not appear in any 5.8.2 run (commandlet, offscreen editor, `-ExecutePythonScript`, plugin alone or with `AllToolsets` and `ModelContextProtocol`), so its cause is not established.
- Why `delete_asset` leaves the file of a system loaded from disk; a Material in the same position was removed.
