# Writing and running a C++ automation test in Unreal 5.8

Target: Unreal Engine 5.8.2, Windows. Running tests and why the process exit code is not the verdict are in [native build and capture](unreal-native-game.md); this page covers writing a test, running it headless and reading the report. Evidence comes from `examples/unreal/automation_test/` (`node automation_test.mjs --engine <UE_5.8 folder>`), which builds the module below in a throwaway code project and ran 9 of 9 checks on 5.8.2.

## Write the test

```cpp
#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAgentProbePassingTest, "AgentUnrealProbe.Passing",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::ProductFilter)

bool FAgentProbePassingTest::RunTest(const FString& Parameters)
{
	TestEqual(TEXT("two plus two"), 2 + 2, 4);
	return true;
}
#endif // WITH_DEV_AUTOMATION_TESTS
```

- [documented] `EAutomationTestFlags` is an `enum class` in 5.8 (`Engine/Source/Runtime/Core/Public/Misc/AutomationTest.h` line 88), and `ENUM_CLASS_FLAGS` gives it `|` and `&`. Combine flags with `|`; there is no `EAutomationTestFlags::Type`.
- [documented] The macro (same file, static asserts at line 4127) requires at least one flag from `EAutomationTestFlags_ApplicationContextMask` (line 144: `EditorContext`, `ClientContext`, `ServerContext`, `CommandletContext`, `ProgramContext`) and exactly one from `EAutomationTestFlags_FilterMask` (line 149: `SmokeFilter`, `EngineFilter`, `ProductFilter`, `PerfFilter`, `StressFilter`, `NegativeFilter`).
- [tested] Wrong styles fail at compile time with these messages: `EAutomationTestFlags::Type(...)` gives `error C2838: 'Type': illegal qualified name in member declaration`; no filter flag gives `static_assert failed: 'All AutomationTests must have exactly 1 filter type specified.'`; no context flag gives `static_assert failed: 'AutomationTest has no application flag.'`.
- [tested] `EditorContext | ProductFilter` was enough for both `UnrealEditor-Cmd.exe` and `UnrealEditor.exe` to find and run the test; `CommandletContext` was not needed.
- [documented] Put the test in any module the editor loads. The example uses an `Editor` module with `Core`, `CoreUObject` and `Engine`, and `IMPLEMENT_MODULE(FDefaultModuleImpl, AutomationProbe)`; the test class registers itself through the macro.
- [tested] Build with `Build.bat <Project>Editor Win64 Development -Project=<.uproject> -WaitMutex -NoHotReloadFromIDE -2022 -CompilerVersion=<x.y.z> -WindowsSDKVersion=<10.0.n.n>`. The example discovers both versions from the installed Visual Studio and Windows SDK (`examples/unreal/native-build.mjs`); the first build of the module took 60 to 80 s.
- [tested] A `.cpp` file added to a module that was already built was not compiled (`Target is up to date`). Touching the module's `.Build.cs` made UBT log `Invalidating makefile ... (source file added)` and compile the new file. Edits to an existing file were picked up without that.

## Run it headless

```powershell
$report = "$project/Saved/automation-report-1"   # a new empty folder for every run
& "$ue/Engine/Binaries/Win64/UnrealEditor-Cmd.exe" $uproject -nullrhi "-ExecCmds=Automation RunTests AgentUnrealProbe; Quit" "-ReportExportPath=$report" -unattended -nosplash -nosound -notraceserver
```

- [tested] `UnrealEditor-Cmd.exe` with `-nullrhi` and `-ExecCmds="Automation RunTests <filter>; Quit"` ran the queued tests, wrote `<report>/index.json` and `index.html`, then quit. The `Quit` waits for the test queue (the log reads `Quit Command Queued`, then `Test Completed`, then the report). A run took 18 to 54 s; the slowest was the first start.
- [tested] `UnrealEditor.exe -nullrhi` with the same arguments ran the same tests and wrote the same counts. No `-run=` commandlet is needed.
- [tested] The filter is a prefix of the test path: `AgentUnrealProbe` ran both example tests, `AgentUnrealProbe.Passing` ran one.
- [tested] A filter that matches nothing logs `Error: No automation tests matched '<filter>'` and writes no report.
- [tested] The `-TestExit="Automation Test Queue Empty"` form from the native game reference (without `; Quit`) also ran the tests and wrote the report.
Use a new empty `-ReportExportPath` folder for each run, so a report left from an earlier run cannot be read as this run's.

## Read the result

- [tested] `index.json` starts with a UTF-8 byte order mark; `JSON.parse` rejects it until the mark is removed.
- [tested] Top-level fields used for the verdict: `succeeded`, `succeededWithWarnings`, `failed`, `notRun`, `inProcess`, and `tests[]`. Each test has `fullTestPath`, `state` (`Success` or `Fail`), `errors`, `warnings` and `entries[]`. Each entry has `event.message`, `filename` and `lineNumber`.
- [tested] The deliberately failing test (`TestEqual(..., 2 + 2, 5)`) was reported as `failed: 1` with `state: "Fail"` and the entry `Expected 'two plus two is five' to be 5, but it was 4.` with its source file and line; the log carried `LogAutomationController: Error: Test Completed. Result={Fail}`.
- [tested] Exit codes were 0 for the passing `; Quit` run and 255 for the failing `; Quit` run and for the no-match run. The `-TestExit` run with a failing test exited 0. Decide from the report, not the exit code.
- [tested] `examples/unreal/automation_test/automation_report.mjs <index.json> --filter <prefix>` exits 0 only when the report exists, parses, lists at least one test, every test is inside the filter and in state `Success`, and `failed`, `notRun` and `inProcess` are all 0. A pure Node test covers each rejection with reports shaped like the engine's.

## Not covered here

Latent and complex tests, `NonNullRHI` tests that render, client and server contexts, packaged builds, and tests of Blueprint or map content were not run.

## Sources

- Engine header `Runtime/Core/Public/Misc/AutomationTest.h` in the 5.8.2 install.
