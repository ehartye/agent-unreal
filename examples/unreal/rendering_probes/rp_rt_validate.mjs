// node rp_rt_validate.mjs --engine "<UE_5.8 folder>" [--phase rt | lights | toggle-prepare | toggle-judge] [--project <folder>] [--keep] [--offscreen] [--warmup-seconds 120]
// The opt-in MegaLights tracing-route probes. Prepared 2026-10-26, not yet run on an engine: a first run tests these probes before it tests the engine. rp_validate.mjs (the
// headless run that backs unreal-directional-lights.md) is untouched. Each phase starts a RENDERING editor (no -nullrhi, a visible window), so it needs a GPU window and a
// DirectX 12 GPU with ray tracing for the hardware phases; keep the editor window in front and do not run another Unreal process meanwhile.
//
//   --phase rt (default)     three launches of one throwaway project, each with its own Config/DefaultEngine.ini (rp-rt-checks.mjs engineIni):
//                            fatal     r.RayTracing on, skin cache shaders off: the engine should log the Fatal line and end before the script runs
//                            hardware  both on, MegaLights on: ray tracing starts, the script reads settings back and asks for a GPU profile
//                            software  r.RayTracing off, mesh distance fields and r.MegaLights.SoftwareRayTracing.Allow on: the same script
//   --phase lights          a Niagara Light renderer with both MegaLights switches on, drawn on the hardware route: a commandlet builds and saves the system (rp_rt_probe.py RP_MODE=lights-build),
//                            a rendering editor plays it, counts the live particles and takes a ProfileGPU (RP_MODE=lights-render), and the "CullLights ... NumLights n" line gives the lights drawn
//   --phase toggle-prepare   makes the throwaway project with a baseline DefaultEngine.ini and saves a copy as Saved/toggle-before.ini; INTERACTIVE from here: open the project in
//                            the editor yourself, Project Settings > Engine > Rendering > Hardware Ray Tracing > Support Hardware Ray Tracing, answer Yes to the skin cache
//                            prompt, close the editor
//   --phase toggle-judge     --project <that folder>: diffs Config/DefaultEngine.ini against the saved copy and judges which keys the toggle wrote
// Exit code 0 when every check passes. Not part of node scripts/check.mjs; the checks are tested there (rp-rt.test.mjs).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { flushLine, planCleanup } from './rp-validate-checks.mjs';
import { PHASES, engineIni, evaluateLights, evaluateRt, evaluateToggle, lightsDrawn, profileLightCounts, summarize } from './rp-rt-checks.mjs';

const say = (text) => flushLine(text), complain = (text) => flushLine(text, { fd: 2 });
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const offscreen = args.includes('--offscreen');   // adds -RenderOffScreen: a session with no desktop (SSH, a service) cannot create the editor window's swap chain
const phase = flag('--phase') || 'rt';
const engine = flag('--engine') || process.env.UE_ROOT;
const usage = 'usage: node rp_rt_validate.mjs --engine <UE_5.8 folder> [--phase rt | lights | toggle-prepare | toggle-judge] [--project <folder>] [--keep] [--warmup-seconds 120]';
if (!['rt', 'lights', 'toggle-prepare', 'toggle-judge'].includes(phase)) { complain(usage); process.exit(2); }
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const here = import.meta.dirname;

function makeProject(root, extraPlugins = []) {
  mkdirSync(join(root, 'Config'), { recursive: true });
  mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
  writeFileSync(join(root, 'RpRtValidate.uproject'), JSON.stringify({
    FileVersion: 3, EngineAssociation: '5.8',
    Plugins: ['PythonScriptPlugin', 'EditorScriptingUtilities', ...extraPlugins].map((Name) => ({ Name, Enabled: true })),
  }, null, 2));
  return join(root, 'RpRtValidate.uproject');
}

// ---------------------------------------------------------------- toggle-judge needs no engine
if (phase === 'toggle-judge') {
  const root = flag('--project') && resolve(flag('--project'));
  if (!root) { complain(usage); process.exit(2); }
  const before = join(root, 'Saved', 'toggle-before.ini'), after = join(root, 'Config', 'DefaultEngine.ini');
  if (!existsSync(before) || !existsSync(after)) { complain(`need ${before} (from --phase toggle-prepare) and ${after}`); process.exit(2); }
  const checks = evaluateToggle({ before: readText(before), after: readText(after) });
  for (const c of checks) say(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
  const { passed, total } = summarize(checks);
  say(`${passed} of ${total} checks passed`);
  process.exit(passed === total ? 0 : 1);
}

if (!engine) { complain(usage); process.exit(2); }
const editor = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
const cmd = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe');
if (!existsSync(editor)) { complain(`not found: ${editor}`); process.exit(2); }

// ---------------------------------------------------------------- toggle-prepare
if (phase === 'toggle-prepare') {
  const root = mkdtempSync(join(tmpdir(), 'rp-rt-toggle-'));
  const uproject = makeProject(root);
  writeFileSync(join(root, 'Config', 'DefaultEngine.ini'), engineIni({}));
  copyFileSync(join(root, 'Config', 'DefaultEngine.ini'), join(root, 'Saved', 'toggle-before.ini'));
  say(`Toggle project: ${root}`);
  say('INTERACTIVE. Do these steps yourself:');
  say(`  1. Open ${uproject} in UnrealEditor (a rendering editor, not -nullrhi).`);
  say('  2. Edit > Project Settings > Engine > Rendering > Hardware Ray Tracing > Support Hardware Ray Tracing: tick it, and answer Yes when asked about the skin cache.');
  say('  3. Close the editor (it may ask to restart; do not restart).');
  say(`  4. node rp_rt_validate.mjs --phase toggle-judge --project ${root}`);
  process.exit(0);
}

// ---------------------------------------------------------------- phase rt
const root = mkdtempSync(join(tmpdir(), phase === 'lights' ? 'rp-rt-lights-' : 'rp-rt-validate-'));
const uproject = makeProject(root, phase === 'lights' ? ['Niagara', 'NiagaraToolsets'] : []);
const warmup = flag('--warmup-seconds') || '120';

function stopProjectProcesses() {
  if (process.platform !== 'win32') return;
  const needle = root.replace(/'/g, "''");
  spawnSync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle}') -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],
  { stdio: 'ignore', windowsHide: true });
}

/**
 * One engine launch with the phase's ini. The editor quits by itself after the script, or ends on the Fatal; a hung editor is stopped after the timeout.
 * `mode` is the probe script's RP_MODE; a `commandlet` launch runs UnrealEditor-Cmd with -nullrhi and the script returning ends it.
 */
function launch(name, timeout, { ini = name, mode = 'rt', commandlet = false } = {}) {
  writeFileSync(join(root, 'Config', 'DefaultEngine.ini'), engineIni(PHASES[ini]));
  const report = join(root, 'Saved', `${name}.json`), log = join(root, 'Saved', 'Logs', `${name}.log`);
  rmSync(report, { force: true });
  say(`  ${name}: started (${commandlet ? 'commandlet, no window' : 'rendering editor; keep its window in front'})`);
  const started = Date.now();
  const script = resolve(here, 'rp_rt_probe.py');
  const common = [`-abslog=${log}`, '-unattended', '-nosplash', '-nosound', '-notraceserver'];
  const args = commandlet ? [uproject, '-run=pythonscript', `-script=${script}`, '-nullrhi', '-nopause', ...common]
    : [uproject, `-ExecutePythonScript=${script}`, ...common, ...(offscreen ? ['-RenderOffScreen'] : [])];
  const result = spawnSync(commandlet ? cmd : editor, args,
    { env: { ...process.env, RP_REPORT: report, RP_MAP: `/Game/Maps/RpRt_${name}`, RP_WARMUP_SECONDS: warmup, RP_MODE: mode }, stdio: 'ignore', timeout });
  const timedOut = result.error?.code === 'ETIMEDOUT';
  say(`  ${name}: exit ${result.status}${timedOut ? ' (timed out)' : ''}${result.error && !timedOut ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
  stopProjectProcesses();
  let parsed;
  try { parsed = existsSync(report) ? JSON.parse(readText(report)) : undefined; } catch (error) { complain(`${name}: report is not JSON: ${error.message}`); }
  return { exit: result.status, timedOut, log: readText(log), report: parsed, logPath: log };
}

let checks;
if (phase === 'lights') {
  say(`Niagara Light Renderer count in ${root}`);
  const runs = { build: launch('lights-build', 900000, { ini: 'lights', mode: 'lights-build', commandlet: true }), render: launch('lights-render', 1500000, { ini: 'lights', mode: 'lights-render' }) };
  checks = evaluateLights(runs);
  const drawn = lightsDrawn(runs.render.log);
  say(drawn === undefined ? 'Lights drawn: not read (no CullLights line in the profile)'
    : `Lights drawn: ${drawn} (CullLights lines: ${profileLightCounts(runs.render.log).map((f) => f.lights).join(', ')}); live particles in the simulation cache: ${JSON.stringify(runs.render.report?.particles ?? null)}`);
} else {
  say(`MegaLights tracing-route validation in ${root}`);
  const runs = { fatal: launch('fatal', 600000), hardware: launch('hardware', 1500000), software: launch('software', 1500000) };
  checks = evaluateRt(runs);
}
for (const c of checks) say(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
say(`${passed} of ${total} checks passed`);
const cleanup = planCleanup({ keep, report: {}, checks, root, logPath: join(root, 'Saved', 'Logs') });   // the report argument only matters to the headless runner
if (cleanup.message) say(cleanup.message);
if (cleanup.remove) rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
