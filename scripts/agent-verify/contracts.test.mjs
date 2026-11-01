import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { validateDocument, validateReceipt, validateSourceManifest, verifySourceFiles, summarize, budgetEligibility, sha256, evaluateCaptureHold, requestEnvelope } from './contracts.mjs';
import { readArtifact, readWav, rmsDb, safeRelativePath, pngDimensions } from './artifacts.mjs';

const source = { plugin_version: '0.0.0-fixture', manifest_sha256: 'a'.repeat(64), state: 'pristine', modified_files: [] };
function request() {
  return { schema_version: 1, request_id: 'fixture-1', kind: 'replay', warmup: { min_seconds: 0, max_seconds: 3 }, settle: { min_seconds: 0.01, max_seconds: 3 }, save_sandbox: false, cache: { requested: 'warm', preparation: 'scenario warm-up' }, phases: [{ name: 'move', seconds: 1, measure: true, actions: [{ at: 0, type: 'key', key: 'W', down: true }, { at: 0, type: 'axis', key: 'Gamepad_LeftX', value: 1 }], checks: [{ id: 'speed', metric: 'speed', aggregation: 'last', min: 6, max: 8 }] }] };
}
function receipt(doc) {
  const trace = doc.phases.flatMap((phase, phaseIndex) => Array.from({ length: 100 }, (_, i) => ({ frame: phaseIndex * 100 + i, phase: phase.name, elapsed_seconds: phase.seconds * (i + 1) / 100, wall_frame_ms: i + 1, metrics: { speed: { available: true, value: 7 } } })));
  return { schema_version: 1, producer: { name: 'AgentVerify', version: source.plugin_version, source: structuredClone(source) }, request_id: doc.request_id, request_sha256: sha256(JSON.stringify(doc)), kind: doc.kind, success: true, reason: 'passed', environment: { engine: '5.8', configuration: 'Development', map: '/Engine/Maps/Entry', rhi: 'D3D12', gpu: 'fixture-device', hardware_id: 'fixture-hardware', profile: 'fixture-profile', resolution: { width: 1, height: 1 } }, cache: { ...doc.cache, state: 'warm', outcome: 'verified', evidence: 'bounded warm-up completed' }, contention: 'none', execution: { stage: 'complete', phases_started: doc.phases.length, phases_completed: doc.phases.length, actions_executed: doc.phases.reduce((n, phase) => n + phase.actions.length, 0), checks_observed: doc.phases.reduce((n, phase) => n + phase.checks.length, 0), warmup_frames: 1, settle_frames: 1, warmup_seconds: 0.01, settle_seconds: 0.01 }, validation: { structural: true, live: true, issues: [] }, input: { released: true, keys_remaining: [], axes_remaining: [], release_events: [{ key: 'W', type: 'key', value: 0 }, { key: 'Gamepad_LeftX', type: 'axis', value: 0 }] }, actions: doc.phases.flatMap((phase, index) => phase.actions.map((action, i) => ({ phase: phase.name, index: i, frame: index * 100 }))), trace, checks: doc.phases.flatMap((phase) => phase.checks.map((check) => ({ id: check.id, phase: phase.name, available: true, value: 7, passed: true, reason: 'passed' }))), captures: [], audio: [], timings: { measured: summarize(trace.filter((row) => doc.phases.find((phase) => phase.name === row.phase).measure).map((row) => row.wall_frame_ms)), unmeasured_frames: trace.filter((row) => !doc.phases.find((phase) => phase.name === row.phase).measure).length, phases: doc.phases.map((phase) => ({ name: phase.name, measured: phase.measure, summary: phase.measure ? summarize(trace.filter((row) => row.phase === phase.name).map((row) => row.wall_frame_ms)) : null })) }, budget: null, artifacts: [] };
}
function check(rec, doc, options = {}) { return validateReceipt(rec, doc, { requestSha256: sha256(JSON.stringify(doc)), expectedSource: source, ...options }); }
function code(value, expected) { assert.equal(value.valid, false); assert.ok(value.issues.some((issue) => issue.code === expected), JSON.stringify(value)); }
const budget = { mode: 'hardware-targeted', hardware_id: 'fixture-hardware', profile: 'fixture-profile', cache_state: 'warm', max_mean_ms: 60, max_p95_ms: 96, max_p99_ms: 99, max_ms: 100 };

test('nearest-rank statistics: exact 1..100, one sample, small boundaries and invalid samples', () => {
  assert.deepEqual(summarize(Array.from({ length: 100 }, (_, i) => i + 1)), { count: 100, mean_ms: 50.5, p95_ms: 95, p99_ms: 99, max_ms: 100 });
  assert.deepEqual(summarize([7]), { count: 1, mean_ms: 7, p95_ms: 7, p99_ms: 7, max_ms: 7 });
  assert.equal(summarize(Array.from({ length: 20 }, (_, i) => i + 1)).p95_ms, 19);
  for (const samples of [[], [NaN], [Infinity], [-1], ['1']]) assert.throws(() => summarize(samples));
});

test('document contracts refuse malformed/unknown-version/ambiguous or vacuous scenarios before actions', () => {
  assert.equal(validateDocument(request()).valid, true);
  for (const [change, expected] of [
    [d => d.schema_version = 2, 'schema.const'], [d => d.unrecognized = true, 'schema.unknown'],
    [d => d.phases = [], 'schema.count'], [d => d.phases[0].seconds = Infinity, 'schema.type'],
    [d => d.phases[0].seconds = 0, 'schema.minimum'], [d => d.phases[0].measure = 'false', 'schema.type'],
    [d => d.phases[0].actions[0].at = 1, 'document.action_time'], [d => d.phases[0].checks[0].min = 9, 'document.check_range'],
    [d => d.warmup.min_seconds = 4, 'document.stage_bounds'], [d => d.phases.push(structuredClone(d.phases[0])), 'document.duplicate_phase'],
    [d => d.phases[0].checks.push(structuredClone(d.phases[0].checks[0])), 'document.duplicate_check'],
    [d => d.phases[0].checks = [], 'document.no_observations'], [d => d.kind = 'shot', 'document.shot_missing'],
    [d => d.phases[0].checks[0].metric = 'frame.p95', 'document.reserved_metric'],
    [d => { d.budget = budget; d.phases[0].measure = false; }, 'document.unmeasured_budget'],
    [d => { d.budget = { ...budget, cache_state: 'cold' }; }, 'document.cache_request'],
    [d => d.phases[0].actions = [{ at: 0, type: 'command', token: 'cmd;quit', args: [] }], 'schema.union'],
  ]) { const doc = request(); change(doc); code(validateDocument(doc), expected); }
});

test('receipt recomputes phase/run statistics, checks, input release and source/request identity', () => {
  const doc = request(), rec = receipt(doc);
  assert.deepEqual(check(rec, doc), { valid: true, issues: [], outcome: 'passed' });
  for (const [change, expected] of [
    [r => delete r.trace, 'schema.required'], [r => r.schema_version = 2, 'schema.const'],
    [r => r.request_id = 'other', 'receipt.request_identity'], [r => r.request_sha256 = 'b'.repeat(64), 'receipt.request_digest'],
    [r => r.producer.source.manifest_sha256 = 'b'.repeat(64), 'receipt.source_anchor'],
    [r => r.trace = [], 'receipt.truncated_phase'], [r => r.trace[0].wall_frame_ms = 100, 'receipt.trace_statistics'],
    [r => r.timings.measured.p95_ms = 96, 'receipt.trace_statistics'], [r => r.checks = [], 'receipt.check_disagreement'],
    [r => r.checks.push(structuredClone(r.checks[0])), 'receipt.check_count'],
    [r => r.trace.at(-1).metrics.speed.value = 20, 'receipt.check_disagreement'],
    [r => r.execution.checks_observed = 0, 'receipt.observed_count'], [r => r.execution.phases_completed = 0, 'receipt.phase_count'],
    [r => r.actions = [], 'receipt.action_count'], [r => r.actions[0].index = 12, 'receipt.action_identity'],
    [r => r.input.released = false, 'receipt.input_not_released'], [r => r.input.release_events = [], 'receipt.input_release_evidence'],
    [r => r.trace[1].frame = 0, 'receipt.trace_order'], [r => r.trace[1].elapsed_seconds = 0, 'receipt.trace_order'],
    [r => r.environment = null, 'receipt.environment_missing'], [r => r.validation.live = false, 'receipt.validation_missing'],
    [r => r.execution.stage = 'runtime', 'receipt.incomplete_success'], [r => r.timings.unmeasured_frames = 2, 'receipt.unmeasured_count'],
    [r => r.success = false, 'receipt.verdict_disagreement'], [r => r.execution.warmup_frames = 0, 'receipt.stage_frames'],
  ]) { const changed = structuredClone(rec); change(changed); code(check(changed, doc), expected); }
  code(validateReceipt(rec, doc), 'receipt.request_digest');
  code(validateReceipt(rec, doc, { requestSha256: rec.request_sha256 }), 'receipt.source_anchor');
});

test('unavailable measurements are explicit failures; no zero-valued success substitution', () => {
  const doc = request(), rec = receipt(doc);
  rec.trace[0].metrics.speed = { available: false, reason: 'adapter unavailable' };
  rec.checks[0] = { id: 'speed', phase: 'move', available: false, value: null, passed: false, reason: 'metric_unavailable' };
  rec.success = false; rec.reason = 'checks_failed';
  assert.equal(check(rec, doc).outcome, 'failed');
  rec.success = true; rec.reason = 'passed'; code(check(rec, doc), 'receipt.verdict_disagreement');
  rec.trace[0].metrics.speed = { available: false, value: 0 }; code(check(rec, doc), 'schema.union');
});

test('unmeasured settle phases contribute no timing samples', () => {
  const doc = request(); doc.phases.unshift({ name: 'settle-scene', seconds: 0.2, measure: false, actions: [], checks: [] });
  const rec = receipt(doc);
  assert.equal(check(rec, doc).valid, true);
  assert.equal(rec.timings.measured.count, 100); assert.equal(rec.timings.unmeasured_frames, 100);
  rec.timings.phases[0].summary = summarize([1]); code(check(rec, doc), 'receipt.timing_unmeasured');
});

test('hardware/cache/contention control eligibility, cross-hardware regression guards retain limitation', () => {
  const doc = request(); doc.budget = budget;
  const rec = receipt(doc);
  const eligibility = budgetEligibility(budget, rec.environment, rec.cache, rec.contention);
  rec.budget = { ...eligibility, passed: true };
  assert.equal(check(rec, doc).valid, true);
  for (const [change, reason] of [
    [r => r.environment.hardware_id = 'other', 'hardware_profile_mismatch'], [r => r.environment.profile = 'other', 'hardware_profile_mismatch'],
    [r => r.cache.state = 'unclassified', 'cache_unqualified'], [r => r.cache.outcome = 'unclassified', 'cache_unqualified'],
    [r => r.cache.state = 'cold', 'cache_unqualified'], [r => r.contention = 'observed', 'contention_unresolved'], [r => r.contention = 'unknown', 'contention_unresolved'],
  ]) {
    const changed = structuredClone(rec); change(changed);
    assert.ok(budgetEligibility(budget, changed.environment, changed.cache, changed.contention).reasons.includes(reason));
    code(check(changed, doc), 'receipt.budget_disagreement');
  }
  const guard = { ...budget, mode: 'regression-guard' };
  assert.deepEqual(budgetEligibility(guard, { ...rec.environment, hardware_id: 'other' }, rec.cache, 'none'), { eligible: true, reasons: [], limitation: 'cross_hardware_regression_guard_only' });
});

function rejection(doc, stage) {
  const rec = receipt(request()); rec.request_id = doc.request_id; rec.request_sha256 = sha256(JSON.stringify(doc)); rec.kind = doc.kind;
  rec.success = false; rec.reason = 'validation_refused'; rec.environment = null;
  rec.execution = Object.fromEntries(Object.entries(rec.execution).map(([key]) => [key, key === 'stage' ? stage : 0]));
  rec.validation = { structural: stage !== 'structural_validation', live: false, issues: stage === 'structural_validation' ? validateDocument(doc).issues : [{ code: 'unknown_metric', path: '$.phases[0].checks[0].metric', message: 'metric not registered' }] };
  rec.actions = []; rec.trace = []; rec.checks = []; rec.timings = { measured: null, unmeasured_frames: 0, phases: [] }; rec.input.release_events = [];
  return rec;
}
test('validation refusal is separate from success, requires matching reasons and zero actions; crashes do not count', () => {
  const doc = request(); doc.schema_version = 2;
  const rec = rejection(doc, 'structural_validation'); assert.equal(check(rec, doc).outcome, 'rejected');
  rec.execution.actions_executed = 1; code(check(rec, doc), 'receipt.validation_actions');
  const valid = request(), live = rejection(valid, 'live_validation'); assert.equal(check(live, valid).outcome, 'rejected');
  live.validation.issues[0].code = 'crash'; code(check(live, valid), 'receipt.validation_code');
  for (const malformed of [null, {}, { request_id: 23, kind: 'other' }]) {
    const digest = sha256(JSON.stringify(malformed)), envelope = requestEnvelope(malformed, digest), invalid = rejection({ ...envelope, schema_version: 2 }, 'structural_validation');
    invalid.request_sha256 = digest; invalid.validation.issues = validateDocument(malformed).issues;
    assert.equal(validateReceipt(invalid, malformed, { requestSha256: digest, expectedSource: source }).outcome, 'rejected');
  }
});

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
function timeline() { return Array.from({ length: 92 }, (_, frame) => ({ frame, wall_seconds: 0.01, settled: true, screenshot_complete: frame === 91 })); }
function attachCapture(doc, rec) {
  doc.kind = 'shot'; doc.phases[0].capture = { id: 'view', wait_seconds: 0 };
  rec.kind = 'shot'; rec.request_sha256 = sha256(JSON.stringify(doc)); rec.execution.checks_observed++;
  rec.captures = [{ id: 'view', phase: 'move', available: true, reason: 'passed', artifact: 'view.png', hold_frames: 90, hold_seconds: 0.9, compile_restarts: 0, pending_settled: true, timeline: timeline() }];
  rec.artifacts = [{ path: 'view.png', kind: 'screenshot', bytes: png.length, sha256: sha256(png) }];
}
test('capture counts 90 real settled frames, resets compilation and discards unsettled pending screenshot', () => {
  const options = { minSettleSeconds: 0.01, waitSeconds: 0 };
  assert.equal(evaluateCaptureHold(timeline(), options).complete, true);
  const longDelta = timeline().slice(0, 3).map(row => ({ ...row, wall_seconds: 100 }));
  assert.equal(evaluateCaptureHold(longDelta, options).hold_frames, 2);
  const resumed = timeline(); resumed[40].settled = false; resumed.at(-1).screenshot_complete = false;
  assert.equal(evaluateCaptureHold(resumed, options).complete, false); assert.equal(evaluateCaptureHold(resumed, options).compile_restarts, 1);
  const pending = timeline(); pending.at(-1).settled = false;
  assert.equal(evaluateCaptureHold(pending, options).complete, false); assert.equal(evaluateCaptureHold(pending, options).hold_frames, 0);
  const doc = request(), rec = receipt(doc); attachCapture(doc, rec);
  assert.equal(check(rec, doc, { artifacts: { 'view.png': png } }).valid, true);
  code(check(rec, doc), 'receipt.artifact_missing_or_tampered');
  rec.captures[0].hold_frames = 900; code(check(rec, doc, { artifacts: { 'view.png': png } }), 'receipt.capture_timeline');
});

function wav(amplitude = 0.5, frames = 100) {
  const bytes = Buffer.alloc(44 + frames * 2); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(100, 24); bytes.writeUInt32LE(200, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) bytes.writeInt16LE(Math.round(amplitude * 32767), 44 + i * 2);
  return bytes;
}
function attachAudio(doc, rec, bytes) {
  doc.phases[0].audio = { id: 'mix', min_rms_db: -8, max_rms_db: -4 }; rec.request_sha256 = sha256(JSON.stringify(doc)); rec.execution.checks_observed++;
  rec.audio = [{ id: 'mix', phase: 'move', available: true, reason: 'passed', artifact: 'mix.wav', start_frame: 0, frame_count: 100, sample_rate: 100, channels: 1, rms_db: rmsDb(readWav(bytes), 0, 100), tap: 'master-mix' }];
  rec.artifacts = [{ path: 'mix.wav', kind: 'audio', bytes: bytes.length, sha256: sha256(bytes) }];
}
test('audio uses verified WAV samples and refuses missing tap, truncation and silently forged active windows', () => {
  const doc = request(), rec = receipt(doc), bytes = wav(); attachAudio(doc, rec, bytes);
  assert.equal(check(rec, doc, { artifacts: { 'mix.wav': bytes } }).valid, true);
  const silent = wav(0); rec.artifacts[0].sha256 = sha256(silent); rec.audio[0].rms_db = -120;
  code(check(rec, doc, { artifacts: { 'mix.wav': silent } }), 'receipt.audio_disagreement');
  rec.audio[0].reason = 'expectation_failed'; rec.success = false; rec.reason = 'checks_failed';
  assert.equal(check(rec, doc, { artifacts: { 'mix.wav': silent } }).outcome, 'failed');
  rec.audio[0].tap = 'unavailable'; code(check(rec, doc, { artifacts: { 'mix.wav': silent } }), 'receipt.audio_tap');
  assert.throws(() => readWav(bytes.subarray(0, -2)), /truncated/);
  assert.throws(() => rmsDb(readWav(bytes), 0, 101), /truncated/);
  rec.audio[0].tap = 'master-mix'; rec.audio[0].frame_count = 50; code(check(rec, doc, { artifacts: { 'mix.wav': silent } }), 'receipt.audio_window');
  const short = wav(0, 50); rec.artifacts[0].bytes = short.length; rec.artifacts[0].sha256 = sha256(short); code(check(rec, doc, { artifacts: { 'mix.wav': short } }), 'receipt.audio_truncated');
  rec.audio[0] = { ...rec.audio[0], available: false, artifact: null, rms_db: null, reason: 'audio_tap_unavailable', tap: 'unavailable' }; rec.artifacts = [];
  assert.equal(check(rec, doc).outcome, 'failed');
});

test('PNG artifact boundary rejects header-only, truncated, bad CRC and invalid image payloads', () => {
  assert.deepEqual(pngDimensions(png), { width: 1, height: 1 });
  assert.throws(() => pngDimensions(Buffer.concat([png.subarray(0, 33), png.subarray(-12)])), /truncated/);
  assert.throws(() => pngDimensions(png.subarray(0, -1)), /truncated/);
  const corrupt = Buffer.from(png); corrupt[41] ^= 1; assert.throws(() => pngDimensions(corrupt), /crc/);
  const chunk = (payload) => {
    const bytes = Buffer.alloc(payload.length + 12); bytes.writeUInt32BE(payload.length); bytes.write('IDAT', 4); payload.copy(bytes, 8);
    let crc = -1;
    for (const byte of bytes.subarray(4, -4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
    bytes.writeUInt32BE((crc ^ -1) >>> 0, bytes.length - 4); return bytes;
  };
  const image = (payload) => Buffer.concat([png.subarray(0, 33), chunk(payload), png.subarray(-12)]);
  for (const payload of [Buffer.alloc(0), Buffer.from('not deflate'), deflateSync(Buffer.from([0]))]) assert.throws(() => pngDimensions(image(payload)), /pixels_invalid/);
  assert.throws(() => pngDimensions(image(deflateSync(Buffer.from([5, 0, 0])))), /filter_invalid/);
});

test('source copies expose changes and cannot use unsafe or duplicate paths', () => {
  const bytes = Buffer.from('source'), manifest = { schema_version: 1, plugin_version: '0.0.0-fixture', files: [{ path: 'Source/Probe.cpp', sha256: sha256(bytes) }] };
  assert.equal(verifySourceFiles(manifest, { 'Source/Probe.cpp': bytes }).state, 'pristine');
  assert.deepEqual(verifySourceFiles(manifest, { 'Source/Probe.cpp': Buffer.from('modified') }).modified_files, ['Source/Probe.cpp']);
  const bad = structuredClone(manifest); bad.files[0].path = '../elsewhere'; code(validateSourceManifest(bad), 'source.path');
  manifest.files.push({ ...manifest.files[0], path: 'source/probe.cpp' }); code(validateSourceManifest(manifest), 'source.duplicate');
});

test('CLI and filesystem boundaries validate fresh artifacts, preserve unrelated files and reject traversal/missing/tampered evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-verify-contract-'));
  try {
    mkdirSync(join(dir, 'plugin')); const sourceBytes = Buffer.from('fixture source'); writeFileSync(join(dir, 'plugin', 'Probe.cpp'), sourceBytes);
    const manifest = { schema_version: 1, plugin_version: source.plugin_version, files: [{ path: 'Probe.cpp', sha256: sha256(sourceBytes) }] }, manifestBytes = Buffer.from(JSON.stringify(manifest));
    writeFileSync(join(dir, 'plugin', 'source-version.json'), manifestBytes);
    const doc = request(), rec = receipt(doc); attachCapture(doc, rec); rec.producer.source.manifest_sha256 = sha256(manifestBytes);
    writeFileSync(join(dir, 'request.json'), JSON.stringify(doc)); writeFileSync(join(dir, 'receipt.json'), JSON.stringify(rec)); writeFileSync(join(dir, 'view.png'), png); writeFileSync(join(dir, 'unrelated.txt'), 'keep');
    const cli = fileURLToPath(new URL('./validate.mjs', import.meta.url)), env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env });
    assert.equal(run(['document', join(dir, 'request.json')]).status, 0);
    const args = ['receipt', join(dir, 'receipt.json'), '--request', join(dir, 'request.json'), '--source', join(dir, 'plugin')];
    const valid = run(args); assert.equal(valid.status, 0, valid.stdout + valid.stderr); assert.equal(JSON.parse(valid.stdout).outcome, 'passed');
    mkdirSync(join(dir, 'plugin', 'Source')); writeFileSync(join(dir, 'plugin', 'Source', 'Extra.cpp'), 'new source');
    const modified = run(args); assert.equal(modified.status, 1); code(JSON.parse(modified.stdout), 'receipt.source_anchor');
    rec.producer.source.state = 'modified'; rec.producer.source.modified_files = ['Source/Extra.cpp']; writeFileSync(join(dir, 'receipt.json'), JSON.stringify(rec));
    assert.equal(run(args).status, 0); assert.equal(readFileSync(join(dir, 'plugin', 'Source', 'Extra.cpp'), 'utf8'), 'new source');
    writeFileSync(join(dir, 'view.png'), Buffer.from('tampered')); const bad = run(args); assert.equal(bad.status, 1); code(JSON.parse(bad.stdout), 'receipt.artifact_missing_or_tampered');
    assert.equal(readFileSync(join(dir, 'unrelated.txt'), 'utf8'), 'keep');
    for (const path of ['../escape','/absolute','C:/absolute','a\\b','a/../b','a//b','file:stream','trailing.']) { assert.equal(safeRelativePath(path), false); assert.throws(() => readArtifact(dir, path)); }
    assert.throws(() => readArtifact(dir, 'missing'));
    mkdirSync(join(dir, 'target')); symlinkSync(join(dir, 'target'), join(dir, 'link'), 'junction'); assert.throws(() => readArtifact(dir, 'link/file'));
    writeFileSync(join(dir, 'invalid.json'), '{'); assert.equal(run(['document', join(dir, 'invalid.json')]).status, 1);
    assert.equal(run(['receipt', join(dir, 'receipt.json')]).status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
