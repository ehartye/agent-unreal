import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { prepare, validateManifest, KINDS, assertUnchanged } from './lib/unreal-verify/manifest.mjs';
import { execute, verifyReceipt } from './lib/unreal-verify/runner.mjs';
import { commandFor, qualifyAutomation, qualifyObservation, qualifyStep } from './lib/unreal-verify/qualification.mjs';
import { parseArguments, main } from './unreal-verify.mjs';
import { sha256, summarize, validateDocument } from './agent-verify/contracts.mjs';
import { LOCK } from './lib/unreal-run/contracts.mjs';
import { observeToolchain } from './lib/unreal-run/identity.mjs';
import { readWav, rmsDb } from './agent-verify/artifacts.mjs';
import { fixture as nativeFixture } from '../examples/unreal/verification_suite/fixture.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const read = path => JSON.parse(readFileSync(path));
const step = (id, kind = 'automation', dependencies = []) => ({ id, kind, required: true, depends_on: dependencies, timeout_seconds: 30, arguments: [], expected_count: 1, ...(kind === 'automation' ? { filter: 'Suite', expected_tests: ['Suite.Test'] } : {}), ...(['replay', 'rejected_replay', 'audio', 'capture', 'smoke'].includes(kind) ? { input: `${id}.json`, requested: {} } : {}), ...(kind === 'rejected_replay' ? { expected_refusal: [{ code: 'unknown_metric', path: '$.phases[0].checks[0].metric' }], expected_exit_code: 0 } : {}) });
const document = () => ({ schema_version: 1, request_id: 'suite-request', kind: 'replay', warmup: { min_seconds: 0, max_seconds: 3 }, settle: { min_seconds: 0, max_seconds: 3 }, save_sandbox: false, cache: { requested: 'unclassified', preparation: 'Functional check' }, phases: [{ name: 'observe', seconds: 1, measure: true, actions: [], checks: [{ id: 'ready', metric: 'ready', aggregation: 'last', min: 1, max: 1 }] }] });
const report = () => ({ succeeded: 1, succeededWithWarnings: 0, failed: 0, notRun: 0, inProcess: 0, tests: [{ fullTestPath: 'Suite.Test', state: 'Success', errors: 0, warnings: 0 }] });
function observation(doc, source, bytes) {
  const summary = summarize([10]), phase = doc.phases[0];
  return { schema_version: 1, producer: { name: 'AgentVerify', version: source.plugin_version, source }, request_id: doc.request_id, request_sha256: sha256(bytes), kind: doc.kind, success: true, reason: 'passed', environment: { engine: '5.8', configuration: 'Development', map: '/Engine/Maps/Entry', rhi: 'D3D12', gpu: 'test-device', hardware_id: 'test-hardware', profile: 'test-profile', resolution: { width: 1, height: 1 } }, cache: { ...doc.cache, state: 'unclassified', outcome: 'unclassified', evidence: 'Functional check' }, contention: 'none', execution: { stage: 'complete', phases_started: 1, phases_completed: 1, actions_executed: 0, checks_observed: 1, warmup_frames: 1, settle_frames: 1, warmup_seconds: .1, settle_seconds: .1 }, validation: { structural: true, live: true, issues: [] }, input: { released: true, keys_remaining: [], axes_remaining: [], release_events: [] }, actions: [], trace: [{ frame: 0, phase: phase.name, elapsed_seconds: 1, wall_frame_ms: 10, metrics: { ready: { available: true, value: 1 } } }], checks: [{ id: 'ready', phase: phase.name, available: true, value: 1, passed: true, reason: 'passed' }], captures: [], audio: [], timings: { measured: summary, unmeasured_frames: 0, phases: [{ name: phase.name, measured: true, summary }] }, budget: null, artifacts: [] };
}
function rejection(doc, source, bytes) {
  const r = observation(doc, source, bytes); r.success = false; r.reason = 'validation_refused'; r.environment = null; r.contention = 'unknown';
  r.execution = Object.fromEntries(Object.keys(r.execution).map(k => [k, k === 'stage' ? 'live_validation' : 0]));
  r.validation = { structural: true, live: false, issues: [{ code: 'unknown_metric', path: '$.phases[0].checks[0].metric', message: 'Metric not registered' }] };
  r.trace = []; r.checks = []; r.timings = { measured: null, unmeasured_frames: 0, phases: [] }; return r;
}
function mediaObservation(doc, source, bytes, dir) {
  const r = observation(doc, source, bytes), phase = doc.phases[0];
  if (phase.capture) {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    writeFileSync(join(dir, 'view.png'), png);
    r.captures = [{ id: 'capture', phase: phase.name, available: true, reason: 'passed', artifact: 'view.png', hold_frames: 90, hold_seconds: .9, compile_restarts: 0, pending_settled: true, timeline: Array.from({ length: 92 }, (_, frame) => ({ frame, wall_seconds: .01, settled: true, screenshot_complete: frame === 91 })) }];
    r.artifacts.push({ path: 'view.png', kind: 'screenshot', bytes: png.length, sha256: sha256(png) }); r.execution.checks_observed++;
  }
  if (phase.audio) {
    const wav = Buffer.alloc(244); wav.write('RIFF'); wav.writeUInt32LE(236, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(100, 24); wav.writeUInt32LE(200, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(200, 40); for (let i = 0; i < 100; i++) wav.writeInt16LE(8192, 44 + i * 2);
    writeFileSync(join(dir, 'audio.wav'), wav);
    r.audio = [{ id: 'audio', phase: phase.name, available: true, reason: 'passed', artifact: 'audio.wav', sample_rate: 100, channels: 1, start_frame: 0, frame_count: 100, rms_db: rmsDb(readWav(wav), 0, 100), tap: 'master-mix' }];
    r.artifacts.push({ path: 'audio.wav', kind: 'audio', bytes: wav.length, sha256: sha256(wav) }); r.execution.checks_observed++;
  }
  return r;
}
function fixture(t, steps = [step('automation')]) {
  const root = mkdtempSync(join(tmpdir(), 'unreal-suite-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project'), engine = join(root, 'engine'); mkdirSync(project); mkdirSync(engine);
  for (const relative of ['Engine/Build/Build.version', 'Engine/Binaries/Win64/UnrealEditor.exe', 'Engine/Binaries/Win64/UnrealEditor-Cmd.exe', 'Engine/Binaries/ThirdParty/DotNet/test/win-x64/dotnet.exe', 'Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.dll', 'Engine/Binaries/DotNET/AutomationTool/AutomationTool.dll']) { const path = join(engine, relative); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'fixture'); }
  write(join(project, 'Sample.uproject'), {});
  cpSync(join(repo, 'runtime/AgentVerify'), join(project, 'Plugins/AgentVerify'), { recursive: true });
  const config = join(root, 'project.json'); write(config, { version: 1, project: join(project, 'Sample.uproject'), engine, sourceRoot: project, editorTarget: 'SampleEditor', gameTarget: 'Sample', packageDirectory: join(root, 'package') });
  const manifest = join(root, 'manifest.json'); write(manifest, { schema_version: 1, steps, suites: { fixture: steps.map(s => s.id) } });
  for (const s of steps.filter(s => s.input)) { const doc = document(); if (s.kind === 'smoke' || s.kind === 'audio') doc.kind = 'observation'; if (s.kind === 'capture') { doc.kind = 'shot'; doc.phases[0].capture = { id: 'capture', wait_seconds: 0 }; } if (s.kind === 'audio') doc.phases[0].audio = { id: 'audio', min_rms_db: -40, max_rms_db: -1 }; write(join(root, s.input), doc); }
  for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Suite fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture']]) execFileSync('git', ['-C', project, ...args], { stdio: 'pipe' });
  return { root, config, manifest, prepare: () => prepare({ project: config, manifest, suite: 'fixture' }) };
}
function fakeLauncher(mutate = () => {}) {
  return async (command, prepared) => {
    const dir = dirname(command.evidence), s = prepared.plan.find(s => dir.endsWith(`-${s.id}`)); mkdirSync(command.evidence);
    const identity = pid => ({ pid, created: '133000000000000000' });
    const r = { version: 1, kind: 'unreal-run/request', id: randomUUID(), nonce: 'a'.repeat(64), purpose: 'production', lock: LOCK, state: join(dir, 'state'), node: process.execPath, controllerPid: 1, controllerCreated: '133000000000000000', ...command };
    write(join(command.evidence, 'request.json'), r); const digest = sha256(readFileSync(join(command.evidence, 'request.json')));
    const life = { version: 1, kind: 'unreal-run/lifecycle', id: r.id, requestHash: digest, operation: r.operation, purpose: 'production', lock: LOCK, controller: identity(1), helper: identity(2), gate: identity(3), probe: identity(4), processes: [1, 2, 3, 4].map(identity), started: new Date().toISOString(), finished: null, contained: true, probeContained: true, permitIssued: true, permit: { requestHash: digest, gate: identity(3) }, exitCode: 0, cancelled: false, timedOut: false, errors: [], drain: { proved: true, active: 0, members: [], requestHash: digest, observed: null } };
    if (s.kind === 'automation') { mkdirSync(join(dir, 'report')); write(join(dir, 'report/index.json'), report()); }
    else if (s.input) { mkdirSync(join(dir, 'observation')); const bytes = readFileSync(join(dir, 'input.json')), doc = JSON.parse(bytes); write(join(dir, 'observation/receipt.json'), (s.kind === 'rejected_replay' ? rejection : mediaObservation)(doc, prepared.observation_source.identity, bytes, join(dir, 'observation'))); }
    else {
      const artifact = join(command.evidence, 'product.bin'); writeFileSync(artifact, 'product');
      const stdout = 'Using Visual Studio 2022 14.44.35223 toolchain and Windows 10.0.26100.0 SDK'; writeFileSync(join(command.evidence, 'stdout.log'), stdout); writeFileSync(join(command.evidence, 'stderr.log'), '');
      write(join(command.evidence, 'identity.json'), { version: 1, kind: 'unreal-run/identity', id: r.id, requestHash: digest, operation: s.kind, source: prepared.source, engine: { buildVersionSha256: sha256('fixture'), executableSha256: sha256('fixture'), observedVersion: 'test' }, toolchain: observeToolchain(stdout + '\n'), target: { name: s.kind === 'build' ? prepared.config.editorTarget : prepared.config.gameTarget, platform: prepared.config.platform, configuration: prepared.config.configuration }, artifacts: [{ path: artifact, bytes: 7, sha256: sha256('product') }], complete: true, errors: [] });
    }
    life.drain.observed = life.finished = new Date().toISOString(); mutate({ life, dir, s, prepared }); write(join(command.evidence, 'lifecycle.json'), life);
  };
}

test('A1 deterministic DAG and all v1 kinds; invalid plans launch nothing', async t => {
  const first = step('first'), last = step('last', 'automation', ['first']);
  const f = fixture(t, [last, first]); assert.deepEqual(f.prepare().plan.map(s => s.id), ['first', 'last']);
  const m = read(f.manifest);
  for (const mutate of [m => m.steps.push(m.steps[0]), m => m.steps[0].depends_on = ['absent'], m => m.steps[1].depends_on = ['last'], m => m.steps[0].kind = 'script_test', m => m.steps[0].expected_count = 0, m => m.steps[0].expected_count = 1.5, m => m.steps[0].command = 'arbitrary', m => m.suites.fixture = [], m => m.steps[0].arguments.push('-ReportExportPath=old')]) {
    const bad = structuredClone(m); mutate(bad); write(f.manifest, bad); let launched = 0;
    await assert.rejects(async () => execute(f.prepare(), join(f.root, randomUUID()), { launch: async () => { launched++; } })); assert.equal(launched, 0);
  }
  const all = KINDS.map(kind => step(kind.replaceAll('_', '-'), kind));
  assert.equal(validateManifest({ schema_version: 1, steps: all, suites: { all: all.map(s => s.id) } }, 'all').length, 8);
});
test('CLI validates read-only, refuses unknown/test-double options, and cannot erase required rows', async t => {
  const f = fixture(t); const before = readFileSync(f.manifest); const output = [];
  assert.equal(await main(['--project', f.config, '--manifest', f.manifest, '--suite', 'fixture', '--validate-only'], v => output.push(v)), 0);
  assert.deepEqual(readFileSync(f.manifest), before); assert.equal(output[0].plan.length, 1);
  for (const args of [['--mock'], ['--verify-receipt', 'x', '--suite', 'y'], ['--project', 'x'], ['--help', '--mock']]) assert.throws(() => parseArguments(args));
  const out = join(f.root, 'run'), result = await execute(f.prepare(), out, { launch: fakeLauncher() }); assert.equal(result.qualified, true, JSON.stringify(result));
  assert.equal(verifyReceipt(join(out, 'regression.json')).qualified, true);
  result.steps = []; write(join(out, 'regression.json'), result); assert.throws(() => verifyReceipt(join(out, 'regression.json')), /Missing/);
});
test('A2 false automation headlines/counts/empty/skipped/name mismatches refuse', () => {
  assert.equal(qualifyAutomation(report(), step('a')).valid, true);
  for (const mutate of [r => r.tests = [], r => r.succeeded = 0, r => r.failed = -1, r => r.succeededWithWarnings = null, r => r.inProcess = 1, r => r.tests[0].state = 'Skipped', r => r.tests[0].errors = 1, r => r.tests[0].fullTestPath = 'Other', r => r.tests.push(r.tests[0])]) { const r = report(); mutate(r); assert.equal(qualifyAutomation(r, step('a')).valid, false); }
});
test('A2 missing/stale reports and incomplete drain never pass; unknown halts independent dispatch', async t => {
  for (const mode of ['missing', 'stale', 'drain', 'request', 'purpose', 'timeout', 'cancel']) {
    const f = fixture(t, [step('one'), step('dependent', 'automation', ['one']), step('independent')]); let launches = 0;
    const adapter = fakeLauncher(({ dir, life, s }) => { if (s.id !== 'one') return; if (mode === 'missing') rmSync(join(dir, 'report/index.json')); if (mode === 'stale') utimesSync(join(dir, 'report/index.json'), new Date(0), new Date(0)); if (mode === 'drain') life.drain.proved = false; if (mode === 'request') life.requestHash = 'b'.repeat(64); if (mode === 'purpose') life.purpose = 'fixture'; if (mode === 'timeout') life.timedOut = true; if (mode === 'cancel') life.cancelled = true; });
    const result = await execute(f.prepare(), join(f.root, 'run'), { launch: async (...args) => { launches++; await adapter(...args); } });
    assert.equal(result.qualified, false); assert.equal(result.steps.length, 3);
    assert.equal(launches, ['drain', 'request', 'purpose', 'cancel'].includes(mode) ? 1 : 2, mode);
    assert.equal(result.steps[0].status, mode === 'timeout' ? 'timed_out' : mode === 'cancel' ? 'cancelled' : ['drain', 'request', 'purpose'].includes(mode) ? 'unknown' : 'failed');
  }
});
test('A2 exact observation source, request, finite measurements and requested conditions bind qualification', t => {
  const f = fixture(t, [step('replay', 'replay')]), p = f.prepare(), bytes = readFileSync(p.inputs.replay.path), doc = JSON.parse(bytes), options = { requestSha256: sha256(bytes), expectedSource: p.observation_source.identity, artifacts: {} }, s = p.plan[0];
  const original = observation(doc, options.expectedSource, bytes); assert.equal(qualifyObservation(original, doc, s, options).valid, true);
  for (const mutate of [r => r.success = false, r => r.schema_version = 2, r => r.request_sha256 = 'c'.repeat(64), r => r.producer.source.manifest_sha256 = 'd'.repeat(64), r => r.checks = [], r => r.trace[0].wall_frame_ms = Infinity, r => r.trace[0].metrics.ready.value = NaN, r => r.checks[0].passed = false, r => r.execution.checks_observed = 0]) { const r = structuredClone(original); mutate(r); assert.equal(qualifyObservation(r, doc, s, options).valid, false); }
  for (const requested of [{ hardware_id: 'other' }, { rhi: 'other' }, { resolution: { width: 2, height: 2 } }, { gpu: 'other' }, { configuration: 'Shipping' }]) assert.equal(qualifyObservation(original, doc, { ...s, requested }, options).valid, false);
});
test('A3 only exact declared refusal at expected engine exit passes', async t => {
  for (const mode of ['exact', 'crash', 'unrelated', 'empty', 'success', 'wrong-exit']) {
    const f = fixture(t, [step('reject', 'rejected_replay')]);
    const result = await execute(f.prepare(), join(f.root, 'run'), { launch: fakeLauncher(({ dir, life, prepared }) => {
      const file = join(dir, 'observation/receipt.json'), r = read(file);
      if (mode === 'crash') { life.exitCode = 3; rmSync(file); }
      if (mode === 'wrong-exit') life.exitCode = 1;
      if (mode === 'unrelated') { r.validation.issues[0].code = 'unknown_command'; write(file, r); }
      if (mode === 'empty') write(file, {});
      if (mode === 'success') { const bytes = readFileSync(join(dir, 'input.json')); write(file, observation(JSON.parse(bytes), prepared.observation_source.identity, bytes)); }
    }) });
    assert.equal(result.qualified, mode === 'exact', `${mode}: ${JSON.stringify(result)}`);
  }
});
test('A3 prevalidation fixture claims no runtime conditions; requested evidence and zero actions remain mandatory', t => {
  const definition = nativeFixture({ compiler: 'test-compiler', sdk: 'test-sdk' });
  const rejected = definition.manifest.steps.find(s => s.kind === 'rejected_replay');
  const replay = definition.manifest.steps.find(s => s.kind === 'replay');
  assert.deepEqual(rejected.requested, {});
  assert.deepEqual(replay.requested, { configuration: 'Development', resolution: { width: 640, height: 360 } });
  const f = fixture(t, [step('reject', 'rejected_replay')]), p = f.prepare();
  const doc = definition.inputs[rejected.input], bytes = Buffer.from(JSON.stringify(doc));
  const options = { requestSha256: sha256(bytes), expectedSource: p.observation_source.identity, artifacts: {} };
  const receipt = rejection(doc, options.expectedSource, bytes);
  assert.equal(qualifyObservation(receipt, doc, rejected, options).valid, true);
  for (const requested of [{ configuration: 'Development' }, { resolution: { width: 640, height: 360 } }, { rhi: 'D3D12' }, { hardware_id: 'test-hardware' }]) {
    const result = qualifyObservation(receipt, doc, { ...rejected, requested }, options);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.startsWith('Requested ')));
  }
  for (const key of ['actions_executed', 'phases_started', 'checks_observed']) {
    const executed = structuredClone(receipt); executed.execution[key] = 1;
    assert.equal(qualifyObservation(executed, doc, rejected, options).valid, false, key);
  }
});

test('dispatch rechecks immutable inputs; retained verification detects evidence tamper and changed plan', async t => {
  const f = fixture(t), p = f.prepare(); write(f.manifest, { ...read(f.manifest), schema_version: 2 }); let launches = 0;
  const refused = await execute(p, join(f.root, 'changed'), { launch: async () => { launches++; } }); assert.equal(launches, 0); assert.equal(refused.qualified, false);
  const g = fixture(t), out = join(g.root, 'run'); await execute(g.prepare(), out, { launch: fakeLauncher() });
  write(join(out, '000-automation/report/index.json'), { ...report(), succeeded: 0 });
  const checked = verifyReceipt(join(out, 'regression.json')); assert.equal(checked.qualified, false); assert.ok(checked.errors.some(e => e.includes('bytes changed')));
});
test('build and package use both identity and existing product bytes', async t => {
  for (const kind of ['build', 'package']) {
    const f = fixture(t, [step(kind, kind)]), out = join(f.root, 'run'); const result = await execute(f.prepare(), out, { launch: fakeLauncher() });
    assert.equal(result.qualified, true, JSON.stringify(result)); assert.equal(verifyReceipt(join(out, 'regression.json')).qualified, true);
    writeFileSync(join(out, `000-${kind}/launcher/product.bin`), 'changed'); assert.equal(verifyReceipt(join(out, 'regression.json')).qualified, false);
  }
});
test('retained verification refuses malformed result shapes, invalid intervals and overlapping dispatch', async t => {
  const f = fixture(t, [step('one'), step('two')]), out = join(f.root, 'run'), file = join(out, 'regression.json');
  const original = await execute(f.prepare(), out, { launch: fakeLauncher() }); assert.equal(original.qualified, true);
  for (const mutate of [r => r.started = 'not-a-time', r => r.finished = null, r => r.errors = {}, r => r.errors = [42], r => r.steps[0].errors = 'none', r => r.steps[0].evidence = null, r => r.steps[0].checks_run = -1, r => r.steps[0].started = 'not-a-time', r => r.steps[0].finished = 'not-a-time', r => r.steps[0].finished = new Date(0).toISOString(), r => r.steps[0].started = 123, r => r.steps[0] = null]) {
    const changed = structuredClone(original); mutate(changed); write(file, changed); assert.throws(() => verifyReceipt(file));
  }
  const overlapping = structuredClone(original);
  overlapping.steps[1].started = new Date(Date.parse(overlapping.steps[0].finished) - 1).toISOString(); write(file, overlapping);
  const checked = verifyReceipt(file); assert.equal(checked.qualified, false); assert.ok(checked.errors.some(error => error.includes('Overlapping')));
});
test('smoke uses AgentVerify checks; capture and audio require their actual artifacts', async t => {
  const smoke = fixture(t, [step('smoke', 'smoke')]); assert.equal((await execute(smoke.prepare(), join(smoke.root, 'run'), { launch: fakeLauncher() })).qualified, true);
  for (const kind of ['capture', 'audio']) {
    const s = { ...step(kind, kind), expected_count: 2 }, f = fixture(t, [s]); assert.equal(f.prepare().plan[0].kind, kind);
    const out = join(f.root, 'run'), result = await execute(f.prepare(), out, { launch: fakeLauncher() });
    assert.equal(result.qualified, true, JSON.stringify(result.steps));
    rmSync(join(out, `000-${kind}/observation`, kind === 'capture' ? 'view.png' : 'audio.wav'));
    assert.equal(verifyReceipt(join(out, 'regression.json')).qualified, false);
  }
});
