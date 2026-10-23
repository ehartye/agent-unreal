// node gas_native.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
// Validates skills/unreal-gameplay/references/unreal-gas-native-effects.md (Gameplay Effects, attribute sets, tags and abilities written
// in C++) against a real Unreal 5.8 install. It writes a throwaway code project in the OS temp folder with one runtime module
// (module/GasNative): an attribute set with one attribute, a timed Gameplay Effect that grants one native tag, a cost effect, and an
// ability that uses them as cost and cooldown and waits on an ability task. It builds the Editor target with Unreal Build Tool, then runs
// a commandlet (UnrealEditor-Cmd.exe -run=GasNativeProbe, headless, no map) that makes a game world, activates the ability, ticks the
// world and writes a JSON report; gas-native-checks.mjs judges the report and the log.
// The compiler and Windows SDK are discovered from the installed Visual Studio (override with --compiler / --sdk).
// Takes about two to three minutes. Exit code 0 when every check passes. Not part of node scripts/check.mjs; the checks are tested there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverToolchain, writeCodeProject, buildEditor } from '../native-build.mjs';
import { evaluate, summarize } from './gas-native-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node gas_native.mjs --engine <UE_5.8 folder> [--keep] [--compiler <x.y.z>] [--sdk <10.0.n.n>]'); process.exit(2); }
const editorCmd = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe');
if (!existsSync(editorCmd)) { console.error(`not found: ${editorCmd}`); process.exit(2); }

const here = import.meta.dirname;
const name = 'GasNativeProbeProject';
const root = mkdtempSync(join(tmpdir(), 'gas-native-'));
mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

console.log(`Native Gameplay Ability System validation in ${root}`);
const toolchain = discoverToolchain({ compiler: flag('--compiler'), sdk: flag('--sdk') });
console.log(`  toolchain: compiler ${toolchain.compiler}, SDK ${toolchain.sdk} (${toolchain.notes.join('; ')})`);
const uproject = writeCodeProject({ root, name, plugins: ['GameplayAbilities'], modules: [{ name: 'GasNative', type: 'Runtime', sourceDir: join(here, 'module', 'GasNative') }] });
const buildLog = join(root, 'Saved', 'build.log');
const built = await buildEditor({ engine, uproject, name, toolchain, logPath: buildLog });
console.log(`  build: exit ${built.exit}, ${built.seconds} s${built.timedOut ? ' (timed out)' : ''}`);
const build = { ...built, log: readText(buildLog) };

let report; let log = ''; let exit;
if (built.exit === 0) {
  const reportFile = join(root, 'Saved', 'gas-native.json');
  const logFile = join(root, 'Saved', 'Logs', 'gas-native.log');
  const started = Date.now();
  const result = spawnSync(editorCmd, [uproject, '-run=GasNativeProbe', `-Report=${reportFile}`, '-nullrhi', `-abslog=${logFile}`, '-unattended', '-nosplash', '-nopause', '-nosound', '-notraceserver'],
    { stdio: 'ignore', timeout: 600000, windowsHide: true });
  exit = result.status;
  console.log(`  probe: exit ${exit}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
  log = readText(logFile);
  report = existsSync(reportFile) ? JSON.parse(readText(reportFile)) : undefined;
}

const checks = evaluate({ build, report, log, exit });
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
