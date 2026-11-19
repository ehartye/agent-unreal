# Compatibility adapter and native acceptance

The prescribed [shared launcher](../../../scripts/lib/unreal-run/README.md) owns
one private Windows Job per run, request-bound permits and drain
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
streams stdout/stderr, and propagates a nonzero child exit. Usage errors return 2.
Ownership and cleanup failures return 74. It prints
the retained evidence directory on stderr. Use native executables (`pwsh -File`
for PowerShell scripts); use the launcher's build/package operations for batch
build entry points. Bare `bash` resolving to the System32 WSL launcher is refused.
Git Bash users must still set `MSYS_NO_PATHCONV=1` for drive-letter engine arguments.

`ENGINE_LOCK_TIMEOUT_MIN` is accepted for compatibility and has no effect.
`ENGINE_RUN_TIMEOUT_SECONDS` bounds the entire probe (default 14400 seconds).
`ENGINE_LOCK_EVIDENCE` may select a fresh evidence directory. The legacy lock-name override remains unsupported.

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
inert lifecycle harness. It overlaps two requests, checks their separate drains and preserves a sentinel. Invoke it through the remote session as well as locally;
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

## Disposable adoption

Copy the bundled launcher and its library to the same relative paths in a
disposable consumer. Give each invocation its own fresh evidence directory and
verify the request ID, hash and Job drain for that invocation.
