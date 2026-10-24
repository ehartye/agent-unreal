# Niagara toolsets: linked, dynamic and hidden inputs, local space, sort order, ribbon materials and added renderers

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

## Switch an emitter to local space

- [tested] All 14 template emitters read `bLocalSpace` false, so their particles stay where they spawn when the emitter moves. `GetEmitterData` (`emitterRef`) returns `propertyValues` as a JSON string.
- [tested] `SetEmitterData` takes `emitter` (the emitter ref) and `emitterData`, not `emitterRef`: `{"emitter": {"system": ..., "emitterName": "Orb"}, "emitterData": {"propertyValues": "{\"bLocalSpace\": true}"}}`. A wrong name returns an error that starts `Function "SetEmitterData", input param "emitter" is required` and then prints the schema. As with renderers, `propertyValues` as an object returns no error and changes nothing.
- [general] Attachment decides where particles spawn and the space setting decides what they do afterwards (Epic's fundamentals skill, `NiagaraToolsets/Content/Python/skills/fundamentals.py`); use local space for an effect that must move rigidly with its owner.

## Order translucent renderers with SortOrderHint

- [tested] `SetRendererData` with `propertyValues` `"{\"SortOrderHint\": 7}"` stores the integer (default 0) on sprite and ribbon renderers; `GetRendererData` reads it back. Set it in the same call as `Material` when both change.
- [documented] Renderers are submitted in ascending `SortOrderHint`, ties in the order the emitters were added (`NiagaraSystem.cpp` lines 2475-2490, `NiagaraRendererProperties.h` line 473), so a higher value draws after, and over, a lower one among translucent materials.

## Give a ribbon or beam its own material flag

- [tested] A new material has `used_with_niagara_sprites`, `used_with_niagara_ribbons` and `used_with_niagara_mesh_particles` all false, and they are separate properties. Set `used_with_niagara_ribbons` before saving a material for a `Ribbon` renderer (a beam is one); `SetRendererData` stores a material without the flag and gives no error.
- [tested] `GetStackIssues` reports the missing flag as a warning on the renderer (`/Render/Ribbon Renderer`): `Some materials 'M_NoFlag' do not have the correct usage flags set, and will use the default material.` A system whose ribbon material has the flag reports no warning.
- [general] A beam or ribbon that shows as a thin line, or in the default material, has this flag missing until proven otherwise; check it before the width inputs.
- [documented] In a game or Play-In-Editor session a material without the flag logs `Material <path> missing usage flag NiagaraRibbons! Default Material will be used in game.` and the default material draws (`Engine/Source/Runtime/Engine/Private/Materials/Material.cpp` line 1945). The editor sets the flag itself, outside play, when the renderer first draws (line 1893), so the saved asset is the place to set it.

## Add a renderer, such as a Light renderer, and address it by the returned ref

- [general] Omit `rendererIndex` to append. Check the returned index against `renderers` before `SetRendererData`, and re-read it before reusing an older index: an insert at 0 moves the others up.
- [tested] `AddRenderer` (`newRendererLocation` `{system, emitterName[, rendererIndex]}`, `rendererClass` `{"refPath": "/Script/Niagara.NiagaraLightRendererProperties"}`) on an emitter with one sprite renderer. `rendererIndex` omitted or `-1` appends: ref 1, order Sprite, Light. `0` inserts first: ref 0, order Light, Sprite; the sprite is now 1. `5` on that one-renderer emitter appends, so it has 2 renderers, yet returns 5; `GetRendererData` on it errors `Renderer index 5 is out of bounds ... (has 2 renderers)`. The order is `GetEmitterTopology` `renderers`. `SetRendererData` on the ref turned `bAllowMegaLights` and `bMegaLightsCastShadows` from false to true.
- [documented] `AddRenderer` appends, then calls `MoveRenderer` only if the location's `RendererIndex` is set (default `INDEX_NONE`); the ref is the requested index (`NiagaraExternalSystemEditorUtilities.cpp` 2268-2280, `.h` 1015). `MoveRenderer` ignores an invalid index (`NiagaraEmitter.cpp` 3181). `rendererClasses` is de-duplicated (`.h` 902-904). Entry: `NiagaraToolset_System.cpp` 326-333.
