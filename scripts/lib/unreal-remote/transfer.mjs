import { existsSync, mkdirSync, renameSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inventory, pack, unpack, json, write, fileIdentity, canonical, digest, now, safe } from './files.mjs';
import { assertBinding, binding, validateState, TERMINAL } from './contracts.mjs';
import { readState } from './state.mjs';
import { verifyReceipt } from '../unreal-verify/runner.mjs';
import { ignored } from './source.mjs';
import { proveDrain } from './worker.mjs';

export function publishReturn(directory, request, { diagnostic = false } = {}) {
  const state = readState(directory, request);
  if (!TERMINAL.includes(state.phase) || state.phase === 'unknown' && !diagnostic) throw Error('Fetch requires terminal state; unknown needs explicit --diagnostic');
  const resultFile = join(directory, 'result.json');
  const result = existsSync(resultFile) ? json(resultFile) : { version: 1, kind: 'unreal-remote/result', ...binding(request), phase: 'unknown', drained: false, errors: [state.error ?? 'No worker result established'] };
  assertBinding(result, request);
  if (result.version !== 1 || result.kind !== 'unreal-remote/result' || result.phase !== state.phase || result.drained !== state.drained) throw Error('Result/state completion differs');
  const snapshot = join(directory, `return-${randomUUID()}`); mkdirSync(snapshot);
  // Metadata is frozen per fetch. Original suite evidence is never rewritten or relocated for verification.
  write(join(snapshot, 'request.json'), request); write(join(snapshot, 'state.json'), state); write(join(snapshot, 'result.json'), result);
  const sources = inventory(snapshot).map(m => ({ path: m.path, source: join(snapshot, m.path) }));
  for (const name of readdirSync(directory).filter(n => n === 'dispatch-ledger.json' || /^dispatch-\d{6}\.json$/.test(n))) sources.push({ path: name, source: join(directory, name) });
  const suite = join(directory, 'suite');
  if (existsSync(suite)) for (const m of inventory(suite)) sources.push({ path: `suite/${m.path}`, source: join(suite, m.path) });
  const archive = join(snapshot, 'evidence.uar'), packed = pack(archive, sources);
  const descriptor = { version: 1, kind: 'unreal-remote/transfer', ...binding(request), phase: state.phase, drained: state.drained, result_sha256: digest(result), state_sha256: digest(state), archive: packed, verification: null, qualified: false };
  write(join(snapshot, 'descriptor.json'), descriptor);
  return { descriptor, archive };
}
export function qualifyReturn(directory, request, archive, expected) {
  safe(archive, directory);
  const snapshot = dirname(archive);
  if (!/^return-[a-f0-9-]{36}$/.test(snapshot.slice(directory.length + 1)) || archive !== join(snapshot, 'evidence.uar')) throw Error('Unexpected return snapshot');
  const descriptor = json(join(snapshot, 'descriptor.json'));
  assertBinding(descriptor, request);
  if (canonical(expected) !== canonical({ request_sha256: digest(request), source_sha256: digest(request.source), result_sha256: descriptor.result_sha256, archive_sha256: descriptor.archive.sha256 })) throw Error('Fetch finalization binding differs');
  if (canonical(fileIdentity(archive)) !== canonical({ bytes: descriptor.archive.bytes, sha256: descriptor.archive.sha256 })) throw Error('Remote archive changed before qualification');
  const state = readState(directory, request);
  if (digest(state) !== descriptor.state_sha256) throw Error('State changed before remote qualification');
  const sources = descriptor.archive.members.map(m => ({ ...m, source: m.path.startsWith('suite/') || m.path.startsWith('dispatch-') ? join(directory, m.path) : join(snapshot, m.path) }));
  const unchanged = () => { for (const m of sources) if (canonical(fileIdentity(m.source)) !== canonical({ bytes: m.bytes, sha256: m.sha256 })) throw Error('Original evidence changed during remote qualification'); };
  unchanged();
  const suite = join(directory, 'suite');
  if (state.phase !== 'unknown') {
    const result = json(join(snapshot, 'result.json')), ledger = json(join(directory, 'dispatch-ledger.json'));
    assertBinding(ledger, request);
    if (canonical(proveDrain(suite)) !== canonical(result.drain)) throw Error('Recorded terminal drain differs from complete launcher dispatch proof');
  }
  let suiteVerification = { valid: false, qualified: false, outcome: state.phase, errors: ['No completed suite receipt'] };
  const receipt = join(suite, 'regression.json');
  if (existsSync(receipt)) {
    try {
      const aggregate = json(receipt), result = json(join(snapshot, 'result.json'));
      if (result.suite_sha256 !== fileIdentity(receipt).sha256 || aggregate.prepared.source.commit !== request.source.commit || aggregate.prepared.source.snapshot !== request.source.snapshot || aggregate.prepared.suite !== request.suite || !request.source.inputs.some(m => m.path === request.manifest && m.sha256 === aggregate.prepared.manifest.sha256)) throw Error('Original suite/request/source binding differs');
      suiteVerification = verifyReceipt(receipt);
    } catch (error) { suiteVerification.errors = [error.message]; }
  }
  unchanged();
  if (canonical(readState(directory, request)) !== canonical(state)) throw Error('State changed during return publication');
  const qualified = state.phase === 'succeeded' && state.drained && suiteVerification.valid && suiteVerification.qualified;
  return { ...descriptor, verification: { location: 'original-remote-paths', observed: now(), ...expected, suite: suiteVerification }, qualified };
}
export function verifyDownload(archive, stage, descriptor, request, diagnostic) {
  assertBinding(descriptor, request);
  if (descriptor.version !== 1 || descriptor.kind !== 'unreal-remote/transfer' || !TERMINAL.includes(descriptor.phase) || descriptor.phase === 'unknown' && !diagnostic || descriptor.phase !== 'unknown' && descriptor.drained !== true) throw Error('Unsupported or undrained transfer state');
  if (canonical(fileIdentity(archive)) !== canonical({ bytes: descriptor.archive?.bytes, sha256: descriptor.archive?.sha256 })) throw Error('Downloaded archive identity differs');
  unpack(archive, stage, descriptor.archive.members);
  const accepted = json(join(stage, 'request.json')), state = json(join(stage, 'state.json')), result = json(join(stage, 'result.json'));
  if (canonical(accepted) !== canonical(request)) throw Error('Transferred request differs');
  validateState(state, request); assertBinding(result, request);
  if (result.version !== 1 || result.kind !== 'unreal-remote/result' || digest(result) !== descriptor.result_sha256 || digest(state) !== descriptor.state_sha256 || result.phase !== descriptor.phase || state.phase !== descriptor.phase || result.drained !== descriptor.drained || state.drained !== descriptor.drained) throw Error('Transferred result/state binding differs');
  return { request_sha256: digest(request), source_sha256: digest(request.source), result_sha256: digest(result), archive_sha256: descriptor.archive.sha256 };
}
export function verifyQualification(descriptor, initial, request) {
  if (canonical({ ...descriptor, verification: null, qualified: false }) !== canonical(initial)) throw Error('Final qualification changed the verified transfer descriptor');
  const proof = descriptor.verification;
  if (proof?.location !== 'original-remote-paths' || !Number.isFinite(Date.parse(proof.observed)) || proof.request_sha256 !== digest(request) || proof.source_sha256 !== digest(request.source) || proof.result_sha256 !== descriptor.result_sha256 || proof.archive_sha256 !== descriptor.archive.sha256 || typeof proof.suite?.valid !== 'boolean' || typeof proof.suite?.qualified !== 'boolean') throw Error('Remote suite verification binding differs');
  const qualified = descriptor.phase === 'succeeded' && descriptor.drained && proof.suite.valid && proof.suite.qualified;
  if (descriptor.qualified !== qualified) throw Error('Transfer qualification contradicts remote verifier');
  return { version: 1, kind: 'unreal-remote/fetch', ...binding(request), transfer_valid: true, qualified, phase: descriptor.phase, verification_location: proof.location, descriptor };
}
export async function receive({ config, request, output, diagnostic = false, transport }) {
  const destination = ignored(config.source_root, resolve(output));
  if (existsSync(destination)) throw Error('Fetch output already exists');
  mkdirSync(dirname(destination), { recursive: true }); safe(destination, config.source_root);
  const staging = join(config.state_directory, `fetch-${randomUUID()}`); ignored(config.source_root, staging); mkdirSync(staging, { recursive: true });
  try {
    const returned = await transport.fetch(request, diagnostic), archive = join(staging, 'download.uar');
    write(join(staging, 'descriptor.json'), returned.descriptor);
    await transport.download(returned.archive, archive);
    const verified = verifyDownload(archive, join(staging, 'verified'), returned.descriptor, request, diagnostic);
    const final = await transport.qualify(request, returned.archive, verified);
    const result = verifyQualification(final, returned.descriptor, request);
    write(join(staging, 'verified', 'fetch.json'), result);
    if (existsSync(destination)) throw Error('Fetch output appeared during verification');
    // An exclusive directory reservation avoids rename replacing an empty directory on POSIX.
    mkdirSync(destination); renameSync(join(staging, 'verified'), join(destination, 'evidence'));
    return { ...result, output: destination, staging };
  } catch (error) { write(join(staging, 'failure.json'), { version: 1, error: error.message, qualified: false, observed: now() }); throw Error(`${error.message}; diagnostic staging retained at ${staging}`); }
}
