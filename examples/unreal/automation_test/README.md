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
