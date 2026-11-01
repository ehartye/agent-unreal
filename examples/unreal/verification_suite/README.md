# Disposable native suite acceptance

This Windows acceptance driver reuses the shipped ObservationSample setup and
AgentVerify source. It never edits a consumer project. Run from the plugin root
with fresh project and evidence directories beneath existing parents:

```powershell
node examples/unreal/verification_suite/acceptance.mjs --project D:/Temp/SuiteSample --evidence D:/Evidence/SuiteSample --engine D:/Engines/UE --compiler <installed-compiler-family> --sdk <installed-sdk>
```

Supply the actual installed compiler family and SDK as single argument values.
The manifest is produced by `fixture.mjs`: a bounded build, the eight supplied
automation rules, a passing mapped-input replay and an exact live-name refusal.
The refusal expects engine exit zero and a valid rejected observation. Every
engine operation uses the same production launcher and owned process tree.
The passing replay requires observed Development configuration and 640×360
resolution. The live-name refusal stops before runtime observation and therefore
requests no runtime conditions (`requested: {}`). It proves the exact refusal and
zero actions, without claiming an observed configuration or resolution. Explicitly
requested conditions still require matching observation evidence, including for
rejected replays.

The driver retains the generated manifest and exact request files, read-only
plan, per-step commands/logs/receipts/artifacts, aggregate `run/regression.json`,
independent `verification.json` and `acceptance.json`. The fresh source must remain
available for subsequent verification. A failed step never becomes a pass merely
because its process exited zero. The engine build is bounded to 600 seconds; each
test/game workload to 180 seconds. Preserve contention, cancellation and failed
attempts for inspection. Do not rerun blindly after native failures.

This acceptance is separate from `node scripts/check.mjs` and does not install an
engine or run in CI. It proves the neutral integration path; it does not prove
consumer migration parity. Compare retained results at one exact consumer source
revision, including every required row and unsupported kind, before proposing a
switch. Keep consumer machinery while schemas or outcomes differ.

See the [manifest and receipt contract](../../../scripts/lib/unreal-verify/README.md)
for all eight v1 kinds, offline validation and retained verification commands.
