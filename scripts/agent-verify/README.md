# AgentVerify v1 contracts

This directory owns individual scenario documents and observation receipts. It does not launch Unreal or qualify a suite. The dependency-free API is `contracts.mjs`; JSON Schemas are `schemas/document-v1.schema.json`, `schemas/receipt-v1.schema.json` and `schemas/source-v1.schema.json`. Unknown fields and schema versions fail closed. The schema evaluator implements only the vocabulary these bundled schemas use; it is not a general JSON Schema service.

```sh
node scripts/agent-verify/validate.mjs document request.json
node scripts/agent-verify/validate.mjs receipt receipt.json --request request.json
node scripts/agent-verify/validate.mjs receipt receipt.json --request request.json --source path/to/Plugins/AgentVerify --evidence path/to/evidence
node --test scripts/agent-verify/*.test.mjs
```

The receipt command defaults to the bundled `runtime/AgentVerify` source and the receipt's directory for artifacts. `--source` selects the actual copied plugin. It reads `source-version.json`, verifies the listed files and detects added files in `Source`, `Config`, `Resources`, `Content` and root plugin descriptors. Generated `Binaries`, `Intermediate` and `Saved` directories are outside source identity. It never writes or updates a consumer copy. Missing, changed or extra source is reported as `modified`; the receipt must identify that same observed state. A pristine claim for an altered copy fails validation.

Both commands emit `{valid, issues}` with structured `{code, path, message}` issues, and exit 0 only for valid evidence. Receipt results also contain `outcome: passed | failed | rejected | invalid`. **Exit 0 is not a successful scenario verdict.** An honestly recorded failing check can be valid evidence with `outcome: failed`. A structural or live-name refusal can be valid evidence with `outcome: rejected` and reasoned `refusal` issues. Downstream code must compare its expected outcome and declared refusal code/path, not accept an arbitrary nonzero engine exit. Crashes and timeouts are not validation refusals.

## Request and adapter boundary

All three kinds (`replay`, `shot`, `observation`) share a bounded phase document. `shot` additionally requires a capture. A smoke observation uses named numeric checks supplied by the consumer; boolean checks can expose 0 or 1. At least one metric, capture or audio check is required. A consumer owns metric names, implementations, registered command tokens and scenario data. The runtime validates every live name before delivering any action, and refuses a requested save sandbox if the adapter has no hook.

```json
{
  "schema_version": 1,
  "request_id": "move-001",
  "kind": "replay",
  "warmup": { "min_seconds": 0, "max_seconds": 30 },
  "settle": { "min_seconds": 1, "max_seconds": 30 },
  "save_sandbox": false,
  "cache": { "requested": "unclassified", "preparation": "none requested" },
  "phases": [{
    "name": "move",
    "seconds": 1,
    "measure": true,
    "actions": [
      { "at": 0, "type": "key", "key": "W", "down": true },
      { "at": 0, "type": "axis", "key": "Gamepad_LeftX", "value": 0.5 }
    ],
    "checks": [{ "id": "moving", "metric": "speed", "aggregation": "last", "min": 1, "max": 1000 }]
  }]
}
```

An action changes key/axis state or invokes one registered command token with an argument array. Actions are ordered by `at`, with `0 <= at < phase.seconds`. The command form is `{at, type:"command", token, args}`; chaining delimiters and newlines are refused. Keys and metric/command names receive structural token checks offline, then actual registry checks inside the engine. Axis state is delivered once per real frame through production simulated input, including release zeros. Declared actions are counted once; repeated per-frame axis delivery is not another scenario action. Every injected key/axis requires a zero/release cleanup event, on completion and failure. This is simulated input evidence, not physical-controller acceptance.

Each metric sample is either `{available:true,value:<finite number>}` or `{available:false,reason:<nonempty explanation>}`. Checks aggregate `last`, `mean`, `min` or `max`; any missing/unavailable sample makes that requested metric unavailable. A missing measurement is never substituted with zero. IDs are unique across metric, capture and audio checks.

## Identity and source version

`request_sha256` hashes the exact request file bytes, including whitespace and any BOM. Producer and request identity are distinct. `requestEnvelope(request, requestSha256)` preserves a valid request ID and kind; malformed/missing IDs become `invalid-<full SHA-256>`, and malformed/missing kinds become `observation`. A JSON parse failure is represented to the validator as `null`, with the exact original byte digest and the root `schema.type` issue. This permits an auditable zero-action refusal even when the original envelope is malformed. Do not use a digest of reserialized JSON when the engine read a file.

`source-version.json` contains `{schema_version:1, plugin_version, files:[{path,sha256}]}`. Hash the supplied descriptor and source bytes, with forward-slash relative paths. The manifest excludes itself to avoid a circular digest. Include every shipped input in the source scope above; use the repository's LF text policy. The receipt records the SHA-256 of the manifest bytes, its `plugin_version`, and the independently checked `pristine`/`modified` state plus changed paths.

The runtime reads the deployed manifest at execution; do not bake a future plugin release into C++. WP2 owns the initial manifest alongside its source. At delivery, release metadata updates its version and recomputes any changed source hashes. Preserve historical acceptance receipts with the manifest they actually used. A later metadata-only release adjustment does not rewrite earlier native evidence.

## Trace, measurements and eligibility

`trace` contains only scenario phase frames, in increasing frame and phase order. Each row has `frame`, `phase`, phase-local `elapsed_seconds`, **`wall_frame_ms`**, and the named `metrics` map. `wall_frame_ms` is the difference between actual monotonic wall-clock observations for successive frames; never copy simulation delta or fixed timestep into it. Warm-up, pre-scenario settle and capture hold frames are recorded separately and never enter measured summaries. Unmeasured phases still produce observations, but their timing summary is `null` and their frames count only as unmeasured.

Per-phase and total summaries contain `count`, `mean_ms`, `p95_ms`, `p99_ms`, `max_ms`. Nearest rank sorts samples and selects `ceil(p*n)-1`. The fixture 1 through 100 yields 50.5, 95, 99 and 100. Empty/non-finite sample arrays are invalid inputs to `summarize`; an explicitly unmeasured run has a null timing summary and cannot pass a performance budget. The validator recomputes every summary and check, allowing absolute/relative serialization tolerance of 1e-6.

An optional `budget` names `mode` (`hardware-targeted` or `regression-guard`), `hardware_id`, `profile`, `cache_state` (`cold` or `warm`), and thresholds `max_mean_ms`, `max_p95_ms`, `max_p99_ms`, `max_ms`. Runtime environment records observed engine, configuration, map, RHI, GPU, hardware/profile identity and resolution. Cache receipts preserve requested state/preparation, observed state/outcome and evidence. Set outcome `verified` only after observing the requested preparation; a cold label alone proves nothing. No cache flush, driver change or reboot is implicit.

`budgetEligibility` refuses observed/unknown contention, unclassified/unverified or mismatched cache state, and hardware/profile mismatch for a targeted budget. A regression guard may cross hardware but always reports its guard-only limitation. Missing samples or failed eligibility means `budget.passed:false`, never a qualified performance pass. Individual receipts do not establish suite qualification.

## Capture and audio artifacts

A phase may request `capture:{id,wait_seconds}`. After settling, hold for at least 90 **actual frames** and the requested wall duration. The settlement-completing frame is not a hold frame. `captures[].timeline` records consecutive real ticks `{frame,wall_seconds,settled,screenshot_complete}`. `evaluateCaptureHold` resets the hold when compilation resumes and discards an unsettled pending screenshot after its completion drains. The validator recomputes hold count, duration and restarts from this sequence. A successful capture requires a matching nonempty PNG artifact, settled pending interval and observed resolution. Accepted PNGs are bounded 8-bit non-interlaced gray, gray-alpha, RGB or RGBA with valid chunk CRCs, inflated scanline lengths and filter bytes. Unsupported formats fail explicitly.

A phase may request `audio:{id,min_rms_db,max_rms_db}`. Record that phase's actual master mix into its own WAV. Do not select a convenient subwindow or reuse one recording for several phases: `start_frame` must be zero and `frame_count` must cover the complete WAV. PCM16 and IEEE float32 interleaved WAVs are supported. The validator checks format, actual duration, finite samples and recomputed RMS over all recorded samples. A silence check can request the -120 dBFS floor; an expected-active check must set a higher minimum. Missing taps, short recordings and silent expected-active phases fail separately. Audio-disabled smoke can pass only if it requested no audio check. Loudness evidence does not establish listening quality.

Every artifact has a relative `path`, byte count, SHA-256 and kind. The CLI reads the bytes under the evidence directory, refuses traversal and symlinks, and recomputes hashes, PNG validity and WAV measurements. A hash in JSON is not proof of an existing artifact. Inline trace is authoritative for recomputation; any separately retained trace artifact is an additional byte-bound artifact, not a replacement for those rows.

## API for runtime tooling and downstream suites

- `validateDocument(document)` returns structured validity issues.
- `requestEnvelope(document, exactByteSha256)` derives normal or malformed-request identity.
- `validateReceipt(receipt, request, {requestSha256, expectedSource, artifacts})` validates an individual receipt. `expectedSource` is the independently checked `{plugin_version,manifest_sha256,state,modified_files}`; `artifacts` maps relative paths to bytes. Omitted expected anchors or requested bytes fail.
- `validateSourceManifest(manifest)` and `verifySourceFiles(manifest, files)` validate a manifest and compare supplied source bytes. `collectSourceFiles(root, manifest)` in `artifacts.mjs` owns safe filesystem enumeration and extra-file detection.
- `summarize`, `budgetEligibility`, `evaluateCaptureHold` are independent pure rules. `sha256` hashes exact bytes.

Refusals use `execution.stage: structural_validation | live_validation`, `reason: validation_refused`, zero action/phase/check/frame counts and empty traces/artifacts. Structural issues must match the independent document validator. Live issues use `unknown_metric`, `unknown_command`, `unknown_key` or `sandbox_unavailable`; each includes the offending document path. Runtime failures use their actual stage and a distinct reason, preserving partial evidence and input cleanup. Complete runs must have all requested phases, actions and checks; a headline verdict is recomputed from that evidence.

These validators prove internal consistency and supplied file identity. They do not attest a hostile producer or independently observe a hardware device. Native acceptance must establish that the runtime actually uses the production input path, wall clock, compile observation and master-mix tap, and the launcher must establish lifecycle ownership and uncontended execution. Keep those native checks outside the merge lane.
