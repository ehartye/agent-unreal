---
name: unreal-quality
description: "Audit and plan the testing strategy and performance measurement of an Unreal Engine 5.8 project against Epic's documented guidance: which Automation, CQTest, Spec, Functional or Gauntlet test fits which behaviour, deterministic and isolated tests, headless runs and report parsing, test lanes by cost, and trustworthy frame-time, memory and shader-hitch measurement. Produces an inventory, ranked findings and a remediation plan whose every step has a check. Not for choosing an engine system (use the domain skills), project structure (use unreal-architecture), or running a build, capture or profile (use unreal-native)."
when_to_use: "Use when asked to review or audit a project's tests, CI or performance practice; to decide which kind of Unreal test to write; when tests are slow, flaky, never fail or are all marked Smoke; when a CI job runs Unreal automation; when a frame-rate, hitch or memory claim needs checking; or to plan how to improve test coverage and performance measurement in order."
---

# Unreal project quality

Unreal 5.8. This skill audits a project's testing and performance measurement and plans the fix. Every reference labels
its claims `[documented]` (Epic's 5.8 documentation says it) or `[general]` (a judgement or a community recommendation
built on it), so a finding can say which kind of rule it breaks. It selects and checks; it does not run anything.
Running a build, capture, trace or profile, and the profiling harness, are
[unreal-native](../unreal-native/SKILL.md). Project structure and testable seams are
[unreal-architecture](../unreal-architecture/SKILL.md). Choosing an engine system is the domain skills such as
[unreal-gameplay](../unreal-gameplay/SKILL.md).

| You are about to | Read |
|---|---|
| Pick the right kind of test for a behaviour | [Test types and choosing one](references/unreal-quality-test-types.md) |
| Make tests deterministic and isolated; wait on latent work; assert correctly | [Test design](references/unreal-quality-test-design.md) |
| Run automation headless, read the report, split runs into lanes, handle a flaky test | [Headless runs and lanes](references/unreal-quality-lanes.md) |
| Judge a frame-time, hitch or memory claim; set the conditions and budget for a measurement | [Measurement conditions](references/unreal-quality-measurement.md) |
| Pick the profiling tool that answers a question: stat, Insights, trace channels, memory, shader hitches | [Profiling tools](references/unreal-quality-profiling-tools.md) |
| Audit a project's tests, lanes and measurement claims | [Quality audit](references/unreal-quality-audit.md) |
| Turn findings into an ordered plan where every step has a check | [Remediation plan](references/unreal-quality-remediation.md) |

## How to work

1. Name the activity the quality bar serves (merge, demo, release) and the behaviours or numbers that matter for it.
   Missing targets are recorded as unknown; do not invent a budget or a coverage goal.
2. Look at what exists before adding: the tests, the CI command, the performance notes and any trace or report files.
3. Read the reference for each area you touch, audit, then plan.
4. Hand execution on: runs, captures and profiling to `unreal-native`, structure that blocks testing to
   `unreal-architecture`. If the `agent-tests` plugin is installed, its test-strategy and test-audit skills cover suite
   bloat and run frequency across languages; this skill covers what is specific to Unreal.

## Rules of thumb

- A result is only as good as its conditions: the build configuration, the machine state and the scenario belong in the claim.
- Use the lightest test that can prove the behaviour, and prove a new test can fail before trusting it.
- Report a preference as a preference. Epic's pages do not set a coverage target, a layer ratio or a frame budget.

## Stop when

The named activity's readiness and the next action are supported, or the precise evidence gap is known. Do not widen
the bar, add checks no question needs, or re-review the review.
