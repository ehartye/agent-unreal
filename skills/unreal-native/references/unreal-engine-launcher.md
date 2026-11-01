# Shared Windows engine launcher

- [general] Read the consumer's `AGENTS.md` and launcher instructions first. Existing consumers keep their established launcher until a separately verified migration. New integrations use the bundled `node scripts/unreal-run.mjs`; do not nest locks or remove consumer machinery merely because the plugin ships a launcher.
- [general] Run commands below from the plugin root. Store `project`, `engine`, `sourceRoot`, `editorTarget` and `gameTarget` in an ignored `launcher.local.json`; relative paths resolve against that file. The [launcher README](../../../scripts/lib/unreal-run/README.md) gives its versioned configuration, ownership and receipt contracts.

```powershell
node scripts/unreal-run.mjs doctor --evidence D:/Evidence/doctor --timeout 30
node scripts/unreal-run.mjs status
node scripts/unreal-run.mjs build --config D:/Project/launcher.local.json --evidence D:/Evidence/build --timeout 1200
node scripts/unreal-run.mjs editor --config D:/Project/launcher.local.json --evidence D:/Evidence/editor --timeout 120 -- -unattended
node scripts/unreal-run.mjs game --config D:/Project/launcher.local.json --evidence D:/Evidence/game --timeout 120 -- -RenderOffScreen
node scripts/unreal-run.mjs commandlet --config D:/Project/launcher.local.json --evidence D:/Evidence/cook --timeout 600 -- -run=Cook -TargetPlatform=Windows
node scripts/unreal-run.mjs test --config D:/Project/launcher.local.json --evidence D:/Evidence/tests --timeout 300 -- '-ExecCmds=Automation RunTests Project;Quit'
node scripts/unreal-run.mjs package --config D:/Project/launcher.local.json --evidence D:/Evidence/package --timeout 1800
```

- [general] Each evidence directory must be fresh. Arguments after `--` are preserved as an array. A workload timeout or cancellation cleans only its owned Job and requires a zero-member drain proof. Missing ownership or cleanup evidence is a refusal, never a successful run. Read automation/observation reports separately: a lifecycle receipt does not prove test assertions.
- [general] Production preserves `Global\agent-plugins-engine-runs`; there is no launch bypass or production lock override. Waiters identify the holder and print a heartbeat. Unmanaged launches can still happen outside the mechanism; contention detection refuses recognized external engines and never stops them.
- [general] Inspect `status`, the journal and the retained lifecycle before `clear-stale --evidence <fresh-directory>`. Recovery accepts only proved no-permit ownership with all recorded creation identities gone, or valid zero-member drain evidence. Live, corrupt, missing or ambiguous ownership refuses. Age and PID disappearance alone are insufficient.

## Existing probe runners

- [general] A bundled Node probe may start several build/editor children in sequence. Wrap the whole probe once with the compatibility adapter so all children inherit the owned Job. Do not recursively call the launcher from inside that tree.

```powershell
pwsh -NoProfile -File examples/unreal/engine_lock/with-engine-lock.ps1 node examples/unreal/editor_python/ep_validate.mjs --engine D:/Engines/UE --keep
```

- [general] The [adapter README](../../../examples/unreal/engine_lock/README.md) documents bounded environment settings, exact arguments and exit codes. `--no-lock` is limited to the bundled descriptor scan and Node version query; it cannot launch arbitrary scripts or engines. Historical bare engine commands remain evidence of older experiments, not current launch instructions.
- [general] Native lifecycle fixtures and actual engine acceptance run separately from `node scripts/check.mjs`. Use the delivered commands and preserve their complete reports. A Linux skip, a doctor result, or an inert fixture does not prove native build/package behavior or visual correctness.
