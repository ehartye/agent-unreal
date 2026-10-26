// node automation_reference.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
// Prepared, not yet run on an engine. The opt-in reference phase of the automation-test example: it does not change what automation_test.mjs does.
// Runs the commands that skills/unreal-quality/references/unreal-quality-lanes.md gives, in the shape it gives them, against the same two probe tests:
//   UnrealEditor-Cmd.exe <project> -Unattended -NullRHI -ExecCmds="Automation RunTest <filter>;Quit" -ReportExportPath=<dir>
// and reads the exported report with automation_report.mjs. It also runs a test group from DefaultEngine.ini (Group:<Name>), a group that does not exist,
// a test excluded with +ExcludeTest (state Skipped, the reason in the report) and, as an observation, the Data Validation commandlet.
// It writes a throwaway code project in the OS temp folder (the AutomationProbe module of automation_test.mjs), builds the Editor target and runs
// the engine hidden. The compiler and Windows SDK are discovered from the installed Visual Studio (override with --compiler / --sdk).
// Exit code 0 when every counted check passes. Not part of node scripts/check.mjs; the checks are tested there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverToolchain, writeCodeProject, buildEditor } from '../native-build.mjs';
import { evaluate, summarize, configText } from './automation-reference-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node automation_reference.mjs --engine <UE_5.8 folder> [--keep] [--compiler <x.y.z>] [--sdk <10.0.n.n>]'); process.exit(2); }
const bin = join(engine, 'Engine', 'Binaries', 'Win64');
const cmdExe = join(bin, 'UnrealEditor-Cmd.exe');
if (!existsSync(cmdExe)) { console.error(`not found: ${cmdExe}`); process.exit(2); }

const here = import.meta.dirname;
const name = 'AutomationReferenceProject';
const root = mkdtempSync(join(tmpdir(), 'automation-reference-'));
mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
mkdirSync(join(root, 'Config'), { recursive: true });
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

console.log(`Automation reference validation in ${root}`);
const toolchain = discoverToolchain({ compiler: flag('--compiler'), sdk: flag('--sdk') });
console.log(`  toolchain: compiler ${toolchain.compiler}, SDK ${toolchain.sdk} (${toolchain.notes.join('; ')})`);
const uproject = writeCodeProject({ root, name, modules: [{ name: 'AutomationProbe', type: 'Editor', sourceDir: join(here, 'module', 'AutomationProbe') }] });
const buildLog = join(root, 'Saved', 'build.log');
const built = await buildEditor({ engine, uproject, name, toolchain, logPath: buildLog });
console.log(`  build: exit ${built.exit}, ${built.seconds} s${built.timedOut ? ' (timed out)' : ''}`);
const build = { ...built, log: readText(buildLog) };

// The reference's command shape. `commandLine` is the text after -ExecCmds=; each run gets its own report folder.
function run(label, commandLine) {
  const reportDir = join(root, 'Saved', `report-${label}`);
  const logFile = join(root, 'Saved', 'Logs', `${label}.log`);
  const started = Date.now();
  const result = spawnSync(cmdExe, [uproject, '-Unattended', '-NullRHI', `-ExecCmds=${commandLine}`, `-ReportExportPath=${reportDir}`, `-abslog=${logFile}`, '-nosplash', '-nosound', '-notraceserver'],
    { stdio: 'ignore', timeout: 900000, windowsHide: true });
  console.log(`  ${label}: exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
  return { exit: result.status, reportText: readText(join(reportDir, 'index.json')), log: readText(logFile) };
}
const ini = join(root, 'Config', 'DefaultEngine.ini');
const runs = {};
if (built.exit === 0) {
  runs.exactPass = run('exact-pass', 'Automation RunTest AgentUnrealProbe.Passing;Quit');
  runs.exactFail = run('exact-fail', 'Automation RunTest AgentUnrealProbe.DeliberateFailure;Quit');
  writeFileSync(ini, configText());
  runs.groupOne = run('group-one', 'Automation RunTest Group:ProbePassing;Quit');
  runs.groupAll = run('group-all', 'Automation RunTest Group:ProbeAll;Quit');
  runs.groupMissing = run('group-missing', 'Automation RunTest Group:NoSuchGroup;Quit');
  writeFileSync(ini, configText({ exclude: true }));   // last: the exclusion would turn the failing test into a skipped one in every later run
  runs.exclude = run('exclude', 'Automation RunTest AgentUnrealProbe;Quit');
  const started = Date.now();
  const dvLog = join(root, 'Saved', 'Logs', 'data-validation.log');
  const dv = spawnSync(cmdExe, [uproject, '-run=DataValidation', `-abslog=${dvLog}`, '-unattended', '-nullrhi', '-nosplash', '-nosound', '-notraceserver'], { stdio: 'ignore', timeout: 900000, windowsHide: true });
  console.log(`  data-validation: exit ${dv.status}${dv.error ? ` (${dv.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
  runs.dataValidation = { exit: dv.status, log: readText(dvLog) };
}

const checks = evaluate({ build, runs });
for (const c of checks) console.log(`${c.info ? 'INFO' : c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
