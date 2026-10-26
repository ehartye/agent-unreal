# C++ automation test, run headless

Backs [Writing and running a C++ automation test](../../../skills/unreal-native/references/unreal-native-automation-tests.md). Unreal Engine 5.8.2, Windows, Visual Studio 2022 Build Tools.

## Files

- `module/AutomationProbe/` is an editor module with two simple tests, `AgentUnrealProbe.Passing` and `AgentUnrealProbe.DeliberateFailure`, wrapped in `WITH_DEV_AUTOMATION_TESTS`, with flags `EAutomationTestFlags::EditorContext | EAutomationTestFlags::ProductFilter`.
- `automation_test.mjs` is the runner. It writes a throwaway code project in the OS temp folder (`../native-build.mjs`), discovers the installed Visual Studio 2022 toolset and Windows SDK, builds the Editor target with `Build.bat`, runs the tests five ways with a new report folder each time, then appends three wrongly flagged tests and builds again to record the compiler messages.
- `automation_report.mjs` reads `index.json` and decides pass or fail. It strips the byte order mark the engine writes and rejects a missing or unreadable report, zero tests, `failed`, `notRun` or `inProcess` above zero, a test outside the filter and any test whose state is not `Success`. As a command it exits 0 only for a passing report.
- `automation-test-checks.mjs` judges the run; `automation-test.test.mjs` tests the parser and the checks with no Unreal (it runs in `node scripts/check.mjs`).

## Run

```text
node examples/unreal/automation_test/automation_test.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
node examples/unreal/automation_test/automation_report.mjs <report folder>/index.json --filter AgentUnrealProbe
```

The runner takes about three to five minutes. Both engine binaries start hidden with `-nullrhi`.

## What it checks (9 checks, all passed on 5.8.2)

- The test module compiles; the removed `EAutomationTestFlags::Type` style, a missing filter flag and a missing context flag are rejected with the messages quoted in the reference.
- `UnrealEditor-Cmd.exe -ExecCmds="Automation RunTests AgentUnrealProbe.Passing; Quit"` writes a report with `succeeded: 1`; the process exits 0.
- The same form on the failing test writes `failed: 1`, `state: "Fail"`, the message `Expected 'two plus two is five' to be 5, but it was 4.` with file and line; the process exits 255.
- With `-TestExit="Automation Test Queue Empty"` and both tests the report counts one success and one failure while the process exits 0.
- `UnrealEditor.exe` gives the same counts. A filter that matches nothing writes no report and the log says `No automation tests matched`.

## Reference commands (opt-in)

**Status:** Prepared and first run 2026-10-26 on Unreal 5.8.2: `automation_reference.mjs` passed 7 of 7 checks in 152 s with no change to the probe; `headless_routes.mjs` reads the install and ran without an engine. Not run on 5.8.3.

Backs [Headless runs, reports and lanes](../../../skills/unreal-quality/references/unreal-quality-lanes.md). The run above uses `Automation RunTests` with a space after the semicolon; this phase uses the command shape the lanes reference gives, so a reader can paste it:

```text
node examples/unreal/automation_test/automation_reference.mjs --engine "<UE_5.8 folder>" [--keep] [--compiler <x.y.z>] [--sdk <10.0.n.n>]
node examples/unreal/automation_test/headless_routes.mjs --engine "<UE_5.8 folder>" [--json]
```

- `automation_reference.mjs` builds the same `AutomationProbe` module and runs `UnrealEditor-Cmd.exe <project> -Unattended -NullRHI -ExecCmds="Automation RunTest <filter>;Quit" -ReportExportPath=<dir>` for the passing and the failing test, then a `Group:<Name>` run for two groups defined in the project's `DefaultEngine.ini` (section `/Script/AutomationController.AutomationControllerSettings`, as the engine source declares it), a group that does not exist, and a `+ExcludeTest` run (section `AutomationTestExcludelist`; the exclusion is written last because it would otherwise skip the failing test in every earlier run). The Data Validation commandlet (`-run=DataValidation`) runs once as an observation: a project with no assets gives it nothing to fail on.
- `automation-reference-checks.mjs` judges the runs: the report through `automation_report.mjs`, the log lines `Test Started.`, `Test Completed. Result={...}` and `**** TEST COMPLETE. EXIT CODE: <n> ****` (formats from the engine source), the process exit code, the tests a group selects, the `No matching group named` error, and a skipped test with its reason. `automation-reference.test.mjs` tests it with hand-built reports (it runs in `node scripts/check.mjs`). The skipped-test report shape is an assumption until the first run.
- `headless_routes.mjs` reads an install and says whether a headless route exists for the commands that are not an Automation run. Low-Level Tests: `RunUAT BuildGraph -Script="Engine/Build/LowLevelTests.xml"` needs that script and the generated `Engine/Build/LowLevelTests` metadata folder; the 5.8.2 installed (Launcher) build read here has `RunUAT.bat`, the LowLevelTests AutomationTool script binaries and the `LowLevelTestsRunner` module source, but neither the script nor the metadata folder, so the command needs a source-built engine. Content tools: the Asset Manager editor module registers five console commands (`AssetManager.AssetAudit`, `FindDepChain`, `FindDepClasses`, `DumpAssetRegistry`, `DumpAssetDependencies`), only when the editor is not running a commandlet; none opens or dumps the Reference Viewer or Size Map, so those are editor UI only, and `AssetManager.AssetAudit` logs statistics rather than driving the Asset Audit window or its CSV export. Its node test runs in the merge lane.

Not prepared: a Low-Level Tests run, a Reference Viewer, Size Map or Audit Assets capture, and a failing Data Validation run (it needs a validator class).
