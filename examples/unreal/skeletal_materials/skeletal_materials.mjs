// node skeletal_materials.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--rendering] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
// Prepared for skills/unreal-import/references/unreal-import-policy.md and skills/unreal-editor-scripting/references/unreal-python-cpp-bridge.md;
// not yet run on an engine (see the README status).
// It writes a throwaway code project in the OS temp folder with one editor-only module (module/SkeletalMaterialsBridge: a Blueprint function
// library whose SetSkeletalMeshMaterials writes a skeletal mesh's material slots), builds the Editor target with Unreal Build Tool, and runs
// skel_probe.py in two separate editor processes: "author" (copies of an engine skeletal mesh, the Python routes, the C++ function, saves)
// and "read" (a fresh process: the hidden asset-registry Materials tag and the loaded slots). skel-checks.mjs judges both reports.
// By default both processes are commandlets (UnrealEditor-Cmd.exe -run=pythonscript -nullrhi). --rendering runs the same script inside a
// rendering editor (UnrealEditor.exe, no -nullrhi, a GPU and a window needed) so the report's authored-material statistics can be compared
// with the headless run.
// The compiler and Windows SDK are discovered from the installed Visual Studio (override with --compiler / --sdk).
// Exit code 0 when every check passes. Not part of node scripts/check.mjs; the checks are tested there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverToolchain, writeCodeProject, buildEditor } from '../native-build.mjs';
import { evaluate, summarize } from './skel-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const rendering = args.includes('--rendering');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node skeletal_materials.mjs --engine <UE_5.8 folder> [--keep] [--rendering] [--compiler <x.y.z>] [--sdk <10.0.n.n>]'); process.exit(2); }
const editorCmd = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe');
const editorGui = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
const exe = rendering ? editorGui : editorCmd;
if (!existsSync(exe)) { console.error(`not found: ${exe}`); process.exit(2); }

const here = import.meta.dirname;
const name = 'SkeletalMaterialsProbe';
const root = mkdtempSync(join(tmpdir(), 'skeletal-materials-'));
mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const readJson = (p) => { try { return existsSync(p) ? JSON.parse(readText(p)) : undefined; } catch { return undefined; } };

console.log(`Skeletal mesh material slots validation in ${root}${rendering ? ' (rendering editor)' : ''}`);
const toolchain = discoverToolchain({ compiler: flag('--compiler'), sdk: flag('--sdk') });
console.log(`  toolchain: compiler ${toolchain.compiler}, SDK ${toolchain.sdk} (${toolchain.notes.join('; ')})`);
const uproject = writeCodeProject({ root, name, plugins: ['PythonScriptPlugin', 'EditorScriptingUtilities'],
  modules: [{ name: 'SkeletalMaterialsBridge', type: 'Editor', sourceDir: join(here, 'module', 'SkeletalMaterialsBridge') }] });
const buildLog = join(root, 'Saved', 'build.log');
const built = await buildEditor({ engine, uproject, name, toolchain, logPath: buildLog });
console.log(`  build: exit ${built.exit}, ${built.seconds} s${built.timedOut ? ' (timed out)' : ''}`);
const build = { ...built, log: readText(buildLog) };

function run(mode) {
  const report = join(root, 'Saved', `skeletal-${mode}.json`);
  const logFile = join(root, 'Saved', 'Logs', `skeletal-${mode}.log`);
  const env = { ...process.env, SM_REPORT: report, SM_MODE: mode, SM_RUN: rendering ? 'tick' : 'direct', MSYS_NO_PATHCONV: '1' };
  const common = ['-unattended', '-nosplash', '-nopause', '-nosound', '-notraceserver', `-abslog=${logFile}`];
  const argv = rendering
    ? [uproject, `-ExecCmds=py ${resolve(here, 'skel_probe.py')}`, ...common]
    : [uproject, '-run=pythonscript', `-script=${resolve(here, 'skel_probe.py')}`, '-nullrhi', ...common];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    const result = spawnSync(exe, argv, { env, stdio: 'ignore', timeout: 900000, windowsHide: true });
    console.log(`  ${mode} process: exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
    if (existsSync(report)) break;
    if (mode === 'author') rmSync(join(root, 'Content'), { recursive: true, force: true });   // a retried author run starts from empty content
  }
  return { report: readJson(report), log: readText(logFile) };
}
const author = built.exit === 0 ? run('author') : { report: undefined, log: '' };
const read = author.report ? run('read') : { report: undefined, log: '' };

const checks = evaluate({ build, author, read });
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
