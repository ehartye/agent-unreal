// node automation_test.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
// Validates skills/unreal-native/references/unreal-native-automation-tests.md against a real Unreal 5.8 install. It writes a throwaway
// code project in the OS temp folder with one editor module (module/AutomationProbe) holding a passing and a deliberately failing
// test, builds the editor target, runs the tests headless in several ways, and reads each automation report with automation_report.mjs.
// A last step appends wrong flag styles to the test file and builds again to record the compiler messages.
// The compiler and Windows SDK are discovered from the installed Visual Studio (override with --compiler / --sdk).
// Takes about six minutes. Exit code 0 when every check passes. Not part of node scripts/check.mjs; the checks are tested there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverToolchain, writeCodeProject, buildEditor } from '../native-build.mjs';
import { evaluate, summarize } from './automation-test-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node automation_test.mjs --engine <UE_5.8 folder> [--keep] [--compiler <x.y.z>] [--sdk <10.0.n.n>]'); process.exit(2); }
const bin = join(engine, 'Engine', 'Binaries', 'Win64');
for (const exe of ['UnrealEditor-Cmd.exe', 'UnrealEditor.exe']) if (!existsSync(join(bin, exe))) { console.error(`not found: ${join(bin, exe)}`); process.exit(2); }

const here = import.meta.dirname;
const name = 'AutomationProbeProject';
const root = mkdtempSync(join(tmpdir(), 'automation-test-'));
mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

console.log(`Automation test validation in ${root}`);
const toolchain = discoverToolchain({ compiler: flag('--compiler'), sdk: flag('--sdk') });
console.log(`  toolchain: compiler ${toolchain.compiler}, SDK ${toolchain.sdk} (${toolchain.notes.join('; ')})`);
const uproject = writeCodeProject({ root, name, modules: [{ name: 'AutomationProbe', type: 'Editor', sourceDir: join(here, 'module', 'AutomationProbe') }] });
const buildLog = join(root, 'Saved', 'build.log');
const built = await buildEditor({ engine, uproject, name, toolchain, logPath: buildLog });
console.log(`  build: exit ${built.exit}, ${built.seconds} s${built.timedOut ? ' (timed out)' : ''}`);
const build = { ...built, log: readText(buildLog) };

// Each run gets its own report folder, so no report can be left over from an earlier run.
function run(label, exe, commandArgs) {
  const reportDir = join(root, 'Saved', `report-${label}`);
  const logFile = join(root, 'Saved', 'Logs', `${label}.log`);
  const started = Date.now();
  const result = spawnSync(join(bin, exe), [uproject, '-nullrhi', ...commandArgs, `-ReportExportPath=${reportDir}`, `-abslog=${logFile}`, '-unattended', '-nosplash', '-nosound', '-notraceserver'],
    { stdio: 'ignore', timeout: 900000, windowsHide: true });
  console.log(`  ${label}: exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
  return { exit: result.status, reportText: readText(join(reportDir, 'index.json')), log: readText(logFile) };
}
const runs = built.exit === 0 ? {
  quitPass: run('quit-pass', 'UnrealEditor-Cmd.exe', ['-ExecCmds=Automation RunTests AgentUnrealProbe.Passing; Quit']),
  quitFail: run('quit-fail', 'UnrealEditor-Cmd.exe', ['-ExecCmds=Automation RunTests AgentUnrealProbe.DeliberateFailure; Quit']),
  exitFail: run('testexit-both', 'UnrealEditor-Cmd.exe', ['-ExecCmds=Automation RunTests AgentUnrealProbe', '-TestExit=Automation Test Queue Empty']),
  editorBoth: run('editor-both', 'UnrealEditor.exe', ['-ExecCmds=Automation RunTests AgentUnrealProbe; Quit']),
  noMatch: run('no-match', 'UnrealEditor-Cmd.exe', ['-ExecCmds=Automation RunTests AgentUnrealProbe.Nothing; Quit']),
} : {};

// Wrong flag styles: the removed type, a missing filter flag and a missing context flag.
appendFileSync(join(root, 'Source', 'AutomationProbe', 'AutomationProbeTests.cpp'), `
#if WITH_DEV_AUTOMATION_TESTS
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBadOldStyle, "AgentUnrealProbe.BadOld", EAutomationTestFlags::Type(EAutomationTestFlags::EditorContext | EAutomationTestFlags::ProductFilter))
bool FBadOldStyle::RunTest(const FString& Parameters) { return true; }
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBadNoFilter, "AgentUnrealProbe.BadNoFilter", EAutomationTestFlags::EditorContext)
bool FBadNoFilter::RunTest(const FString& Parameters) { return true; }
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBadNoContext, "AgentUnrealProbe.BadNoContext", EAutomationTestFlags::ProductFilter)
bool FBadNoContext::RunTest(const FString& Parameters) { return true; }
#endif
`);
const badLog = join(root, 'Saved', 'build-bad.log');
const bad = await buildEditor({ engine, uproject, name, toolchain, logPath: badLog });
console.log(`  build with wrong flag styles (expected to fail): exit ${bad.exit}, ${bad.seconds} s`);
const badBuild = { ...bad, log: readText(badLog) };

const checks = evaluate({ build, badBuild, runs });
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
