# Niagara toolsets scene: author a system from Python and check the call shapes

Backs [Author Niagara systems from Python with the Niagara toolsets](../../../skills/unreal-effects/references/unreal-niagara-toolsets.md) and its companions on [delete and recreate](../../../skills/unreal-effects/references/unreal-niagara-toolsets-lifecycle.md), [inputs](../../../skills/unreal-effects/references/unreal-niagara-toolset-inputs.md) and [renderers](../../../skills/unreal-effects/references/unreal-niagara-toolset-renderers.md). Verified on Unreal Engine 5.8 (the validator and the opt-in groups). Windows. Nothing here needs a project of yours: the validator makes a throwaway project (PythonScriptPlugin, EditorScriptingUtilities, Niagara, NiagaraToolsets) in the OS temp folder.

## Run

```text
node examples/unreal/niagara_toolsets/nts_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--only author]
```

It starts eight hidden headless commandlets and one hidden editor (the stack-issue tick run), a few minutes in total (timing varies with machine load, and a loaded machine can take more than twice as long), prints PASS or FAIL per claim and exits 0 when every check passes. A line is written, and flushed, as each phase starts and ends, so a redirected run shows progress and a slow phase can be told from a hung one. It is not part of `node scripts/check.mjs`; the check logic is tested there (`nts-validate.test.mjs`). Two phases end in an editor crash on purpose, so a non-zero exit code from those is a result, not an error. A timed-out run is retried once, and afterwards only processes whose command line names the throwaway project are stopped.

`--only <group>[,<group>...]` (or `--phases`, the same option) runs only the named groups, in pipeline order: `author`, `readback`, `issues`, `recreate` (the five delete-and-recreate phases) and `startup`. `readback`, `issues` and `startup` read what `author` saved, so they need it in the same list. Use `--only author` to iterate on `nts_author.py` in about the time of that one phase. A partial run keeps the project folder, prints the path of each report it wrote (or says it was not written), does not judge the checks, which need every group, and exits 0 when every report it should have written exists.

`--keep` leaves the project folder. When the `startup` phase ran, that folder holds a project `init_unreal.py` that raises on purpose, so any other script run against it exits 1 until that file is deleted; the run prints a note with its path.

## Opt-in probes

Status: Prepared 2026-10-26. Rerun with the same counts as the first runs: the default validator passed 25 of 25 (134 s on the first run) and `nts_validate.mjs --only author` ran its phase (44 s on the first run); the `renderers` group passed 6 of 6, the `emit` group 8 of 8 (after fixes on the first run, see "What the emit probe showed") and the `gradient` group 3 of 3. From a session with no desktop (one engine process at a time) the default validator passed 25 of 25 and its two intentional crash phases exited 3 as before; the `wire` group passed 7 of 8 with the built-in cube (4 of 8 on its first run), and the `frame` group 3 of 5 (see "What the frame, wire and gradient probes showed").

`nts_probe.mjs` runs probes for questions the validator above does not answer. It is separate from `nts_validate.mjs`: the default run is unchanged, and no validator file refers to the probes (a test checks that). It is not part of `node scripts/check.mjs`; the pure checks have node tests (`nts-probe.test.mjs`) in the merge lane.

```text
node examples/unreal/niagara_toolsets/nts_probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--only renderers,emit,frame,wire,gradient] [--keep] [--plan]
        [--scenes <folder>] [--glb <file|builtin>] [--atlas-png <file>] [--atlas-json <file>]
```

Each group gets its own throwaway project in the OS temp folder. A group with a `sim` phase builds assets and a level in a commandlet, then plays the level offscreen in the editor (a GPU, `-RenderOffScreen`, no interactive session) to read simulation caches and take screenshots.

The `frame` build script reads three environment switches, so one run can separate the mode from the link and the name from the value:

| Switch | Values | Effect |
|---|---|---|
| `NTS_FRAME_VARIANT` | `link` (default), `const`, `modelast`, `emitterage` | `link` links Direct Frame Index to `User.FrameIndex`; `const` writes 5.0 into it with no link (the control); `modelast` writes the Direct Index mode again after the link; `emitterage` links it to `Emitter.Age` instead |
| `NTS_FRAME_SETNAME` | a parameter name (default `User.FrameIndex`) | the name the sim half passes to `set_variable_float` (`FrameIndex` is the short form) |
| `NTS_FRAME_DEFAULT` | a number (default `0`) | the user parameter's default value |

`--plan` prints what would run and resolves the wire assets without starting anything. The exit code is 0 when every check of the groups that ran passes.

| Group | Question | Phases |
|---|---|---|
| `renderers` | `AddRenderer` between existing renderers (index 1 of two, 0, the old count, one past it, -2), renderer classes other than Light, two renderers of one class against `rendererClasses`, how many renderers each of the 14 templates holds | commandlet |
| `emit` | which authoring step leaves an added emitter dead: 23 systems (factory or template system; Fountain or burst emitter; template emitters kept or removed; every kind of write after the add) counted in a simulation cache, a negative control (SpawnRate 0), and a count that moves with a stack input | build, sim |
| `frame` | Direct Frame Index linked to a user parameter set from Python: the link read back, `SubImageIndex` from a simulation cache at two values, screenshots at both against a baseline | build, sim |
| `wire` | a GLB through Interchange into a mesh renderer, and a sprite atlas into a Sub UV flipbook: particles counted, screenshots against a baseline; a Static Mesh user parameter and the runtime override call | build, sim |
| `gradient` | the System toolset's tool and skill lists (to compare one engine version with another), and a gradient or curve input written as a whole and read back | commandlet |

`wire` imports a sample model and an atlas. Pass `--scenes <folder>` (or set `AGENT_UNREAL_SCENES`) with the workspace layout in [the sample scene notes](../README.md), or `--glb`, `--atlas-png` and `--atlas-json`. When `wire` is named with `--only` and a file is missing the run stops with exit code 2 before any engine start and names the file; without `--only` it is skipped. The sample model is rigged and Interchange makes a skeletal mesh from it, which a mesh renderer cannot take, so a small built-in cube is imported as well (`--glb builtin` imports only the cube). The atlas grid (the Sub Image Size) is computed from the atlas JSON, and an atlas whose cells do not tile the sheet is refused.

| File | What it does |
|---|---|
| `nts_probe.mjs` | the runner: options, one throwaway project per group, the engine phases, the screenshots read back, the judging |
| `nts-probe-checks.mjs` | the options, the phase table and one check per claim; `nts-probe-assets.mjs` holds the atlas grid, the asset lookup, the built-in cube, a small PNG reader and the pixel comparison |
| `nts-probe.test.mjs` | canned reports with a failing case per check, a missing-report case, and consistency checks between the scripts and the checks |
| `nts_probe_common.py` | shared helpers: tool calls, stack references, the report and manifest writers, the level builder |
| `nts_probe_renderers.py`, `nts_probe_gradient.py` | the commandlet probes |
| `nts_probe_emit_build.py`, `nts_probe_frame_build.py`, `nts_probe_wire_build.py` | the build halves: assets, a level, and the manifest the sim half reads |
| `nts_probe_sim.py` | the run half: plays the level, counts particles with a simulation cache, reads attributes, takes screenshots, quits |

The report shapes in the node tests (the `emit` ones were confirmed by a run) are assumptions until a first run; a check that fails on its first run may need the script or the check fixed before it says anything about the engine. Engine facts the probes rely on were read from the install (symbols are cited in each script); the engine calls that were not checked are listed there.

Not prepared: whether the Light renderer's MegaLights switches change what is drawn (needs a rendering run with lights); binding the mesh renderer to the user parameter that the override call sets (the JSON shape of `FNiagaraParameterBinding` was not confirmed, so the override is checked for acceptance, not for appearance); inputs held inside a dynamic input chain (the gradient scan reads the module inputs only); stencil outlines, ribbons and mesh particles for the stylized look, and frame cost.

## Files

| File | What it does |
|---|---|
| `nts_author.py` | creates a system with `NiagaraSystemFactoryNew`, adds two emitters from Epic templates, reads and writes a stack input, sets the sprite renderer's material with `SetRendererData`, saves, and records every result shape. Then: adds all 14 template emitters and records what each is made of; `set_input` replaces a linked, dynamic or plain input as a whole and returns the toolset's refusal unshortened; a hidden input and its gating input; `SetEmitterData` for local space; `SortOrderHint`; a ribbon material with and without its usage flag; `AddRenderer` adds a Light renderer to four emitters that each hold a sprite renderer (location `rendererIndex` omitted, -1, 0 and 5), recording the returned ref and the renderer order from `GetEmitterTopology`, then sets and reads back the Light renderer's MegaLights switches through the returned ref |
| `nts_readback.py` | in a new process, reads the emitters, the edited input and the renderer material back from disk, and runs `audit_system`: it reports a linked input that reads `Module.None` and a particle lifetime of zero or less, and logs an error (non-zero exit) for any in the clean systems |
| `nts_issues.py` | an editor run with a tick callback: `GetStackIssues` and `GetSystemCompileState` for the saved systems (they complete from the editor tick, not in a commandlet) |
| `nts_recreate.py` | one delete-and-recreate phase per run (`make`, `same_process`, `stale`, `rescan_only`, `remove_rescan`), with a progress line flushed after every step so a crash leaves a trace |
| `nts_startup.py` | with a project `init_unreal.py` that raises, shows the toolset still registers and answers |
| `nts-validate-checks.mjs`, `nts-validate.test.mjs` | one check per claim; the command-line options and phase list, the report lines of a partial run, the `--keep` note and the flushed-line writer; the test changes one fact at a time and expects the matching check to fail, and takes the number of checks from the code |

## What the emit probe showed

Run, 8 of 8 checks; the numbers are particle counts in a simulation cache after 40 frames.

- A system made with `NiagaraSystemFactoryNew` emits with an emitter added and nothing written (Fountain 145, SimpleSpriteBurst 1). A system made with `CreateNiagaraSystem` and a template system does not: an emitter added to it with `AddEmitter` is dead until a stack input is written with a different value afterwards. The template emitters it came with keep emitting (380 in the control).
- Dead means two things. With the template emitters kept, the cache is valid, lists the added emitter and reads 0 for it. With the template emitters removed the added emitter is the only one, the system completes at once, and the capture is refused (the log line is `SimCache Error: System already completed its simulation`; the Python call returns `None` on all 40 frames). `GetSystemCompileState` reads UpToDate for every one of these systems, so a compile state does not show that a system emits.
- What revives it: a Float or Int stack input written with a different value after the last `AddEmitter`, anywhere in the system (the added emitter's `SpawnRate` or burst `Spawn Count`, or the system's own `SystemState` `Loop Duration`). Writing `SpawnRate` to 91 and then back to 90, the default, revives it, so it is the write and not the value. A second emitter added after a write is dead again, and the whole system completes if it has no other emitter; a write after that add revives both emitters, including the untouched one. `RemoveEmitter` after the write leaves it emitting.
- What does not: a write before the add, a write of the value the input already holds (SpawnRate 90 on the Fountain, Loop Duration 1 on the template system), `Loop Behavior` set to Infinite, a bool input set, `SetModuleEnabled` off and on again, and three modules added with `AddModule`. Exploratory runs made while building the probe, not kept in it, also showed that the emitter's own `Loop Duration` written to 3 revives it, and that saving twice and the system's `bDeterminism` set to false do not.
- The template system differs from a factory system in its `SystemState` (Loop Behavior Once, Loop Duration 1, against Infinite and 5), `bDeterminism` and `bInitialOwnerVelocityFromActor`. Changing those is not what revives the emitter: a Loop Duration written to 5 does, a Loop Behavior set to Infinite does not. The mechanism is not determined. What the engine source says: a Float or Int input is a rapid iteration parameter and a bool or enum input is not (`FNiagaraStackGraphUtilities::IsRapidIterationType`, `NiagaraStackGraphUtilities.cpp`); `UNiagaraStackFunctionInput::SetLocalValue` (`NiagaraStackFunctionInput.cpp`) writes a rapid iteration value into every script the input affects; the toolset's view model is built with auto compile off (`CreateSystemViewModel`, `NiagaraExternalSystemEditorUtilities.cpp`). That fits the split between numeric writes and the rest, but a missing refresh of those parameters as the cause was not tested.
- SpawnRate moves the count: 60, 30, 15 and 0 read 97, 49, 24 and 0, and the 0 is a valid cache with the emitter listed (the negative control).
- The default Fountain `SpawnRate` reads 90 and the default burst `Spawn Count` reads 1.

Workaround until the cause is known: after the last `AddEmitter` on a system made from a template system, write one Float or Int stack input to a different value (the emitter's own `SpawnRate`, say) before saving, and check the count in a simulation cache.

## What it showed

- Tool arguments are the C++ parameter names in lower camel case; asset refs are `{"refPath": "/Package/Path.Name"}`; a stack-input ref is `{system, emitterName, scriptName, moduleName, inputNameStack}`. `GetStackInputData` returns `{"struct": {"refPath": "/Script/Niagara.NiagaraFloat"}, "value": {"value": 5}}` for a float, `LinearColor` for a color and `NiagaraExt_StackInputData_Enum` (`enum`, `enumName`, `displayName`) for an enum. Writing the changed object back with `SetStackInputData` stores it; an unknown input name returns an error naming the full path.
- `SetRendererData` takes `propertyValues` as a JSON string and changes only the properties it names (`Material`, `SubImageSize`). The same payload with an object in place of the string returns no error and changes nothing.
- A system created and saved in one process is deleted and recreated without trouble. A system saved by an earlier process is not removed by `delete_asset`: it returns `True`, the `.uasset` and the registry entry stay, `CreateNiagaraSystem` and `AddEmitter` report success, and `save_asset` ends the process with `EXCEPTION_ACCESS_VIOLATION reading address 0x0000000000000000` (exit code 3; the stack runs through Engine, CoreUObject, UnrealEd and EditorScriptingUtilities). `scan_paths_synchronous` alone does not help. Removing the file and then rescanning does: `does_asset_exist` becomes `False`, the new system saves and the process exits 0.
- A linked input (a particle `Lifetime` linked to `Emitter.CurrentLoopDuration`) and a dynamic input (a beam's `Beam Width`, a `FloatFromCurve`) read back as `NiagaraExt_StackInputData_Linked` and `..._DynamicInput`. Adding `value.value` to the returned data changes nothing; replacing its `value` while the struct stays `Linked` stores an empty link (`Module.None`); neither returns an error from `SetStackInputData`. Replacing the data as a whole, `{"struct": {"refPath": "/Script/Niagara.NiagaraFloat"}, "value": {"value": 3}}`, stores the number. The emptied link is not silent in the editor tick: `GetStackIssues` reports `This stage has compile errors.` and `GetSystemCompileState` names `InitializeParticle.Lifetime`. A lifetime of 0 compiles without an issue, which is why `audit_system` reads the values.
- A hidden input is refused with `Refusing to set input 'Color': input is hidden by static-switch / conditional logic ... Adjust the parent switch first.` The message names the refused input, not the switch; `GetStackInputTopology` shows `bIsVisible` false for it and `bIsStaticSwitch` true for `Color Mode`. A visible-condition refusal (`Loop Duration` while `Life Cycle Mode` is System) says `flip the gating input first`.
- All 14 template emitters read `bLocalSpace` false. `SetEmitterData` takes `emitter` and `emitterData` (`emitterRef` returns an error that starts `Function "SetEmitterData", input param "emitter" is required`); `propertyValues` must be a JSON string, an object is accepted and changes nothing.
- `SortOrderHint` (default 0) is stored by `SetRendererData` on sprite and ribbon renderers. A material is created with all three Niagara usage flags false; `GetStackIssues` warns `Some materials 'M_NoFlag' do not have the correct usage flags set, and will use the default material.` on the Ribbon renderer that holds one without `used_with_niagara_ribbons`. The `missing usage flag NiagaraRibbons!` log line did not appear in these headless runs; the engine source logs it in a game or Play-In-Editor session only, and sets the flag itself in the editor.
- `NiagaraToolsets/Content/Python/init_unreal.py` registers seven instruction-text skills (`ToolsetRegistry.AgentSkillToolset` `ListSkills`). The C++ toolsets log `Registering Toolset ...` before the Python start-up scripts run. A start-up script that raises is logged as `LogPython: Error: Traceback ...`, the other start-up scripts and the commandlet script still run, and the commandlet exits with 1 because an error was logged.
- `AddRenderer` takes `newRendererLocation` and `rendererClass` (read from the toolset schema) and returns `{rendererIndex, rendererClass}`. On an emitter that holds one sprite renderer (the `renderers` group also ran an emitter with two), a Light renderer is appended (returned index 1, order Sprite then Light) when the location leaves `rendererIndex` out and when it is `-1`, and is moved to the front (returned index 0, order Light then Sprite) when it is `0`. With `5` on that one-renderer emitter it is appended (2 renderers) and the returned index is still 5; `GetRendererData` on that ref returns `Renderer index 5 is out of bounds for emitter ... (has 2 renderers)`. The schema lists every field of the location as required, yet a location with only `system` and `emitterName` is accepted. The order is `renderers` in `GetEmitterTopology` (index and class of each). `bAllowMegaLights` and `bMegaLightsCastShadows` read `false` on a new Light renderer, and `SetRendererData` through the returned ref stores `true` for both.

## What the frame, wire and gradient probes showed (first runs; rerun with the same pass counts)

Rerun with the same checks passing and failing (`frame` 3 of 5, `wire` 7 of 8, `gradient` 3 of 3). The `wire` and `frame` rerun used the built-in cube and a generated stand-in atlas (a 128 by 160 PNG, 8 by 10 cells of 16 px, with an Aseprite-style JSON), because the earlier atlas files were no longer available; the figures below are from the first runs.

**`frame`: the Direct Frame Index user parameter did not drive the index (3 of 5).**

- Build, the same in every run: the user parameter `User.FrameIndex` (float) was added and listed; the SubUV Animation Mode was set to Direct Index without an error; Direct Frame Index was linked with `SetStackInputData` (Linked) and read back as `NiagaraExt_StackInputData_Linked` naming `User.FrameIndex`; a new process re-reading the saved asset showed the mode `Direct Index` (a visible, editable static switch) and the Linked value; `GetSystemCompileState` read UpToDate. These checks passed.
- Sim: `set_variable_float` on `User.FrameIndex` to 2 and then 9 (30 frames cached each, one screenshot each) left `Particles.SubImageIndex` at 3.82 and 5.86 (two runs) for 2 and at 11.49 and 13.5 for 9. The per-particle values in one cache differed from each other by about 1.0 (7.67, 8.67, 11.49, 1.0), so they were age-driven, and they varied from run to run. The two screenshots were byte-identical (5102 changed pixels each against a hidden-actor baseline). These two checks failed.
- The control: with a constant 5.0 written into Direct Frame Index (no link, `NTS_FRAME_VARIANT=const`) every particle read 5 and the picture differed (9745 changed pixels), in this one scene.
- Variants that left the result unchanged (all still age-driven, the same values): setting by the short name `FrameIndex`; a user parameter default of 5.0 with no set; the mode written again after the link; Direct Frame Index linked to `Emitter.Age` instead of the user parameter. The cause is not determined.

**`wire`: generated assets into Niagara (7 of 8 with the built-in cube; 4 of 8 on the first run).**

- Atlas: an 8 by 10 sprite sheet imported as a texture; `SetRendererData` stored `SubImageSize` `{"x":8,"y":10}` on the sprite renderer with the SubUV material; the flipbook system emitted 3 particles; `Particles.SubImageIndex` read about 19.4 to 20.0 after 10 frames and 59.8 to 60.3 after 60 frames; the screenshot changed 75350 of 921600 pixels against the hidden baseline.
- Mesh: a rigged GLB (a fox) imported through Interchange with the default pipeline gave one skeletal mesh and no static mesh (19 assets). The engine's built-in cube gave one static mesh, `/Game/Probe/Wire/Mesh_builtin/cube/StaticMeshes/cube.cube` (2 assets). `GetRendererData` on a mesh renderer lists nested struct fields in lower camel case (`mesh`, `lODBias`, `lODMode`). `SetRendererData` with a `Meshes` slot written under the key `Mesh` returned no error and the read-back still had no mesh; under `mesh` the read-back held the same asset path.
- A mesh emitter (`UpwardMeshBurst`) added to a template-made system was dead: 30 refused captures, and its `Lifetime` was refused ("input is hidden by static-switch / conditional logic ... Adjust the parent switch first."). After the system's `SystemState` `Loop Duration` was written to 5.0 the mesh emitter counted 88 particles and the screenshot changed 116434 of 921600 pixels.
- Static Mesh user parameter: `AddUserVariables` with type `/Script/Niagara.NiagaraDataInterfaceStaticMesh` and a default `NiagaraExt_VariableValue_DataInterface` carrying only `dataInterfaceClass` returned no error and no value, and `GetUserVariables` listed nothing. `NiagaraFunctionLibrary.override_system_user_variable_static_mesh` on the copy's component ran without an error and the system still emitted (80 particles); with no such variable the call shows nothing. [documented] `AddUserVariable` returns without a message when the default is invalid, and builds the default from `DataInterface` (the instance), not the class (`NiagaraExternalSystemEditorUtilities.cpp`, `FNiagaraExt_VariableValue::Get`).

**`gradient` (3 of 3):** the System toolset registered, a data-interface input that mentions a curve or gradient exists, and a gradient or curve input written as a whole read back changed.

## Not verified

- A start-up traceback naming `unreal.AgentSkill` appears in a game (`-game`) run, the Niagara showcase self-test: Epic's `NiagaraToolsets` (`init_unreal.py`, `from skills import blueprint_interop`) and `ToolsetRegistry` (`unreal.PythonTestRunner` missing) log it at start-up, and it does not stop the toolsets (the same calls work in the editor runs). Whether it appears in other run modes was not recorded. `unreal.AgentSkill` exists and `is_toolset_registered` is `True` in every editor run. The cause was not traced.
- Why `delete_asset` leaves the file of a Niagara system loaded from disk; the same call removed a Material.
- Whether the empty-link result is the same on other engine builds (the validator's check for it passed), and whether a gradient or colour-curve input behaves like the float case when a link or a key is edited (the `gradient` group wrote one as a whole and read it back changed; only float lifetime and beam width were run for the link).
- The `missing usage flag NiagaraRibbons!` log line itself; it needs a game or Play-In-Editor session that draws the renderer.
- `AddRenderer` on other engine builds (the validator's check for it passed). The MegaLights switches were read back, not rendered.
- The `renderers` group (6 of 6) ran the positions between renderers, the six renderer kinds, and a second Sprite renderer: `renderers` read [Sprite, Sprite] and `rendererClasses` [Sprite]. `rendererClasses` is a de-duplicated list (`NiagaraExternalSystemEditorUtilities.h` 902-904; `.cpp` 1527 and 1542, `AddUnique`) [documented], so it cannot show the order and the scripts read `renderers`.
