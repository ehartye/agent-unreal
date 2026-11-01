import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { prepare } from '../unreal-verify/manifest.mjs';
import { execute, verifyReceipt, productionLaunch } from '../unreal-verify/runner.mjs';
import { validateRequest as launcherRequest, verifyLifecycle } from '../unreal-run/contracts.mjs';
import { json, write, digest, hash, canonical, now, inventory } from './files.mjs';
import { readState, transition, cancelled, checkLease, releaseLease } from './state.mjs';
import { binding, TERMINAL } from './contracts.mjs';
import { materialize, ignored } from './source.mjs';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
export const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
export function windows(action, message, directory) {
  const file = join(directory, `windows-${randomUUID()}.json`); write(file, { version: 1, ...message });
  return JSON.parse(execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', join(here, 'windows.ps1'), '-Action', action, '-Message', file], { windowsHide: true, timeout: 20000, encoding: 'utf8' }));
}
export function processIdentity(pid, directory) { return windows('Identity', { pid }, directory); }
export function proveDrain(suite) {
  const proofs = [];
  const directory = dirname(suite), ledger = json(join(directory, 'dispatch-ledger.json'));
  if (ledger.version !== 1 || ledger.kind !== 'unreal-remote/dispatch-ledger' || !Array.isArray(ledger.paths)) throw Error('Missing dispatch ledger');
  const issued = readdirSync(directory).filter(name => /^dispatch-\d{6}\.json$/.test(name)).map(name => json(join(directory, name)));
  if (issued.some(m => m.version !== 1 || m.request_sha256 !== ledger.request_sha256 || !ledger.paths.includes(m.path)) || new Set(issued.map(m => m.path)).size !== issued.length) throw Error('Dispatch ledger identity differs');
  const requests = existsSync(suite) ? inventory(suite).filter(m => m.path.endsWith('/launcher/request.json')) : [];
  if (canonical(requests.map(m => m.path).sort()) !== canonical(issued.map(m => `${m.path}/request.json`).sort())) throw Error('Missing or unexpected issued launcher request');
  for (const m of requests) {
    const file = join(suite, m.path), bytes = readFileSync(file), request = JSON.parse(bytes);
    const lifecycle = json(join(dirname(file), 'lifecycle.json'));
    const errors = [...launcherRequest(request), ...verifyLifecycle(lifecycle, { requestId: request.id, requestHash: hash(bytes), requireSuccess: false }).errors];
    if (errors.length) throw Error(`Owned engine drain unproved: ${errors.join('; ')}`);
    proofs.push({ request: m.path, request_sha256: hash(bytes), lifecycle_sha256: digest(lifecycle), processes: lifecycle.processes, drain: lifecycle.drain, permit_issued: lifecycle.permitIssued });
  }
  return proofs;
}
export async function runWorker(directory, { executeSuite = execute, identity = processIdentity, pollMs = 100 } = {}) {
  const request = json(join(directory, 'request.json')), metadata = json(join(directory, 'worker.json'));
  let state = readState(directory, request), controller;
  const log = message => appendFileSync(join(directory, 'worker.log'), `${now()} ${message}\n`);
  try {
    checkLease(metadata.lease, request, state);
    const worker = identity(process.pid, directory);
    if (state.phase === 'launch_pending') state = transition(directory, request, state, { phase: 'ready', worker });
    else if (state.phase === 'cancelling') state = transition(directory, request, state, { phase: 'cancelling', worker });
    else throw Error('Worker start no longer owns launch_pending state');
    const deadline = Date.now() + request.remote.timeouts.startup_seconds * 1000;
    log('ready; waiting for identity-bound dispatch permit');
    while (!existsSync(join(directory, 'permit.json'))) {
      if (cancelled(directory, request, state)) break;
      if (Date.now() >= deadline) throw Error('Startup timed out before workload permit; inspect exact job state and retained worker lease; no automatic retry');
      await delay(pollMs);
    }
    state = readState(directory, request); checkLease(metadata.lease, request, state);
    if (!cancelled(directory, request, state)) {
      const permit = json(join(directory, 'permit.json'));
      if (canonical(permit) !== canonical({ version: 1, ...binding(request), token: state.token, worker })) throw Error('Worker dispatch permit differs');
      if (state.phase !== 'ready' || canonical(state.worker) !== canonical(worker)) throw Error('Worker state ownership differs');
      state = transition(directory, request, state, { phase: 'running' });
      log('materializing exact bundle and LFS objects');
      const worktree = materialize(metadata.base, request, metadata.payload);
      const launcher = { ...request.remote.launcher, project: join(worktree, request.remote.launcher.project), sourceRoot: worktree };
      if (launcher.packageDirectory) launcher.packageDirectory = ignored(worktree, join(worktree, launcher.packageDirectory));
      const project = join(directory, 'project.json'); write(project, launcher);
      const prepared = prepare({ project, manifest: join(worktree, request.manifest), suite: request.suite });
      if (prepared.source.commit !== request.source.commit || prepared.source.snapshot !== request.source.snapshot || prepared.source.dirty) throw Error('Worker source differs from accepted request');
      for (const input of [prepared.manifest, ...Object.values(prepared.inputs)]) if (!request.source.inputs.some(m => m.sha256 === input.sha256 && m.bytes === input.bytes)) throw Error('Worker input differs from accepted snapshot');
      write(join(directory, 'prepared.json'), prepared);
      write(join(directory, 'dispatch-ledger.json'), { version: 1, kind: 'unreal-remote/dispatch-ledger', ...binding(request), paths: prepared.plan.map((s, i) => `${String(i).padStart(3, '0')}-${s.id}/launcher`) });
      state = readState(directory, request);
      if (cancelled(directory, request, state)) controller = new AbortController();
      else {
      controller = new AbortController(); let controlError;
      const poll = setInterval(() => { try { if (cancelled(directory, request, readState(directory, request))) controller.abort(); } catch (error) { controlError = error; controller.abort(); } }, pollMs);
      const timer = setTimeout(() => { log('workload deadline reached; requesting owned drain'); controller.abort(); }, request.remote.timeouts.workload_seconds * 1000);
      let dispatch = 0;
      const launch = async (command, planned, signal) => {
        checkLease(metadata.lease, request, readState(directory, request));
        const path = command.evidence.slice(join(directory, 'suite').length + 1).replaceAll('\\', '/');
        write(join(directory, `dispatch-${String(dispatch++).padStart(6, '0')}.json`), { version: 1, ...binding(request), path, command_sha256: digest(command), observed: now() });
        return productionLaunch(command, planned, signal);
      };
      try { log('suite dispatch'); await executeSuite(prepared, join(directory, 'suite'), { signal: controller.signal, launch }); }
      finally { clearInterval(poll); clearTimeout(timer); }
      if (controlError) throw controlError;
      }
    }
    state = readState(directory, request); checkLease(metadata.lease, request, state);
    if (state.phase === 'unknown') throw Error('Worker lost state authority');
    if (!existsSync(join(directory, 'dispatch-ledger.json'))) write(join(directory, 'dispatch-ledger.json'), { version: 1, kind: 'unreal-remote/dispatch-ledger', ...binding(request), paths: [] });
    const drain = proveDrain(join(directory, 'suite'));
    let verification = { valid: false, qualified: false, errors: ['Cancelled before suite dispatch'] };
    if (existsSync(join(directory, 'suite/regression.json'))) verification = verifyReceipt(join(directory, 'suite/regression.json'));
    const phase = cancelled(directory, request, state) ? 'cancelled' : verification.valid && verification.qualified ? 'succeeded' : 'failed';
    const result = { version: 1, kind: 'unreal-remote/result', ...binding(request), phase, drained: true, worker, drain, suite_sha256: existsSync(join(directory, 'suite/regression.json')) ? hash(readFileSync(join(directory, 'suite/regression.json'))) : null, verification, finished: now(), errors: [] };
    // Result is durable before terminal state is visible. A crash in between remains conservatively nonterminal.
    write(join(directory, 'result.json'), result);
    state = transition(directory, request, state, { phase, drained: true }); releaseLease(metadata.lease, request, state);
    log(`${phase}; drain recorded`); return state;
  } catch (error) {
    log(`unknown: ${error.message}`);
    state = readState(directory, request);
    if (!TERMINAL.includes(state.phase)) state = transition(directory, request, state, { phase: 'unknown', drained: false, error: error.message });
    return state;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runWorker(resolve(process.argv[2])).then(s => { process.exitCode = s.phase === 'succeeded' || s.phase === 'cancelled' ? 0 : 1; }).catch(error => { console.error(error.message); process.exitCode = 2; });
