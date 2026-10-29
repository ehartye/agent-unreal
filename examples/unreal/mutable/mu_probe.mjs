// node mu_probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --parts <folder of .glb files> [--only build,variants,headless] [--keep] [--plan] [--compile-timeout <seconds>]
// The Mutable probe. Prepared 2026-10-29. It never runs as part of node scripts/check.mjs; the pure checks are tested in mu-probe.test.mjs.
//   build     import the parts, create a Customizable Object, try to reach its graph from Python, compile it under a wall-clock limit, read it back
//   variants  an Instance of the saved object set to each option in turn, a Play-In-Editor frame of each variant, frames compared
//   headless  the same compile under UnrealEditor-Cmd -run=pythonscript -nullrhi, or a record that it needs the editor
// One throwaway project in the OS temp folder (PythonScriptPlugin, EditorScriptingUtilities, Mutable, Interchange) serves all groups, in order. The build
// and variants phases start a rendering editor offscreen (-RenderOffScreen: a GPU, no interactive session); headless runs the commandlet. Every phase
// has a process limit of the compile timeout plus a margin, and a phase that reaches it is a recorded result, not retried; only processes whose
// command line names the throwaway project are stopped. --plan prints what would run without starting anything.
// --parts is a folder with two or more .glb files: a fixed body and the accessory pieces that differ (made with agent-meshes; see the README).
// Exit code 0 when every check of the groups that ran passes, 1 when a check fails, 2 on a usage or missing-file error.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { flushLine } from '../niagara_toolsets/nts-validate-checks.mjs';
import { decodePng } from '../niagara_toolsets/nts-probe-assets.mjs';
import { parseProbeOptions, listParts, PROBE_PHASES, USAGE, evaluateProbes, summarize, shotNames } from './mu-probe-checks.mjs';

const say = (text) => flushLine(text), complain = (text) => flushLine(text, { fd: 2 });
const options = parseProbeOptions(process.argv.slice(2), process.env);
if (options.error) { complain(`${options.error}\n${USAGE}`); process.exit(2); }
const { engine, keep, plan, groups, compileTimeoutS } = options;
const cmd = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe');
const editor = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
if (!plan && !existsSync(cmd)) { complain(`not found: ${cmd}`); process.exit(2); }

const here = import.meta.dirname;
const forward = (p) => String(p).replaceAll('\\', '/');

let parts = [];
if (groups.includes('build')) {
  if (!options.parts) { complain(`build needs the parts: pass --parts <folder of .glb files> or set AGENT_UNREAL_MUTABLE_PARTS\n${USAGE}`); process.exit(2); }
  if (!existsSync(options.parts) || !statSync(options.parts).isDirectory()) { complain(`parts folder not found: ${options.parts}`); process.exit(2); }
  const listed = listParts(readdirSync(options.parts));
  if (listed.error) { complain(`${listed.error}\n${USAGE}`); process.exit(2); }
  parts = listed.parts.map((p) => ({ id: p.id, path: forward(resolve(options.parts, p.file)) }));
}

const limits = (phase) => (compileTimeoutS + phase.extraS) * 1000;
if (plan) {
  say(`plan: ${groups.join(', ')} on ${engine}; compile timeout ${compileTimeoutS} s`);
  for (const group of groups) {
    for (const phase of PROBE_PHASES[group]) {
      say(`  ${phase.name}: ${phase.mode === 'commandlet' ? `UnrealEditor-Cmd <project> -run=pythonscript -script=${phase.script} -unattended -nullrhi` : `UnrealEditor <project> -RenderOffScreen -ExecCmds="py ${phase.script}"`}; process limit ${limits(phase) / 1000} s`);
    }
  }
  if (parts.length) say(`  parts: ${parts.map((p) => p.id).join(', ')}`);
  process.exit(0);
}

const root = mkdtempSync(join(tmpdir(), 'mu-probe-'));
mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
const project = join(root, 'MuProbe.uproject');
const plugins = ['PythonScriptPlugin', 'EditorScriptingUtilities', 'Mutable', 'Interchange', 'InterchangeEditor', 'InterchangeAssets'];
writeFileSync(project, JSON.stringify({ FileVersion: 3, EngineAssociation: '5.8', Plugins: plugins.map((Name) => ({ Name, Enabled: true })) }, null, 2));
const saved = join(root, 'Saved');
const reportPath = (phase) => join(saved, `${phase}.json`);
const logPath = (phase) => join(saved, 'Logs', `${phase}.log`);
const readJson = (path) => { try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined; } catch { return undefined; } };

function stopProjectProcesses() {
  if (process.platform !== 'win32') return;
  const needle = root.replace(/'/g, "''");
  spawnSync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],
  { stdio: 'ignore', windowsHide: true, timeout: 60000 });
}

/** Run one phase once. A process that reaches its limit is killed and recorded; the run is not retried. */
function launch(phase) {
  const env = {
    ...process.env, MU_PROBE_DIR: here, MU_REPORT: reportPath(phase.name), MU_CO: '/Game/Mu/CO_Person', MU_COMPILE_TIMEOUT_S: String(compileTimeoutS),
    MU_COMPILE_MODE: phase.mode === 'commandlet' ? 'sync' : 'async', MU_PARTS: JSON.stringify(parts), MU_PREFIX: phase.prefix || 'mu',
  };
  const script = resolve(here, phase.script);
  const args = phase.mode === 'commandlet'
    ? [project, '-run=pythonscript', `-script=${script}`, `-abslog=${logPath(phase.name)}`, '-unattended', '-nullrhi', '-nosplash', '-nopause', '-nosound', '-notraceserver']
    : [project, '-RenderOffScreen', `-ExecCmds=py ${forward(script)}`, `-abslog=${logPath(phase.name)}`, '-notraceserver', '-nosplash', '-unattended', '-nosound'];
  const started = Date.now();
  say(`  ${phase.name}: started (process limit ${limits(phase) / 1000} s)`);
  const result = spawnSync(phase.mode === 'commandlet' ? cmd : editor, args, { env, stdio: 'ignore', timeout: limits(phase), windowsHide: true });
  const seconds = Math.round((Date.now() - started) / 1000);
  const timedOut = result.status === null;
  say(`  ${phase.name}: ${timedOut ? 'killed at the limit' : `exit ${result.status}`}${result.error && !timedOut ? ` (${result.error.message})` : ''}, ${seconds} s, report ${existsSync(reportPath(phase.name)) ? 'written' : 'NOT written'}`);
  if (timedOut) stopProjectProcesses();
  return { exit: timedOut ? undefined : result.status, timed_out: timedOut, seconds };
}

function findFile(dir, name) {
  if (!existsSync(dir)) return undefined;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { const hit = findFile(full, name); if (hit) return hit; } else if (entry === name) return full;
  }
  return undefined;
}

say(`Mutable probe in ${root} (${groups.join(', ')}); compile timeout ${compileTimeoutS} s`);
const reports = {};
for (const group of groups) {
  say(`${group}:`);
  const [phase] = PROBE_PHASES[group];
  const process_ = launch(phase);
  stopProjectProcesses();
  const report = readJson(reportPath(phase.name));
  const images = {};
  if (group === 'variants') {
    for (const name of shotNames(report)) {
      const file = findFile(join(saved, 'Screenshots'), name);
      if (!file) { say(`  screenshot ${name} not found under ${join(saved, 'Screenshots')}`); continue; }
      try { images[name] = decodePng(readFileSync(file)); } catch (error) { say(`  screenshot ${name}: ${error.message}`); }
    }
  }
  reports[group] = { report, process: process_, images };
}

say('  judging the reports');
const checks = evaluateProbes({ groups, reports });
for (const c of checks) say(`${c.pass ? 'PASS' : 'FAIL'}  [${c.group}] ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
say(`${passed} of ${total} probe checks passed`);
const clean = passed === total;
if (keep || !clean) say(`kept ${root} (reports and logs under Saved; screenshots under Saved/Screenshots)`);
else rmSync(root, { recursive: true, force: true });
process.exit(clean ? 0 : 1);
