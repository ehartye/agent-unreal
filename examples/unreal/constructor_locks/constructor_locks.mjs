// node constructor_locks.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
// Validates the content-stage rule in skills/unreal-native/references/unreal-native-content-pipeline.md against a real Unreal 5.8 install.
// It writes a throwaway project in the OS temp folder, creates six assets with lock_setup.py (a material and a static mesh for each of
// three actors), then adds one runtime module (module/LockProbe) whose actors load their assets in three ways: ConstructorHelpers in the
// constructor, LoadObject in PostInitializeComponents, and soft references resolved with LoadSynchronous. It builds the Editor target and
// starts the editor four times (lock_hold.py): classes loaded only, actors spawned in the editor world, actors running in Play-In-Editor, Play-In-Editor ended and garbage collected. While each
// editor is running, lock_try.py (plain Python) tries to open, rename, overwrite and delete each asset file; the assets are restored from a
// copy before every run. A control pass runs the same tries with no editor open.
// Needs `python` on PATH. Takes about ten minutes. Exit code 0 when every check passes. Not part of node scripts/check.mjs; the checks are tested there.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverToolchain, writeCodeProject, buildEditor } from '../native-build.mjs';
import { evaluate, summarize } from './constructor-locks-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node constructor_locks.mjs --engine <UE_5.8 folder> [--keep] [--compiler <x.y.z>] [--sdk <10.0.n.n>]'); process.exit(2); }
const bin = join(engine, 'Engine', 'Binaries', 'Win64');
for (const exe of ['UnrealEditor-Cmd.exe', 'UnrealEditor.exe']) if (!existsSync(join(bin, exe))) { console.error(`not found: ${join(bin, exe)}`); process.exit(2); }

const here = import.meta.dirname;
const name = 'LockProbeProject';
const root = mkdtempSync(join(tmpdir(), 'constructor-locks-'));
mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const readJson = (p) => (existsSync(p) ? JSON.parse(readText(p)) : undefined);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lockDir = join(root, 'Content', 'Lock');
const backup = join(root, 'Saved', 'LockBackup');

console.log(`Constructor lock validation in ${root}`);
const python = spawnSync('python', ['--version'], { encoding: 'utf8', windowsHide: true });
if (python.status !== 0) { console.error('python is not on PATH'); process.exit(2); }

// 1. A project without a code module creates the assets, so no class refers to them yet.
const plugins = ['PythonScriptPlugin', 'EditorScriptingUtilities'];
const uproject = writeCodeProject({ root, name, plugins, modules: [] });
const setupReport = join(root, 'Saved', 'setup.json');
const setup = spawnSync(join(bin, 'UnrealEditor-Cmd.exe'), [uproject, `-ExecutePythonScript=${resolve(here, 'lock_setup.py')}`, '-nullrhi', `-abslog=${join(root, 'Saved', 'Logs', 'setup.log')}`,
  '-unattended', '-nosplash', '-nosound', '-notraceserver'], { env: { ...process.env, LOCK_REPORT: setupReport }, stdio: 'ignore', timeout: 900000, windowsHide: true });
console.log(`  asset setup: exit ${setup.status}`);
cpSync(lockDir, backup, { recursive: true });

// 2. Add the module and build the Editor target.
const toolchain = discoverToolchain({ compiler: flag('--compiler'), sdk: flag('--sdk') });
console.log(`  toolchain: compiler ${toolchain.compiler}, SDK ${toolchain.sdk} (${toolchain.notes.join('; ')})`);
writeCodeProject({ root, name, plugins, modules: [{ name: 'LockProbe', type: 'Runtime', sourceDir: join(here, 'module', 'LockProbe') }] });
const buildLog = join(root, 'Saved', 'build.log');
const built = await buildEditor({ engine, uproject, name, toolchain, logPath: buildLog });
console.log(`  build: exit ${built.exit}, ${built.seconds} s${built.timedOut ? ' (timed out)' : ''}`);
const build = { ...built, log: readText(buildLog) };

function tries() {
  const out = spawnSync('python', ['-I', resolve(here, 'lock_try.py'), lockDir], { encoding: 'utf8', windowsHide: true });
  try { return JSON.parse(out.stdout); } catch { return [{ error: out.stderr || out.stdout }]; }
}
function restore() { rmSync(lockDir, { recursive: true, force: true }); cpSync(backup, lockDir, { recursive: true }); }
const refused = (list) => list.filter((r) => r.ok === false).length;

async function stage(label) {
  restore();
  const report = join(root, 'Saved', `${label}.json`), ready = join(root, 'Saved', `${label}.ready`), done = join(root, 'Saved', `${label}.done`);
  const env = { ...process.env, LOCK_STAGE: label, LOCK_REPORT: report, LOCK_READY: ready, LOCK_DONE: done };
  const started = Date.now();
  const child = spawn(join(bin, 'UnrealEditor.exe'), [uproject, '-nullrhi', `-ExecCmds=py ${resolve(here, 'lock_hold.py')}`, `-abslog=${join(root, 'Saved', 'Logs', `${label}.log`)}`,
    '-unattended', '-nosplash', '-nosound', '-notraceserver'], { env, stdio: 'ignore', windowsHide: true });
  let exited = false;
  child.on('exit', () => { exited = true; });
  while (!existsSync(ready) && !exited && Date.now() - started < 900000) await sleep(1000);
  const hold = readJson(report);
  const result = existsSync(ready) ? tries() : [];
  writeFileSync(done, 'done');
  for (let i = 0; i < 120 && !exited; i++) await sleep(1000);
  if (!exited) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  console.log(`  ${label}: ${Math.round((Date.now() - started) / 1000)} s, ${refused(result)} refused of ${result.length} tries`);
  return { hold, tries: result, log: readText(join(root, 'Saved', 'Logs', `${label}.log`)) };
}

const runs = {};
if (built.exit === 0) {
  restore();
  runs.control = { tries: tries() };       // no editor open: every try should succeed
  console.log(`  control (no editor): ${refused(runs.control.tries)} refused of ${runs.control.tries.length} tries`);
  for (const label of ['loaded', 'spawned', 'played', 'ended']) {
    runs[label] = await stage(label);
    if (!runs[label].hold) runs[label] = await stage(label);   // one retry
  }
}

const checks = evaluate({ build, setup: readJson(setupReport), runs });
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
writeFileSync(join(root, 'Saved', 'runs.json'), JSON.stringify(runs, null, 2));
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
