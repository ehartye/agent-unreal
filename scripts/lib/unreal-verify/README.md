# Verification suites, schema version 1

The dependency-free Node entry point plans a manifest, executes its steps serially
through the shared Windows launcher, and qualifies referenced evidence. There is
no arbitrary shell step, alternate lock, fixture-purpose qualification, remote
job transport, or consumer migration switch.

```sh
node scripts/unreal-verify.mjs --project project.json --manifest manifest.json --suite acceptance --validate-only
node scripts/unreal-verify.mjs --project project.json --manifest manifest.json --suite acceptance --output fresh-folder
node scripts/unreal-verify.mjs --verify-receipt fresh-folder/regression.json
node --test scripts/unreal-verify.test.mjs
```

`project.json` is the [launcher configuration](../unreal-run/README.md), not a
second configuration dialect. Its source repository must have a clean committed
identity. Validation and retained receipt verification never launch an engine or
write a project. They require the referenced local files. Only a qualified suite
returns exit zero; bad arguments/input return 2 and an unqualified suite returns 1.
Output must be a nonexistent directory beneath an existing parent.

## Manifest

```json
{
  "schema_version": 1,
  "steps": [{
    "id": "rules",
    "kind": "automation",
    "required": true,
    "depends_on": [],
    "timeout_seconds": 180,
    "arguments": ["-nullrhi", "-nosound", "-unattended"],
    "filter": "Sample.Domain",
    "expected_tests": ["Sample.Domain.Rule"],
    "expected_count": 1
  }],
  "suites": { "rules": ["rules"] }
}
```

Every field shown on a step is required. `filter` and `expected_tests` belong only
to automation. All eight kinds require `id`, `kind`, `required`, `depends_on`,
`timeout_seconds`, `arguments`, and a positive integer `expected_count`.
Unknown fields and versions fail. IDs are lowercase letters, digits, dots and
hyphens, beginning with a letter or digit; Windows reserved device names fail.
Timeouts range from 1 to 86400 seconds. Arguments remain an array passed directly
to the launcher. The suite owns observation input/output and automation report
arguments; users cannot override those paths or automation commands.

The planner validates every manifest step and every suite before launch, including
unselected steps. Duplicate IDs, missing dependencies and cycles fail. Suite
selection includes transitive dependencies. Stable depth-first dependency ordering
uses manifest order to resolve independent steps. At least one selected step must
be required. Required steps remain in the result even when blocked. Declare build
dependencies explicitly when a workload needs a fresh build.

| Kind | Operation | Required evidence and kind-specific fields |
|---|---|---|
| build | build | Launcher source/engine/toolchain/target identity and actual products; count 1 |
| package | package | Launcher identity and actual package products; count 1; project configuration supplies packageDirectory |
| automation | test | Fresh report/index.json; exact filter, expected_tests names and count; all rows successful with zero errors/warnings |
| replay | game | AgentVerify replay document and independently valid passed receipt |
| rejected_replay | game | Exact declared validation refusal, plus the declared engine exit |
| audio | game | AgentVerify observation with audio checks and actual full-phase WAV artifacts |
| smoke | game | AgentVerify observation with named checks |
| capture | game | AgentVerify shot with capture requests and actual PNG artifacts |

Each observation kind also requires `input` and `requested`. `input` is relative
to the manifest directory, without traversal or symlinks. The exact bytes are
hashed, checked again at dispatch and copied into the fresh step directory.
`requested` selects exact observed environment fields: `engine`, `configuration`,
`map`, `rhi`, `gpu`, `hardware_id`, `profile`, or `resolution:{width,height}`.
Omitted fields make no exact-device claim. A completed observation must also match
the launcher's build configuration. Input kinds and expected counts must agree:
count metric checks, captures and audio checks together. An audio step needs at
least one audio request; a capture step needs a shot document and capture request.

Install the supplied source at the project's `Plugins/AgentVerify` and implement
its consumer adapter. The suite reads the deployed manifest and source files,
checks pristine identity, then supplies it and real artifact bytes to
[AgentVerify validators](../../agent-verify/README.md). Those validators own
statistics, observations, capture holds, audio windows and rejection rules.

`rejected_replay` additionally requires `expected_refusal:[{code,path}]` and
`expected_exit_code` (0–255). Its count is the number of exact refusal issues.
Structural refusal issues must match independent document validation; live issue
paths must identify a corresponding input field. A malformed JSON input can be
declared with its independent root-type refusal. A crash, absent/empty report,
unrelated refusal, extra issue, normal success or unexpected exit cannot pass.
The bundled adapter exits zero after a correctly recorded validation refusal;
legacy wrapper exit conventions must be declared rather than assumed.

## Aggregate receipt and trust boundary

`regression.json` has `schema_version:1`, `kind:"unreal-verify/suite"`, a UUID
`run_id`, absolute `output`, start/finish timestamps, `prepared`, `steps`,
`outcome`, `qualified`, and `errors`. `prepared` binds exact project/manifest/input
hashes, resolved configuration, ordered plan, Git source identity and AgentVerify
source identity. Each step retains its ID/kind/required flag, directory, interval,
status, reasons, observed count, observation outcome and complete evidence-file
inventory (relative path, bytes, SHA-256).

Child `command.json` binds the requested operation and exact arguments. Launcher
requests and lifecycle receipts must bind that command, a production owned Job,
the current interval and proven zero-member drain. Build/package receipts also
require current product bytes, engine bytes and independently parsed toolchain
logs. A failed dependency blocks its dependents. Unknown ownership stops every
later dispatch, including independent work. Cancellation stops dispatch and waits
for the launcher's cleanup; cancellation, timeout, failure and unknown ownership
remain distinct outcomes. Failed optional checks remain visible; required checks
determine normal suite qualification, while any unknown ownership, cancellation,
timeout or changed source/input prevents qualification.

Retained verification recomputes the plan, command, child verdicts and aggregate
result, and checks referenced file bytes. Missing rows, changed reasons, swapped
requests, stale reports and edited artifacts fail. The original local paths and
current source/build products must still exist unchanged; moving a receipt or
fetching a remote archive is unsupported in this version. These are consistency
and byte-identity checks, not a signature or hostile-producer attestation.

An interrupted controller may leave incomplete output. That directory remains
evidence of an incomplete attempt and cannot be reused. Never infer drain from a
process exit or a controller's disappearance.
