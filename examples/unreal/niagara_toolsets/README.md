# Niagara toolsets scene: author a system from Python and check the call shapes

Backs [Author Niagara systems from Python with the Niagara toolsets](../../../skills/unreal-effects/references/unreal-niagara-toolsets.md). Verified on Unreal Engine 5.8.2, Windows. Nothing here needs a project of yours: the validator makes a throwaway project (PythonScriptPlugin, EditorScriptingUtilities, Niagara, NiagaraToolsets) in the OS temp folder.

## Run

```text
node examples/unreal/niagara_toolsets/nts_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep]
```

It starts eight hidden headless commandlets, about 1.5 minutes in total, prints PASS or FAIL per claim and exits 0 when all 14 pass. It is not part of `node scripts/check.mjs`; the check logic is tested there (`nts-validate.test.mjs`). Two phases end in an editor crash on purpose, so a non-zero exit code from those is a result, not an error. A timed-out run is retried once, and afterwards only processes whose command line names the throwaway project are stopped.

## Files

| File | What it does |
|---|---|
| `nts_author.py` | creates a system with `NiagaraSystemFactoryNew`, adds two emitters from Epic templates, reads and writes a stack input, sets the sprite renderer's material with `SetRendererData`, saves, and records every result shape |
| `nts_readback.py` | in a new process, reads the emitters, the edited input and the renderer material back from disk |
| `nts_recreate.py` | one delete-and-recreate phase per run (`make`, `same_process`, `stale`, `rescan_only`, `remove_rescan`), with a progress line flushed after every step so a crash leaves a trace |
| `nts_startup.py` | with a project `init_unreal.py` that raises, shows the toolset still registers and answers |
| `nts-validate-checks.mjs`, `nts-validate.test.mjs` | one check per claim; the test changes one fact at a time and expects the matching check to fail |

## What it showed (5.8.2)

- Tool arguments are the C++ parameter names in lower camel case; asset refs are `{"refPath": "/Package/Path.Name"}`; a stack-input ref is `{system, emitterName, scriptName, moduleName, inputNameStack}`. `GetStackInputData` returns `{"struct": {"refPath": "/Script/Niagara.NiagaraFloat"}, "value": {"value": 5}}` for a float, `LinearColor` for a color and `NiagaraExt_StackInputData_Enum` (`enum`, `enumName`, `displayName`) for an enum. Writing the changed object back with `SetStackInputData` stores it; an unknown input name returns an error naming the full path.
- `SetRendererData` takes `propertyValues` as a JSON string and changes only the properties it names (`Material`, `SubImageSize`). The same payload with an object in place of the string returns no error and changes nothing.
- A system created and saved in one process is deleted and recreated without trouble. A system saved by an earlier process is not removed by `delete_asset`: it returns `True`, the `.uasset` and the registry entry stay, `CreateNiagaraSystem` and `AddEmitter` report success, and `save_asset` ends the process with `EXCEPTION_ACCESS_VIOLATION reading address 0x0000000000000000` (exit code 3; the stack runs through Engine, CoreUObject, UnrealEd and EditorScriptingUtilities). `scan_paths_synchronous` alone does not help. Removing the file and then rescanning does: `does_asset_exist` becomes `False`, the new system saves and the process exits 0.
- `NiagaraToolsets/Content/Python/init_unreal.py` registers seven instruction-text skills (`ToolsetRegistry.AgentSkillToolset` `ListSkills`). The C++ toolsets log `Registering Toolset ...` before the Python start-up scripts run. A start-up script that raises is logged as `LogPython: Error: Traceback ...`, the other start-up scripts and the commandlet script still run, and the commandlet exits with 1 because an error was logged.

## Not verified

- A start-up traceback naming `unreal.AgentSkill`: it did not appear in any 5.8.2 run (commandlet, offscreen editor, `-ExecutePythonScript`; the plugin alone, or with `AllToolsets` and `ModelContextProtocol`). `unreal.AgentSkill` exists and `is_toolset_registered` is `True` in every run.
- Why `delete_asset` leaves the file of a Niagara system loaded from disk; the same call removed a Material.
- Compile state and stack issues (they need an editor tick); see `niagara_verify.py`.
