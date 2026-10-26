// node statetree_bridge.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
// Validates skills/unreal-gameplay/references/unreal-statetree-authoring.md (building and compiling a StateTree from an editor module,
// then running it on an AI controller) against a real Unreal 5.8 install. It writes a throwaway code project in the OS temp folder with two
// modules: module/StateTreeNodes (runtime: a custom task, a custom condition, their instance data, a probe pawn and an AI controller) and
// module/StateTreeBridge (editor only: builds and compiles the tree). It builds the Editor target with Unreal Build Tool and starts the
// editor twice with statetree_probe.py. Session "build" creates and compiles three trees, reads them back, saves two and probes what Python
// reaches; it then builds three more under the component schema (row S1) and one with a bound root parameter (row S2). Session "run" is a
// fresh editor that loads the saved trees and runs them in Play-In-Editor on probe pawns: an AI controller pawn, or for the component schema
// a plain pawn that owns a StateTreeComponent. Rows S1 and S2 ran on 5.8.4.
// The compiler and Windows SDK are discovered from the installed Visual Studio (override with --compiler / --sdk).
// Takes about five minutes. Exit code 0 when every asserted check passes (observations are recorded, never judged). Not part of node scripts/check.mjs; the checks are tested there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverToolchain, writeCodeProject, buildEditor } from '../native-build.mjs';
import { evaluate, summarize } from './statetree-bridge-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node statetree_bridge.mjs --engine <UE_5.8 folder> [--keep] [--compiler <x.y.z>] [--sdk <10.0.n.n>]'); process.exit(2); }
const editor = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
if (!existsSync(editor)) { console.error(`not found: ${editor}`); process.exit(2); }

const here = import.meta.dirname;
const name = 'StateTreeProbe';
const root = mkdtempSync(join(tmpdir(), 'statetree-bridge-'));
mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const readJson = (p) => (existsSync(p) ? JSON.parse(readText(p)) : undefined);

console.log(`StateTree bridge validation in ${root}`);
const toolchain = discoverToolchain({ compiler: flag('--compiler'), sdk: flag('--sdk') });
console.log(`  toolchain: compiler ${toolchain.compiler}, SDK ${toolchain.sdk} (${toolchain.notes.join('; ')})`);
const uproject = writeCodeProject({ root, name, plugins: ['PythonScriptPlugin', 'EditorScriptingUtilities', 'StateTree', 'GameplayStateTree'],
  modules: [{ name: 'StateTreeNodes', type: 'Runtime', sourceDir: join(here, 'module', 'StateTreeNodes') }, { name: 'StateTreeBridge', type: 'Editor', sourceDir: join(here, 'module', 'StateTreeBridge') }] });
const buildLog = join(root, 'Saved', 'build.log');
const built = await buildEditor({ engine, uproject, name, toolchain, logPath: buildLog });
console.log(`  build: exit ${built.exit}, ${built.seconds} s${built.timedOut ? ' (timed out)' : ''}`);
const build = { ...built, log: readText(buildLog) };

// Two editor sessions on the same project: "build" makes, compiles and saves the trees; "run" is a fresh session that loads them from
// disk and plays them.
function run(mode) {
  const report = join(root, 'Saved', `statetree-${mode}.json`);
  const logFile = join(root, 'Saved', 'Logs', `statetree-${mode}.log`);
  const env = { ...process.env, ST_REPORT: report, ST_MODE: mode, MSYS_NO_PATHCONV: '1' };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    const result = spawnSync(editor, [uproject, '-nullrhi', `-ExecCmds=py ${resolve(here, 'statetree_probe.py')}`, `-abslog=${logFile}`, '-unattended', '-nosplash', '-nosound', '-notraceserver'],
      { env, stdio: 'ignore', timeout: 900000, windowsHide: true });
    console.log(`  editor run (${mode}): exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
    if (existsSync(report)) break;
    if (mode === 'build') rmSync(join(root, 'Content'), { recursive: true, force: true });   // a retried build starts from empty content
  }
  return { report: readJson(report), log: readText(logFile) };
}
const buildRun = built.exit === 0 ? run('build') : { report: undefined, log: '' };
const playRun = buildRun.report ? run('run') : { report: undefined, log: '' };

const checks = evaluate({ build, buildReport: buildRun.report, runReport: playRun.report, buildLog: buildRun.log, runLog: playRun.log });
for (const c of checks) console.log(`${c.observe ? (c.pass ? 'OBSERVE' : 'NOT RECORDED') : c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total, observed, observedRecorded } = summarize(checks);
console.log(`${passed} of ${total} checks passed; ${observedRecorded} of ${observed} observations recorded`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
