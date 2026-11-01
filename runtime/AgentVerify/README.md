# AgentVerify runtime

Copy this directory into a disposable project's `Plugins/AgentVerify`, enable
the plugin and add `AgentVerify` to the consumer module's dependencies. Preserve
`source-version.json`, `Resources` and `Source`. Build and run through the shared
engine launcher. This plugin supplies observations; it does not launch engines,
manage packages, migrate consumers or update itself.

Implement `IAgentVerifyProbe` with named finite metrics and a command allowlist.
Command tokens must also resolve to live `IConsoleCommand` objects. Missing
metrics return `FAgentVerifyMetric::Unavailable(reason)`. Override save sandbox,
cache preparation, contention monitoring and hardware profile only when the
consumer can actually observe those conditions. Defaults remain unqualified.

Create `FAgentVerifyRunner(World, Probe, RequestFile, FreshOutputDirectory)` on
the game thread and retain it until `IsFinished()`. It ticks itself once per
actual engine frame. Read `Succeeded()` and independently validate its receipt
against the exact request bytes, supplied source and output artifacts using
`scripts/agent-verify/validate.mjs`. A successful process exit does not qualify
observations. Source/resource failures write `diagnostic.json`; they never
invent a valid receipt.

`Cancel()` schedules input release on the next actual frame. Keep the world,
controller and runner alive through that frame. Early destruction attempts
release but records failure because a fresh-frame analog zero cannot be proved.
One runner per process owns replay input and ordinary screenshot requests.
Only its still-queued screenshot is reset during cancellation; unrelated
requests are preserved. Scene-changing input persists through a capture hold
until an explicit replay release or final cleanup.

Structural and live-name validation precede input, commands, warm-up and cache
preparation. Warm-up and compile settling are bounded and excluded from timing
samples. Wall-clock frame durations are independent of simulation delta.
Capture requires compile readiness, at least 90 subsequent actual frames and
the requested wait; renewed compilation invalidates both an active hold and a
pending screenshot. Capture and cleanup frames are excluded from measurements.

Audio observes the actual master-submix render buffer before device output
muting. Each audio phase writes its entire own float WAV with no selected
subwindow. Missing devices, malformed buffers, short recordings and the bounded
256 MiB accumulation limit fail explicitly. Native audio evidence must verify
the intended engine/device configuration; source inspection alone is not an
audio acceptance result. Screenshot completion likewise requires a real saved
artifact, independently checked by the Node validator.

Hardware identity is a SHA-256 digest of the observed CPU brand, GPU name and
physical memory. The receipt also reports engine, build configuration, map,
RHI, GPU, resolution, consumer profile, cache preparation and contention.
Performance budgets require observed matching cache preparation and absent
contention. Cross-hardware regression guards retain their limited claim.

The descriptor's `Version`/`VersionName` **1** identify the observation API
generation. The independently versioned plugin release and complete supplied
source identity come from `source-version.json` at runtime. Local changes are
reported as modified; regenerate neither the shipped manifest nor historical
receipts to hide them. Source identity covers the descriptor, `Source`,
`Resources`, and any supplied `Config` or `Content` files, excluding the manifest
itself. The independent validator also detects added files and unsafe paths.

Native rule tests use `Automation RunTests AgentVerify` and require the fresh
Automation JSON report, not merely the editor's exit code. They cover A2
prevalidation/refusal, A3 statistics/eligibility/unavailability and A4 capture
restart/full-duration audio rules. Device, input and artifact integration
acceptance belongs to the disposable sample's separate native lane.
