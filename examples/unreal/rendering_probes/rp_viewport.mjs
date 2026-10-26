// node rp_viewport.mjs --engine "<UE_5.8 folder>" [--keep]                                  headless extras (about a minute, no GPU needed)
// node rp_viewport.mjs --engine "<UE_5.8 folder>" --interactive [--phase-seconds 30]         INTERACTIVE: a rendering editor and a person watching its viewport
// node rp_viewport.mjs --judge --report <viewport report.json> --observed <observations.json>   judge a finished interactive run
// The opt-in directional-light probes behind unreal-directional-lights.md. Prepared 2026-10-26, not yet run on an engine: a first run tests these probes before it tests the engine.
// rp_validate.mjs (the headless run that backs the [tested] lines) is untouched, and this file adds no check that the headless run cannot judge: the checks that need a viewport are
// judged only from what a person observed.
//
// Extras: one hidden commandlet (-run=pythonscript, -nullrhi) runs rp_viewport_probe.py with RP_MODE=extras, judged by evaluateExtras (the existing-level form, a setter on an
// unregistered component, the renderer setting).
// Interactive: the editor starts with a visible window and no -nullrhi. The script spawns a sun and a moon and steps them through eight phases (rp-viewport-checks.mjs PHASES), holding each
// for --phase-seconds. This runner prints each phase as it starts, so look at the viewport then: the renderer's orange message "Multiple directional lights are competing to be the
// single one used for forward shading, translucent, water or volumetric fog..." is drawn at the top left of the viewport while two lights tie for the highest priority. Note per phase
// whether it is on screen and, if you can, take a screenshot of the editor window (the Windows snipping tool is enough). When the editor has quit, the runner writes a sheet
// (observations.json beside the report) with a blank entry per phase: fill in message_visible (true or false) for each phase, and for the tie phase text_seen (the words you read) and
// colour; then run --judge. The editor window must be visible and in front for the message to be drawn and for the phases to be timed in real frames.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { flushLine, planCleanup } from './rp-validate-checks.mjs';
import { PHASES, evaluateExtras, evaluateViewport, observationTemplate, summarize } from './rp-viewport-checks.mjs';

const say = (text) => flushLine(text), complain = (text) => flushLine(text, { fd: 2 });
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const usage = 'usage: node rp_viewport.mjs --engine <UE_5.8 folder> [--keep] | --engine <folder> --interactive [--phase-seconds 30] | --judge --report <report.json> --observed <observations.json>';
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const readJson = (path, what) => {
  if (!existsSync(path)) { complain(`${what} not found: ${path}`); process.exit(2); }
  try { return JSON.parse(readText(path)); } catch (error) { complain(`${what} is not JSON: ${error.message}`); process.exit(1); }
};
const printChecks = (checks) => {
  for (const c of checks) say(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
  const { passed, total } = summarize(checks);
  say(`${passed} of ${total} checks passed`);
  return passed === total;
};

// ---------------------------------------------------------------- --judge needs no engine
if (args.includes('--judge')) {
  const report = flag('--report') && readJson(resolve(flag('--report')), 'report');
  const observed = flag('--observed') && readJson(resolve(flag('--observed')), 'observations');
  if (!report || !observed) { complain(usage); process.exit(2); }
  process.exit(printChecks(evaluateViewport({ report, observed })) ? 0 : 1);
}

const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { complain(usage); process.exit(2); }
const interactive = args.includes('--interactive');
const exe = join(engine, 'Engine', 'Binaries', 'Win64', interactive ? 'UnrealEditor.exe' : 'UnrealEditor-Cmd.exe');
if (!existsSync(exe)) { complain(`not found: ${exe}`); process.exit(2); }

const here = import.meta.dirname;
const root = mkdtempSync(join(tmpdir(), 'rp-viewport-'));
const uproject = join(root, 'RpViewport.uproject');
writeFileSync(uproject, JSON.stringify({
  FileVersion: 3, EngineAssociation: '5.8',
  Plugins: ['PythonScriptPlugin', 'EditorScriptingUtilities'].map((Name) => ({ Name, Enabled: true })),
}, null, 2));
mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
const reportPath = join(root, 'Saved', interactive ? 'viewport-report.json' : 'extras-report.json');
const logPath = join(root, 'Saved', 'Logs', 'viewport.log');
const script = resolve(here, 'rp_viewport_probe.py');

function stopProjectProcesses() {
  if (process.platform !== 'win32') return;
  const needle = root.replace(/'/g, "''");
  spawnSync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle}') -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],
  { stdio: 'ignore', windowsHide: true });
}

// ---------------------------------------------------------------- headless extras
if (!interactive) {
  say(`Directional light extras (headless) in ${root}`);
  const result = spawnSync(exe, [uproject, '-run=pythonscript', `-script=${script}`, `-abslog=${logPath}`, '-unattended', '-nullrhi', '-nosplash', '-nopause', '-nosound', '-notraceserver'],
    { env: { ...process.env, RP_MODE: 'extras', RP_REPORT: reportPath, RP_MAP: '/Game/Maps/RpViewportExtras' }, stdio: 'ignore', timeout: 600000, windowsHide: true });
  say(`  probe (headless): exit ${result.status}${result.error ? ` (${result.error.message})` : ''}`);
  stopProjectProcesses();
  let report;
  try { report = existsSync(reportPath) ? JSON.parse(readText(reportPath)) : undefined; } catch (error) { complain(`report is not JSON: ${error.message}`); }
  const checks = evaluateExtras(report);
  const ok = printChecks(checks);
  const cleanup = planCleanup({ keep, report, checks, root, logPath });
  if (cleanup.message) say(cleanup.message);
  if (cleanup.remove) rmSync(root, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
}

// ---------------------------------------------------------------- interactive
const phaseSeconds = flag('--phase-seconds') || '30';
say('INTERACTIVE RUN. A rendering editor opens with a visible window. Keep it in front and watch its viewport.');
say(`Each of ${PHASES.length} phases lasts ${phaseSeconds} s after a 20 s settle. For every phase, note whether the orange renderer message is on screen, and screenshot the window if you can.`);
say(`Project: ${root}`);
const child = spawn(exe, [uproject, `-ExecutePythonScript=${script}`, `-abslog=${logPath}`, '-unattended', '-nosplash', '-nosound', '-notraceserver'],
  { env: { ...process.env, RP_MODE: 'interactive', RP_REPORT: reportPath, RP_MAP: '/Game/Maps/RpViewportInteractive', RP_PHASE_SECONDS: phaseSeconds }, stdio: 'ignore' });
let announced = 0;
const poll = setInterval(() => {
  let report;
  try { report = JSON.parse(readText(reportPath)); } catch { return; }
  const phases = Array.isArray(report?.phases) ? report.phases : [];
  while (announced < phases.length) {
    const p = phases[announced++];
    say(`  PHASE ${announced} of ${PHASES.length}: ${p.name} -- ${p.action}\n      LOOK NOW: is the orange "Multiple directional lights are competing..." message on screen?`);
  }
}, 1000);
const exitCode = await new Promise((done) => { child.on('exit', (code) => done(code)); child.on('error', () => done(null)); });
clearInterval(poll);
stopProjectProcesses();
say(`  editor exited with ${exitCode}`);
const sheet = join(root, 'Saved', 'observations.json');
writeFileSync(sheet, `${JSON.stringify(observationTemplate(), null, 2)}\n`);
say(`Fill in ${sheet}: message_visible true or false for every phase; for the tie phase also text_seen (the first words you read) and colour.`);
say(`Then: node rp_viewport.mjs --judge --report ${reportPath} --observed ${sheet}`);
say(`The project folder is kept: ${root}; editor log: ${logPath}`);
process.exit(0);
