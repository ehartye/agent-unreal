# Niagara toolsets: linked, dynamic and hidden inputs

Written for Unreal 5.8.2. [`nts_validate.mjs`](../../../examples/unreal/niagara_toolsets/README.md) runs each [tested] line on a throwaway project; [documented] lines name a file under the engine's `Engine` folder. Argument shapes, refs and the plain-input worked example are in [Author Niagara systems from Python](unreal-niagara-toolsets.md); which template emitter covers which effect is in [Niagara templates](unreal-niagara-templates.md).

## Replace a linked or dynamic input as a whole

- [tested] `GetStackInputData` returns a different struct for a bound input. A link is `NiagaraExt_StackInputData_Linked` with `value.linkedVariable` (`name`, `type`); a dynamic input is `NiagaraExt_StackInputData_DynamicInput` with `value.dynamicInputAsset`. A template's particle `Lifetime` (`SingleLoopingParticle`) is linked to `Emitter.CurrentLoopDuration`; `Beam Width` (`StaticBeam`) is a `FloatFromCurve` dynamic input.
- [tested] `SetStackInputData` accepts an edit of the returned data without an error, and the edit does not store the number. Adding `value.value` to a linked input leaves the link as it was. Replacing its `value` with `{"value": N}` while the struct stays `Linked` stores an empty link, read back as `linkedVariable.name` `Module.None`. The same edit on a dynamic input leaves it dynamic.
- [tested] Replace the data as a whole, with the input's own type: `SetStackInputData` with `inputData` `{"struct": {"refPath": "/Script/Niagara.NiagaraFloat"}, "value": {"value": 3.0}}`. The input becomes a local value, and `GetStackInputData` reads `NiagaraFloat` 3. Take the type from `GetStackInputTopology` (`type.classStructOrEnum.refPath`) when the input holds a link or a dynamic input.
- [documented] A write of `Linked` data calls `SetLinkedParameterValue` with the data's variable, and `DynamicInput` data calls `SetDynamicInput` (`NiagaraEditor/Private/NiagaraExternalSystemEditorUtilities.cpp`, `InitStackInputFromValue`, lines 2995-3050), which is why an edit of the wrong shape does not reach the number.
- [tested] [`nts_author.py`](../../../examples/unreal/niagara_toolsets/nts_author.py) `set_input(stack_ref, value)` does this and returns `ok`, the toolset's `error` and the stored data; `ok` is false when the read-back is an empty link or not the type written.
- [tested] To restore a link, write `NiagaraExt_StackInputData_Linked` with `linkedVariable` `{"name": "Emitter.CurrentLoopDuration", "type": {"classStructOrEnum": {"refPath": "/Script/Niagara.NiagaraFloat"}}}`.

## Audit a saved system for empty links and zero lifetimes

- [tested] `GetStackIssues` and `GetSystemCompileState` (they complete from the editor tick; [`nts_issues.py`](../../../examples/unreal/niagara_toolsets/nts_issues.py)) do report an emptied link: the issue `This stage has compile errors.` on the emitter's `Particle Spawn`, and a compile error naming `InitializeParticle.Lifetime`. A lifetime of 0 compiles without an issue.
- [tested] [`nts_readback.py`](../../../examples/unreal/niagara_toolsets/nts_readback.py) `audit_system(system)` reads `GetEmitterInputValues` for every emitter and reports a linked input that reads `Module.None` and an `InitializeParticle` lifetime that reads zero or less. It names the emitter, module and input. Run it in a new process after a save; a hidden input reads as `NiagaraExt_StackInputData_Unsupported` and is skipped.

## Read a refusal for a hidden input

- [tested] `SetStackInputData` returns an `error` and no value for a hidden input: `Refusing to set input 'Color': input is hidden by static-switch / conditional logic and is not currently part of the executing graph. Adjust the parent switch first.` The message names the refused input and not its gating input, so keep the whole message and look the switch up.
- [tested] `GetStackInputTopology` on the refused input reads `bIsVisible: false`. The gating input sits in the same module and reads `bIsStaticSwitch: true` (`Color Mode`, an enum). Set it first with the enum shape (`NiagaraExt_StackInputData_Enum`: `enum`, `enumName`, `displayName`, copied from a `GetStackInputData` read of an input that already has the mode you want), then the hidden input is writable.
- [tested] A second message covers a visible condition: `Refusing to set input 'Loop Duration': its VisibleCondition currently evaluates false. The input is not visible in the editor - flip the gating input first.` On `SingleLoopingParticle`, `Life Cycle Mode` is `System`; setting it to `Self` makes `Loop Duration` writable.
- [documented] The three refusals (hidden, VisibleCondition, EditCondition) are in `SetStackInputData` of the same file, lines 2796-2820.

## Gradient and curve inputs

- [tested] On 5.8.3, `nts_probe.mjs --only gradient` passed 3 of 3: the System toolset registers, a data-interface input whose name mentions a curve or gradient exists, and a gradient or curve input written as a whole reads back changed.

Local space, `SortOrderHint`, the ribbon material flag and adding a renderer are in [Local space, sort order, ribbon materials and added renderers](unreal-niagara-toolset-renderers.md).
