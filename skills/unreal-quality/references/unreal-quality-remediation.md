# Remediation plan

A plan turns ranked findings into ordered, bounded steps the owner can approve one at a time. Everything here is `[general]` method; the guidance each step moves toward is `[documented]` or labelled in the linked references.

## Shape of a plan

- `[general]` Each step has: **finding ids** it closes, **change**, **blast radius** (tests, CI scripts, docs and code touched), **check**, **rollback** and **depends on**. One step changes one thing, so a failure points at one change.
- `[general]` The check is an observation, not a review. For a test: it passes, and it fails when the behaviour it covers is broken on purpose. For a lane: a deliberately failing test turns the job red and leaves a report. For a measurement: a second run under the same recorded conditions agrees within the noise you state.
- `[general]` Say what the plan leaves alone, and which findings are preferences.

## Order

1. `[general]` Make failure visible first. Until the run exits non-zero on a failed test and leaves a report, no later check can be trusted.
2. `[general]` Fix tests that cannot fail, then tests that block others (sleeps, full map loads and shared files in the fast lane). Move each slow test to the lane its cost fits rather than deleting it.
3. `[general]` Add a test for a risky behaviour when you next fix a bug in it, using the lightest test type that proves the behaviour.
4. `[general]` Establish one trustworthy measurement before changing performance: record the build configuration, scenario, metric and conditions, then take a baseline. Only then change code, and compare with the same conditions.
5. `[general]` Set budgets with the owner after a baseline exists. A budget is the owner's decision, not a finding.
6. `[general]` Structure that blocks testing (rules buried in a controller, state on the game instance) is an [architecture](../../unreal-architecture/SKILL.md) step; sequence it before the tests that depend on it.

## Compare credible options

When a finding has more than one reasonable fix, present each with its implications for time, risk, complexity, best practice and maintainability, recommend one, and say why. Give estimates only when they rest on something observed, such as the number of tests to move; otherwise give relative size.

- `[general]` Keep a small option that restores trust in the results ahead of a larger redesign of the suite.
- `[general]` Prefer deleting a test that proves nothing over keeping it for a coverage number; say so in the plan.

## Hand-offs

- `[general]` Running the suite, a capture or a profile, cooking and the profiling harness are [unreal-native](../../unreal-native/SKILL.md). The audit reads; the owner or `unreal-native` runs.
- `[general]` Cross-language suite audits, run frequency and test-bloat rules are the `agent-tests` plugin's test-strategy and test-audit skills when installed.
- `[general]` Do not implement the plan inside the audit. Present it, get the owner's choice, then execute step by step with each check.

## Plan template

```
Step N: <change in one line>          closes: F1, F3       depends on: Step N-1
  changes:   <tests, scripts, docs>
  blast:     <what else is touched>
  check:     <observable proof, including that a broken behaviour fails it>
  rollback:  <how to undo>
Not fixed: <preferences and deferred findings, with reason>
Open questions: <owner decisions, such as budgets and lane frequency>
```
