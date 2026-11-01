import { existsSync, mkdirSync, cpSync, renameSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { json, write, safe, unpack, fileIdentity, canonical, digest, now } from './files.mjs';
import { validateRequest, binding, TERMINAL, jobId, remoteSettings } from './contracts.mjs';
import { git, materialize, ignored } from './source.mjs';
import { initialize, readState, transition, lease, issuePermit, cancelObserved, currentOwner } from './state.mjs';
import { processIdentity, windows, delay } from './worker.mjs';
import { publishReturn, qualifyReturn } from './transfer.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export async function startRemote(base, request, message, { launch = (directory) => windows('Launch', { node: request.remote.node, worker: join(here, 'worker.mjs'), job: directory }, directory), identity = processIdentity, pollMs = 100 } = {}) {
  validateRequest(request);
  const jobs = safe(join(base, 'jobs'), base); mkdirSync(jobs, { recursive: true });
  const directory = safe(join(jobs, request.job), jobs);
  if (existsSync(directory)) {
    if (!existsSync(join(directory, 'request.json'))) throw Error('Job initialization incomplete; inspect retained directory, never redispatch');
    if (canonical(json(join(directory, 'request.json'))) !== canonical(request)) throw Error('Job ID already binds a different request');
    return readState(directory, request);
  }
  const claim = `${directory}.init-${randomUUID()}`; mkdirSync(claim); write(join(claim, 'request.json'), request);
  let state = initialize(claim, request);
  write(join(claim, 'setup.json'), { version: 1, ...binding(request), token: state.token, owner: currentOwner(), observed: now() });
  try { renameSync(claim, directory); } catch (error) { if (existsSync(directory)) return startRemote(base, request, message, { launch, identity, pollMs }); throw error; }
  try {
    const repo = safe(join(base, 'repository.git'), base);
    if (!existsSync(repo)) {
      const candidate = `${repo}.init-${randomUUID()}`; mkdirSync(candidate); git(candidate, ['init', '--bare']); git(candidate, ['config', 'lfs.repositoryformatversion', '0']); git(candidate, ['config', 'core.autocrlf', request.source.checkout.autocrlf]); git(candidate, ['config', 'core.eol', request.source.checkout.eol]); write(join(candidate, 'remote-owner.json'), { version: 1, kind: 'unreal-remote/repository', root: base });
      try { renameSync(candidate, repo); } catch (error) { if (!existsSync(repo)) throw error; }
    }
    const owner = json(join(repo, 'remote-owner.json'));
    if (owner.kind !== 'unreal-remote/repository' || owner.root !== base) throw Error('Repository is not owned by remote jobs');
    const common = git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']).toString().trim();
    const held = lease(common, directory, request, state);
    const payloadFile = join(message, 'payload.uar');
    if (canonical(fileIdentity(payloadFile)) !== canonical(request.payload)) throw Error('Payload identity differs');
    const payload = join(directory, 'payload'); unpack(payloadFile, payload);
    const expected = ['source.bundle', ...new Set(request.source.lfs.map(m => `lfs/${m.oid}`))].sort();
    const { inventory } = await import('./files.mjs');
    if (canonical(inventory(payload).map(m => m.path).sort()) !== canonical(expected)) throw Error('Unexpected source payload members');
    write(join(directory, 'worker.json'), { version: 1, lease: held, payload, base });
    write(join(directory, 'dispatch-intent.json'), { version: 1, ...binding(request), token: state.token, observed: now() });
    const child = await launch(directory);
    write(join(directory, 'launch.json'), { version: 1, ...binding(request), token: state.token, pid: child.pid, observed: now() });
    const deadline = Date.now() + request.remote.timeouts.startup_seconds * 1000;
    while (Date.now() < deadline) {
      state = readState(directory, request);
      if (TERMINAL.includes(state.phase)) return state;
      if (state.worker) {
        const observed = identity(child.pid, directory);
        if (canonical(observed) !== canonical(state.worker)) throw Error('Detached worker creation identity differs');
        if (state.phase === 'ready') issuePermit(directory, request, state, observed);
        return state;
      }
      await delay(pollMs);
    }
    throw Error('Startup timed out; worker dispatch is uncertain. Reconcile this job ID; no second worker is launched');
  } catch (error) {
    state = readState(directory, request);
    if (!TERMINAL.includes(state.phase)) state = transition(directory, request, state, { phase: 'unknown', drained: false, error: error.message });
    return state;
  }
}
export function statusRemote(base, job, expectedHash) {
  jobId(job); const directory = safe(join(base, 'jobs', job), base);
  if (!existsSync(directory)) return { version: 1, kind: 'unreal-remote/status', job, found: false, observed: now() };
  const request = json(join(directory, 'request.json'));
  if (expectedHash && validateRequest(request) !== expectedHash) throw Error('Observed request identity differs');
  const state = readState(directory, request);
  const dispatches = readdirSync(directory).filter(n => /^dispatch-\d{6}\.json$/.test(n)).map(n => {
    const record = json(join(directory, n));
    if (!/^\d{3}-[a-z0-9.-]+\/launcher$/.test(record.path)) throw Error('Invalid dispatch progress path');
    return { path: record.path, observed: record.observed, workload_permit: existsSync(join(directory, 'suite', record.path, 'workload-permit.json')), lifecycle: existsSync(join(directory, 'suite', record.path, 'lifecycle.json')) };
  });
  return { version: 1, kind: 'unreal-remote/status', ...binding(request), found: true, observed: now(), state, request, dispatches };
}
export async function endpoint(messageFile) {
  if (process.platform !== 'win32') throw Error('Remote worker requires Windows');
  const message = json(messageFile);
  if (message.version !== 1 || !['start', 'status', 'cancel', 'fetch'].includes(message.action)) throw Error('Unsupported typed remote action');
  remoteSettings(message.remote); jobId(message.job);
  const base = safe(message.remote.root), owner = json(join(base, 'owner.json'));
  if (owner.version !== 1 || owner.kind !== 'unreal-remote/root' || resolve(owner.root) !== base) throw Error('Remote root ownership differs');
  if (message.action === 'start') {
    if (message.request.job !== message.job || canonical(message.request.remote) !== canonical(message.remote)) throw Error('Start envelope differs');
    return startRemote(base, message.request, dirname(messageFile));
  }
  const observed = statusRemote(base, message.job, message.request_sha256);
  if (!observed.found || message.action === 'status') return observed;
  const directory = join(base, 'jobs', message.job), request = observed.request;
  if (canonical(request.runtime) !== canonical(message.runtime)) throw Error('Job implementation snapshot differs; use the exact client/runtime snapshot recorded at Start');
  if (message.action === 'cancel') return cancelObserved(directory, request, observed => processIdentity(observed.pid, dirname(messageFile)));
  if (message.finalize) return qualifyReturn(directory, request, safe(message.finalize.archive, directory), message.finalize.binding);
  return publishReturn(directory, request, { diagnostic: message.diagnostic === true });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) endpoint(resolve(process.argv[2])).then(value => console.log(JSON.stringify(value))).catch(error => { console.error(error.message); process.exitCode = 2; });
