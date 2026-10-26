// node nts_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--only author]
// Validates the unreal-niagara-toolsets*.md and unreal-niagara-toolset-*.md references of skills/unreal-effects against a real Unreal 5.8 install.
// It makes a throwaway project in the OS temp folder (PythonScriptPlugin, EditorScriptingUtilities, Niagara, NiagaraToolsets), authors a
// system through the toolsets (nts_author.py: call shapes, bound and hidden inputs, local space, sort order, ribbon material, the template
// emitters), reads it back in a new process (nts_readback.py, with the input audit), asks the editor tick for the stack issues
// (nts_issues.py), and runs four delete-and-recreate phases (nts_recreate.py), two of which end in an editor crash on purpose, and a
// start-up run with a project init_unreal.py that raises. The reports, progress notes, exit codes and logs are judged
// by nts-validate-checks.mjs. Exit code 0 when every check passes. Takes a few minutes (timing varies with machine load). Not part of
// node scripts/check.mjs; the pure checks are tested there. Hidden windows; only processes whose command line names the throwaway project
// are stopped afterwards.
// --only <group>[,<group>...] (alias --phases) runs only those groups (author, readback, issues, recreate, startup; the ones after author
// need it), keeps the project, prints where their reports are and does not judge the checks, which need every group. One line is written as each phase starts
// and ends, so a redirected run shows progress.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { evaluate, summarize, parseOptions, describeReports, keepNote, flushLine, USAGE, PHASES_OF } from './nts-validate-checks.mjs';

const say = (text) => flushLine(text), complain = (text) => flushLine(text, { fd: 2 });
const options = parseOptions(process.argv.slice(2), process.env);
if (options.error) { complain(`${options.error}\n${USAGE}`); process.exit(2); }
const { engine, keep, phases: wanted, partial } = options;
const cmd = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe');
const editor = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
if (!existsSync(cmd)) { complain(`not found: ${cmd}`); process.exit(2); }
const runs = (phase) => wanted.includes(phase);

const here = import.meta.dirname;
const root = mkdtempSync(join(tmpdir(), 'nts-validate-'));
const project = join(root, 'NtsValidate.uproject');
writeFileSync(project, JSON.stringify({
  FileVersion: 3, EngineAssociation: '5.8',
  Plugins: ['PythonScriptPlugin', 'EditorScriptingUtilities', 'Niagara', 'NiagaraToolsets'].map((Name) => ({ Name, Enabled: true })),
}, null, 2));
const saved = join(root, 'Saved');
mkdirSync(join(saved, 'Logs'), { recursive: true });
const reportPath = (name) => join(saved, `${name}.json`);
const logPath = (name) => join(saved, 'Logs', `${name}.log`);
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const readJson = (path) => (existsSync(path) ? JSON.parse(readText(path)) : undefined);
const readLines = (path) => readText(path).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const initScript = join(root, 'Content', 'Python', 'init_unreal.py');

function run(label, script, name, env = {}, timeout = 600000) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    say(`  ${label}: started${attempt > 1 ? ' (second attempt)' : ''}`);
    const result = spawnSync(cmd, [project, '-run=pythonscript', `-script=${resolve(here, script)}`, `-abslog=${logPath(name)}`,
      '-unattended', '-nullrhi', '-nosplash', '-nopause', '-nosound', '-notraceserver'],
    { env: { ...process.env, NTS_REPORT: reportPath(name), NTS_NOTES: join(saved, `${name}.jsonl`), ...env }, stdio: 'ignore', timeout, windowsHide: true });
    say(`  ${label}: exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
    if (result.status !== null) return result.status;   // a timeout is retried once; a crash is a result
    rmSync(join(saved, `${name}.jsonl`), { force: true });
  }
  return null;
}

// The editor (not the commandlet) with a tick callback: GetStackIssues completes from the editor tick. The script quits the editor.
function runEditor(label, script, name, timeout = 300000) {
  const started = Date.now();
  say(`  ${label}: started`);
  const result = spawnSync(editor, [project, `-ExecCmds=py ${resolve(here, script).replaceAll(sep, '/')}`, `-abslog=${logPath(name)}`,
    '-unattended', '-nullrhi', '-nosplash', '-nopause', '-nosound', '-notraceserver'],
  { env: { ...process.env, NTS_REPORT: reportPath(name) }, stdio: 'ignore', timeout, windowsHide: true });
  say(`  ${label}: exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
  return result.status;
}

// Stop editors that were started with this project (and nothing else).
function stopProjectProcesses() {
  if (process.platform !== 'win32') return;
  const needle = root.replace(/'/g, "''");
  spawnSync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],
  { stdio: 'ignore', windowsHide: true });
}

say(`Niagara toolset validation in ${root}${partial ? ` (only: ${wanted.join(', ')})` : ''}`);
const exits = {};
if (runs('author')) run('author', 'nts_author.py', 'author');
if (runs('readback')) run('read back (new process)', 'nts_readback.py', 'readback');
if (runs('issues')) runEditor('stack issues (editor tick)', 'nts_issues.py', 'issues');
if (runs('make')) exits.make = run('make three systems on disk', 'nts_recreate.py', 'make', { NTS_PHASE: 'make' });
for (const phase of PHASES_OF.recreate.slice(1)) {
  if (runs(phase)) exits[phase] = run(`recreate: ${phase}`, 'nts_recreate.py', phase, { NTS_PHASE: phase });
}

// A project start-up script that raises: the traceback is logged and the toolset still registers and answers.
let startupExit = null;
if (runs('startup')) {
  mkdirSync(join(root, 'Content', 'Python'), { recursive: true });
  writeFileSync(initScript, [
    'import unreal',
    'unreal.log("[nts_startup] project init_unreal.py ran")',
    'raise AttributeError("module unreal has no attribute ExampleMissingClass")',
    '',
  ].join('\n'));
  startupExit = run('start-up script that raises', 'nts_startup.py', 'startup');
}
stopProjectProcesses();

let code;
if (partial) {
  // The checks need every group, so a partial run points at the reports instead of judging them.
  const { lines, missing } = describeReports(wanted, reportPath, existsSync);
  for (const line of lines) say(`  ${line}`);
  say(`${wanted.length} phase${wanted.length === 1 ? '' : 's'} run; checks not judged (they need every group)`);
  code = missing.length === 0 ? 0 : 1;
} else {
  say('  judging the reports and logs');
  const recreate = PHASES_OF.recreate;
  const checks = evaluate({
    author: readJson(reportPath('author')), readback: readJson(reportPath('readback')), issues: readJson(reportPath('issues')), authorLog: readText(logPath('author')),
    startup: readJson(reportPath('startup')), startupLog: readText(logPath('startup')), startupExit,
    notes: Object.fromEntries(recreate.map((p) => [p, readLines(join(saved, `${p}.jsonl`))])), exits,
    logs: Object.fromEntries(recreate.map((p) => [p, readText(logPath(p))])),
  });
  for (const c of checks) say(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
  const { passed, total } = summarize(checks);
  say(`${passed} of ${total} checks passed`);
  code = passed === total ? 0 : 1;
}
if (keep) say(keepNote(root, wanted, initScript)); else rmSync(root, { recursive: true, force: true });
process.exit(code);
