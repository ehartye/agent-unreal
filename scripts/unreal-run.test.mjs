import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArguments } from './unreal-run.mjs';
import { LOCK, OPERATIONS, verifyLifecycle, verifyIdentity, recoveryDecision, validateRequest } from './lib/unreal-run/contracts.mjs';
import { loadConfiguration, operationCommand, runContainedProcess } from './lib/unreal-run/controller.mjs';
import { verifyArtifactFiles } from './lib/unreal-run/identity.mjs';
import { hash } from './lib/unreal-run/contracts.mjs';

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
});
test('configuration rejects bypass keys and command construction preserves workload argv', t => {
  const root = mkdtempSync(join(tmpdir(), 'unreal-config-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'Engine/Binaries/Win64'), { recursive: true });
  writeFileSync(join(root, 'Game.uproject'), '{}'); writeFileSync(join(root, 'Engine/Binaries/Win64/UnrealEditor.exe'), 'inert fixture');
  const config = { version: 1, project: 'Game.uproject', engine: '.', sourceRoot: '.', editorTarget: 'GameEditor', gameTarget: 'Game' };
  const file = join(root, 'project.json'); writeFileSync(file, JSON.stringify(config)); const loaded = loadConfiguration(file);
  assert.deepEqual(operationCommand('editor', loaded, ['', 'a b']).arguments, [join(root, 'Game.uproject'), '', 'a b']);
  writeFileSync(file, JSON.stringify({ ...config, lock: 'other' })); assert.throws(() => loadConfiguration(file), /Unknown configuration field/);
  writeFileSync(file, JSON.stringify({ ...config, gameTarget: 'Game;exec' })); assert.throws(() => loadConfiguration(file), /Invalid configuration/);
});
test('unsupported platform refuses native control before filesystem actions', { skip: process.platform === 'win32' }, async () => {
  await assert.rejects(runContainedProcess({}), /requires Windows/);
});
