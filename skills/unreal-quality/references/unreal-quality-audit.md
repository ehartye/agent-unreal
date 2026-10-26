# Quality audit

An audit answers: can the project's tests and performance numbers be trusted for the activity at hand, what is missing, and what comes first. Everything here is `[general]` method built on the `[documented]` references linked from each step.

## 1. Fix the scope first

- `[general]` Write the activity (merge gate, demo, release), the behaviours that must not break, and any performance targets the owner already has. Record absent targets as unknown.
- `[general]` Ask which engine version, which platforms and which build configuration players will run. A claim about a different configuration is evidence of a different thing.

## 2. Inventory without running anything

- `[general]` **Tests.** For each: registration macro, name, flags (`SmokeFilter`, `ProductFilter`, context flags), file, whether it asserts anything, waits (`Sleep`, fixed delays, latent commands), map loads, files written, random or time inputs, and what state it assumes. See [test types](unreal-quality-test-types.md) and [test design](unreal-quality-test-design.md).
- `[general]` **Runs.** The CI or local script: the command, filters or groups, `-Unattended`, `-NullRHI`, report export, how the exit code and the report are used, and which tests are excluded and why. See [lanes](unreal-quality-lanes.md).
- `[general]` **Performance claims.** For each number in docs or messages: the build configuration, editor or packaged, scenario, metric (average, percentile, maximum), repeat count, machine state and any budget. See [measurement](unreal-quality-measurement.md) and [profiling tools](unreal-quality-profiling-tools.md).
- `[general]` **Artifacts.** Which traces, `.uestats`, memory CSVs or report JSON files exist, and whether the numbers cited can be recomputed from them.
- `[general]` Source may be partial. Say which function bodies you could not read before judging what a test proves.

## 3. Compare with the guidance

- `[general]` One finding per difference: **what**, **where** (file and line), **rule** (Epic page with `[documented]`, or `[general]` for a judgement or community recommendation), **consequence**, **confidence** (observed, inferred, unverified) and **fix size**.
- `[general]` Questions that find most findings: Does each test assert something that can fail? Is every Smoke test fast? Does any test depend on order, files, time or randomness? Does the run fail loudly and leave a report? Do the lanes match what each test costs? Was each number measured under conditions that make it comparable?
- `[general]` A document that contradicts the code or the run (a coverage rule nobody follows, a frame rate nobody measured) is a documentation-drift finding.

## 4. Rank by consequence

| Rank | Consequence | Typical findings |
|---|---|---|
| 1 | A green result is meaningless | A test with no assertion; CI that cannot see a failure; a run that skips the tests it claims to run |
| 2 | A measurement is untrustworthy | Frame rate read in the editor; no bottleneck identified; debug build; no repeatable conditions |
| 3 | The suite costs too much or flakes | Sleeps and full map loads in Smoke tests; order-dependent tests; everything in one lane |
| 4 | A risky behaviour has no test | Damage, save and load, replication, level transitions |
| 5 | Convention | Naming, coverage percentage, file layout |

- `[general]` Rank 1 findings come first even when there are few. Do not rank by test count or coverage percentage.

## 5. Report

- `[general]` Open with the activity and a verdict in two sentences. Then the test inventory (type, flags, cost, can it fail), the run description, each performance claim with its conditions, ranked findings, **observed versus inferred versus unverified**, and owner questions.
- `[general]` State what you did not run. Reading a test does not show it passes, and reading a report does not show the numbers are right; say which findings need a run, and hand that to [unreal-native](../../unreal-native/SKILL.md).
- `[general]` Stop when the activity's readiness and next action are supported. Each extra check needs a question it could change.

Next: [remediation plan](unreal-quality-remediation.md).
