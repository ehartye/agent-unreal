import { createHash } from 'node:crypto';

export const VERSION = 1;
export const LOCK = 'Global\\agent-plugins-engine-runs';
export const OPERATIONS = ['build', 'editor', 'game', 'commandlet', 'package', 'test', 'status', 'doctor', 'clear-stale'];
export const hash = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identity = value => object(value) && Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.created === 'string' && /^\d{15,20}$/.test(value.created);
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function validateRequest(r) {
  const errors = [];
  if (!object(r)) return ['request must be an object'];
  if (r.version !== VERSION || r.kind !== 'unreal-run/request') errors.push('unsupported request contract');
  if (!/^[a-f0-9-]{36}$/.test(r.id ?? '') || !sha(r.nonce)) errors.push('invalid request identity');
  if (!['production', 'fixture'].includes(r.purpose)) errors.push('invalid purpose');
  if (r.purpose === 'production' && r.lock !== LOCK) errors.push('production lock identity mismatch');
  if (r.purpose === 'fixture' && !/^Global\\agent-unreal-fixture-[a-f0-9-]{36}$/.test(r.lock ?? '')) errors.push('fixture isolation required');
  if (!OPERATIONS.includes(r.operation) && r.operation !== 'compat') errors.push('unsupported operation');
  for (const key of ['executable', 'cwd', 'evidence', 'state', 'node']) if (typeof r[key] !== 'string' || !r[key] || r[key].includes('\0')) errors.push(`invalid ${key}`);
  if (!Array.isArray(r.arguments) || r.arguments.some(a => typeof a !== 'string' || a.includes('\0'))) errors.push('arguments must be a string array without NUL');
  for (const key of ['timeoutMs', 'waitMs']) if (!Number.isSafeInteger(r[key]) || r[key] < 1 || r[key] > 86400000) errors.push(`invalid bounded ${key}`);
  if (!identity({ pid: r.controllerPid, created: r.controllerCreated })) errors.push('invalid controller creation identity');
  if (r.fault && (r.purpose !== 'fixture' || !['containment', 'accounting', 'observation', 'observation-once'].includes(r.fault))) errors.push('invalid fixture fault');
  return errors;
}

// Validators deliberately recompute eligibility. A producer's success flag is never proof.
export function verifyLifecycle(r, { purpose = 'production', requestId, requestHash, requireSuccess = true } = {}) {
  const errors = [];
  if (!object(r)) return { valid: false, errors: ['missing lifecycle receipt'] };
  if (r.version !== VERSION || r.kind !== 'unreal-run/lifecycle') errors.push('unsupported lifecycle contract');
  if (!['build', 'editor', 'game', 'commandlet', 'package', 'test', 'doctor', 'compat'].includes(r.operation)) errors.push('missing or unsupported lifecycle operation');
  if (r.purpose !== purpose || (purpose === 'production' && r.lock !== LOCK) || (purpose === 'fixture' && !/^Global\\agent-unreal-fixture-[a-f0-9-]{36}$/.test(r.lock ?? ''))) errors.push('lock or purpose mismatch');
  if (!sha(r.requestHash) || !/^[a-f0-9-]{36}$/.test(r.id ?? '') || (requestId && r.id !== requestId) || (requestHash && r.requestHash !== requestHash)) errors.push('request identity mismatch');
  if (!identity(r.controller) || !identity(r.helper)) errors.push('missing owner creation identity');
  if (!Array.isArray(r.processes) || r.processes.some(p => !identity(p))) errors.push('invalid recorded process identities');
  else {
    const key = p => `${p?.pid}:${p?.created}`;
    const recorded = new Set(r.processes.map(key));
    if (recorded.size !== r.processes.length || ![r.controller, r.helper, ...(r.permitIssued ? [r.gate, r.probe] : [])].every(p => recorded.has(key(p)))) errors.push('incomplete or duplicate process ownership record');
  }
  if (!time(r.started) || !time(r.finished) || Date.parse(r.finished) < Date.parse(r.started)) errors.push('invalid lifecycle interval');
  if (typeof r.permitIssued !== 'boolean' || typeof r.cancelled !== 'boolean' || typeof r.timedOut !== 'boolean' || !Array.isArray(r.errors)) errors.push('missing lifecycle facts');
  if (r.permitIssued && (!identity(r.gate) || !identity(r.probe) || r.contained !== true || r.probeContained !== true || r.permit?.requestHash !== r.requestHash || r.permit?.gate?.pid !== r.gate.pid || r.permit?.gate?.created !== r.gate.created)) errors.push('unproved containment or request-bound permit');
  if (r.permitIssued === false && r.permit != null) errors.push('contradictory permit facts');
  if (!object(r.drain) || r.drain.proved !== true || r.drain.active !== 0 || !Array.isArray(r.drain.members) || r.drain.members.length !== 0 || r.drain.requestHash !== r.requestHash || !time(r.drain.observed)) errors.push('unproved drain');
  else if (Date.parse(r.drain.observed) < Date.parse(r.started) || Date.parse(r.drain.observed) > Date.parse(r.finished)) errors.push('drain observation outside lifecycle interval');
  if (requireSuccess && (!r.permitIssued || r.exitCode !== 0 || r.cancelled || r.timedOut || r.errors?.length)) errors.push('workload did not succeed');
  return { valid: errors.length === 0, errors };
}

export function verifyIdentity(r, lifecycle, { source, operation } = {}) {
  const errors = [...verifyLifecycle(lifecycle).errors];
  if (!object(r)) return { valid: false, errors: [...errors, 'missing identity receipt'] };
  if (r.version !== VERSION || r.kind !== 'unreal-run/identity' || !['build', 'package'].includes(r.operation) || (operation && r.operation !== operation)) errors.push('unsupported identity contract');
  if (r.requestHash !== lifecycle?.requestHash || r.id !== lifecycle?.id || r.operation !== lifecycle?.operation) errors.push('identity/lifecycle mismatch');
  if (!object(r.source) || !sha(r.source.snapshot) || !/^[a-f0-9]{40,64}$/.test(r.source.commit ?? '') || typeof r.source.dirty !== 'boolean') errors.push('missing source identity');
  if (source && (r.source?.snapshot !== source.snapshot || r.source?.commit !== source.commit)) errors.push('mismatched source');
  if (!object(r.engine) || !sha(r.engine.buildVersionSha256) || !sha(r.engine.executableSha256) || typeof r.engine.observedVersion !== 'string' || !r.engine.observedVersion) errors.push('missing engine observation');
  if (!object(r.toolchain) || !r.toolchain.compiler || !r.toolchain.sdk || !sha(r.toolchain.logSha256)) errors.push('missing actual toolchain observation');
  if (!Array.isArray(r.artifacts) || !r.artifacts.length || r.artifacts.some(a => !object(a) || typeof a.path !== 'string' || !a.path || !sha(a.sha256) || !Number.isSafeInteger(a.bytes) || a.bytes < 1) || new Set(r.artifacts.map(a => a?.path)).size !== r.artifacts.length) errors.push('missing or malformed artifacts');
  if (r.complete !== true || !Array.isArray(r.errors) || r.errors.length) errors.push('incomplete identity');
  return { valid: errors.length === 0, errors };
}

// Observations must be made while holding the same mutex. Missing and unknown are distinct.
export function recoveryDecision(owner, observations) {
  if (!object(owner) || owner.version !== VERSION || owner.kind !== 'unreal-run/owner' || !/^[a-f0-9-]{36}$/.test(owner.id ?? '') || !time(owner.started) || !['production', 'fixture'].includes(owner.purpose) || (owner.purpose === 'production' && owner.lock !== LOCK) || (owner.purpose === 'fixture' && !/^Global\\agent-unreal-fixture-[a-f0-9-]{36}$/.test(owner.lock ?? '')) || !sha(owner.requestHash) || !Array.isArray(owner.processes) || !owner.processes.length || owner.processes.some(p => !identity(p))) return { allowed: false, reason: 'absent or corrupt ownership evidence' };
  if (!Array.isArray(observations) || observations.length !== owner.processes.length || observations.some((p, i) => p.pid !== owner.processes[i].pid || p.expectedCreated !== owner.processes[i].created || p.state !== 'gone')) return { allowed: false, reason: 'live, reused or ambiguous process identity' };
  const validDrain = owner.drain?.proved === true && owner.drain.active === 0 && Array.isArray(owner.drain.members) && owner.drain.members.length === 0 && owner.drain.requestHash === owner.requestHash && time(owner.drain.observed);
  if (validDrain) return { allowed: true, reason: 'verified zero-member owned Job drain' };
  if (owner.permitIssued === false && owner.phase === 'pre-permit') return { allowed: true, reason: 'no workload permit and every recorded identity gone' };
  return { allowed: false, reason: 'workload may have run without a drain proof' };
}
