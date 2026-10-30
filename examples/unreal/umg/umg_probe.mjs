// node umg_probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--only toolsets,widget,capture,commonui] [--keep] [--plan] [--port <number>]
// The UMG and Common UI probe. Prepared 2026-10-30. It never runs as part of node scripts/check.mjs; the pure checks are tested in umg-probe.test.mjs.
//   toolsets  Epic's MCP server over loopback: list_toolsets and describe_toolset name the UMG, MVVM and widget-animation toolsets with their tools
//   widget    a Widget Blueprint (canvas, text block, button, image) built through call_tool, properties set, compiled, saved, read back
//   capture   that widget added to the viewport of a Play-In-Editor session run offscreen, frames saved with and without it, regions compared
//   commonui  the Common UI quickstart pieces set from a script, an activatable widget with a Common button created, activated and captured
// Each project is a throwaway in the OS temp folder (the base project: PythonScriptPlugin, EditorScriptingUtilities, Unreal MCP, AllToolsets and the UMG and MVVM
// toolsets; the commonui project adds Common UI, so the base project's frames are not taken under another viewport client). Per project: a rendering editor with
// -RenderOffScreen (a GPU, no interactive session) and the MCP server started by launch flag on a free port is driven from this script over loopback; then it is
// stopped and a second editor plays the saved widget in a Play-In-Editor viewport. Only processes whose command line names the throwaway project are stopped.
// --plan prints what would run. Video memory is sampled with nvidia-smi when it is on the PATH, before and after every editor phase.
// Exit code 0 when every check of the groups that ran passes, 1 when a check fails, 2 on a usage error.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { flushLine } from '../niagara_toolsets/nts-validate-checks.mjs';
import { parseProbeOptions, planPhases, USAGE, evaluateProbes, summarize, shotNames, decodePng, looksLikeMemoryFailure, WIDGET_ASSET } from './umg-probe-checks.mjs';
import { waitForServer } from './umg-mcp.mjs';
import { baseSession, commonUiSession, COMMONUI_ASSETS } from './umg-session.mjs';

const say = (text) => flushLine(text), complain = (text) => flushLine(text, { fd: 2 });
const options = parseProbeOptions(process.argv.slice(2), process.env);
if (options.error) { complain(`${options.error}\n${USAGE}`); process.exit(2); }
const { engine, keep, plan, groups } = options;
const editor = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
if (!plan && !existsSync(editor)) { complain(`not found: ${editor}`); process.exit(2); }

const here = import.meta.dirname;
const forward = (p) => String(p).replaceAll('\\', '/');
const phases = planPhases(groups);
const SERVER_WAIT_MS = 420000, EDITOR_LIMIT_MS = 600000;
const PLUGINS = {
  base: ['PythonScriptPlugin', 'EditorScriptingUtilities', 'ModelContextProtocol', 'ToolsetRegistry', 'EditorToolset', 'AllToolsets', 'UMGToolSet', 'MVVMToolset', 'ModelViewViewModel'],
  commonui: ['PythonScriptPlugin', 'EditorScriptingUtilities', 'ModelContextProtocol', 'ToolsetRegistry', 'EditorToolset', 'AllToolsets', 'UMGToolSet', 'CommonUI'],
};

if (plan) {
  say(`plan: ${groups.join(', ')} on ${engine}`);
  for (const phase of phases) {
    say(phase.mode === 'mcp'
      ? `  ${phase.name} (${phase.project} project): UnrealEditor <project> -RenderOffScreen -unattended -ModelContextProtocolStartServer -ModelContextProtocolPort=<free port>, then list_toolsets, describe_toolset and call_tool over loopback`
      : `  ${phase.name} (${phase.project} project): UnrealEditor <project> -RenderOffScreen -ExecCmds="py ${phase.script}" (UMG_MODE=${phase.stage}), frames read back from Saved/Screenshots`);
  }
  process.exit(0);
}

const root = mkdtempSync(join(tmpdir(), 'umg-probe-'));
const projects = {};
for (const name of [...new Set(phases.map((p) => p.project))]) {
  const dir = join(root, name);
  mkdirSync(join(dir, 'Saved', 'Logs'), { recursive: true });
  const file = join(dir, `Umg${name[0].toUpperCase()}${name.slice(1)}.uproject`);
  writeFileSync(file, JSON.stringify({ FileVersion: 3, EngineAssociation: '5.8', Plugins: PLUGINS[name].map((Name) => ({ Name, Enabled: true })) }, null, 2));
  projects[name] = { dir, file, saved: join(dir, 'Saved') };
}
const reportPath = (project, name) => join(projects[project].saved, `${name}.json`);
const logPath = (project, name) => join(projects[project].saved, 'Logs', `${name}.log`);
const readJson = (path) => { try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined; } catch { return undefined; } };
const readText = (path) => { try { return existsSync(path) ? readFileSync(path, 'utf8') : ''; } catch { return ''; } };

function stopProjectProcesses() {
  if (process.platform !== 'win32') return;
  const needle = root.replace(/'/g, "''");
  spawnSync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],
  { stdio: 'ignore', windowsHide: true, timeout: 60000 });
}

/** Video memory in use and GPU load, when nvidia-smi is on the PATH (an empty string when it is not). */
function gpu() {
  const r = spawnSync('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used', '--format=csv,noheader'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  return r.status === 0 ? `gpu ${r.stdout.trim().replace(/\s*\n\s*/g, '; ')}` : '';
}

const freePort = () => new Promise((ok, fail) => { const s = createServer(); s.once('error', fail); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });

function findShot(dir, stem) {
  if (!existsSync(dir)) return undefined;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { const hit = findShot(full, stem); if (hit) return hit; } else if (entry.startsWith(stem) && entry.endsWith('.png')) return full;
  }
  return undefined;
}

function frames(project, stage) {
  const images = {};
  for (const stem of shotNames(stage)) {
    const file = findShot(join(projects[project].saved, 'Screenshots'), stem);
    if (!file) { say(`  frame ${stem} not found under ${join(projects[project].saved, 'Screenshots')}`); continue; }
    try { images[stem] = decodePng(readFileSync(file)); } catch (error) { say(`  frame ${stem}: ${error.message}`); }
  }
  return images;
}

/** The MCP phase: start the editor with the server, drive it over loopback, write the report and the trace, stop the editor. */
async function mcpPhase(phase) {
  const project = projects[phase.project];
  const port = options.port ?? await freePort();
  const args = [project.file, '-RenderOffScreen', '-unattended', '-nosplash', '-nosound', '-notraceserver', '-ModelContextProtocolStartServer', `-ModelContextProtocolPort=${port}`, `-abslog=${logPath(phase.project, phase.name)}`];
  const started = Date.now();
  say(`  ${phase.name}: starting the editor with the MCP server on port ${port} ${gpu()}`);
  const child = spawn(editor, args, { stdio: 'ignore', windowsHide: true });
  let exited = false;
  child.on('exit', () => { exited = true; });
  child.on('error', () => { exited = true; });
  const server = await waitForServer({ port, limitMs: SERVER_WAIT_MS, alive: () => !exited, say });
  let report;
  let trace = [];
  if (!server.client) {
    say(`  ${phase.name}: ${server.error}`);
    report = { probe: 'session', project: phase.project, steps: [{ step: 'connect', error: server.error }] };
  } else {
    say(`  ${phase.name}: server answered after ${server.seconds} s ${gpu()}`);
    const ctx = { client: server.client, say };
    report = phase.project === 'base' ? await baseSession({ ...ctx, build: groups.some((g) => g === 'widget' || g === 'capture') }) : await commonUiSession(ctx);
    report.steps.unshift({ step: 'connect', ready_seconds: server.seconds, session_id: server.info.sessionId, protocol_version: server.info.protocolVersion, server_name: server.info.serverInfo && server.info.serverInfo.name });
    trace = server.client.trace;
  }
  writeFileSync(reportPath(phase.project, phase.name), JSON.stringify(report, null, 2));
  writeFileSync(join(project.saved, `${phase.name}-mcp-trace.json`), JSON.stringify(trace, null, 2));
  say(`  ${phase.name}: ${report.steps.length} steps in ${Math.round((Date.now() - started) / 1000)} s ${gpu()}`);
  child.kill();
  stopProjectProcesses();
  const memory = looksLikeMemoryFailure(readText(logPath(phase.project, phase.name)));
  if (memory) say(`  ${phase.name}: not run: memory (the log reports a video-memory failure)`);
  return report;
}

/** The Play-In-Editor phase: one editor runs umg_stage.py, which plays a map, adds the widget, takes the frames and quits. */
function editorPhase(phase) {
  const project = projects[phase.project];
  const asset = phase.project === 'base' ? WIDGET_ASSET : COMMONUI_ASSETS.activatable;
  const env = {
    ...process.env, UMG_MODE: phase.stage, UMG_REPORT: reportPath(phase.project, phase.name), UMG_PREFIX: phase.prefix, UMG_WIDGET: asset,
    UMG_INPUT_DATA: phase.project === 'commonui' ? COMMONUI_ASSETS.inputData : '',
  };
  const args = [project.file, '-RenderOffScreen', `-ExecCmds=py ${forward(resolve(here, phase.script))}`, `-abslog=${logPath(phase.project, phase.name)}`, '-notraceserver', '-nosplash', '-unattended', '-nosound'];
  const started = Date.now();
  say(`  ${phase.name}: started ${gpu()}`);
  const result = spawnSync(editor, args, { env, stdio: 'ignore', timeout: EDITOR_LIMIT_MS, windowsHide: true });
  const timedOut = result.status === null;
  say(`  ${phase.name}: ${timedOut ? 'killed at the limit' : `exit ${result.status}`}${result.error && !timedOut ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s, report ${existsSync(reportPath(phase.project, phase.name)) ? 'written' : 'NOT written'} ${gpu()}`);
  if (timedOut) stopProjectProcesses();
  if (looksLikeMemoryFailure(readText(logPath(phase.project, phase.name)))) say(`  ${phase.name}: not run: memory (the log reports a video-memory failure)`);
  const report = readJson(reportPath(phase.project, phase.name));
  return { report, images: report ? frames(phase.project, report) : {} };
}

say(`UMG probe in ${root} (${groups.join(', ')})`);
const reports = { base: {}, commonui: {} };
try {
  for (const phase of phases) {
    say(`${phase.name}:`);
    if (phase.mode === 'mcp') reports[phase.project].session = await mcpPhase(phase);
    else { const out = editorPhase(phase); reports[phase.project].capture = out.report; reports[phase.project].images = out.images; }
  }
} finally {
  stopProjectProcesses();
}

say('  judging the reports');
const checks = evaluateProbes({ groups, reports });
for (const c of checks) say(`${c.pass ? 'PASS' : 'FAIL'}  [${c.group}] ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
say(`${passed} of ${total} probe checks passed`);
const clean = passed === total;
if (keep || !clean) say(`kept ${root} (reports, MCP traces and logs under <project>/Saved; frames under <project>/Saved/Screenshots)`);
else rmSync(root, { recursive: true, force: true });
process.exit(clean ? 0 : 1);
