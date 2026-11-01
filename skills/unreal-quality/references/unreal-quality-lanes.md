# Headless runs, reports and lanes

Source for every `[documented]` line here: Epic's 5.8 pages "Review Test Results in Unreal Engine", "Configure Automation Tests in Unreal Engine", "Build and Run Low-Level Tests in Unreal Engine", "Data Validation in Unreal Engine", "BuildGraph for Unreal Engine", "Build Configurations Reference for Unreal Engine" and "Unreal Engine Build Tool Target Reference". Community lines come from one July 2026 article (see [test types](unreal-quality-test-types.md)).

## Reading a run

- `[general]` For manifest-driven suite execution and retained receipt qualification, use [unreal-verify](../../unreal-verify/SKILL.md). It checks declared counts, identities, requested conditions and launcher drain; keep its native acceptance separate from the dependency-free merge lane.

- `[documented]` The Automation Test Framework logs events and test status to the log file by default. Lines include `Test Started`, `Test Completed. Result=...`, and a final `**** TEST COMPLETE. EXIT CODE: <n> ****`. "An exit code of 0 means no test failure."
- `[documented]` `-ReportExportPath="<path>"` writes a JSON report with every event, each test's duration and the device details. The sample has `succeeded`, `failed`, `notRun`, `inProcess` and `totalDuration` at the top and, per test, `state`, `duration`, `entries`, `warnings` and `errors`.
- `[documented]` Excluded tests report `Skipped` with their reason attached as an info event.
- `[tested]` `examples/unreal/automation_test/automation_reference.mjs`, 7 of 7: the command shape under "Community lane advice" runs a test; the log carries the documented lines; a failing test gives a non-zero exit code.

## Choosing what runs

- `[documented]` Groups are defined in `DefaultEngine.ini` with `+Groups=(Name="...", Filters=((Contains="...", MatchFromStart=true)))` and run as `Group:<Name>` in `-ExecCmds="Automation RunTest ..."` or in Gauntlet.
- `[documented]` `+ExcludeTest=(Test="...", Reason="...", Warn=False)` excludes a test, optionally per RHI. Epic frames exclusion as a temporary measure and the `Reason` is part of the syntax.
- `[tested]` Same script: `Group:<Name>` selects the group's tests; an unknown group name does not look like a pass; a `+ExcludeTest` entry skips its test and reports the reason.
- `[documented]` Data Validation runs in CI with `UnrealEditor-Cmd.exe <Project>.uproject -run=DataValidation`; failures print to the console.
- `[documented]` Low-Level Tests: Epic recommends BuildGraph (`RunUAT BuildGraph -Script="Engine/Build/LowLevelTests.xml" -Target="..."`). The test executable takes `--timeout=<MINUTES>`, `--buildmachine`, `--log` and `--extra-args`; tags select which tests run, so `[slow]` tests can go to a nightly build.
- `[tested]` The Launcher install has no `Engine/Build/LowLevelTests.xml` and no generated test metadata (`examples/unreal/automation_test/headless_routes.mjs` reads the install and starts no engine), so the Low-Level Tests `RunUAT BuildGraph` step needs a source-built engine.
- `[documented]` BuildGraph scripts are XML graphs of nodes; `-Export=<file>` produces a JSON graph and `-SingleNode=<name>` with `-SharedStorageDir=<path>` runs one node on each agent.

## Content-audit routes without a window

- `[documented]` In the installed engine source (same script, source reading only): the Reference Viewer and Size Map are editor UI; the Asset Manager editor module registers five console commands.
- `[documented]` In the installed engine source `AssetManager.AssetAudit` is registered only when the editor is not running a commandlet and only logs statistics. It is not the Asset Audit window and does not write that window's CSV export.

## Builds that tests run on

- `[documented]` Development enables most optimizations and is the editor's default; Shipping strips console commands, stats and profiling tools; Test is Shipping with some of them enabled. Epic's matrices list Editor only in Debug, DebugGame and Development. In the project-only matrix Test, Client and Server have no available configurations; the page does not say so, but that implies (an inference) they need an engine built from source.
- `[documented]` Per-target switches such as `bForceCompileDevelopmentAutomationTests` and `bForceDisableAutomationTests` change which automation tests compile; the defaults outside Debug and Development are not stated on the page.

## Community lane advice

These are one author's recommendations, not Epic's.

- `[general]` Pre-submit within minutes: CQTest, Simple tests, Smoke tests and critical data validation, with `-NullRHI` where possible. After main updates: small Functional Tests, important map loads, Blueprint compilation. Nightly: all maps, screenshots, multiple clients and a dedicated server, packaged builds, long stress runs, Gauntlet.
- `[tested]` Command shape: `UnrealEditor-Cmd.exe <project> -Unattended -NullRHI -ExecCmds="Automation RunTest <filter>;Quit" -ReportExportPath=<dir>`.
- `[general]` Remove `-NullRHI` for screenshots, Slate, materials or GPU checks.
- `[general]` Do not trust only the exit code: parse the report, fail when a test failed, timed out or stayed `NotRun`, when the report is missing, and decide explicitly whether `Skipped` is allowed. Keep reports as artifacts even on success.
- `[general]` Name tests `Project.Layer.Feature.Subject.Condition` so a name filter selects a lane. Fix a flaky test or exclude it with a reason and a removal condition; do not rerun until green.

## Judgements

- `[general]` A lane is fit when its cost matches its frequency: a test over one second does not belong where every edit runs. Moving a test to a slower lane is better than deleting it unless it proves nothing.
- `[general]` A job that cannot go red is the highest-ranked CI finding. Check that a deliberately failing test turns the job red and leaves a report.
- `[general]` Choosing lane frequencies is the owner's decision. Present the cost of each option and recommend one.

Next: [measurement conditions](unreal-quality-measurement.md).
