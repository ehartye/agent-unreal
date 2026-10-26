# Niagara toolsets: local space, sort order, ribbon materials and added renderers

Written for Unreal 5.8.2; a line marked 5.8.3 ran on that version. [`nts_validate.mjs`](../../../examples/unreal/niagara_toolsets/README.md) runs each [tested] line on a throwaway project; [documented] lines name a file under the engine's `Engine` folder. Argument shapes and refs are in [Author Niagara systems from Python](unreal-niagara-toolsets.md); inputs are in [Linked, dynamic and hidden inputs](unreal-niagara-toolset-inputs.md).

## Switch an emitter to local space

- [tested] All 14 template emitters read `bLocalSpace` false, so their particles stay where they spawn when the emitter moves. `GetEmitterData` (`emitterRef`) returns `propertyValues` as a JSON string.
- [tested] `SetEmitterData` takes `emitter` (the emitter ref) and `emitterData`, not `emitterRef`: `{"emitter": {"system": ..., "emitterName": "Orb"}, "emitterData": {"propertyValues": "{\"bLocalSpace\": true}"}}`. A wrong name returns an error that starts `Function "SetEmitterData", input param "emitter" is required` and then prints the schema. As with renderers, `propertyValues` as an object returns no error and changes nothing.
- [general] Attachment decides where particles spawn and the space setting decides what they do afterwards (Epic's fundamentals skill, `NiagaraToolsets/Content/Python/skills/fundamentals.py`); use local space for an effect that must move rigidly with its owner.

## A mesh renderer's `Meshes` slot used the key `mesh`

- [tested] On 5.8.3, `GetRendererData` of a mesh renderer listed nested struct fields in lower camel case (`mesh`, `lODBias`, `lODMode`). `SetRendererData` with a mesh written in the `Meshes` slot under the key `Mesh` returned no error and the read-back still had no mesh; written under `mesh` the read-back held the same asset path ([generated assets](unreal-niagara-generated-assets.md)).
- [general] Read the property back after a write, and copy nested key names from `GetRendererData` instead of from the property's C++ name.

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
- [tested] On 5.8.2, with a Ribbon renderer added to an emitter that holds [Sprite, Light]: `rendererIndex` 1 lands between them (Sprite, Ribbon, Light), 0 in front (Ribbon, Sprite, Light), 2 (the old count) at the end. 3 (old count + 1) and -2 append, the returned ref still says 3 or -2, and `GetRendererData` on it errors `Renderer index 3 is out of bounds ... has 3 renderers`. A returned index outside 0 to count-1 is not a ref: re-read `renderers` in `GetEmitterTopology` and use the position there before `GetRendererData` or `SetRendererData`.
- [tested] On 5.8.2, Ribbon, Mesh, Light, Component, Decal and Volume renderers all add. A Light renderer lists 29 properties, among them `bAllowMegaLights` and `bMegaLightsCastShadows`; call `GetRendererData` after the add to see the names for any class. The MegaLights switches were read back, not rendered.
- [tested] On 5.8.2, a second Sprite renderer gives `renderers` [Sprite, Sprite] and `rendererClasses` [Sprite], so `rendererClasses` is a de-duplicated set and does not count renderers; count and order them from `renderers`. All 14 template emitters report matching `renderers` and `rendererClasses`, none with more than one renderer.
- [documented] `AddRenderer` appends, then calls `MoveRenderer` only if the location's `RendererIndex` is set (default `INDEX_NONE`); the ref is the requested index (`NiagaraExternalSystemEditorUtilities.cpp` 2268-2280, `.h` 1015). `MoveRenderer` ignores an invalid index (`NiagaraEmitter.cpp` 3181). `rendererClasses` is built with `AddUnique` (`.h` 902-904, `.cpp` 1527 and 1542). Entry: `NiagaraToolset_System.cpp` 326-333.
