# Niagara: generated assets, a flipbook, a mesh and a frame parameter

Written for Unreal 5.8. A [tested] line ran in [`nts_probe.mjs`](../../../examples/unreal/niagara_toolsets/README.md) (`--only wire` passed 7 of 8 checks with the built-in cube, 4 of 8 on the first run; `--only frame` passed 3 of 5) on a throwaway project: it shows one project and one scene, not a general rule. The probes were rerun on 5.8.4 with the same counts, the same two `frame` checks and the same `wire` check failing; the rerun used a generated stand-in atlas of the same grid, so the pixel counts and index readings below are from the first run. A [documented] line names Epic's documentation or a file under the engine's `Engine` folder. Call shapes are in [Author Niagara systems from Python](unreal-niagara-toolsets.md); the rest of the Niagara routes are in [Niagara](unreal-niagara.md).

## Sprite atlas to a flipbook

- [documented] Import the atlas, use a Sprite Renderer with the Sub UV Animation module, and set Sub Image Size to the atlas grid. Epic advises a power-of-two texture and a tile count that divides it evenly. The Niagara Baker, which bakes a simulation to a flipbook, is an editor UI workflow.
- [tested] An atlas with an 8x10 grid imported as a texture. `SetRendererData` stored `SubImageSize` `{"x":8,"y":10}` on the sprite renderer that used the SubUV material, and the flipbook system emitted 3 particles.
- [tested] The flipbook advanced: `Particles.SubImageIndex` read about 19.4 to 20.0 after 10 frames and 59.8 to 60.3 after 60 frames, and the screenshot changed 75,350 of 921,600 pixels against a baseline with the actor hidden.

## Direct Frame Index and a user parameter

- [tested] The build worked every time: `AddUserVariables` added and `GetUserVariables` listed `User.FrameIndex` (float); SubUV Animation Mode was set to Direct Index without error; `SetStackInputData` linked Direct Frame Index, read back as `NiagaraExt_StackInputData_Linked` naming `User.FrameIndex`. The saved asset, re-read in a new process, showed the mode `Direct Index` (a visible, editable static switch) and the Linked value, and `GetSystemCompileState` read `UpToDate`.
- [tested] The link did not drive the frame. `set_variable_float` on `User.FrameIndex` to 2, then 9 (30 frames cached each): `Particles.SubImageIndex` read 3.82 and 5.86 (two runs) at 2 and 11.49 and 13.5 at 9. Particle values in one cache differed from each other by about 1.0 (7.67, 8.67, 11.49, 1.0), which is age-driven, and the numbers varied from run to run. The screenshots at 2 and 9 were byte-identical (5,102 changed pixels each against the hidden-actor baseline).
- [tested] The control: a constant 5.0 written into Direct Frame Index with no link made every particle read 5, and the picture differed (9,745 changed pixels), in this one scene.
- [tested] These link variants left the result unchanged (still age-driven, same values): setting the parameter by its short name `FrameIndex`; a user-parameter default of 5.0 with no set; writing the mode again after the link; linking Direct Frame Index to `Emitter.Age` instead of the user parameter.
- [general] The cause is not determined, and no other variant was tried ([drawn looks](unreal-niagara.md)).

## Mesh renderer

- [general] A mesh renderer takes a static mesh from the system or a user parameter (`override_system_user_variable_static_mesh`); the Static Mesh data interface also binds an actor or component. The Audio Player data interface plays a `SoundBase` from particle data.
- [tested] A rigged GLB (a fox) imported through Interchange with the default pipeline gave 1 skeletal mesh and no static mesh (19 assets), so there was no static mesh for the renderer. The built-in cube imported as one static mesh, `.../StaticMeshes/cube.cube` (2 assets).
- [tested] `GetRendererData` of a mesh renderer lists nested struct fields in lower camel case (`mesh`, `lODBias`, `lODMode`). A mesh written under the key `Mesh` returned no error and the read-back still had no mesh; written under `mesh` the read-back held the same asset path ([renderers](unreal-niagara-toolset-renderers.md)).
- [tested] On 5.8.4, a mesh emitter added to a template-made system started dead and emitted after a write of the system's `Loop Duration`: see [Emitters added to a template-made system start dead](unreal-niagara-toolsets.md).

## Static Mesh user parameter

- [tested] `AddUserVariables` with type `/Script/Niagara.NiagaraDataInterfaceStaticMesh` and a default `NiagaraExt_VariableValue_DataInterface` carrying only `dataInterfaceClass` returned no error and no value, and `GetUserVariables` listed nothing.
- [tested] `NiagaraFunctionLibrary.override_system_user_variable_static_mesh` on the copy's component ran without an error and the system still emitted (80 particles). With no such variable the call shows nothing, so a clean return does not show that a mesh was bound.
- [documented] `AddUserVariable` returns without a message when the default is invalid, and builds the default from `DataInterface` (the instance), not from the class (`NiagaraEditor/Private/NiagaraExternalSystemEditorUtilities.cpp`, `FNiagaraExt_VariableValue::Get`).
- [general] Not covered by these runs: binding the mesh renderer's mesh to a user parameter that the override sets, so the override was checked for acceptance, not for appearance.
