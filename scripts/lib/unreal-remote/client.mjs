import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { json, write, canonical, fileIdentity, pack, digest, now } from './files.mjs';
import { loadConfig, jobId, validateRequest, validateState } from './contracts.mjs';
import { snapshot, createBundle } from './source.mjs';
import { runtimePackage, sshTransport } from './transport.mjs';
import { receive } from './transfer.mjs';

export async function action(options, { makeTransport = sshTransport, packageRuntime = runtimePackage } = {}) {
  const config = loadConfig(options.config); jobId(options.job);
  mkdirSync(config.state_directory, { recursive: true });
  const directory = join(config.state_directory, options.job); mkdirSync(directory, { recursive: true });
  const runtimeDir = join(directory, `client-${randomUUID()}`); mkdirSync(runtimeDir);
  const runtime = packageRuntime(runtimeDir), transport = makeTransport(config, runtimeDir, runtime);
  const requestFile = join(directory, 'request.json'); let request = existsSync(requestFile) ? json(requestFile) : null;
  if (request) validateRequest(request);
  if (options.action === 'start') {
    const source = snapshot(config.source_root, options.commit, options.manifest, options.suite);
    const identity = { version: 1, kind: 'unreal-remote/request', job: options.job, source: source.identity, manifest: options.manifest, suite: options.suite, remote: config.remote, runtime: runtime.identity };
    const payloadFile = join(directory, 'payload.uar');
    if (request) {
      const { payload, ...prior } = request;
      if (canonical(prior) !== canonical(identity)) throw Error('Job ID/request mismatch or changed source, inputs, runtime or configuration');
      if (!existsSync(payloadFile) || canonical(fileIdentity(payloadFile)) !== canonical(payload)) throw Error('Cached source payload changed; retained job cannot be redispatched');
    } else {
      const bundle = join(directory, 'source.bundle'); createBundle(config.source_root, options.commit, bundle);
      const members = [{ path: 'source.bundle', source: bundle }];
      for (const oid of new Set(source.identity.lfs.map(m => m.oid))) members.push({ path: `lfs/${oid}`, source: join(source.media, oid.slice(0, 2), oid.slice(2, 4), oid) });
      pack(payloadFile, members);
      // Detect changes while bundle/LFS snapshotting before accepting an immutable request.
      if (canonical(snapshot(config.source_root, options.commit, options.manifest, options.suite).identity) !== canonical(source.identity)) throw Error('Source or inputs changed during snapshot');
      request = { ...identity, payload: fileIdentity(payloadFile) }; validateRequest(request); write(requestFile, request);
    }
    const prior = await transport.status(options.job, request);
    if (prior.found) return { repeated: true, ...prior };
    try { const state = await transport.start(request, payloadFile); validateState(state, request); return { repeated: false, state }; }
    catch (error) {
      // Timeout is uncertainty, never permission to launch again. Reconcile by the same immutable identity once.
      let reconciled;
      try { reconciled = await transport.status(options.job, request); } catch (observationError) { reconciled = { found: null, error: observationError.message, observed: now() }; }
      write(join(runtimeDir, 'reconciliation.json'), { error: error.message, reconciled });
      return { uncertain: true, error: error.message, reconciled, qualified: false };
    }
  }
  if (options.action === 'status') return transport.status(options.job, request);
  if (!request) {
    const observed = await transport.status(options.job);
    if (!observed.found) throw Error('Unknown remote job');
    request = observed.request; validateRequest(request); write(requestFile, request);
  }
  if (canonical(request.remote) !== canonical(config.remote)) throw Error('Local configuration differs from accepted job');
  if (options.action === 'cancel') return transport.cancel(request);
  return receive({ config, request, output: options.output, diagnostic: options.diagnostic === true, transport });
}
