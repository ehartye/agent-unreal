import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArguments } from './unreal-run.mjs';
import { LOCK, OPERATIONS, verifyLifecycle, verifyIdentity, recoveryDecision, validateRequest } from './lib/unreal-run/contracts.mjs';
import { loadConfiguration, operationCommand, runContainedProcess } from './lib/unreal-run/controller.mjs';
import { sourceIdentity, verifyArtifactFiles, observeToolchain } from './lib/unreal-run/identity.mjs';
import { hash } from './lib/unreal-run/contracts.mjs';
import { engineContenders } from './lib/unreal-run/contention.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { corruptRecoveryCases } from './lib/unreal-run/fixtures/recovery-cases.mjs';

const sha = 'a'.repeat(64), id = '12345678-1234-1234-1234-123456789012', now = '2026-01-01T00:00:00.000Z';
const identity = pid => ({ pid, created: `63900000000000000${pid}` });
function lifecycle() {
  return { version: 1, kind: 'unreal-run/lifecycle', operation: 'build', id, purpose: 'production', lock: LOCK, requestHash: sha, controller: identity(1), helper: identity(2), gate: identity(3), probe: identity(4), processes: [1,2,3,4].map(identity), started: now, finished: now, contained: true, probeContained: true, permitIssued: true, permit: { requestHash: sha, gate: identity(3) }, exitCode: 0, cancelled: false, timedOut: false, errors: [], drain: { proved: true, active: 0, members: [], requestHash: sha, observed: now } };
}
function receipt() {
  return { version: 1, kind: 'unreal-run/identity', operation: 'build', id, requestHash: sha, source: { commit: 'b'.repeat(40), snapshot: sha, dirty: false }, engine: { buildVersionSha256: sha, executableSha256: sha, observedVersion: '5.8.0' }, toolchain: { compiler: '14.50.10000', sdk: '10.0.20000.0', logSha256: sha }, artifacts: [{ path: 'Build/Game.exe', bytes: 12, sha256: sha }], complete: true, errors: [] };
}
function owner() { return { version: 1, kind: 'unreal-run/owner', id, purpose: 'production', lock: LOCK, started: now, requestHash: sha, processes: [identity(1)], permitIssued: false, phase: 'pre-permit', drain: null }; }
const gone = [{ pid: 1, expectedCreated: identity(1).created, state: 'gone' }];

test('contention excludes exact EOS overlay images while engine and near-name game observations still block', () => {
  const observation = (name, commandLine = null) => ({ name, commandLine, pid: 101, created: '639000000000000001' });
  const nonEngines = ['EOSOverlayRenderer-Win64-Shipping.exe', 'EOSOverlayRenderer-Win32-Shipping.exe', 'eosoverlayrenderer-win64-shipping.EXE', 'node.exe', 'dotnet.exe'].map(name => observation(name));
  assert.deepEqual(engineContenders(nonEngines), []);
  for (const observed of [
    observation('UnrealEditor.exe'), observation('UnrealEditor-Cmd.exe'), observation('UnrealGame.exe'),
    observation('UnrealBuildTool.exe'), observation('dotnet.exe', 'dotnet "D:/Engine/UnrealBuildTool.dll" SampleEditor'),
    observation('dotnet.exe', 'dotnet "D:/Engine/AutomationTool.dll" BuildCookRun'),
    observation('Sample-Win64-Shipping.exe'), observation('Sample-Win64-Development.exe'), observation('Sample-Win64-Test.exe'),
    observation('EOSOverlayRendererGame-Win64-Shipping.exe'), observation('MyEOSOverlayRenderer-Win64-Shipping.exe'), observation('EOSOverlayRenderer-Win64-Development.exe'),
  ]) {
    const contenders = engineContenders([...nonEngines, observed]);
    assert.equal(contenders.length, 1, observed.name);
    assert.equal(contenders[0].pid, observed.pid); assert.equal(contenders[0].created, observed.created);
    assert.equal(contenders[0].name, observed.name); assert.ok(contenders[0].reason);
    assert.equal(Object.hasOwn(contenders[0], 'commandLine'), false, 'receipt does not expose unrelated command arguments');
  }
});

test('contention classifier CLI refuses missing or malformed observations instead of emitting no contenders', () => {
  const classifier = fileURLToPath(new URL('./lib/unreal-run/contention.mjs', import.meta.url));
  for (const input of ['', '{bad', '{}', '[null]', '[{"name":"UnrealEditor.exe","pid":0}]']) {
    const result = spawnSync(process.execPath, [classifier], { input, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 74); assert.equal(result.stdout, ''); assert.match(result.stderr, /classification refused/);
  }
  const empty = spawnSync(process.execPath, [classifier], { input: '[]', encoding: 'utf8', timeout: 5000 });
  assert.equal(empty.status, 0); assert.deepEqual(JSON.parse(empty.stdout), []);
});

test('CLI advertises nine operations and preserves exact trailing arguments', () => {
  assert.equal(OPERATIONS.length, 9);
  assert.deepEqual(parseArguments(['editor', '--config', 'a b.json', '--evidence', 'out', '--timeout', '5', '--', '', 'x"y', 'x\\', '--timeout']), { operation: 'editor', config: 'a b.json', evidence: 'out', timeout: '5', arguments: ['', 'x"y', 'x\\', '--timeout'] });
  assert.equal(parseArguments(['--help']).help, true);
});
test('CLI refuses missing, unknown, repeated and unbounded input before launch', () => {
  for (const args of [['unknown'], ['editor'], ['doctor', '--timeout', '0'], ['doctor', '--timeout', '86401'], ['doctor', '--timeout', 'x'], ['doctor', '--no-lock'], ['doctor', '--wait', '1', '--wait', '2'], ['status', '--', 'engine']]) assert.throws(() => parseArguments(args));
});
test('production requests cannot change lock identity or select fixture faults', () => {
  const request = { version: 1, kind: 'unreal-run/request', id, nonce: sha, purpose: 'production', operation: 'editor', lock: LOCK, executable: 'editor.exe', arguments: [''], cwd: 'cwd', evidence: 'out', state: 'state', node: 'node', timeoutMs: 1, waitMs: 1, controllerPid: 1, controllerCreated: identity(1).created };
  assert.deepEqual(validateRequest(request), []);
  assert.match(validateRequest({ ...request, lock: 'other' }).join(), /lock identity/);
  assert.match(validateRequest({ ...request, fault: 'containment' }).join(), /fixture fault/);
  assert.match(validateRequest({ ...request, fault: 'observation' }).join(), /fixture fault/);
  assert.match(validateRequest({ ...request, fault: 'observation-once' }).join(), /fixture fault/);
  assert.match(validateRequest({ ...request, arguments: ['bad\0value'] }).join(), /NUL/);
});
test('complete lifecycle is verifiable with expected request binding', () => {
  assert.equal(verifyLifecycle(lifecycle(), { requestId: id, requestHash: sha }).valid, true);
  assert.equal(verifyLifecycle(lifecycle(), { requestHash: 'c'.repeat(64) }).valid, false);
});
test('lifecycle rejects unknown ownership, missing probe, contradictory permit and wrong lock', () => {
  for (const mutation of [r => { r.drain.proved = false; }, r => { r.drain.active = 1; }, r => { r.drain.members = [99]; }, r => { r.probe = null; }, r => { r.processes.pop(); }, r => { r.permit.gate.created = '1'; }, r => { r.permitIssued = false; }, r => { r.lock = 'Global\\other'; }, r => { r.cancelled = true; }, r => { r.timedOut = true; }, r => { r.exitCode = 7; }, r => { r.errors = ['monitor failed']; }]) { const r = lifecycle(); mutation(r); assert.equal(verifyLifecycle(r).valid, false); }
});
test('fixture receipts cannot qualify production evidence', () => {
  const r = lifecycle(); r.purpose = 'fixture'; r.lock = `Global\\agent-unreal-fixture-${randomUUID()}`;
  assert.equal(verifyLifecycle(r).valid, false); assert.equal(verifyLifecycle(r, { purpose: 'fixture' }).valid, true);
});
test('identity verification accepts complete build/package observations and rejects missing evidence', () => {
  const life = lifecycle(), good = receipt();
  assert.equal(verifyIdentity(good, life, { source: good.source }).valid, true);
  assert.equal(verifyIdentity({ ...good, operation: 'package' }, { ...life, operation: 'package' }).valid, true);
  assert.equal(verifyIdentity({ ...good, operation: 'package' }, life).valid, false);
  for (const bad of [null, {}, { ...good, artifacts: [] }, { ...good, artifacts: {} }, { ...good, artifacts: [null] }, { ...good, engine: null }, { ...good, toolchain: null }, { ...good, complete: false }, { ...good, requestHash: 'c'.repeat(64) }]) assert.equal(verifyIdentity(bad, life).valid, false);
  assert.equal(verifyIdentity(good, life, { source: { ...good.source, snapshot: 'c'.repeat(64) } }).valid, false);
  assert.equal(verifyIdentity(good, { ...life, drain: null }).valid, false);
  assert.equal(verifyLifecycle({ ...life, drain: { ...life.drain, observed: '2025-01-01T00:00:00Z' } }).valid, false);
});
test('toolchain identity reads the actual UBT compiler and Windows SDK observation', () => {
  const line = 'Using Visual Studio 2022 14.44.35223 toolchain (D:/Toolchain) and Windows 10.0.26100.0 SDK (D:/SDK).';
  const observed = observeToolchain(line);
  assert.equal(observed.compiler, '14.44.35223'); assert.equal(observed.sdk, '10.0.26100.0');
  assert.equal(observed.observation, line); assert.equal(observed.logSha256, hash(line));
  for (const missing of ['', 'Target is up to date', 'Using Visual Studio 2022 14.44.35223 toolchain']) assert.throws(() => observeToolchain(missing), /not observed/);
});

test('sample source identity excludes generated file-order logs but detects source and build-resource changes', t => {
  const root = mkdtempSync(join(tmpdir(), 'unreal-sample-identity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = args => {
    const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  };
  const write = (relative, contents) => { const file = join(root, relative); mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, contents); };
  write('.gitignore', readFileSync(new URL('../examples/unreal/engine_lock/sample/.gitignore', import.meta.url)));
  write('Source/Module.cpp', 'source before\n');
  write('Build/Windows/Resources/Icon.ico', 'resource before\n');
  git(['init']); git(['add', '--', '.']); git(['commit', '-m', 'Sample identity fixture']);
  const baseline = sourceIdentity({ sourceRoot: root });
  assert.equal(baseline.dirty, false);
  write('Build/Windows/FileOpenOrder/EditorOpenOrder.log', 'editor generated access order\n');
  write('Build/Windows/FileOpenOrder/CookerOpenOrder.log', 'cook generated access order\n');
  assert.deepEqual(sourceIdentity({ sourceRoot: root }), baseline);
  for (const path of ['Source/Module.cpp', 'Build/Windows/Resources/Icon.ico']) {
    const original = readFileSync(join(root, path));
    write(path, 'changed input\n');
    assert.notEqual(sourceIdentity({ sourceRoot: root }).snapshot, baseline.snapshot, path);
    write(path, original);
  }
  write('Build/Windows/Resources/Additional.ico', 'new packaging input\n');
  assert.notEqual(sourceIdentity({ sourceRoot: root }).snapshot, baseline.snapshot);
});

test('artifact verification reads bytes and rejects missing or tampered products', t => {
  const root = mkdtempSync(join(tmpdir(), 'unreal-artifacts-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'product.bin'); writeFileSync(file, 'product');
  const r = { artifacts: [{ path: file, bytes: 7, sha256: hash('product') }] };
  assert.equal(verifyArtifactFiles(r).valid, true);
  writeFileSync(file, 'changed'); assert.equal(verifyArtifactFiles(r).valid, false);
  rmSync(file); assert.equal(verifyArtifactFiles(r).valid, false);
});
test('recovery accepts only both evidence-backed cases; age and PID absence alone are insufficient', () => {
  assert.equal(recoveryDecision(owner(), gone).allowed, true);
  const after = { ...owner(), permitIssued: true, phase: 'unknown-after-permit' };
  assert.equal(recoveryDecision(after, gone).allowed, false);
  assert.equal(recoveryDecision({ ...after, drain: lifecycle().drain }, gone).allowed, true);
  for (const invalid of [null, {}, { ...owner(), processes: [] }, { ...owner(), permitIssued: null }, { ...owner(), phase: 'invented' }]) assert.equal(recoveryDecision(invalid, gone).allowed, false);
  for (const state of ['live', 'reused', 'unknown']) assert.equal(recoveryDecision(owner(), [{ ...gone[0], state }]).allowed, false);
  assert.equal(recoveryDecision(owner(), []).allowed, false);
  assert.equal(recoveryDecision(owner(), [{ ...gone[0], expectedCreated: 'wrong' }]).allowed, false);
  assert.equal(recoveryDecision(owner(), [null]).allowed, false);
  assert.equal(recoveryDecision(owner(), gone, { lock: 'wrong' }).allowed, false);
  assert.equal(recoveryDecision(owner(), gone, { purpose: 'fixture' }).allowed, false);
  for (const [name, mutate] of corruptRecoveryCases) {
    const corrupt = { ...owner(), permitIssued: true, phase: 'unknown-after-permit', drain: lifecycle().drain };
    mutate(corrupt);
    assert.equal(recoveryDecision(corrupt, gone).allowed, false, name);
  }
});
test('recovery policy process binds original owner bytes and refuses corrupt input', t => {
  const root = mkdtempSync(join(tmpdir(), 'unreal-recovery-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ownerPath = join(root, 'owner.json');
  const bytes = JSON.stringify(owner()); writeFileSync(ownerPath, bytes);
  const policy = fileURLToPath(new URL('./lib/unreal-run/recovery.mjs', import.meta.url));
  const input = { ownerPath, ownerHash: hash(bytes), lock: LOCK, purpose: 'production', observations: gone };
  const invoke = value => spawnSync(process.execPath, [policy], { input: value, encoding: 'utf8', timeout: 5000, windowsHide: true });
  const valid = invoke(JSON.stringify(input)); assert.equal(valid.status, 0);
  assert.deepEqual(JSON.parse(valid.stdout), { ...recoveryDecision(owner(), gone), ownerHash: input.ownerHash, lock: LOCK });
  for (const corrupt of ['', '{bad', '{}', JSON.stringify({ ...input, ownerHash: 'wrong' })]) {
    const result = invoke(corrupt); assert.equal(result.status, 74); assert.equal(result.stdout, '');
  }
  writeFileSync(ownerPath, '{bad');
  assert.equal(invoke(JSON.stringify({ ...input, ownerHash: hash('{bad') })).status, 74);
  assert.equal(readFileSync(ownerPath, 'utf8'), '{bad');
});
test('configuration rejects bypass keys and command construction preserves workload argv', t => {
  const root = mkdtempSync(join(tmpdir(), 'unreal-config-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'Engine/Binaries/Win64'), { recursive: true });
  writeFileSync(join(root, 'Game.uproject'), '{}'); writeFileSync(join(root, 'Engine/Binaries/Win64/UnrealEditor.exe'), 'inert fixture');
  const config = { version: 1, project: 'Game.uproject', engine: '.', sourceRoot: '.', editorTarget: 'GameEditor', gameTarget: 'Game' };
  const file = join(root, 'project.json'); writeFileSync(file, JSON.stringify(config)); const loaded = loadConfiguration(file);
  assert.deepEqual(operationCommand('editor', loaded, ['', 'a b']).arguments, [join(root, 'Game.uproject'), '', 'a b']);
  for (const operation of ['build', 'package']) for (const override of ['-Project=Other.uproject', '-Target=Other', '-TargetList=other.txt', '-Platform=Other', '-Configuration=Shipping', '-ClientConfig=Shipping', '-ArchiveDirectory=Other', '--PROJECT']) {
    assert.throws(() => operationCommand(operation, loaded, [override]), /identity options belong in project configuration/);
  }
  writeFileSync(file, JSON.stringify({ ...config, lock: 'other' })); assert.throws(() => loadConfiguration(file), /Unknown configuration field/);
  writeFileSync(file, JSON.stringify({ ...config, gameTarget: 'Game;exec' })); assert.throws(() => loadConfiguration(file), /Invalid configuration/);
});
test('unsupported platform refuses native control before filesystem actions', { skip: process.platform === 'win32' }, async () => {
  await assert.rejects(runContainedProcess({}), /requires Windows/);
});
