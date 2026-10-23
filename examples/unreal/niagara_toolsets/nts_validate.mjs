// node nts_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep]
// Validates skills/unreal-features/references/unreal-niagara-toolsets.md against a real Unreal 5.8 install.
// It makes a throwaway project in the OS temp folder (PythonScriptPlugin, EditorScriptingUtilities, Niagara, NiagaraToolsets), authors a
// system through the toolsets (nts_author.py), reads it back in a new process (nts_readback.py), and runs four delete-and-recreate
// phases (nts_recreate.py), two of which end in an editor crash on purpose, and a start-up run with a project init_unreal.py that raises. The reports, progress notes, exit codes and logs are judged
// by nts-validate-checks.mjs. Exit code 0 when every check passes. Takes a few minutes. Not part of node scripts/check.mjs; the pure
// checks are tested there. Hidden windows; only processes whose command line names the throwaway project are stopped afterwards.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { evaluate, summarize } from './nts-validate-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node nts_validate.mjs --engine <UE_5.8 folder> [--keep]'); process.exit(2); }
const cmd = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe');
if (!existsSync(cmd)) { console.error(`not found: ${cmd}`); process.exit(2); }

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

function run(label, script, name, env = {}, timeout = 600000) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    const result = spawnSync(cmd, [project, '-run=pythonscript', `-script=${resolve(here, script)}`, `-abslog=${logPath(name)}`,
      '-unattended', '-nullrhi', '-nosplash', '-nopause', '-nosound', '-notraceserver'],
    { env: { ...process.env, NTS_REPORT: reportPath(name), NTS_NOTES: join(saved, `${name}.jsonl`), ...env }, stdio: 'ignore', timeout, windowsHide: true });
    console.log(`  ${label}: exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
    if (result.status !== null) return result.status;   // a timeout is retried once; a crash is a result
    rmSync(join(saved, `${name}.jsonl`), { force: true });
  }
  return null;
}

// Stop editors that were started with this project (and nothing else).
function stopProjectProcesses() {
  if (process.platform !== 'win32') return;
  const needle = root.replace(/'/g, "''");
  spawnSync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],
  { stdio: 'ignore', windowsHide: true });
}

console.log(`Niagara toolset validation in ${root}`);
const exits = {};
run('author', 'nts_author.py', 'author');
run('read back (new process)', 'nts_readback.py', 'readback');
exits.make = run('make three systems on disk', 'nts_recreate.py', 'make', { NTS_PHASE: 'make' });
for (const phase of ['same_process', 'stale', 'rescan_only', 'remove_rescan']) {
  exits[phase] = run(`recreate: ${phase}`, 'nts_recreate.py', phase, { NTS_PHASE: phase });
}

// A project start-up script that raises: the traceback is logged and the toolset still registers and answers.
mkdirSync(join(root, 'Content', 'Python'), { recursive: true });
writeFileSync(join(root, 'Content', 'Python', 'init_unreal.py'), [
  'import unreal',
  'unreal.log("[nts_startup] project init_unreal.py ran")',
  'raise AttributeError("module unreal has no attribute ExampleMissingClass")',
  '',
].join('\n'));
const startupExit = run('start-up script that raises', 'nts_startup.py', 'startup');
stopProjectProcesses();

const phases = ['make', 'same_process', 'stale', 'rescan_only', 'remove_rescan'];
const checks = evaluate({
  author: readJson(reportPath('author')), readback: readJson(reportPath('readback')), authorLog: readText(logPath('author')),
  startup: readJson(reportPath('startup')), startupLog: readText(logPath('startup')), startupExit,
  notes: Object.fromEntries(phases.map((p) => [p, readLines(join(saved, `${p}.jsonl`))])), exits,
  logs: Object.fromEntries(phases.map((p) => [p, readText(logPath(p))])),
});
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
