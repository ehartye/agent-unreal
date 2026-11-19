# Shared Windows engine launcher

Use `node scripts/unreal-run.mjs --help` for the public operations: `build`,
`editor`, `game`, `commandlet`, `package`, `test`, `status`, `doctor`, `clear-stale`.
Windows, Node and PowerShell 7 are required. Native acceptance is separate from
the dependency-free Linux merge gate. Existing projects keep their own launcher
until a separately verified migration.

Store machine paths in an ignored project configuration, never in plugin source:

```json
{
  "version": 1,
  "project": "./Sample.uproject",
  "engine": "D:/Engines/UE",
  "sourceRoot": ".",
  "editorTarget": "SampleEditor",
  "gameTarget": "Sample",
  "configuration": "Development",
  "platform": "Win64",
  "packageDirectory": "./Saved/Package"
}
```

Relative paths resolve against the configuration file. `sourceRoot` is the Git
repository root. `dotnet` optionally identifies the engine-bundled runtime when
discovery is ambiguous. `gameExecutable` optionally selects an already packaged
game; otherwise `game` launches the editor executable with `-game`.

```powershell
node scripts/unreal-run.mjs build --config launcher.local.json --evidence Saved/build-proof --timeout 1200
node scripts/unreal-run.mjs editor --config launcher.local.json --evidence Saved/editor-proof --timeout 120 -- -unattended
node scripts/unreal-run.mjs commandlet --config launcher.local.json --evidence Saved/commandlet-proof --timeout 120 -- -run=MyCommandlet
node scripts/unreal-run.mjs test --config launcher.local.json --evidence Saved/test-proof --timeout 120 -- '-ExecCmds=Automation RunTests Project;Quit'
node scripts/unreal-run.mjs package --config launcher.local.json --evidence Saved/package-proof --timeout 1800
node scripts/unreal-run.mjs status
node scripts/unreal-run.mjs doctor --evidence Saved/doctor-proof --timeout 30
node scripts/unreal-run.mjs clear-stale --evidence Saved/recovery-proof
```

Evidence directories must be empty. `--timeout` bounds the workload, `--wait`
bounds lock acquisition (default 60 seconds); both are 1–86400 seconds. Arguments
after `--` remain an array, including empty arguments and quoted paths. No shell
reconstructs workload arguments. Builds use the engine's bundled .NET runtime
and UnrealBuildTool assembly; packages use AutomationTool `BuildCookRun`.
`commandlet` and `test` use `UnrealEditor-Cmd.exe`; their engine arguments specify
the intended commandlet or automation selection. Nonzero workload exit codes
propagate; launcher/cleanup/identity failures return 74 and invalid input returns 2.

## Ownership and recovery

Each launch keeps its ownership journal in its own evidence directory. Independent
launches can overlap. A missing drain affects the evidence for that request alone.
The launcher neither acquires a machine-wide process lock nor scans other engines.

The Node controller binds its PID and creation time into a fresh request. The
helper owns an unnamed, non-inheritable, kill-on-close Job without breakaway. A
fixed Node gate waits without spawning a workload, joins that Job, and proves
inheritance with a live inert child before receiving the request-bound workload
permit. The journal records permit intent before permission is published.
Only that Job is terminated for timeout, cancellation or controller death.
Cleanup waits at most ten seconds for zero active members and an empty member
list. PID disappearance, EOF, or kill-on-close is never substituted for drain.

Member enumeration and process queries are separate observations. An exiting
process can remain in a Job snapshot after its PID can no longer be opened. The
helper reconciles each failed identity observation for at most one second, still
checking cancellation and the workload deadline. It records the PID, original
exception and reconciliation outcome in `member-observations.jsonl`. Persistent
failure refuses the run; a reconciled snapshot never substitutes for final drain.

Ctrl+C and SIGTERM request cancellation; the controller waits for cleanup.
The detached supervisor lets the helper observe controller death and finish
cleanup. While it still owns the Job, the helper polls both accounting and the
member list, persists the request-bound lifecycle and releases the owner record
after a proved drain. Abrupt helper death can leave an owner record with no
drain. Preserve that request's evidence as an unknown outcome.

`status` reports the independent launch policy and any pre-upgrade journal in
`legacyOwner`. For a current run, inspect `owner.json` or `lifecycle.json` in
its evidence directory. `doctor` exercises the same Job with an inert workload.

Plain `clear-stale` retains the original proof rules for a legacy journal under
`%ProgramData%/agent-unreal/engine-runs`. If the helper died after issuing a
permit and its drain witness was lost, explicitly archive the original journal:

```powershell
node scripts/unreal-run.mjs clear-stale --archive-unwitnessed Saved/interrupted/request.json --evidence Saved/archive-proof
```

Recovery holds the legacy mutex during inspection and compares the supplied
request ID and SHA-256 with the owner. Every recorded creation identity must be
gone. A matching unwitnessed journal is renamed byte-for-byte in its original
directory. The recovery receipt records `archived-unwitnessed` and the archive
path. The interrupted workload retains an unknown outcome. The command never
uses `last.json` as evidence.

## Receipt contract and embedding API

The `schemas/` directory documents version 1 shapes. `contracts.mjs` exports
dependency-free `validateRequest`, `verifyLifecycle`, `verifyIdentity` and
`recoveryDecision`. Shape validation alone never qualifies a result.
`verifyLifecycle(receipt, {requestId, requestHash})` recomputes successful
production eligibility, including ownership, permit binding, exit state and a
drain observation within the lifecycle interval. `{requireSuccess:false}` checks
drained diagnostic outcomes. Fixture purpose is rejected by default.

`identity.mjs` exports `sourceIdentity`, `collectIdentity` and
`verifyArtifactFiles`. Build/package identity binds the Git commit, dirty state
and content snapshot before/after work; records installed engine metadata and
actual executable version separately; observes compiler/SDK from tool output;
and hashes target products and packaged files. Missing observations remain
failures, including incremental builds whose logs do not identify a toolchain.
Consumers must use both `verifyIdentity` and `verifyArtifactFiles`, providing the
expected source identity. Fetch consumers may provide a validated
`resolveArtifact(recordedPath)` mapping to their fetched tree; never trust an
unvalidated archive path. Receipt success does not prove arbitrary test assertions.

`runContainedProcess(options)` in `controller.mjs` is the internal embedding API
for the compatibility adapter: `{executable, arguments, cwd, evidence, timeoutMs,
waitMs, operation:'compat', signal, onDiagnostic, onStdout, onStderr}`. It owns one Job around
the whole child tree, so a Node probe may launch its engine children inside that
Job. It returns the child exit,
request, lifecycle and validation. `fixtureIsolation` is only for the inert
harness; fixture receipts cannot qualify production evidence and the public CLI
does not expose this option. Production consumers cannot change state or lock.
The output callbacks receive incremental UTF-8 text, including a final flush;
an adapter forwards these to its stdout/stderr while complete logs remain in the
evidence directory. Diagnostics have their own callback and stderr log.

## Verification commands

```powershell
node --test scripts/unreal-run.test.mjs
node scripts/check.mjs
node scripts/lib/unreal-run/native-acceptance.mjs
node scripts/lib/unreal-run/verify-receipt.mjs Saved/build-proof --config launcher.local.json
node scripts/lib/unreal-run/verify-receipt.mjs Saved/editor-proof
```

The first two need no engine or Windows helper. The native-acceptance command requires Windows and
returns its unique retained OS-temp evidence directory; an optional first path
selects an empty output directory. It uses inert child/grandchild workloads and
a fixture-only mutex for legacy recovery. It covers exact
arguments, exit propagation, timeout, cancellation, containment refusal,
controller/helper death, missing accounting, overlapping consumers,
recovery refusal/acceptance and survival of an unrelated sentinel. Run the same
command through a remote session for that host's fixture acceptance. Engine
build/editor/game/commandlet/package smoke acceptance is a separate native lane;
inert fixture success does not establish those engine behaviors.

The receipt-verifier commands read retained evidence without starting an engine.
For actual build, commandlet, editor/game and package smoke checks, use the
[disposable engine acceptance sample](../../../examples/unreal/engine_lock/README.md).

For a targeted owner-death repair check, append `--only owner-death,helper-death`
to the native acceptance command. The report names the selected cases and marks
`fullSuite: false`; a partial report never substitutes for full native acceptance.
