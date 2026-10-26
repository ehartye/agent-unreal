# Niagara toolsets: delete and recreate a system, and the start-up log

Written for Unreal 5.8.2. [`nts_validate.mjs`](../../../examples/unreal/niagara_toolsets/README.md) runs each [tested] line on a throwaway project; [documented] lines name a file under the engine's `Engine` folder. Call shapes and the worked example are in [Author Niagara systems from Python](unreal-niagara-toolsets.md).

## Delete and recreate a system

- [tested] A system created and saved in the same process deletes cleanly: `delete_asset` removes the file and the registry entry, and a new system at the path saves.
- [tested] A system saved by an earlier process does not: `delete_asset` returns `True` while the `.uasset` and the registry entry stay. `CreateNiagaraSystem` and `AddEmitter` then report success and `save_asset` ends the process with `EXCEPTION_ACCESS_VIOLATION` (exit code 3; the stack runs through Engine, CoreUObject, UnrealEd and EditorScriptingUtilities). A `scan_paths_synchronous` alone does not clear it; the same crash follows.
- [tested] What works: after `delete_asset`, check the file. If it remains, remove it, call `AssetRegistry.scan_paths_synchronous([folder], True)` and confirm `does_asset_exist` is `False`, then create. The map-recreation order in [Editor Python](../../unreal-editor-scripting/references/unreal-editor-python.md) is the same remove-and-rescan step.
- [general] Name a recreated system differently when the old name does not matter.

## The start-up log

- [documented] `NiagaraToolsets/Content/Python/init_unreal.py` imports seven modules under `skills/`. Each declares a class that derives from `unreal.AgentSkill` and registers it with `toolset_registry.agent_skill.agent_skill` (`ToolsetRegistry/Content/Python/toolset_registry/agent_skill.py`). `AgentSkill` is the Python name of `UAgentSkill` in `ToolsetRegistry/Source/ToolsetRegistry/Public/ToolsetRegistry/AgentSkill.h`: a description and an instructions string for AI assistants.
- [tested] With the plugin enabled the seven skills are listed by `ToolsetRegistry.AgentSkillToolset` `ListSkills`; the C++ toolsets log `Registering Toolset NiagaraToolsets.NiagaraToolset_System` before the Python start-up scripts run, so they do not depend on those skills.
- [tested] A start-up script that raises is logged as `LogPython: Error: Traceback ...` ending in `AttributeError: module 'unreal' has no attribute '<name>'`. The other `init_unreal.py` files and your script still run, the toolset registers and answers, and a commandlet exits with 1 because an error was logged.
- [general] Judge the plugin by `unreal.ToolsetRegistry.is_toolset_registered("NiagaraToolsets.NiagaraToolset_System")` and a successful `GetSystemSummary`, not by the start-up log.

## Not verified

- [general] A start-up traceback naming `unreal.AgentSkill` did not appear in any 5.8.2 run (commandlet, offscreen editor, `-ExecutePythonScript`, plugin alone or with `AllToolsets` and `ModelContextProtocol`), so its cause is not established.
- [general] Why `delete_asset` leaves the file of a system loaded from disk; a Material in the same position was removed.
