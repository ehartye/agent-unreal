import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync, appendFileSync, symlinkSync, utimesSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArguments } from './unreal-remote.mjs';
import { action } from './lib/unreal-remote/client.mjs';
import { loadConfig, binding, validateState } from './lib/unreal-remote/contracts.mjs';
import { git, snapshot, createBundle, pointers, lfsStorage, ignored, materialize } from './lib/unreal-remote/source.mjs';
import { json, write, hash, digest, canonical, pack, unpack, fileIdentity, inventory, now } from './lib/unreal-remote/files.mjs';
import { initialize, readState, transition, cancelJob, lease, reconcileLease, issuePermit, cancelObserved, recoverStateLock, currentOwner } from './lib/unreal-remote/state.mjs';
import { startRemote, statusRemote } from './lib/unreal-remote/endpoint.mjs';
import { publishReturn, qualifyReturn, receive, verifyDownload, verifyQualification } from './lib/unreal-remote/transfer.mjs';
import { encoded } from './lib/unreal-remote/transport.mjs';
import { proveDrain, runWorker, processIdentity } from './lib/unreal-remote/worker.mjs';
import { prepare } from './lib/unreal-verify/manifest.mjs';
import { execute } from './lib/unreal-verify/runner.mjs';
import { LOCK } from './lib/unreal-run/contracts.mjs';

const step = { id: 'rules', kind: 'automation', required: true, depends_on: [], timeout_seconds: 10, arguments: [], expected_count: 1, filter: 'RemoteFixture', expected_tests: ['RemoteFixture.Rule'] };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'unreal-remote-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'); mkdirSync(source);
  writeFileSync(join(source, '.gitignore'), '/local/\n/out/result/\n/remote.local.json\n');
  write(join(source, 'Sample.uproject'), {}); write(join(source, 'manifest.json'), { schema_version: 1, steps: [step], suites: { small: ['rules'] } });
  git(source, ['init']); git(source, ['config', 'core.autocrlf', 'false']);
  git(source, ['add', '.']); git(source, ['-c', 'user.name=Remote fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture']);
  const commit = git(source, ['rev-parse', 'HEAD']).toString().trim(), remote = { root: 'C:/RemoteFixture', node: 'C:/Tools/node.exe', launcher: { version: 1, project: 'Sample.uproject', engine: 'C:/Engine/UE_5.8', editorTarget: 'SampleEditor', gameTarget: 'Sample' }, timeouts: { transport_seconds: 5, startup_seconds: 1, workload_seconds: 10 } };
  const config = join(source, 'remote.local.json'); write(config, { version: 1, source_root: source, state_directory: 'local', ssh_target: 'fixture-host', remote });
  const base = join(root, 'remote'); mkdirSync(base);
  const inputs = snapshot(source, commit, 'manifest.json', 'small');
  const message = join(root, 'message'); mkdirSync(message); createBundle(source, commit, join(message, 'source.bundle'));
  pack(join(message, 'payload.uar'), [{ path: 'source.bundle', source: join(message, 'source.bundle') }]);
  const request = { version: 1, kind: 'unreal-remote/request', job: 'test-job', source: inputs.identity, manifest: 'manifest.json', suite: 'small', remote, runtime: { bytes: 1, sha256: hash('r') }, payload: fileIdentity(join(message, 'payload.uar')) };
  return { root, source, commit, config, base, request, message, options: { action: 'start', config, job: request.job, commit, manifest: 'manifest.json', suite: 'small' } };
}
function job(f) { const dir = join(f.base, 'jobs', f.request.job); mkdirSync(dir, { recursive: true }); write(join(dir, 'request.json'), f.request); const state = initialize(dir, f.request); return { dir, state }; }
const worker = { pid: 77, created: '133000000000000000' };
function inertLifecycle(command, { cancelled = false, timedOut = false } = {}) {
  mkdirSync(command.evidence, { recursive: true }); const identity = pid => ({ pid, created: '133000000000000000' });
  const request = { version: 1, kind: 'unreal-run/request', id: randomUUID(), nonce: 'a'.repeat(64), purpose: 'production', lock: LOCK, state: join(dirname(command.evidence), 'inert-state'), node: process.execPath, controllerPid: 1, controllerCreated: identity(1).created, ...command };
  write(join(command.evidence, 'request.json'), request); const requestHash = hash(readFileSync(join(command.evidence, 'request.json')));
  write(join(command.evidence, 'lifecycle.json'), { version: 1, kind: 'unreal-run/lifecycle', id: request.id, requestHash, operation: command.operation, purpose: 'production', lock: LOCK, controller: identity(1), helper: identity(2), gate: identity(3), probe: identity(4), processes: [1, 2, 3, 4].map(identity), started: now(), finished: now(), contained: true, probeContained: true, permitIssued: true, permit: { requestHash, gate: identity(3) }, exitCode: cancelled || timedOut ? 1 : 0, cancelled, timedOut, errors: [], drain: { proved: true, active: 0, members: [], requestHash, observed: now() } });
  return { exitCode: cancelled || timedOut ? 1 : 0 };
}
function ready(f, directory) { const s = readState(directory, f.request); transition(directory, f.request, s, { phase: 'ready', worker }); return { pid: worker.pid }; }
function terminal(f, phase = 'failed') {
  const j = job(f); let s = transition(j.dir, f.request, j.state, { phase: 'ready', worker });
  s = transition(j.dir, f.request, s, { phase: 'running' });
  s = transition(j.dir, f.request, s, { phase, drained: phase !== 'unknown' });
  write(join(j.dir, 'dispatch-ledger.json'), { version: 1, kind: 'unreal-remote/dispatch-ledger', ...binding(f.request), paths: [] });
  const result = { version: 1, kind: 'unreal-remote/result', ...binding(f.request), phase, drained: s.drained, drain: [] };
  write(join(j.dir, 'result.json'), result); return { ...j, state: s };
}
const runtime = directory => { const file = join(directory, 'runtime.uar'); writeFileSync(file, 'r'); return { file, identity: fileIdentity(file) }; };

test('four typed public actions reject test adapter, generic commands and misplaced options', () => {
  assert.equal(parseArguments(['fetch', '--config', 'c', '--job', 'j', '--output', 'o', '--diagnostic']).diagnostic, true);
  for (const args of [[], ['shell'], ['start', '--config', 'c', '--job', 'j'], ['status', '--config', 'c', '--job', 'j', '--adapter', 'fixture'], ['cancel', '--config', 'c', '--job', 'j', '--suite', 'small'], ['status', '--config', 'c', '--job', 'j', '--job', 'j'], ['fetch', '--config', 'c', '--job', 'j']]) assert.throws(() => parseArguments(args));
  assert.ok(encoded("Write-Output 'fixed'").join(' ').length < 7800); assert.throws(() => encoded('x'.repeat(8000)), /bounded/);
});
test('R1 configuration is ignored and rejects unknown credentials/adapter fields', t => {
  const f = fixture(t); assert.equal(loadConfig(f.config).source_root, f.source);
  const c = json(f.config); c.password = 'forbidden'; writeFileSync(f.config, canonical(c)); assert.throws(() => loadConfig(f.config), /fields/);
  delete c.password; c.adapter = 'fixture'; writeFileSync(f.config, canonical(c)); assert.throws(() => loadConfig(f.config), /fields/);
  delete c.adapter; writeFileSync(f.config, canonical(c)); git(f.source, ['add', '-f', 'remote.local.json']); assert.throws(() => loadConfig(f.config), /tracked/);
});
test('R1 dirty source, non-HEAD revision and changed tracked manifest are refused', t => {
  const f = fixture(t); appendFileSync(join(f.source, 'Sample.uproject'), '\n');
  assert.throws(() => snapshot(f.source, f.commit, 'manifest.json', 'small'), /clean/);
  git(f.source, ['checkout', '--', 'Sample.uproject']);
  assert.throws(() => snapshot(f.source, 'f'.repeat(40), 'manifest.json', 'small'));
  writeFileSync(join(f.source, 'untracked.txt'), 'changed'); assert.throws(() => snapshot(f.source, f.commit, 'manifest.json', 'small'), /clean/);
});
test('R1 raw LFS pointer inventory refuses missing format before filter-mediated source mutation', t => {
  const f = fixture(t), oid = hash('large-object');
  writeFileSync(join(f.source, 'asset.bin'), `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 12\n`);
  git(f.source, ['add', 'asset.bin']); git(f.source, ['-c', 'user.name=Fixture', '-c', 'user.email=f@example.invalid', 'commit', '-m', 'LFS pointer']);
  const commit = git(f.source, ['rev-parse', 'HEAD']).toString().trim();
  assert.deepEqual(pointers(f.source, commit), [{ path: 'asset.bin', oid, bytes: 12 }]);
  const before = git(f.source, ['config', '--local', '--list', '--null']);
  assert.throws(() => snapshot(f.source, commit, 'manifest.json', 'small'), /repositoryformatversion/);
  assert.deepEqual(git(f.source, ['config', '--local', '--list', '--null']), before);
  git(f.source, ['config', 'lfs.repositoryformatversion', '1']);
  const malformed = git(f.source, ['config', '--local', '--list', '--null']);
  assert.throws(() => lfsStorage(f.source), /repositoryformatversion/); assert.deepEqual(git(f.source, ['config', '--local', '--list', '--null']), malformed);
  const media = join(f.root, 'media'); mkdirSync(media);
  assert.throws(() => snapshot(f.source, commit, 'manifest.json', 'small', { storage: () => media }), /Required LFS object is missing/);
  const object = join(media, oid.slice(0, 2), oid.slice(2, 4), oid); mkdirSync(dirname(object), { recursive: true }); writeFileSync(object, 'tampered');
  assert.throws(() => snapshot(f.source, commit, 'manifest.json', 'small', { storage: () => media }), /corrupt|hydrated/);
});
test('R1 exact bundle materialization preserves source identity and repeated start never dispatches twice', async t => {
  const f = fixture(t); let count = 0;
  const adapter = { launch: dir => { count++; return ready(f, dir); }, identity: () => worker, pollMs: 1 };
  const first = await startRemote(f.base, f.request, f.message, adapter);
  assert.equal(first.phase, 'ready', first.error); assert.equal(count, 1);
  materialize(f.base, f.request, join(f.base, 'jobs', f.request.job, 'payload'));
  const worktree = join(f.base, 'repository-worktrees', f.request.job);
  assert.equal(git(worktree, ['rev-parse', 'HEAD']).toString().trim(), f.commit);
  assert.equal(git(worktree, ['rev-parse', 'HEAD^{tree}']).toString().trim(), f.request.source.tree);
  assert.equal(git(worktree, ['status', '--porcelain']).length, 0);
  const second = await startRemote(f.base, f.request, f.message, adapter); assert.equal(second.sequence, first.sequence); assert.equal(count, 1);
  await assert.rejects(startRemote(f.base, { ...f.request, suite: 'other' }, f.message, adapter), /different request/); assert.equal(count, 1);
});
test('R1 missing and tampered LFS payloads refuse before a worker can launch', async t => {
  for (const mode of ['missing', 'tampered']) {
    const f = fixture(t), j = job(f); // Use the actual payload boundary before materialization, without a Git LFS executable.
    const source = join(f.root, 'object'); writeFileSync(source, 'object'); const oid = hash('object');
    const archive = join(f.root, `${mode}.uar`); pack(archive, mode === 'missing' ? [] : [{ path: `lfs/${oid}`, source }]);
    if (mode === 'tampered') { const b = readFileSync(archive); b[b.length - 1] ^= 1; writeFileSync(archive, b); }
    if (mode === 'missing') assert.throws(() => unpack(archive, join(f.root, 'extract'), [{ path: `lfs/${oid}`, bytes: 6, sha256: oid }]), /member set/);
    else assert.throws(() => unpack(archive, join(f.root, 'extract')), /bytes changed/);
    assert.equal(readState(j.dir, f.request).phase, 'launch_pending');
  }
});
test('R1 client binds accepted inputs and reuses cached request, rejecting changed inputs and ID mismatches', async t => {
  const f = fixture(t); let accepted, count = 0;
  const adapter = { status: async () => accepted ? { found: true, state: accepted } : { found: false }, start: async request => { count++; const dir = join(f.root, 'accepted'); mkdirSync(dir); accepted = initialize(dir, request); return accepted; } };
  const seam = { packageRuntime: runtime, makeTransport: () => adapter };
  await action(f.options, seam); assert.equal((await action(f.options, seam)).repeated, true); assert.equal(count, 1);
  await assert.rejects(action({ ...f.options, suite: 'other' }, seam));
  appendFileSync(join(f.source, 'manifest.json'), '\n'); await assert.rejects(action(f.options, seam), /clean/); assert.equal(count, 1);
});
test('R2 disconnect before and after dispatch reconciles by job ID without retrying execution', async t => {
  for (const after of [false, true]) {
    const f = fixture(t); let state, starts = 0, observations = 0;
    const seam = { packageRuntime: runtime, makeTransport: () => ({ status: async () => { observations++; return state ? { found: true, state } : { found: false }; }, start: async request => { starts++; if (after) { const d = join(f.root, 'accepted'); mkdirSync(d); state = initialize(d, request); } throw Error('connection lost'); } }) };
    const result = await action(f.options, seam); assert.equal(result.uncertain, true); assert.equal(starts, 1); assert.equal(observations, 2); assert.equal(result.reconciled.found, after);
    if (after) { assert.equal((await action(f.options, seam)).repeated, true); assert.equal(starts, 1); }
  }
});
test('R2 status is read-only; cancellation is idempotent; stale competing CAS is refused', t => {
  const f = fixture(t), j = job(f), before = readFileSync(join(j.dir, 'state.json'));
  assert.equal(statusRemote(f.base, f.request.job).state.phase, 'launch_pending'); assert.deepEqual(readFileSync(join(j.dir, 'state.json')), before);
  const cancelled = cancelJob(j.dir, f.request); assert.equal(cancelled.phase, 'cancelling');
  assert.equal(cancelJob(j.dir, f.request).sequence, cancelled.sequence);
  assert.throws(() => transition(j.dir, f.request, j.state, { phase: 'ready' }), /Stale/);
  const forged = { ...f.request, job: 'another' }; assert.throws(() => cancelJob(j.dir, forged), /binding/);
});
test('R2 startup timeout stays unknown; exact no-permit recovery fences a late worker and releases only its lease', async t => {
  const f = fixture(t); let launches = 0;
  const state = await startRemote(f.base, f.request, f.message, { launch: () => { launches++; return { pid: 55 }; }, pollMs: 10 });
  assert.equal(state.phase, 'unknown'); assert.equal(state.drained, false); assert.equal(launches, 1);
  const dir = join(f.base, 'jobs', f.request.job), held = json(join(dir, 'worker.json')).lease;
  const recovery = reconcileLease(dir, f.request, () => { throw Error('No permit needs no guessed process kill'); }); assert.equal(recovery.released, true); assert.equal(existsSync(held), false);
  assert.throws(() => issuePermit(dir, f.request, state, worker), /fencing/);
  assert.throws(() => transition(dir, f.request, state, { phase: 'ready', worker }), /Forbidden/);
  assert.equal(readState(dir, f.request).phase, 'unknown');
  assert.equal((await startRemote(f.base, f.request, f.message, { launch: () => { launches++; } })).phase, 'unknown'); assert.equal(launches, 1);
});
test('R2 post-permit missing proof and a live worker never authorize lease release', t => {
  const f = fixture(t), j = job(f); let s = transition(j.dir, f.request, j.state, { phase: 'ready', worker });
  const common = join(f.root, 'common'); mkdirSync(common); const held = lease(common, j.dir, f.request, s); write(join(j.dir, 'worker.json'), { lease: held });
  issuePermit(j.dir, f.request, s, worker); s = transition(j.dir, f.request, s, { phase: 'unknown' });
  assert.equal(reconcileLease(j.dir, f.request, () => ({ pid: worker.pid, absent: true })).released, false);
  write(join(j.dir, 'dispatch-ledger.json'), { version: 1, kind: 'unreal-remote/dispatch-ledger', ...binding(f.request), paths: ['000-rules/launcher'] });
  assert.equal(reconcileLease(j.dir, f.request, () => worker).released, false);
  mkdirSync(join(j.dir, 'suite')); write(join(j.dir, 'dispatch-000000.json'), { version: 1, ...binding(f.request), path: '000-rules/launcher' });
  assert.equal(reconcileLease(j.dir, f.request, () => ({ pid: worker.pid, absent: true })).released, false); assert.equal(existsSync(held), true);
  rmSync(join(j.dir, 'suite'), { recursive: true });
  assert.equal(reconcileLease(j.dir, f.request, () => ({ pid: worker.pid, absent: true })).released, false); assert.equal(existsSync(held), true);
});
test('R2 cancelled pre-permit worker records zero dispatch and drain without invoking the suite', async t => {
  const f = fixture(t), j = job(f), common = join(f.root, 'common'); mkdirSync(common);
  const held = lease(common, j.dir, f.request, j.state); write(join(j.dir, 'worker.json'), { lease: held });
  cancelJob(j.dir, f.request); let dispatches = 0;
  const state = await runWorker(j.dir, { identity: () => worker, executeSuite: async () => { dispatches++; } });
  assert.equal(state.phase, 'cancelled', state.error); assert.equal(state.drained, true); assert.equal(dispatches, 0); assert.equal(existsSync(held), false);
  assert.deepEqual(proveDrain(join(j.dir, 'suite')), []);
});
test('R2 shared-launcher setup is covered by the overall deadline and scoped cancellation before suite dispatch', async t => {
  for (const cancel of [false, true]) {
    const f = fixture(t); f.request.remote.timeouts.workload_seconds = cancel ? 10 : 1;
    const j = job(f), common = join(f.root, 'common'); mkdirSync(common);
    const held = lease(common, j.dir, f.request, j.state); write(join(j.dir, 'worker.json'), { lease: held });
    let suiteDispatches = 0, setupStarted;
    const started = new Promise(r => { setupStarted = r; });
    const running = runWorker(j.dir, { identity: () => worker, pollMs: 10, executeSuite: async () => { suiteDispatches++; }, launchSetup: async ({ signal, onDiagnostic, ...command }) => {
      setupStarted(); await new Promise(r => { if (signal.aborted) r(); else signal.addEventListener('abort', r, { once: true }); });
      return inertLifecycle(command, { cancelled: cancel, timedOut: !cancel });
    } });
    issuePermit(j.dir, f.request, readState(j.dir, f.request), worker);
    await started; if (cancel) cancelJob(j.dir, f.request);
    const state = await running;
    assert.equal(state.phase, cancel ? 'cancelled' : 'failed', state.error); assert.equal(state.drained, true); assert.equal(suiteDispatches, 0); assert.equal(existsSync(held), false);
    assert.equal(proveDrain(join(j.dir, 'suite')).length, 1);
  }
});
test('R2 cancellation reconciles dead setup and exact stale state lock, never a live or unknown owner', t => {
  const f = fixture(t), j = job(f), common = join(f.root, 'common'); mkdirSync(common);
  const held = lease(common, j.dir, f.request, j.state); write(join(j.dir, 'worker.json'), { lease: held });
  write(join(j.dir, 'setup.json'), { version: 1, ...binding(f.request), owner: worker, token: j.state.token });
  const lock = join(j.dir, 'state.lock'); mkdirSync(lock); write(join(lock, 'owner.json'), { version: 1, token: randomUUID(), process: worker });
  assert.throws(() => recoverStateLock(j.dir, () => worker), /live|unobservable/); assert.equal(existsSync(held), true);
  const recovered = cancelObserved(j.dir, f.request, owner => ({ pid: owner.pid, absent: true }));
  assert.equal(recovered.state.phase, 'unknown'); assert.equal(recovered.reconciliation.released, true); assert.equal(recovered.state.drained, false);
});
test('Windows inert live owner uses the same creation identity encoding and cannot be reclaimed', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t), j = job(f), owner = currentOwner();
  assert.deepEqual(processIdentity(process.pid, f.root), owner);
  const lock = join(j.dir, 'state.lock'); mkdirSync(lock); write(join(lock, 'owner.json'), { version: 1, token: randomUUID(), process: owner });
  assert.throws(() => recoverStateLock(j.dir, identity => processIdentity(identity.pid, f.root)), /live|unobservable/);
});
test('R3 archive rejects traversal, casefold duplicates, extra/missing members, byte tampering and unsupported versions', t => {
  const f = fixture(t), member = { path: 'safe.txt', bytes: 1, sha256: hash('x') };
  function raw(header, bytes = Buffer.from('x')) { const file = join(f.root, randomUUID()), text = Buffer.from(canonical(header)), length = Buffer.alloc(8); length.writeBigUInt64BE(BigInt(text.length)); writeFileSync(file, Buffer.concat([length, text, bytes])); return file; }
  const base = { version: 1, kind: 'unreal-remote/archive', members: [member] };
  for (const bad of [{ ...base, version: 2 }, { ...base, members: [{ ...member, path: '../escape' }] }, { ...base, members: [member, { ...member, path: 'SAFE.txt' }] }, { ...base, members: [{ ...member, path: 'C:/escape' }] }, { ...base, members: [{ ...member, path: 'folder\\escape' }] }]) assert.throws(() => unpack(raw(bad), join(f.root, randomUUID())));
  assert.throws(() => unpack(raw(base), join(f.root, randomUUID()), []), /member set/);
  assert.throws(() => unpack(raw(base, Buffer.alloc(0)), join(f.root, randomUUID())), /Truncated/);
  assert.throws(() => unpack(raw(base, Buffer.from('y')), join(f.root, randomUUID())), /bytes changed/);
  assert.throws(() => unpack(raw(base, Buffer.from('xx')), join(f.root, randomUUID())), /trailing/);
});
test('R3 verified failed transfer remains unqualified and accepts any fresh ignored target under checkout', async t => {
  const f = fixture(t), j = terminal(f), c = loadConfig(f.config); let qualifications = 0;
  const transport = { fetch: async () => publishReturn(j.dir, f.request), download: async (from, to) => cpSync(from, to), qualify: async (request, archive, expected) => { qualifications++; return qualifyReturn(j.dir, request, archive, expected); } };
  const output = join(f.source, 'out/result');
  const result = await receive({ config: c, request: f.request, output, transport });
  assert.equal(result.transfer_valid, true); assert.equal(result.qualified, false); assert.equal(qualifications, 1); assert.equal(existsSync(join(output, 'evidence/fetch.json')), true);
  assert.throws(() => ignored(f.source, join(f.source, 'out/sibling')), /ignored/);
  await assert.rejects(receive({ config: c, request: f.request, output, transport }), /already exists/);
});
test('R3 tampered download never invokes suite qualification or publishes output', async t => {
  const f = fixture(t), j = terminal(f); let qualifications = 0;
  const output = join(f.source, 'out/result');
  await assert.rejects(receive({ config: loadConfig(f.config), request: f.request, output, transport: { fetch: async () => publishReturn(j.dir, f.request), download: async (a, b) => { cpSync(a, b); appendFileSync(b, 'tamper'); }, qualify: async () => { qualifications++; } } }), /identity differs/);
  assert.equal(qualifications, 0); assert.equal(existsSync(output), false);
});
test('R3 wrong request/source/job/version, contradictory result and undrained completion refuse', t => {
  const f = fixture(t), j = terminal(f), returned = publishReturn(j.dir, f.request);
  for (const mutate of [d => d.job = 'other', d => d.request_sha256 = hash('wrong'), d => d.source_sha256 = hash('wrong'), d => d.version = 2, d => d.drained = false, d => d.result_sha256 = hash('wrong'), d => d.state_sha256 = hash('wrong')]) {
    const bad = structuredClone(returned.descriptor); mutate(bad); assert.throws(() => verifyDownload(returned.archive, join(f.root, randomUUID()), bad, f.request, false));
  }
  const expected = verifyDownload(returned.archive, join(f.root, 'valid'), returned.descriptor, f.request, false), proof = qualifyReturn(j.dir, f.request, returned.archive, expected);
  proof.qualified = true; assert.throws(() => verifyQualification(proof, returned.descriptor, f.request), /contradicts/);
});
test('R3 unknown requires explicit diagnostic Fetch and can never qualify', t => {
  const f = fixture(t), j = terminal(f, 'unknown');
  assert.throws(() => publishReturn(j.dir, f.request), /diagnostic/);
  const returned = publishReturn(j.dir, f.request, { diagnostic: true });
  assert.throws(() => verifyDownload(returned.archive, join(f.root, 'refused'), returned.descriptor, f.request, false));
  const expected = verifyDownload(returned.archive, join(f.root, 'diagnostic'), returned.descriptor, f.request, true);
  assert.equal(verifyQualification(qualifyReturn(j.dir, f.request, returned.archive, expected), returned.descriptor, f.request).qualified, false);
});
test('R3 a terminal boolean cannot substitute for issued launcher drain evidence', t => {
  const f = fixture(t), j = terminal(f);
  write(join(j.dir, 'dispatch-000000.json'), { version: 1, ...binding(f.request), path: '000-rules/launcher' });
  const returned = publishReturn(j.dir, f.request), expected = verifyDownload(returned.archive, join(f.root, 'download'), returned.descriptor, f.request, false);
  assert.throws(() => qualifyReturn(j.dir, f.request, returned.archive, expected), /ledger|request/);
});
test('R3 output and archive reject symlink/junction ancestors without changing their target', async t => {
  const f = fixture(t), outside = join(f.root, 'outside'); mkdirSync(outside); mkdirSync(join(f.source, 'local')); symlinkSync(outside, join(f.source, 'local/link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => ignored(f.source, join(f.source, 'local/link/new')), /Symlink|junction/);
  assert.equal(existsSync(join(outside, 'new')), false);
});

test('R3 successful Fetch calls the unchanged suite verifier on original paths and retains original receipt bytes', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 0, 1) });
  const f = fixture(t), j = job(f), engine = join(f.root, 'engine');
  const exe = join(engine, 'Engine/Binaries/Win64/UnrealEditor-Cmd.exe'); mkdirSync(dirname(exe), { recursive: true }); writeFileSync(exe, 'inert fixture');
  const configFile = join(f.root, 'project.json'); write(configFile, { version: 1, project: join(f.source, 'Sample.uproject'), engine, sourceRoot: f.source, editorTarget: 'SampleEditor', gameTarget: 'Sample' });
  const prepared = prepare({ project: configFile, manifest: join(f.source, 'manifest.json'), suite: 'small' });
  const timedWrite = (file, value) => { write(file, value); utimesSync(file, new Date(), new Date()); };
  const suite = join(j.dir, 'suite');
  const aggregate = await execute(prepared, suite, { launch: async command => {
    mkdirSync(command.evidence); const identity = pid => ({ pid, created: '133000000000000000' });
    const request = { version: 1, kind: 'unreal-run/request', id: randomUUID(), nonce: 'a'.repeat(64), purpose: 'production', lock: LOCK, state: join(f.root, 'inert-state'), node: process.execPath, controllerPid: 1, controllerCreated: identity(1).created, ...command };
    timedWrite(join(command.evidence, 'request.json'), request); const requestHash = hash(readFileSync(join(command.evidence, 'request.json')));
    timedWrite(join(command.evidence, 'lifecycle.json'), { version: 1, kind: 'unreal-run/lifecycle', id: request.id, requestHash, operation: 'test', purpose: 'production', lock: LOCK, controller: identity(1), helper: identity(2), gate: identity(3), probe: identity(4), processes: [1, 2, 3, 4].map(identity), started: now(), finished: now(), contained: true, probeContained: true, permitIssued: true, permit: { requestHash, gate: identity(3) }, exitCode: 0, cancelled: false, timedOut: false, errors: [], drain: { proved: true, active: 0, members: [], requestHash, observed: now() } });
    const report = join(dirname(command.evidence), 'report'); mkdirSync(report);
    timedWrite(join(report, 'index.json'), { succeeded: 1, succeededWithWarnings: 0, failed: 0, notRun: 0, inProcess: 0, tests: [{ fullTestPath: 'RemoteFixture.Rule', state: 'Success', errors: 0, warnings: 0 }] });
  } });
  assert.equal(aggregate.qualified, true, canonical(aggregate));
  write(join(j.dir, 'dispatch-ledger.json'), { version: 1, kind: 'unreal-remote/dispatch-ledger', ...binding(f.request), paths: ['000-rules/launcher'] });
  write(join(j.dir, 'dispatch-000000.json'), { version: 1, ...binding(f.request), path: '000-rules/launcher', command_sha256: digest(json(join(suite, '000-rules/command.json'))) });
  let s = transition(j.dir, f.request, j.state, { phase: 'ready', worker }); s = transition(j.dir, f.request, s, { phase: 'running' }); s = transition(j.dir, f.request, s, { phase: 'succeeded', drained: true });
  write(join(j.dir, 'result.json'), { version: 1, kind: 'unreal-remote/result', ...binding(f.request), phase: 'succeeded', drained: true, drain: proveDrain(suite), suite_sha256: fileIdentity(join(suite, 'regression.json')).sha256 });
  const returned = publishReturn(j.dir, f.request), downloaded = join(f.root, 'download'), expected = verifyDownload(returned.archive, downloaded, returned.descriptor, f.request, false);
  assert.deepEqual(readFileSync(join(downloaded, 'suite/regression.json')), readFileSync(join(suite, 'regression.json')));
  assert.equal(json(join(downloaded, 'suite/regression.json')).output, suite);
  const qualified = qualifyReturn(j.dir, f.request, returned.archive, expected);
  assert.equal(verifyQualification(qualified, returned.descriptor, f.request).qualified, true, canonical(qualified));
  appendFileSync(join(f.source, 'Sample.uproject'), '\n');
  const changed = qualifyReturn(j.dir, f.request, returned.archive, expected);
  assert.equal(verifyQualification(changed, returned.descriptor, f.request).qualified, false);
});
