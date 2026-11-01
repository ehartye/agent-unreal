# Compatibility adapter and native acceptance

The prescribed [shared launcher](../../../scripts/lib/unreal-run/README.md) owns
one machine-wide lock, an owned Windows Job, request-bound permits and drain
receipts. `with-engine-lock.ps1` is an adapter to that mechanism; it has no second
mutex or cleanup implementation. Existing consumers keep their own launcher
until a separately verified migration.

Run from the plugin root:

```powershell
pwsh -NoProfile -File examples/unreal/engine_lock/with-engine-lock.ps1 node examples/unreal/editor_python/ep_validate.mjs --engine D:/Engines/UE --keep
```

The whole probe and its sequential engine children share one owned tree. Do not
call another launcher recursively inside it. For direct engine work use
`node scripts/unreal-run.mjs <operation>` with the versioned project configuration.
Build/package target, project, platform, configuration and archive destinations
come from that configuration; trailing arguments cannot replace their identity.

The adapter preserves one, empty, quoted and trailing-backslash arguments,
streams stdout/stderr, and propagates a nonzero child exit. Usage errors return 2,
lock-wait expiry returns 3, and ownership/cleanup failures return 74. It prints
the retained evidence directory on stderr. Use native executables (`pwsh -File`
for PowerShell scripts); use the launcher's build/package operations for batch
build entry points. Bare `bash` resolving to the System32 WSL launcher is refused.
Git Bash users must still set `MSYS_NO_PATHCONV=1` for drive-letter engine arguments.

`ENGINE_LOCK_TIMEOUT_MIN` bounds waiting (default 240 minutes).
`ENGINE_RUN_TIMEOUT_SECONDS` bounds the entire probe (default 14400 seconds).
`ENGINE_LOCK_EVIDENCE` may select a fresh evidence directory. The shared helper
reports holders promptly and every five seconds; the old heartbeat setting no
longer changes this. `ENGINE_LOCK_NAME` overrides are refused: production always
uses `Global\agent-plugins-engine-runs`.

`--no-lock` is restricted to `node --version` and the bundled
`examples/unreal/engine_plugins.mjs` filesystem scan. Arbitrary scripts, `node -e`,
engines and build tools cannot use it. This restriction prevents a documented
scan-only option from becoming a general launch bypass.

## Repeatable checks

```powershell
node --test examples/unreal/engine_lock/engine-lock.test.mjs
node scripts/lib/unreal-run/native-acceptance.mjs
node examples/unreal/engine_lock/native-acceptance.mjs --engine D:/Engines/UE --evidence D:/Evidence/launcher-native
```

The first checks adapter compatibility on Windows and skips native cases on
other platforms. Tests use unique OS-temp roots and explicit fixture isolation;
their receipts cannot qualify production evidence. The second is the separate
inert lifecycle harness: two independent controllers share one isolated global
mutex, assert non-overlapping workload intervals and holder diagnostics, and
preserve a sentinel. Invoke it through the remote session as well as locally;
no engine runs in that harness.

The third creates a disposable source repository and sample, then exercises
actual build, cook commandlet, editor, game, package and packaged startup through
the public CLI. It requires an idle engine-equipped Windows host and saves exact
commands, versioned lifecycle/identity receipts, source identity and artifact
hash checks. Sample startup uses `-nullrhi`: this establishes native process
behavior, not visual quality or GPU performance. A failed step stays failed.
`--only build,commandlet,editor,game,package,packaged` selects explicit remaining
steps in the retained sample; an existing step/report is never overwritten.

Build/package receipt verification observes actual compiler/SDK logs and reads
artifact bytes. Missing observations cannot pass, including an incremental build
that emits no toolchain line. Never turn an older receipt into a new successful
run. Use the shared launcher's `verify-receipt.mjs` command for independent checks.

## Disposable adoption and contention

Copy the bundled `scripts/unreal-run.mjs` and `scripts/lib/unreal-run/` into a
second disposable consumer, retaining their layout. Create its own ignored
configuration pointing at its own project; use the same production lock. Run the
inert harness there with fresh evidence and retain both source hashes. Do not copy
private consumer machinery or replace a real consumer's launcher.

Keep same-lock exclusion and unmanaged-engine refusal separate. When an external
engine is already running, a new production operation must refuse before its
workload permit, preserve the contention observation and leave that process
untouched. Wait for it to finish before positive acceptance. An inert process
with an engine-like name is useful detector coverage, not proof of a real external
engine observation. The launcher cannot prevent arbitrary manually started work
outside its mechanism.
