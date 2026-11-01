import { mkdirSync, rmdirSync, existsSync, renameSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { atomic, write, json, now, canonical } from './files.mjs';
import { binding, validateState, TERMINAL } from './contracts.mjs';
import { proveDrain } from './worker.mjs';

let processOwner;
export function currentOwner() {
  processOwner ??= { pid: process.pid, created: process.platform === 'win32' ? execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('../unreal-run/observe.ps1', import.meta.url)), '-Kind', 'process', '-ProcessId', String(process.pid)], { timeout: 20000, windowsHide: true, encoding: 'utf8' }).trim() : String(Math.floor((Date.now() - process.uptime() * 1000) * 10000)) };
  return processOwner;
}
function lockState(directory) {
  const token = randomUUID(), claim = join(directory, `state-claim-${token}`), lock = join(directory, 'state.lock'); mkdirSync(claim);
  write(join(claim, 'owner.json'), { version: 1, token, process: currentOwner() });
  try { renameSync(claim, lock); } catch { throw Error('State CAS busy; inspect retained state and retry by the same job ID'); }
  return () => { const owner = json(join(lock, 'owner.json')); if (owner.token !== token) throw Error('State lock ownership changed'); unlinkSync(join(lock, 'owner.json')); rmdirSync(lock); };
}
export function recoverStateLock(directory, observe) {
  const lock = join(directory, 'state.lock'); if (!existsSync(lock)) return false;
  const recovery = join(directory, 'state.recovery');
  try { mkdirSync(recovery); } catch { throw Error('State recovery already claimed; retain evidence and reconcile its exact owner before retrying'); }
  write(join(recovery, 'owner.json'), { version: 1, process: currentOwner(), observed: now() });
  try {
  const owner = json(join(lock, 'owner.json'));
  if (owner.version !== 1 || !owner.token || !owner.process?.created || readdirSync(lock).length !== 1) throw Error('Unknown state lock ownership; preserve it for inspection');
  const observed = observe(owner.process);
  if (!(observed?.pid === owner.process.pid && (observed.absent === true || typeof observed.created === 'string' && observed.created !== owner.process.created))) throw Error('State lock owner remains live or unobservable');
  if (canonical(json(join(lock, 'owner.json'))) !== canonical(owner)) throw Error('State lock changed during recovery');
  const request = json(join(directory, 'request.json')), current = readState(directory, request), nextFile = join(directory, `state-${String(current.sequence + 1).padStart(6, '0')}.json`);
  if (existsSync(nextFile)) {
    const published = validateState(json(nextFile), request);
    if (published.sequence !== current.sequence + 1 || published.token !== current.token) throw Error('Interrupted CAS history differs');
    atomic(join(directory, 'state.json'), published);
  }
  renameSync(lock, `${lock}.recovered-${owner.token}`); return true;
  } finally { unlinkSync(join(recovery, 'owner.json')); rmdirSync(recovery); }
}

export function readState(directory, request) { return validateState(json(join(directory, 'state.json')), request); }
export function initialize(directory, request) {
  const state = { version: 1, kind: 'unreal-remote/state', ...binding(request), token: randomUUID(), sequence: 0, phase: 'launch_pending', observed: now(), worker: null, drained: false, error: null };
  write(join(directory, 'state-000000.json'), state); write(join(directory, 'state.json'), state); return state;
}
const next = { launch_pending: ['ready', 'cancelling', 'unknown'], ready: ['running', 'cancelling', 'cancelled', 'unknown'], running: ['cancelling', 'succeeded', 'failed', 'cancelled', 'unknown'], cancelling: ['cancelled', 'failed', 'unknown'], succeeded: [], failed: [], cancelled: [], unknown: [] };
export function transition(directory, request, expected, patch) {
  const unlock = lockState(directory);
  try {
    const current = readState(directory, request);
    if (current.sequence !== expected.sequence || current.token !== expected.token || current.request_sha256 !== expected.request_sha256) throw Error('Stale competing state transition');
    if (patch.phase !== current.phase && !next[current.phase].includes(patch.phase)) throw Error('Forbidden state transition');
    const value = { ...current, ...patch, ...binding(request), token: current.token, sequence: current.sequence + 1, observed: now() };
    validateState(value, request);
    write(join(directory, `state-${String(value.sequence).padStart(6, '0')}.json`), value); atomic(join(directory, 'state.json'), value); return value;
  } finally { unlock(); }
}
export function lease(common, directory, request, state) {
  const root = join(common, 'agent-unreal-remote-worker');
  try { mkdirSync(root); } catch { throw Error('Repository worker lease exists; inspect its exact job and retained drain evidence. No lease was cleared'); }
  write(join(root, 'owner.json'), { version: 1, ...binding(request), token: state.token, directory });
  return root;
}
export function checkLease(root, request, state) {
  const owner = json(join(root, 'owner.json'));
  if (owner.version !== 1 || canonical({ ...binding(request), token: state.token }) !== canonical({ job: owner.job, request_sha256: owner.request_sha256, source_sha256: owner.source_sha256, token: owner.token })) throw Error('Worker lease ownership differs');
  return owner;
}
export function releaseLease(root, request, state) {
  checkLease(root, request, state);
  if (!TERMINAL.includes(state.phase) || state.phase === 'unknown' || !state.drained) throw Error('Worker lease cannot be released without drain');
  // Keep the immutable lease as evidence; rename only this exact owned directory.
  atomic(join(root, 'released.json'), { ...binding(request), token: state.token, observed: now() });
  renameSync(root, `${root}.released-${state.token}`);
}
export function cancelJob(directory, request) {
  const state = readState(directory, request);
  if (TERMINAL.includes(state.phase)) return state;
  const cancel = { version: 1, ...binding(request), token: state.token };
  const file = join(directory, 'cancel.json');
  if (existsSync(file)) { if (canonical(json(file)) !== canonical(cancel)) throw Error('Cancellation identity differs'); }
  else write(file, cancel);
  if (state.phase === 'cancelling') return state;
  return transition(directory, request, state, { phase: 'cancelling' });
}
export function cancelled(directory, request, state) {
  const file = join(directory, 'cancel.json'); if (!existsSync(file)) return false;
  if (canonical(json(file)) !== canonical({ version: 1, ...binding(request), token: state.token })) throw Error('Cancellation identity differs');
  return true;
}
export function issuePermit(directory, request, expected, worker) {
  const unlock = lockState(directory);
  try {
    const state = readState(directory, request);
    if (state.sequence !== expected.sequence || state.token !== expected.token || state.phase !== 'ready' || canonical(state.worker) !== canonical(worker)) throw Error('Permit fencing rejected changed state');
    write(join(directory, 'permit.json'), { version: 1, ...binding(request), token: state.token, worker });
  } finally { unlock(); }
}
export function reconcileLease(directory, request, observeWorker) {
  const unlock = lockState(directory);
  try {
    const state = readState(directory, request);
    if (state.phase !== 'unknown') throw Error('Recovery only reconciles unknown ownership');
    const metadataFile = join(directory, 'worker.json');
    const root = existsSync(metadataFile) ? json(metadataFile).lease : join(request.remote.root, 'repository.git', 'agent-unreal-remote-worker');
    if (!existsSync(root)) return { released: false, reason: 'No active lease exists; unknown evidence stays unqualified' };
    checkLease(root, request, state);
    const permit = existsSync(join(directory, 'permit.json'));
    let proofs = [], observation = null;
    if (permit) {
      if (!existsSync(join(directory, 'dispatch-ledger.json'))) return { released: false, reason: 'Missing post-permit dispatch ledger; preserve lease and original evidence' };
      if (!state.worker) return { released: false, reason: 'Permit exists without exact worker identity; retain lease and inspect owned launcher evidence' };
      observation = observeWorker(state.worker);
      if (!(observation?.absent === true && observation.pid === state.worker.pid) && !(observation?.pid === state.worker.pid && typeof observation.created === 'string' && observation.created !== state.worker.created)) return { released: false, reason: 'Exact worker remains live or its identity is unobservable; retain lease' };
      try { proofs = proveDrain(join(directory, 'suite')); }
      catch (error) { return { released: false, reason: `${error.message}. Use unreal-run status and its documented exact-owner recovery; preserve lease until recorded Job drain is established` }; }
    }
    const proof = { version: 1, ...binding(request), token: state.token, observed: now(), no_permit: !permit, worker: observation, drain: proofs, phase: 'unknown', qualified: false, reason: permit ? 'Exact worker gone and every issued launcher request has verified drain' : 'No engine permit; immutable unknown state fences every future permit' };
    write(join(root, 'reconciliation.json'), proof); renameSync(root, `${root}.reconciled-${state.token}`);
    return { released: true, proof };
  } finally { unlock(); }
}
export function cancelObserved(directory, request, observe) {
  recoverStateLock(directory, observe);
  let state = cancelJob(directory, request);
  if (!TERMINAL.includes(state.phase)) {
    const setup = json(join(directory, 'setup.json')), owner = state.worker ?? setup.owner;
    const observed = observe(owner);
    if (observed?.pid === owner.pid && (observed.absent === true || typeof observed.created === 'string' && observed.created !== owner.created)) state = transition(directory, request, state, { phase: 'unknown', drained: false, error: state.worker ? 'Exact worker disappeared; cancellation cannot imply drain' : 'Exact setup owner disappeared before a worker established ownership' });
  }
  return state.phase === 'unknown' ? { state, reconciliation: reconcileLease(directory, request, observe) } : state;
}
