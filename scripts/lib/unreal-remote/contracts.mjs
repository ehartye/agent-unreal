import { resolve, join, win32 } from 'node:path';
import { existsSync } from 'node:fs';
import { json, safe, logical, digest } from './files.mjs';
import { ignored } from './source.mjs';

export const TERMINAL = ['succeeded', 'failed', 'cancelled', 'unknown'];
export function validProcessIdentity(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2 && Object.keys(value).every(k => k === 'pid' || k === 'created') && Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.created === 'string' && /^[0-9]+$/.test(value.created);
}
export function processIdentityDifference(expected, observed) {
  if (!validProcessIdentity(expected)) return 'Expected process identity is missing or malformed';
  if (!validProcessIdentity(observed)) return 'Observed process identity is absent, missing or malformed';
  if (expected.pid !== observed.pid) return 'Process PID differs';
  if (expected.created !== observed.created) return 'Process creation identity differs';
  return null;
}
export function sameProcessIdentity(expected, observed) { return processIdentityDifference(expected, observed) === null; }
export function processIdentityGone(expected, observed) {
  return validProcessIdentity(expected) && observed?.pid === expected.pid && (validProcessIdentity(observed) && observed.created !== expected.created || observed.absent === true && Object.keys(observed).length === 2 && Object.keys(observed).every(k => k === 'pid' || k === 'absent'));
}
export function fields(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw Error(`Unsupported ${label} fields`);
}
export function jobId(id) { if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(id)) throw Error('Invalid job ID'); return id; }
function bounded(v) { return Number.isSafeInteger(v) && v >= 1 && v <= 86400; }
export function remoteSettings(c) {
  fields(c, ['root', 'node', 'launcher', 'timeouts'], 'remote settings');
  for (const k of ['root', 'node']) if (typeof c[k] !== 'string' || !/^[A-Za-z]:[\\/]/.test(c[k]) || /[\x00-\x1f"<>|?*]/.test(c[k]) || c[k].slice(2).includes(':') || c[k].length > 200 || c[k].split(/[\\/]/).some(p => p === '.' || p === '..' || /[. ]$/.test(p))) throw Error(`Explicit unambiguous Windows ${k} required`);
  if (win32.parse(c.root).root === c.root) throw Error('Remote root cannot be a drive root');
  fields(c.launcher, ['version', 'project', 'engine', 'editorTarget', 'gameTarget', 'configuration', 'platform', 'dotnet', 'packageDirectory', 'gameExecutable'], 'launcher template');
  if (c.launcher.version !== 1) throw Error('Unsupported launcher template');
  logical(c.launcher.project);
  if (!c.launcher.project.endsWith('.uproject')) throw Error('Launcher project must be relative .uproject');
  for (const k of ['engine', 'dotnet', 'gameExecutable']) if (c.launcher[k] !== undefined && (typeof c.launcher[k] !== 'string' || !win32.isAbsolute(c.launcher[k]) || /[\x00-\x1f"]/.test(c.launcher[k]))) throw Error(`Remote absolute launcher ${k} required`);
  if (!c.launcher.engine) throw Error('Remote engine required');
  if (c.launcher.packageDirectory !== undefined) logical(c.launcher.packageDirectory);
  fields(c.timeouts, ['transport_seconds', 'startup_seconds', 'workload_seconds'], 'timeouts');
  for (const k of ['transport_seconds', 'startup_seconds', 'workload_seconds']) if (!bounded(c.timeouts[k])) throw Error(`Explicit bounded ${k} required`);
  return c;
}
export function loadConfig(file) {
  const c = json(file); fields(c, ['version', 'source_root', 'state_directory', 'ssh_target', 'remote'], 'remote configuration');
  if (c.version !== 1 || typeof c.source_root !== 'string' || typeof c.state_directory !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.@-]{0,252}$/.test(c.ssh_target ?? '')) throw Error('Invalid remote configuration');
  c.source_root = safe(resolve(c.source_root));
  ignored(c.source_root, resolve(file)); c.state_directory = ignored(c.source_root, c.state_directory);
  remoteSettings(c.remote); return c;
}
export function validateRequest(r) {
  fields(r, ['version', 'kind', 'job', 'source', 'manifest', 'suite', 'remote', 'runtime', 'payload'], 'request');
  if (r.version !== 1 || r.kind !== 'unreal-remote/request') throw Error('Unsupported remote request');
  jobId(r.job); logical(r.manifest);
  if (!/^[a-z0-9][a-z0-9.-]{0,95}$/.test(r.suite ?? '')) throw Error('Invalid suite');
  remoteSettings(r.remote);
  if (!/^[a-f0-9]{40}$/.test(r.source?.commit ?? '') || !/^[a-f0-9]{40}$/.test(r.source?.tree ?? '') || !/^[a-f0-9]{64}$/.test(r.source?.snapshot ?? '') || r.source.dirty !== false || !Array.isArray(r.source.inputs) || !Array.isArray(r.source.lfs)) throw Error('Invalid source identity');
  for (const k of ['runtime', 'payload']) if (!/^[a-f0-9]{64}$/.test(r[k]?.sha256 ?? '') || !Number.isSafeInteger(r[k].bytes) || r[k].bytes < 1) throw Error(`Invalid ${k} binding`);
  return digest(r);
}
export function binding(request) { return { job: request.job, request_sha256: validateRequest(request), source_sha256: digest(request.source) }; }
export function assertBinding(value, request) { const expected = binding(request); for (const k of Object.keys(expected)) if (value?.[k] !== expected[k]) throw Error(`Remote ${k} binding differs`); }
export function validateState(s, request) {
  assertBinding(s, request);
  if (s.version !== 1 || s.kind !== 'unreal-remote/state' || !Number.isSafeInteger(s.sequence) || s.sequence < 0 || !['launch_pending', 'ready', 'running', 'cancelling', ...TERMINAL].includes(s.phase) || !Number.isFinite(Date.parse(s.observed)) || typeof s.drained !== 'boolean' || !/^[a-f0-9-]{36}$/.test(s.token ?? '')) throw Error('Unsupported remote state');
  if (TERMINAL.includes(s.phase) && s.phase !== 'unknown' && !s.drained) throw Error('Terminal state has no drain proof');
  if (s.phase === 'unknown' && s.drained) throw Error('Unknown state cannot assert drain');
  return s;
}
