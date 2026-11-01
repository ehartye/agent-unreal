# AgentVerify disposable consumer sample

The consumer owns `module/ObservationSample/` and scenario documents. The bundled
`runtime/AgentVerify` owns replay scheduling, input injection, observations and
receipts. The sample does not copy that framework into its game module.

The pawn's ordinary `UPlayerInput` axis/action mappings move a visible body and
count a marked action. This exercises legacy mapped input, not Enhanced Input or
a physical controller. After completion and cancellation, the adapter records
the pawn's actual released input state four gameplay frames later. A procedural
440 Hz sound travels through `UAudioComponent`; AgentVerify records the actual
master mix. The source waveform is never substituted for recording evidence.
The engine cube and basic material provide only the disposable sample's visible
body and floor; `/Engine/Maps/Entry` supplies an empty startup level.

## Create and run

Run on the configured Windows GPU host with Unreal 5.8 and an installed compiler.
Every directory below is caller-selected. Setup refuses an existing project.

```powershell
node examples/unreal/agent_verify/setup.mjs --project D:/Scratch/ObservationSample --engine D:/Engines/UE --compiler <installed-version> --sdk <installed-version> --comparison D:/Evidence/comparison/manifest.json
node examples/unreal/agent_verify/acceptance.mjs --project D:/Scratch/ObservationSample --evidence D:/Evidence/observation-001
node --test examples/unreal/agent_verify/acceptance.test.mjs
node scripts/check.mjs
```

Setup creates an owned Git fixture and copies AgentVerify source, manifests and
schemas intact. Local machine paths go into ignored `launcher.local.json` and
`acceptance.local.json`. The acceptance command uses the shared launcher for one
build (600 seconds), eight selected Automation tests (180 seconds), and ten
serial game observations (180 seconds each). Acquisition waits are bounded to
60 seconds. It stops at the first native failure and preserves its evidence.
It never adds engine execution to the dependency-free merge gate.

By default every invocation builds. To retain an already accepted build's actual
toolchain observation, optionally set `prior_build` in `acceptance.local.json`
to its launcher evidence directory. Reuse requires a successful independently
validated lifecycle, the exact current clean source commit and snapshot, matching
project/engine/target/configuration arguments, unchanged engine and produced
binary bytes, and the retained compiler/SDK log binding. Missing or changed
evidence fails; it never becomes a skipped build success. The new evidence copies
the original launcher files and records their hashes in `build/reused-build.json`.

The observations cover mapped input, audio-disabled smoke, a 90-real-frame shot,
silence/tone recordings, exact structural/live-name refusals, an explicitly
unavailable metric, cancellation cleanup, and a requested absent audio tap.
All receipts pass through the independent AgentVerify validator. A copied source
file is changed to prove the `modified` result while retaining that edit.
External artifact mutations separately remove the shot and shorten a valid
recording; these are validator tests, not native screenshot/audio failures.
The shortened WAV retains valid format and synchronized hash/frame metadata so
the refusal specifically tests duration, not a corrupt header or stale hash.

`acceptance.json` records A1/A2/A4/A6, actual scenario verdicts, source identities
and errors. `inventory.json` binds every retained file by length and SHA-256.
Build/game requests, lifecycle receipts, raw observations, images, WAVs, adapter
state, negative mutations and source copies remain beside it. Exit zero means
all requested criteria passed. Missing comparison evidence leaves A6 pending and
returns failure; it is never silently skipped. A launcher pass alone does not
establish any gameplay or audio assertion.

## Genuine old/new comparison

The configured comparison manifest points to retained evidence from an existing
consumer's old implementation and an adapter-only disposable integration of
AgentVerify at the same baseline. Do not alter that consumer's real checkout or
launcher. Run both sides under the shared launcher's owned tree in disposable
copies, preserving the baseline revision and exact adapter patch/revision.
The generic verifier supports the narrow legacy receipt format described in
[comparison contract](comparison.md); an unrelated format needs an explicit
reviewed adapter. It does not invent an old runner or trust a supplied verdict.

The comparison independently checks request/file hashes, launcher and build
identity, actual artifact bytes, complete phases/checks, old raw CSV speed
samples, and the new AgentVerify receipt. It reconciles key transitions and the
old counter's initialization teleport without claiming equal raw counter units.
Allowed semantic differences are generic identifiers/version fields, the
corrected percentile definition and new measurement eligibility metadata.
Unexplained check-count or verdict differences fail.

Build artifact paths are verified on the native host. Preserve the referenced
products there for verification, or transfer them with an explicitly validated
path mapping in a separate transfer workflow. Copying the JSON report alone
does not prove binaries still match. This sample does not implement remote jobs.

## Source updates and rule ownership

Install and update guidance is in [AgentVerify source integration](../../../skills/unreal-native/references/unreal-agent-verify.md).
Inspect a locally modified plugin before replacing it; never regenerate its
manifest merely to conceal changes. Archive the old source/version and receipts,
compare the incoming source, then rebuild and rerun relevant acceptance in a
disposable project before an authorized consumer migration.

`Domain/TravelRule.h` contains the game's engine-free movement rule. Its adapter
owns actor positions, input bindings and clocks. The example Automation test is
`ObservationSample.Domain.Travel.ReleasedAxisStopsMovement`; it is guarded by
`WITH_DEV_AUTOMATION_TESTS` and uses the product filter rather than promising a
Smoke duration. Source ownership follows behavior, not the test harness.

[tested] On Unreal 5.8 (observed executable CL 58902052), the builder acceptance
passed all eight Automation rules and ten observation scenarios: actual mapped
movement and cleanup, a 90-real-frame capture, master-mix silence/tone, exact
zero-action refusals, unavailable metrics, cancellation and the absent-tap
failure. A1/A2/A4/A6 passed, including the external artifact mutations and the
retained disposable old/new comparison. This establishes this bounded sample;
it makes no physical-controller or performance-budget claim. Independent spec
verification remains a separate delivery step.
