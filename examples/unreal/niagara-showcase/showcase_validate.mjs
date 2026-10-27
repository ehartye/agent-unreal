// node showcase_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--timeout-ms 2400000]
// Runs the Niagara showcase end to end and judges it, in one command. It writes a throwaway project in the OS temp folder (PythonScriptPlugin,
// EditorScriptingUtilities, Niagara, NiagaraFluids, NiagaraToolsets, and r.GenerateMeshDistanceFields=True in Config/DefaultEngine.ini),
// builds the arena level headless with showcase_build.py (-run=pythonscript, -nullrhi), then starts the game process on that level with
// showcase_explore.py in self-test mode (NIAGARA_SHOWCASE_GAME=1 and NIAGARA_SHOWCASE_SELFTEST=1, -game -windowed -RenderOffScreen),
// which glides to every station and logs its verdict. showcase-validate-checks.mjs reads the build report and the logs: the PASS line, each
// of the twelve checks (four motion, eight stations), the check count and any fatal error.
// The first activation of each fluid compiles its Niagara system, up to about a minute apiece, so the self-test run is given a long
// time (--timeout-ms, default 40 minutes, applies to each of the two runs). Needs a GPU for the offscreen game process. Exit code 0 when
// every check passes, 1 when one fails, 2 on bad usage. The project is deleted unless --keep. Not part of node scripts/check.mjs; the
// checks are tested there (showcase-validate.test.mjs). Hidden windows; only processes whose command line names the throwaway project
// are stopped afterwards.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readEngineVersion, describeEngine } from '../engine-version.mjs';
import { evaluate, summarize } from './showcase-validate-checks.mjs';

const USAGE = 'usage: node showcase_validate.mjs --engine <UE_5.8 folder> [--keep] [--timeout-ms N]';
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error(USAGE); process.exit(2); }
const timeoutText = flag('--timeout-ms');
const timeoutMs = timeoutText === undefined ? 2400000 : Number(timeoutText);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) { console.error(`--timeout-ms needs a positive number of milliseconds\n${USAGE}`); process.exit(2); }
const bin = join(engine, 'Engine', 'Binaries', 'Win64');
const cmd = join(bin, 'UnrealEditor-Cmd.exe');
const editor = join(bin, 'UnrealEditor.exe');
for (const exe of [cmd, editor]) if (!existsSync(exe)) { console.error(`not found: ${exe}`); process.exit(2); }

const here = import.meta.dirname;
const slash = (p) => p.replaceAll('\\', '/');
const root = mkdtempSync(join(tmpdir(), 'showcase-validate-'));
const project = join(root, 'ShowcaseValidate.uproject');
const saved = join(root, 'Saved');
const buildLogPath = join(saved, 'Logs', 'showcase-build.log');
const playLogPath = join(saved, 'Logs', 'showcase-selftest.log');
const reportPath = join(saved, 'niagara-showcase-build.json');
mkdirSync(join(saved, 'Logs'), { recursive: true });
mkdirSync(join(root, 'Config'), { recursive: true });
writeFileSync(project, JSON.stringify({
  FileVersion: 3, EngineAssociation: '5.8',
  Plugins: ['PythonScriptPlugin', 'EditorScriptingUtilities', 'Niagara', 'NiagaraFluids', 'NiagaraToolsets'].map((Name) => ({ Name, Enabled: true })),
}, null, 2));
writeFileSync(join(root, 'Config', 'DefaultEngine.ini'), '[/Script/Engine.RendererSettings]\nr.GenerateMeshDistanceFields=True\n');
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const readJson = (p) => { try { return existsSync(p) ? JSON.parse(readText(p)) : undefined; } catch { return undefined; } };

// Stop processes that were started with this project (and nothing else): a timed-out editor can leave workers behind.
function stopProjectProcesses() {
  if (process.platform !== 'win32') return;
  const needle = root.replace(/'/g, "''");
  spawnSync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains('${needle}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],
  { stdio: 'ignore', windowsHide: true });
}

function run(label, exe, argv, env) {
  const started = Date.now();
  console.log(`  ${label}: started`);
  const result = spawnSync(exe, argv, { env: { ...process.env, MSYS_NO_PATHCONV: '1', ...env }, stdio: 'ignore', timeout: timeoutMs, windowsHide: true });
  const seconds = Math.round((Date.now() - started) / 1000);
  const timedOut = result.error?.code === 'ETIMEDOUT';
  console.log(`  ${label}: exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${seconds} s${timedOut ? ' (timed out)' : ''}`);
  stopProjectProcesses();
  return { exit: result.status, timedOut, seconds };
}

console.log(`Niagara showcase validation in ${root}`);
for (const line of describeEngine(readEngineVersion(engine), engine)) console.log(`  ${line}`);

const quiet = ['-unattended', '-nosplash', '-nosound', '-notraceserver'];
let built;
for (let attempt = 1; attempt <= 2; attempt++) {
  built = run(`build the arena level${attempt > 1 ? ' (second attempt)' : ''}`, cmd,
    [slash(project), '-run=pythonscript', `-script=${slash(resolve(here, 'showcase_build.py'))}`, '-nullrhi', '-nopause', ...quiet, `-abslog=${slash(buildLogPath)}`],
    { NIAGARA_SHOWCASE_REPORT: reportPath });
  if (built.timedOut || existsSync(reportPath)) break;   // a run that wrote no report is retried once (a first-run crash); a timeout is not
}
const buildReport = readJson(reportPath);
const build = { ...built, report: buildReport, log: readText(buildLogPath) };

// The self-test: a game process (no editor, so the script finds the world with ObjectIterator), offscreen, quits itself after its verdict.
const mapBuilt = buildReport?.steps?.some((s) => s.step === 'save_map' && s.ok === true);
let play = { exit: null, timedOut: false, seconds: 0, log: '' };
if (mapBuilt) {
  const ran = run('self-test (game process, offscreen)', editor,
    [slash(project), '/Game/Maps/NiagaraShowcase', '-game', '-windowed', '-ResX=1280', '-ResY=720', '-RenderOffScreen', ...quiet, `-abslog=${slash(playLogPath)}`,
      `-ExecCmds=py ${slash(resolve(here, 'showcase_explore.py'))}`],
    { NIAGARA_SHOWCASE_GAME: '1', NIAGARA_SHOWCASE_SELFTEST: '1' });
  play = { ...ran, log: readText(playLogPath) };
} else {
  console.log('  self-test: skipped, the build did not save the map');
}

const checks = evaluate({ build, play });
for (const c of checks) console.log(`${c.observe ? (c.pass ? 'OBSERVE' : 'NOT RECORDED') : c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total, observed, observedRecorded } = summarize(checks);
console.log(`${passed} of ${total} checks passed; ${observedRecorded} of ${observed} observations recorded`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
