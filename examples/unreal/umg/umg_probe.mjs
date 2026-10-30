// node umg_probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--only toolsets,widget,capture,commonui,animation,mvvm,viewport,input] [--keep] [--plan] [--hold] [--port <number>]
// The UMG and Common UI probe. Prepared 2026-10-30. It never runs as part of node scripts/check.mjs; the pure checks are tested in umg-probe.test.mjs.
//   toolsets  Epic's MCP server over loopback: list_toolsets and describe_toolset name the UMG, MVVM and widget-animation toolsets with their tools
//   widget    a Widget Blueprint (canvas, text block, button, image) built through call_tool, properties set, compiled, saved, read back
//   capture   that widget added to the viewport of a Play-In-Editor session run offscreen, frames saved with and without it, regions compared
//   commonui  the Common UI quickstart pieces set from a script, an activatable widget with a Common button created, activated and captured
//   animation the eight Sequencer and Control Rig toolsets described, a track and a key added to a widget animation through them, read back by a fresh editor
//   mvvm      the MVVM toolset: a view model with a property, added to a widget, bound to a text block, read back with the List tools, compiled, loaded by a fresh editor
//   viewport  the class of the game viewport client of a Play-In-Editor session against the saved Game Viewport Client Class
//   input     a simulated key or click delivered to the active Common button in a Play-In-Editor session, by every route tried (the Slate inspector toolset included)
// Each project is a throwaway in the OS temp folder (the base project: PythonScriptPlugin, EditorScriptingUtilities, Unreal MCP, AllToolsets and the UMG and MVVM
// toolsets; the commonui project adds Common UI, so the base project's frames are not taken under another viewport client). Per project: a rendering editor with
// -RenderOffScreen (a GPU, no interactive session) and the MCP server started by launch flag on a free port is driven from this script over loopback; then it is
// stopped and a second editor plays the saved widget in a Play-In-Editor viewport. Only processes whose command line names the throwaway project are stopped.
// --plan prints what would run. --hold keeps the editor of the session (or play) phase open after its scripted steps and answers request files (umg-hold.mjs) until end.flag appears. Video memory is sampled with nvidia-smi when it is on the PATH, before and after every editor phase.
// Exit code 0 when every check of the groups that ran passes, 1 when a check fails, 2 on a usage error.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { flushLine } from '../niagara_toolsets/nts-validate-checks.mjs';
import { parseProbeOptions, planPhases, USAGE, evaluateProbes, summarize, shotNames, decodePng, looksLikeMemoryFailure, WIDGET_ASSET } from './umg-probe-checks.mjs';
import { waitForServer } from './umg-mcp.mjs';
import { pyCall, holdLoop } from './umg-hold.mjs';
import { baseSession, commonUiSession, readbackSession, slateSession, COMMONUI_ASSETS } from './umg-session.mjs';

const say = (text) => flushLine(text), complain = (text) => flushLine(text, { fd: 2 });
const options = parseProbeOptions(process.argv.slice(2), process.env);
if (options.error) { complain(`${options.error}\n${USAGE}`); process.exit(2); }
const { engine, keep, plan, groups, hold } = options;
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
      : phase.mode === 'play'
        ? `  ${phase.name} (${phase.project} project): UnrealEditor <project> -RenderOffScreen -ExecCmds="py ${phase.script}" (UMG_MODE=${phase.stage}) with the MCP server started by launch flag; the stage script waits for the calls to the Slate inspector toolset, frames read back from Saved/Screenshots`
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

/** Print the GPU load and video memory every 20 s while a phase runs. Returns the function that stops it. */
function startSampler(label) {
  const timer = setInterval(() => { const line = gpu(); if (line) say(`  ${label}: during ${line}`); }, 20000);
  return () => clearInterval(timer);
}

/** Run an editor to its end or to the limit (then stop it and any process of this project). Resolves with { status, timedOut }. */
function runEditor(args, env, limitMs) {
  return new Promise((ok) => {
    const child = spawn(editor, args, { env, stdio: 'ignore', windowsHide: true });
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; clearTimeout(timer); ok(value); } };
    const timer = setTimeout(() => { child.kill(); stopProjectProcesses(); finish({ status: null, timedOut: true }); }, limitMs);
    child.on('exit', (status) => finish({ status, timedOut: false }));
    child.on('error', (error) => finish({ status: null, timedOut: false, error: error.message }));
  });
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
  // the session phase also runs the stage script in its rpc mode when editor Python is needed beside the MCP server (the animation container) or when --hold is given
  const rpcDir = join(project.saved, 'hold', 'rpc');
  const useRpc = phase.name === 'session' && (hold || groups.includes('animation'));
  const args = [project.file, '-RenderOffScreen', '-unattended', '-nosplash', '-nosound', '-notraceserver', '-ModelContextProtocolStartServer', `-ModelContextProtocolPort=${port}`, `-abslog=${logPath(phase.project, phase.name)}`];
  if (useRpc) args.push(`-ExecCmds=py ${forward(resolve(here, 'umg_stage.py'))}`);
  const started = Date.now();
  say(`  ${phase.name}: starting the editor with the MCP server on port ${port} ${gpu()}`);
  const stopSampler = startSampler(phase.name);
  const child = spawn(editor, args, { stdio: 'ignore', windowsHide: true, env: useRpc ? { ...process.env, UMG_MODE: 'rpc', UMG_RPC: forward(rpcDir), UMG_REPORT: reportPath(phase.project, `${phase.name}-rpc`) } : process.env });
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
    const py = (code, o) => pyCall(rpcDir, code, o);
    const ctx = { client: server.client, say, py: useRpc ? py : undefined };
    const want = (...names) => names.some((g) => groups.includes(g));
    if (phase.name === 'readback') report = await readbackSession({ ...ctx, animation: want('animation'), mvvm: want('mvvm'), projectDir: project.dir });
    else if (phase.project === 'base') report = await baseSession({ ...ctx, build: want('widget', 'capture'), animation: want('animation'), mvvm: want('mvvm') });
    else report = await commonUiSession(ctx);
    if (hold && phase.name === 'session') {
      say(`  ${phase.name}: hold; the project is ${project.dir}`);
      await holdLoop({ dir: join(project.saved, 'hold'), ctx: { client: server.client, py }, say });
    }
    report.steps.unshift({ step: 'connect', ready_seconds: server.seconds, session_id: server.info.sessionId, protocol_version: server.info.protocolVersion, server_name: server.info.serverInfo && server.info.serverInfo.name });
    trace = server.client.trace;
  }
  writeFileSync(reportPath(phase.project, phase.name), JSON.stringify(report, null, 2));
  writeFileSync(join(project.saved, `${phase.name}-mcp-trace.json`), JSON.stringify(trace, null, 2));
  say(`  ${phase.name}: ${report.steps.length} steps in ${Math.round((Date.now() - started) / 1000)} s ${gpu()}`);
  child.kill();
  stopSampler();
  stopProjectProcesses();
  const memory = looksLikeMemoryFailure(readText(logPath(phase.project, phase.name)));
  if (memory) say(`  ${phase.name}: not run: memory (the log reports a video-memory failure)`);
  return report;
}

/** The environment the stage script reads. */
function stageEnv(phase, extra = {}) {
  extra = { UMG_RPC: forward(join(projects[phase.project].saved, 'hold', 'rpc')), ...extra };
  const asset = phase.project === 'base' ? WIDGET_ASSET : COMMONUI_ASSETS.activatable;
  return {
    ...process.env, UMG_MODE: phase.stage, UMG_REPORT: reportPath(phase.project, phase.name), UMG_PREFIX: phase.prefix, UMG_WIDGET: asset,
    UMG_INPUT_DATA: phase.project === 'commonui' ? COMMONUI_ASSETS.inputData : '', ...extra,
  };
}

/** The Play-In-Editor phase: one editor runs umg_stage.py, which plays a map, adds the widget, takes the frames and quits. */
async function editorPhase(phase) {
  const project = projects[phase.project];
  const args = [project.file, '-RenderOffScreen', `-ExecCmds=py ${forward(resolve(here, phase.script))}`, `-abslog=${logPath(phase.project, phase.name)}`, '-notraceserver', '-nosplash', '-unattended', '-nosound'];
  const started = Date.now();
  say(`  ${phase.name}: started ${gpu()}`);
  const stopSampler = startSampler(phase.name);
  const result = await runEditor(args, stageEnv(phase), EDITOR_LIMIT_MS);
  stopSampler();
  say(`  ${phase.name}: ${result.timedOut ? 'killed at the limit' : `exit ${result.status}`}${result.error ? ` (${result.error})` : ''}, ${Math.round((Date.now() - started) / 1000)} s, report ${existsSync(reportPath(phase.project, phase.name)) ? 'written' : 'NOT written'} ${gpu()}`);
  if (looksLikeMemoryFailure(readText(logPath(phase.project, phase.name)))) say(`  ${phase.name}: not run: memory (the log reports a video-memory failure)`);
  const report = readJson(reportPath(phase.project, phase.name));
  return { report, images: report ? frames(phase.project, report) : {} };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The play phase: one editor with Epic's MCP server (launch flag) and the stage script (mode input). The stage script plays, reads the running viewport client, makes the
 * Common button active and waits at a barrier file; node calls the Slate inspector toolset over loopback, writes the barrier file and the stage script tries its own routes.
 */
async function playPhase(phase) {
  const project = projects[phase.project];
  const port = options.port ?? await freePort();
  const barrier = join(project.saved, 'play.continue');
  rmSync(barrier, { force: true });
  const args = [project.file, '-RenderOffScreen', `-ExecCmds=py ${forward(resolve(here, phase.script))}`, '-ModelContextProtocolStartServer', `-ModelContextProtocolPort=${port}`,
    `-abslog=${logPath(phase.project, phase.name)}`, '-notraceserver', '-nosplash', '-unattended', '-nosound'];
  const started = Date.now();
  say(`  ${phase.name}: started with the MCP server on port ${port} ${gpu()}`);
  const stopSampler = startSampler(phase.name);
  let exited = false;
  const done = runEditor(args, stageEnv(phase, { UMG_CONTINUE: forward(barrier) }), EDITOR_LIMIT_MS).then((r) => { exited = true; return r; });
  const mcp = { steps: [] };
  const server = await waitForServer({ port, limitMs: SERVER_WAIT_MS, alive: () => !exited, say });
  // wait until the stage script has the Common button active (it writes input_ready into its report), then call the server
  const readyBy = Date.now() + 360000;
  while (!exited && Date.now() < readyBy) {
    const stage = readJson(reportPath(phase.project, phase.name));
    if (stage && stage.steps && stage.steps.input_ready) break;
    await sleep(2000);
  }
  if (server.client && !exited) {
    say(`  ${phase.name}: server answered after ${server.seconds} s; calling the Slate inspector toolset ${gpu()}`);
    const slate = await slateSession({ client: server.client, say, readStage: () => readJson(reportPath(phase.project, phase.name)) });
    mcp.steps = slate.steps;
    if (hold) {
      say(`  ${phase.name}: hold; the project is ${project.dir}`);
      await holdLoop({ dir: join(project.saved, 'hold'), ctx: { client: server.client, py: (code, o) => pyCall(join(project.saved, 'hold', 'rpc'), code, o), stage: () => readJson(reportPath(phase.project, phase.name)) }, say });
    }
    writeFileSync(join(project.saved, `${phase.name}-mcp-trace.json`), JSON.stringify(server.client.trace, null, 2));
  } else mcp.steps = [{ step: 'slate_describe', error: server.error || 'the editor exited before the calls' }];
  writeFileSync(barrier, 'continue');
  const result = await done;
  stopSampler();
  say(`  ${phase.name}: ${result.timedOut ? 'killed at the limit' : `exit ${result.status}`}, ${Math.round((Date.now() - started) / 1000)} s, report ${existsSync(reportPath(phase.project, phase.name)) ? 'written' : 'NOT written'} ${gpu()}`);
  const log = readText(logPath(phase.project, phase.name));
  if (looksLikeMemoryFailure(log)) say(`  ${phase.name}: not run: memory (the log reports a video-memory failure)`);
  const report = readJson(reportPath(phase.project, phase.name)) || { probe: 'stage', steps: {}, shots: [], events: ['the stage report was not written'] };
  report.mcp = mcp;
  report.log_viewport = log.split(/\r?\n/).filter((l) => /\[umg_stage\] (viewport_client|CLICKED)|GameViewportClient/.test(l)).slice(0, 40).map((l) => l.slice(0, 300));
  writeFileSync(reportPath(phase.project, phase.name), JSON.stringify(report, null, 2));
  return { report, images: frames(phase.project, report) };
}

say(`UMG probe in ${root} (${groups.join(', ')})`);
const reports = { base: {}, commonui: {} };
try {
  for (const phase of phases) {
    say(`${phase.name}:`);
    if (phase.mode === 'mcp') reports[phase.project][phase.key] = await mcpPhase(phase);
    else if (phase.mode === 'play') { const out = await playPhase(phase); reports[phase.project].play = out.report; reports[phase.project].playImages = out.images; }
    else { const out = await editorPhase(phase); reports[phase.project].capture = out.report; reports[phase.project].images = out.images; }
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
