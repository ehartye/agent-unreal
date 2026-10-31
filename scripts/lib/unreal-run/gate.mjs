// Internal gate. Never accepts commands from a permit or a second invocation.
import { readFileSync, writeFileSync, renameSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { hash, validateRequest } from './contracts.mjs';
const requestPath = process.argv[2];
const bytes = readFileSync(requestPath);
const request = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
const problems = validateRequest(request);
if (problems.length) throw Error(problems.join('; '));
const requestHash = hash(bytes);
const put = (name, value) => {
  const file = join(request.evidence, name);
  writeFileSync(`${file}.tmp`, JSON.stringify(value)); renameSync(`${file}.tmp`, file);
};
async function permit(name) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const p = JSON.parse(readFileSync(join(request.evidence, name), 'utf8').replace(/^\uFEFF/, ''));
      if (p.requestHash !== requestHash || p.nonce !== request.nonce || p.gate.pid !== process.pid || !p.gate.created) throw Error('request-bound gate permit mismatch');
      return p;
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error(`bounded wait expired: ${name}`);
}
put('gate-ready.json', { pid: process.pid, requestHash });
await permit('probe-permit.json');
const probe = spawn(request.node, ['-e', 'process.stdin.resume()'], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
await new Promise((resolve, reject) => { probe.once('spawn', resolve); probe.once('error', reject); });
put('probe-ready.json', { pid: probe.pid, requestHash });
await permit('probe-complete.json');
const probeExit = new Promise((resolve, reject) => { probe.once('exit', code => code === 0 ? resolve() : reject(Error('inert probe failed'))); probe.once('error', reject); });
probe.stdin.end(); await probeExit;
put('probe-exited.json', { requestHash });
await permit('workload-permit.json');
const out = openSync(join(request.evidence, 'stdout.log'), 'wx');
const err = openSync(join(request.evidence, 'stderr.log'), 'wx');
const started = new Date().toISOString();
const child = spawn(request.executable, request.arguments, { cwd: request.cwd, shell: false, windowsHide: true, stdio: ['ignore', out, err] });
try {
  const result = await new Promise(resolve => {
    child.once('spawn', () => put('workload-started.json', { pid: child.pid, requestHash, started }));
    child.once('error', error => resolve({ exitCode: 74, error: error.message }));
    child.once('exit', (code, signal) => resolve({ exitCode: code ?? 74, signal }));
  });
  put('workload-result.json', { ...result, requestHash, started, finished: new Date().toISOString() });
  process.exitCode = result.exitCode;
} finally { closeSync(out); closeSync(err); }
