// Inert Windows compatibility tests. Isolated fixture receipts never qualify production.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanAllowed } from './compat.mjs';
const script = join(dirname(fileURLToPath(import.meta.url)), 'with-engine-lock.ps1');
const skip = process.platform === 'win32' && spawnSync('pwsh', ['-NoProfile', '-Command', '1'], { encoding: 'utf8' }).status === 0 ? false : 'needs Windows and PowerShell 7';
const roots = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'engine-lock-compat-')); roots.push(root);
  const config = join(root, 'fixture.json');
  writeFileSync(config, JSON.stringify({ lock: `Global\\agent-unreal-fixture-${randomUUID()}`, state: join(root, 'state') }));
  return { root, config };
}
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function environment(f, evidence = join(f.root, randomUUID()), extra = {}) {
  return { ...process.env, ENGINE_LOCK_NAME: '', AGENT_UNREAL_TEST_ISOLATION: f.config, ENGINE_LOCK_EVIDENCE: evidence, ENGINE_RUN_TIMEOUT_SECONDS: '30', ...extra };
}
const wrapped = (f, args, extra) => spawnSync('pwsh', ['-NoProfile', '-File', script, ...args], { encoding: 'utf8', timeout: 45000, env: environment(f, undefined, extra) });
test('a command with one argument runs with that argument', { skip }, () => {
  const r = wrapped(fixture(), ['node', '--version']); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout.trim(), /^v\d+\.\d+\.\d+/);
});
test('a script path given as the only argument reaches the command whole', { skip }, () => {
  const f = fixture(); const file = join(f.root, 'quoted script path.mjs'); writeFileSync(file, 'console.log("whole")');
  const r = wrapped(f, ['node', file]); assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), 'whole');
});
test('empty, quoted and trailing-backslash arguments remain exact', { skip }, () => {
  const args = ['', 'a b', 'quote"value', 'trailing\\']; const r = wrapped(fixture(), ['node', '-p', 'JSON.stringify(process.argv.slice(1))', ...args]);
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(JSON.parse(r.stdout.trim()), args);
});
test('the wrapped command exit code is the wrapper exit code', { skip }, () => { assert.equal(wrapped(fixture(), ['node', '-e', 'process.exit(7)']).status, 7); });
test('no command is a usage error', { skip }, () => { const r = wrapped(fixture(), []); assert.equal(r.status, 2); assert.match(r.stderr, /usage/); });
test('--no-lock only admits known engine-free scans', () => {
  assert.equal(scanAllowed('node', ['--version']), true);
  assert.equal(scanAllowed('node', ['-e', 'launchEngine()']), false);
  assert.equal(scanAllowed('UnrealEditor.exe', []), false);
});
test('--no-lock runs a scan while another call holds the lock', { skip }, async () => {
  const f = fixture(); const done = await startHolder(f); try { const r = wrapped(f, ['--no-lock', 'node', '--version']); assert.equal(r.status, 0, r.stderr); } finally { await done.promise; }
});
async function startHolder(f) {
  // Avoid async promise assimilation: return a holder object while the process runs.
  const evidence = join(f.root, 'holder');
  const child = spawn('pwsh', ['-NoProfile', '-File', script, 'node', '-e', 'setTimeout(()=>{},8000)'], { env: environment(f, evidence), windowsHide: true, stdio: 'ignore' });
  const promise = new Promise((resolveExit, reject) => { child.once('error', reject); child.once('exit', resolveExit); });
  const deadline = Date.now() + 20000;
  while (!existsSync(join(evidence, 'workload-started.json'))) { if (child.exitCode !== null || Date.now() > deadline) throw Error('Holder did not start'); await new Promise(r => setTimeout(r, 50)); }
  return { child, promise };
}
test('a second call names the holder while waiting, then runs', { skip }, async () => {
  const f = fixture(); const h = await startHolder(f);
  try { const r = wrapped(f, ['node', '--version']); assert.equal(r.status, 0, r.stderr); assert.match(r.stderr, /Waiting for.*holder:/); assert.match(r.stdout, /^v\d+/); } finally { await h.promise; }
});
test('bounded lock wait preserves exit code 3', { skip }, async () => {
  const f = fixture(); const h = await startHolder(f);
  try { const r = wrapped(f, ['node', '--version'], { ENGINE_LOCK_TIMEOUT_MIN: '0.01' }); assert.equal(r.status, 3, r.stderr); assert.match(r.stderr, /Bounded lock wait expired/); } finally { await h.promise; }
});
test('production lock overrides and unsafe no-lock commands refuse before dispatch', { skip }, () => {
  const f = fixture(); const marker = join(f.root, 'never-created');
  const args = ['node', '-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'bad')`];
  assert.equal(wrapped(f, args, { ENGINE_LOCK_NAME: 'another-lock' }).status, 2);
  assert.equal(wrapped(f, ['--no-lock', ...args]).status, 2); assert.equal(existsSync(marker), false);
});
