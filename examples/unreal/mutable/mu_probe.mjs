// node mu_probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --parts <folder of .glb files> [--only bridge,build,graph,variants,headless] [--keep] [--plan] [--compile-timeout <seconds>] [--compiler <x.y.z>] [--sdk <10.0.n.n>]
// The Mutable probe. Prepared 2026-10-30. It never runs as part of node scripts/check.mjs; the pure checks are tested in mu-probe.test.mjs.
//   bridge    build the editor module MutableBridge (module/MutableBridge, which depends on the Mutable plugin's editor module) with Unreal Build Tool, start the editor, look for unreal.MutableBridgeLibrary
//   build     import the parts, create a Customizable Object, show that Python alone cannot add a node or link a pin, compile the bare object under a wall-clock limit
//   graph     through the bridge: add a node and link a pin on one object, ask for what must be refused, then build a swappable-parts graph on another, compile it and read its parameter
//   variants  an Instance of the saved object set to each option in turn, a Play-In-Editor frame of each variant, frames compared
//   headless  the same compile under UnrealEditor-Cmd -run=pythonscript -nullrhi, or a record that it needs the editor
// One throwaway project in the OS temp folder (PythonScriptPlugin, EditorScriptingUtilities, Mutable, Interchange) serves all groups, in order. With the bridge
// group it is a code project whose Editor target is built first; without it, a content project. The editor phases start a rendering editor offscreen
// (-RenderOffScreen: a GPU, no interactive session); headless runs the commandlet. Every phase has a limit (the module build its own, the others the compile
// timeout plus a margin), and a phase that reaches it is a recorded result, not retried; only processes whose command line names the throwaway project are
// stopped. If the module does not build, the later phases are not run (the project would name a module with no binary). --plan prints what would run.
// --parts is a folder with two or more .glb files: a fixed body and the accessory pieces that differ (made with agent-meshes; see the README).
// Exit code 0 when every check of the groups that ran passes, 1 when a check fails, 2 on a usage or missing-file error.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { flushLine } from '../niagara_toolsets/nts-validate-checks.mjs';
import { decodePng } from '../niagara_toolsets/nts-probe-assets.mjs';
import { discoverToolchain, writeCodeProject, buildEditor } from '../native-build.mjs';
import { parseProbeOptions, listParts, PROBE_PHASES, USAGE, evaluateProbes, summarize, shotNames, summarizeBuildLog, MODULE_BUILD_TIMEOUT_S, OBJECT_PATH } from './mu-probe-checks.mjs';

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
      if (phase.mode === 'build') say(`  ${phase.name}: Build.bat MuProbeEditor Win64 Development (module MutableBridge); build limit ${MODULE_BUILD_TIMEOUT_S} s`);
      else say(`  ${phase.name}: ${phase.mode === 'commandlet' ? `UnrealEditor-Cmd <project> -run=pythonscript -script=${phase.script} -unattended -nullrhi` : `UnrealEditor <project> -RenderOffScreen -ExecCmds="py ${phase.script}"`}; process limit ${limits(phase) / 1000} s`);
    }
  }
  if (parts.length) say(`  parts: ${parts.map((p) => p.id).join(', ')}`);
  process.exit(0);
}

const wantsModule = groups.includes('bridge');
const projectName = 'MuProbe';
const root = mkdtempSync(join(tmpdir(), 'mu-probe-'));
mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
const plugins = ['PythonScriptPlugin', 'EditorScriptingUtilities', 'Mutable', 'Interchange', 'InterchangeEditor', 'InterchangeAssets'];
const project = join(root, `${projectName}.uproject`);
if (wantsModule) writeCodeProject({ root, name: projectName, plugins, modules: [{ name: 'MutableBridge', type: 'Editor', sourceDir: join(here, 'module', 'MutableBridge') }] });
else writeFileSync(project, JSON.stringify({ FileVersion: 3, EngineAssociation: '5.8', Plugins: plugins.map((Name) => ({ Name, Enabled: true })) }, null, 2));
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

/** Build the Editor target (with the module) once under its own limit. A build that reaches the limit is killed by the helper and recorded; it is not retried. */
async function buildModule() {
  const toolchain = discoverToolchain({ compiler: options.compiler, sdk: options.sdk });
  say(`  module: toolchain compiler ${toolchain.compiler}, SDK ${toolchain.sdk}; build limit ${MODULE_BUILD_TIMEOUT_S} s`);
  const buildLog = join(saved, 'build.log');
  const built = await buildEditor({ engine, uproject: project, name: projectName, toolchain, logPath: buildLog, timeoutMs: MODULE_BUILD_TIMEOUT_S * 1000 });
  const text = existsSync(buildLog) ? readFileSync(buildLog, 'utf8') : '';
  const log = summarizeBuildLog(text);
  say(`  module: Build.bat ${built.timedOut ? 'killed at the limit' : `exit ${built.exit}`}, ${built.seconds} s, ${log.errorCount} error lines, ${log.warningCount} warnings${log.result ? `, ${log.result}` : ''}`);
  for (const line of log.errorLines) say(`    ${line}`);
  return { exit: built.exit ?? undefined, seconds: built.seconds, timedOut: built.timedOut, log };
}

/** Run one editor or commandlet phase once. A process that reaches its limit is killed and recorded; the run is not retried. */
function launch(phase) {
  const env = {
    ...process.env, MU_PROBE_DIR: here, MU_REPORT: reportPath(phase.name), MU_CO: phase.co || OBJECT_PATH, MU_COMPILE_TIMEOUT_S: String(compileTimeoutS),
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
let moduleFailed = false;
for (const group of groups) {
  say(`${group}:`);
  const entry = { report: undefined, process: undefined, images: {}, module: undefined };
  for (const phase of PROBE_PHASES[group]) {
    if (phase.mode === 'build') {
      entry.module = await buildModule();
      moduleFailed = entry.module.exit !== 0 || entry.module.timedOut;
      continue;
    }
    if (moduleFailed) { say(`  ${phase.name}: not run: the module did not build, and the project names a module with no binary`); continue; }
    entry.process = launch(phase);
    stopProjectProcesses();
    entry.report = readJson(reportPath(phase.name));
  }
  if (group === 'variants') {
    for (const name of shotNames(entry.report)) {
      const file = findFile(join(saved, 'Screenshots'), name);
      if (!file) { say(`  screenshot ${name} not found under ${join(saved, 'Screenshots')}`); continue; }
      try { entry.images[name] = decodePng(readFileSync(file)); } catch (error) { say(`  screenshot ${name}: ${error.message}`); }
    }
  }
  reports[group] = entry;
}

say('  judging the reports');
const checks = evaluateProbes({ groups, reports });
for (const c of checks) say(`${c.pass ? 'PASS' : 'FAIL'}  [${c.group}] ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
say(`${passed} of ${total} probe checks passed`);
const clean = passed === total;
if (keep || !clean) say(`kept ${root} (reports and logs under Saved; the module build log is Saved/build.log; screenshots under Saved/Screenshots)`);
else rmSync(root, { recursive: true, force: true });
process.exit(clean ? 0 : 1);
