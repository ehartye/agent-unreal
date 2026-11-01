---
name: unreal-verify
description: "Author and run manifest-driven Unreal Engine 5.8 verification suites, qualify retained suite receipts, and compare suite adoption evidence. Use when asked to write a verification manifest, validate a suite plan, investigate an unqualified regression.json, declare an expected replay refusal, or assess migration to the shared suite runner. Not for individual native builds or captures, quality audits, or test strategy."
---

# Verification suites

Use the shared suite runner for declared checks and evidence qualification. For
test strategy and performance audits use [unreal-quality](../unreal-quality/SKILL.md);
for individual builds, captures and profiles use [unreal-native](../unreal-native/SKILL.md).

**A prevalidation refusal can stop before runtime observation.** If the intended
check proves only that exact zero-action refusal, declare `requested: {}` and make
no runtime-condition claim. An `environment: null` receipt cannot establish a
configuration, resolution or hardware identity. If the task actually requires
those conditions, retain them in `requested` and report the missing evidence;
never remove a requested condition just to obtain qualification.

| You are about to | Read |
|---|---|
| Write a manifest, select kinds/counts/dependencies, or interpret regression.json | [Manifest and receipt contract](../../scripts/lib/unreal-verify/README.md) |
| Set project, source, toolchain or process ownership requirements | [Shared launcher contract](../../scripts/lib/unreal-run/README.md) |
| Write replay/metric requests, integrate observations or interpret refusal details | [AgentVerify integration and observations](../unreal-native/references/unreal-agent-verify.md) |
| Run disposable native acceptance | [Fixture driver and requirements](../../examples/unreal/verification_suite/README.md) |
| Compare an existing consumer and plan adoption | [Staged adoption](references/unreal-verify-adoption.md) |

## Workflow

1. Read the manifest contract and existing consumer declarations. Use the launcher
   project configuration and a clean committed source identity. Declare each
   required step, positive expected count, exact automation test names, bounded
   timeout and dependencies; include build dependencies when fresh products are
   needed. Keep inputs relative to the manifest. V1 supports only `build`,
   `automation`, `replay`, `rejected_replay`, `audio`, `package`, `smoke` and `capture`.
2. Validate the complete manifest before execution. Inspect the deterministic plan
   including transitive dependencies and required rows. Validation and retained
   verification need local referenced files but launch no engine and write no
   project. Unknown fields/kinds/versions, invalid counts and dependency errors
   must be fixed before execution; do not silently omit unsupported checks.
3. Run the selected suite into a nonexistent output directory beneath an existing
   parent. Execution is Windows-only, serial through the shared launcher. Preserve
   failed and interrupted output. A failed dependency blocks dependents; unknown
   ownership stops later dispatch. Use the launcher's status/recovery procedure
   before further work; process exit or controller disappearance is not drain proof.
4. Independently verify the retained aggregate and report its qualification,
   outcome, exact observed counts, failed/blocked rows and evidence location.
   Require fresh source/input/configuration identities, matching requested
   conditions, complete required evidence and proven drain. A zero process exit
   or valid observation schema alone cannot qualify a suite.

Run from the plugin root, replacing the example paths and suite name:

```sh
node scripts/unreal-verify.mjs --project project.json --manifest manifest.json --suite acceptance --validate-only
node scripts/unreal-verify.mjs --project project.json --manifest manifest.json --suite acceptance --output fresh-folder
node scripts/unreal-verify.mjs --verify-receipt fresh-folder/regression.json
```

Validation exits zero for a valid plan; execution and retained verification exit
zero only for a qualified suite. Invalid input exits 2; unqualified results exit 1.
Preserve original source, products and evidence at their original local paths for
retained verification. Moving receipts or fetching an archive is unsupported.

## Expected rejection

A `rejected_replay` step declares the exact `expected_refusal` code/path list,
`expected_exit_code`, and refusal count. Match the independently valid refusal,
zero actions and declared process exit. The bundled adapter exits zero after a
recorded refusal; do not assume an older wrapper's exit convention. A crash,
timeout, missing/empty report, unrelated or extra issue, normal success or wrong
exit is a failure. Requested conditions remain mandatory even for a refusal.

The fixture driver writes four steps: build, eight Automation tests, a passing
two-check replay and one exact refusal. Its refusal requests no runtime conditions;
the passing replay requests Development and 640-by-360 resolution. These are the
fixture's declarations, not a claim that every native run passes. Use its linked
README for the five required driver arguments and separate engine acceptance.

## Completion and limits

Finish with the observed plan/verdict and retained evidence, or the precise reason
qualification is unavailable. Keep unsupported consumer behavior visible and use
staged adoption before proposing any switch. Arbitrary shell steps, automatic
migration and remote job transport are unsupported; remote execution belongs to a
separate future specification. The dependency-free merge gate does not run Unreal.
