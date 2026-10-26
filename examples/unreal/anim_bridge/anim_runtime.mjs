// node anim_runtime.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
// Prepared, not yet run on an engine. The opt-in runtime phase of the Animation Blueprint bridge: it does not change what anim_bridge.mjs does.
// Validates the "Not verified" list of skills/unreal-animation/references/unreal-animation-blueprints.md: a state machine played at runtime, 2D Blend Spaces
// and linked layers. It writes a throwaway code project in the OS temp folder with four modules: module/SlotClip and module/AnimBridge (the
// default run's, reused for AddState and ResampleBlendSpace), module/AnimMachine (runtime: the AnimInstance parent class with the transition
// variables and the state name reader) and module/AnimMachineBridge (editor: state content, a Boolean rule on a transition, animation layers and
// layer interfaces). It builds the Editor target with Unreal Build Tool and starts the editor twice with anim_runtime_probe.py: session "build"
// makes the clips and the Animation Blueprints, session "play" is a fresh editor that plays them and reads a bone back.
// The compiler and Windows SDK are discovered from the installed Visual Studio (override with --compiler / --sdk).
// Exit code 0 when every counted check passes. Not part of node scripts/check.mjs; the checks are tested there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverToolchain, writeCodeProject, buildEditor } from '../native-build.mjs';
import { evaluate, summarize } from './anim-runtime-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node anim_runtime.mjs --engine <UE_5.8 folder> [--keep] [--compiler <x.y.z>] [--sdk <10.0.n.n>]'); process.exit(2); }
const editor = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
if (!existsSync(editor)) { console.error(`not found: ${editor}`); process.exit(2); }

const here = import.meta.dirname;
const name = 'AnimRuntimeProbe';
const root = mkdtempSync(join(tmpdir(), 'anim-runtime-'));
mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const readJson = (p) => { try { return existsSync(p) ? JSON.parse(readText(p)) : undefined; } catch { return undefined; } };

console.log(`Animation Blueprint runtime validation in ${root}`);
const toolchain = discoverToolchain({ compiler: flag('--compiler'), sdk: flag('--sdk') });
console.log(`  toolchain: compiler ${toolchain.compiler}, SDK ${toolchain.sdk} (${toolchain.notes.join('; ')})`);
const uproject = writeCodeProject({ root, name, plugins: ['PythonScriptPlugin', 'EditorScriptingUtilities'],
  modules: [
    { name: 'SlotClip', type: 'Runtime', sourceDir: join(here, 'module', 'SlotClip') },
    { name: 'AnimMachine', type: 'Runtime', sourceDir: join(here, 'module', 'AnimMachine') },
    { name: 'AnimBridge', type: 'Editor', sourceDir: join(here, 'module', 'AnimBridge') },
    { name: 'AnimMachineBridge', type: 'Editor', sourceDir: join(here, 'module', 'AnimMachineBridge') },
  ] });
const buildLog = join(root, 'Saved', 'build.log');
const built = await buildEditor({ engine, uproject, name, toolchain, logPath: buildLog });
console.log(`  build: exit ${built.exit}, ${built.seconds} s${built.timedOut ? ' (timed out)' : ''}`);
const build = { ...built, log: readText(buildLog) };

function run(mode) {
  const report = join(root, 'Saved', `anim-runtime-${mode}.json`);
  const logFile = join(root, 'Saved', 'Logs', `anim-runtime-${mode}.log`);
  const env = { ...process.env, AR_REPORT: report, AR_MODE: mode, MSYS_NO_PATHCONV: '1' };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    const result = spawnSync(editor, [uproject, '-nullrhi', `-ExecCmds=py ${resolve(here, 'anim_runtime_probe.py')}`, `-abslog=${logFile}`, '-unattended', '-nosplash', '-nosound', '-notraceserver'],
      { env, stdio: 'ignore', timeout: 900000, windowsHide: true });
    console.log(`  editor run (${mode}): exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
    if (existsSync(report)) break;
    if (mode === 'build') rmSync(join(root, 'Content'), { recursive: true, force: true });   // a retried build starts from empty content
  }
  return { report: readJson(report), log: readText(logFile) };
}
const buildRun = built.exit === 0 ? run('build') : { report: undefined, log: '' };
const playRun = buildRun.report ? run('play') : { report: undefined, log: '' };

const checks = evaluate({ build, buildReport: buildRun.report, playReport: playRun.report, buildLog: buildRun.log });
for (const c of checks) console.log(`${c.info ? 'INFO' : c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
