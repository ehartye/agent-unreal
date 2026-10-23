# Editor probes: read back what was saved

Three small editor-Python scripts and a headless launcher. Each script reads something the editor holds and writes one JSON report, so a build is judged by what was saved and not by what the log said. They back the "Read back what was saved" step in [Editor Python](../../../skills/unreal-editor-scripting/references/unreal-editor-python.md). Unreal Engine 5.8.2, Windows.

| Probe | Script | Input (environment variable) | Use it |
|---|---|---|---|
| `doc` | `doc_probe.py` | `PROBE_CALLABLES`: dotted names under `unreal`, such as `GeometryScript_Primitives.append_disc` | before calling an unfamiliar function |
| `system` | `inspect_system.py` | `PROBE_SYSTEMS`: Niagara system paths; `PROBE_MODULES` (optional): `Module` or `Emitter:Module` | after any Niagara authoring |
| `asset` | `asset_probe.py` | `PROBE_ASSETS`: asset paths | after any import or material build |

All three take `PROBE_REPORT`, the absolute path of the report. Names are separated by commas or white space.

## Run

```text
node probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --project <Project.uproject> --probe doc --report <report.json> --callables "EditorAssetLibrary.save_asset"
node probe.mjs --engine ... --project ... --probe system --report ... --systems /Game/FX/NS_Example --modules InitializeParticle
node probe.mjs --engine ... --project ... --probe asset  --report ... --assets /Game/Props/SM_Crate,/Game/Props/M_Crate
```

The project needs PythonScriptPlugin and EditorScriptingUtilities; `system` also needs Niagara and NiagaraToolsets, and `doc` needs the plugin whose classes you ask about (for example GeometryScripting). The names can come from the environment variables instead of the flags. In Git Bash set `MSYS_NO_PATHCONV=1`, or `/Game/...` is rewritten into a Windows path.

`probe.mjs` starts `UnrealEditor.exe` with `-ExecutePythonScript`, `-nullrhi` and a hidden window, and gives the names to the script through the environment. The editor shuts down when the script ends. The launcher deletes an old report first, so a report that exists afterwards came from this run. It exits 1 when:

- no report was written: the message gives how the editor ended and the editor log path (`<project>/Saved/Logs/probe-<probe>.log`, or `--log`); a script that fails to parse or raises before writing is caught this way;
- the report is not JSON, lacks an entry for a requested name, or has an entry without a status or a required field (`probe-checks.mjs`).

It also takes `--timeout <ms>` (default 600000). The pure logic (arguments, report shape, failure message) is in `probe-checks.mjs`, and `probe-checks.test.mjs` tests it with no Unreal; the test runs in `node scripts/check.mjs`. The editor runs are a manual lane.

## The reports

One object keyed by each name you asked for. Each entry has `status`: `found`, `missing` (nothing at that name) or `unavailable` (it exists but cannot be described, with the reason). A property the editor could not read holds the string `"unavailable"`.

- `doc`: `found` entries have `kind` (`callable`, `class` or `value`) and `doc`. A missing entry lists `nearby` names on the last object that resolved.
- `system`: `summary`, `system_data`, `emitters` (each with its summary, property values, module names per script stack and renderer property values), `modules` (key `Emitter:Script:Module`, `inputs` as the toolset returns them) and `problems`, the errors behind any `"unavailable"` part.
- `asset`: by class. `StaticMesh`: `material_slots`, `bounds`, `nanite_enabled`. `Material`: `blend_mode`, `shading_model`, `two_sided`, `used_with_nanite`, `used_with_niagara_sprites`, `used_with_niagara_ribbons`, `used_with_niagara_mesh_particles`. `MaterialInstanceConstant`: `parent`, `scalar_parameters`. Other classes are `unavailable`.

## What a run showed (Unreal 5.8.2, throwaway project)

- Each launcher run took 14 to 18 s once the editor had started once (the first took about 60 to 80 s) and the editor exited by itself with code 0.
- `doc`: the docstring of `GeometryScript_Primitives.append_disc` begins `X.append_disc(target_mesh, primitive_options, transform, radius=50.000000, angle_steps=16, ...) -> DynamicMesh` and lists each parameter with its type. `EditorAssetLibrary.save_asset` begins `X.save_asset(asset_to_save, only_if_is_dirty=True) -> bool`. The class docstring of `EditorAssetLibrary` is a description with no signature. `EditorAssetLibrary.save_assets` is `missing` and `nearby` names `save_asset`.
- `system`: a system made by [`nts_author.py`](../niagara_toolsets/nts_author.py) in an earlier process reads back with its two emitters, their module names per stack and the sprite renderer's `Material`; `InitializeParticle`'s `Lifetime Min` is 2.5 in `Motes` and 15 in `Dust`. The template's `Lifetime` input comes back as `NiagaraExt_StackInputData_Unsupported` with an empty value. A path with no asset is `missing`; a Material path is `unavailable` (not a NiagaraSystem); `Dust:Nothing` is a `missing` module.
- `asset`: a copy of the engine cube reads back with one slot (`WorldGridMaterial`), box extent 50, 50, 50 and `nanite_enabled` false, and true after the setting was saved on a copy. A material set to masked and two-sided with the sprite flag reads `BLEND_MASKED`, `MSM_DEFAULT_LIT`, `two_sided` true, `used_with_niagara_sprites` true and the Nanite and ribbon flags false. An instance of it reads its parent path and `Opacity` 0.5. A Niagara system path is `unavailable` for this probe.
- A script with a syntax error made the editor exit 0 without a report; the launcher exited 1 with the "wrote no report" message and the log path.

## Not verified

The launcher on macOS or Linux (the editor path is chosen by platform, only Windows was run), a probe run longer than the timeout, and `inspect_system.py` on a system whose compile is still pending.
