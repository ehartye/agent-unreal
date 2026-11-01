import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { setup } from './setup.mjs';
import { scenarios } from './scenarios.mjs';
import { judgeScenario, shortenRecording, validateBuildEvidence } from './acceptance.mjs';
import { sourceIdentity, observeToolchain } from '../../../scripts/lib/unreal-run/identity.mjs';
import { operationCommand } from '../../../scripts/lib/unreal-run/controller.mjs';
import { LOCK } from '../../../scripts/lib/unreal-run/contracts.mjs';
import { verifyComparison } from './comparison.mjs';
import { validateDocument, sha256 } from '../../../scripts/agent-verify/contracts.mjs';
import { readWav } from '../../../scripts/agent-verify/artifacts.mjs';

test('sample setup refuses an existing project without changing its files', () => {
  const folder = mkdtempSync(join(tmpdir(), 'observation-setup-'));
  try { writeFileSync(join(folder, 'keep.txt'), 'owned elsewhere'); assert.throws(() => setup({ project: folder, engine: folder, compiler: '1.2.3', sdk: '10.0.1.0' }), /already exists/); assert.equal(readFileSync(join(folder, 'keep.txt'), 'utf8'), 'owned elsewhere'); }
  finally { rmSync(folder, { recursive: true, force: true }); }
});

test('public sample documents prevalidate; deliberate refusal names its exact structural issue', () => {
  for (const scenario of scenarios()) {
    const result = validateDocument(scenario.document);
    if (scenario.id === 'invalid-version') assert.deepEqual(result.issues.map(({ code, path }) => ({ code, path })), [scenario.refusal]);
    else assert.equal(result.valid, true, `${scenario.id}: ${JSON.stringify(result.issues)}`);
  }
});

test('sample verdict refuses retained gameplay input and arbitrary rejection despite headline outcome', () => {
  const scenario = scenarios().find((item) => item.id === 'unknown-command');
  const observed = { receipt: { execution: { actions_executed: 0 } }, validation: { valid: true, outcome: 'rejected', refusal: [scenario.refusal] } };
  const adapter = { pawn_available: true, post_completion_frames: 4, axis_after_release: 0, key_held_after_release: false, commands: 0, presses: 0 };
  assert.equal(judgeScenario(scenario, observed, adapter).passed, true);
  assert.equal(judgeScenario(scenario, observed, { ...adapter, axis_after_release: .5 }).passed, false);
  assert.equal(judgeScenario(scenario, { ...observed, validation: { ...observed.validation, refusal: [{ code: 'crash', path: '$' }] } }, adapter).passed, false);
  assert.equal(judgeScenario(scenario, { ...observed, receipt: { execution: { actions_executed: 1 } } }, adapter).passed, false);
});

test('short-recording mutation retains a valid WAV and only a quarter of the actual frames', () => {
  const bytes = Buffer.alloc(44 + 200 * 2); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(100, 24); bytes.writeUInt32LE(200, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(400, 40);
  const shortened = shortenRecording(bytes); assert.equal(readWav(shortened).frame_count, 50); assert.equal(readWav(bytes).frame_count, 200);
});

test('comparison refuses absent or tampered retained evidence before interpreting caller verdicts', () => {
  const folder = mkdtempSync(join(tmpdir(), 'observation-comparison-'));
  try {
    assert.equal(verifyComparison(join(folder, 'missing.json')).passed, false);
    const raw = Buffer.from('{}'), binding = { path: 'source.json', bytes: raw.length, sha256: sha256(raw) };
    writeFileSync(join(folder, 'source.json'), 'tampered');
    writeFileSync(join(folder, 'comparison.json'), JSON.stringify({ schema_version: 1, baseline_revision: 'a'.repeat(40), old: { source: binding }, new: { source: binding } }));
    const result = verifyComparison(join(folder, 'comparison.json')); assert.equal(result.passed, false); assert.match(result.errors[0], /artifact mismatch/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('retained build requires current clean source, exact configured project and actual produced bytes', () => {
  const folder = mkdtempSync(join(tmpdir(), 'observation-build-'));
  const put = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); };
  const save = (name, value) => put(join(folder, 'evidence', name), JSON.stringify(value));
  try {
    const sourceRoot = join(folder, 'source'), engine = join(folder, 'engine'), evidence = join(folder, 'evidence');
    const config = { sourceRoot, engine, project: join(sourceRoot, 'Sample.uproject'), editorTarget: 'SampleEditor', platform: 'Win64', configuration: 'Development', dotnet: join(engine, 'dotnet.exe') }, local = { compiler: '14.44.35207', sdk: '10.0.26100.0' };
    put(config.project, '{}');
    const git = (...args) => execFileSync('git', ['-C', sourceRoot, ...args], { windowsHide: true, stdio: 'pipe' });
    git('init'); git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture');
    for (const path of [config.dotnet, join(engine, 'Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.dll'), join(engine, 'Engine/Binaries/Win64/UnrealEditor.exe')]) put(path, 'inert fixture bytes');
    put(join(engine, 'Engine/Build/Build.version'), '{}');
    const product = join(folder, 'produced.dll'); put(product, 'produced bytes');
    const id = '11111111-1111-1111-1111-111111111111', command = operationCommand('build', config, ['-CompilerVersion=14.44.35207', '-WindowsSDKVersion=10.0.26100.0', '-NoUBTMakefiles']);
    const request = { version: 1, kind: 'unreal-run/request', id, nonce: 'a'.repeat(64), purpose: 'production', lock: LOCK, operation: 'build', ...command, cwd: sourceRoot, evidence, state: folder, node: process.execPath, timeoutMs: 600000, waitMs: 60000, controllerPid: 1, controllerCreated: '1000000000000000' };
    save('request.json', request); const requestHash = sha256(readFileSync(join(evidence, 'request.json')));
    const processes = [1, 2, 3, 4].map(pid => ({ pid, created: '1000000000000000' })), time = '2026-01-01T00:00:00Z';
    const lifecycle = { version: 1, kind: 'unreal-run/lifecycle', operation: 'build', purpose: 'production', lock: LOCK, id, requestHash, controller: processes[0], helper: processes[1], gate: processes[2], probe: processes[3], processes, started: time, finished: time, permitIssued: true, cancelled: false, timedOut: false, errors: [], contained: true, probeContained: true, permit: { requestHash, gate: processes[2] }, drain: { proved: true, active: 0, members: [], requestHash, observed: time }, exitCode: 0 };
    save('lifecycle.json', lifecycle);
    const stdout = 'Using Visual Studio 2022 14.44.35223 toolchain and Windows 10.0.26100.0 SDK'; put(join(evidence, 'stdout.log'), stdout); put(join(evidence, 'stderr.log'), '');
    const identity = { version: 1, kind: 'unreal-run/identity', operation: 'build', id, requestHash, source: sourceIdentity(config), engine: { buildVersionSha256: sha256('{}'), executableSha256: sha256('inert fixture bytes'), observedVersion: 'fixture' }, toolchain: observeToolchain(stdout + '\n'), target: { name: config.editorTarget, platform: config.platform, configuration: config.configuration }, artifacts: [{ path: product, bytes: 14, sha256: sha256('produced bytes') }], complete: true, errors: [] };
    save('identity.json', identity);
    assert.equal(validateBuildEvidence(evidence, config, local).valid, true);
    assert.throws(() => validateBuildEvidence(evidence, { ...config, project: join(sourceRoot, 'Other.uproject') }, local), /current project/);
    put(config.project, '{"changed":true}'); assert.throws(() => validateBuildEvidence(evidence, config, local), /source/); put(config.project, '{}');
    put(product, 'mutated'); assert.throws(() => validateBuildEvidence(evidence, config, local), /artifact bytes or hash mismatch/); put(product, 'produced bytes');
    rmSync(join(evidence, 'identity.json')); assert.throws(() => validateBuildEvidence(evidence, config, local));
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
