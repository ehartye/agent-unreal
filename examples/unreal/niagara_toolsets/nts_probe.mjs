// node nts_probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--only renderers,emit,frame,wire,gradient] [--keep] [--plan]
//                    [--scenes <folder>] [--glb <file|builtin>] [--atlas-png <file>] [--atlas-json <file>]
// Opt-in probes next to the Niagara toolset validator. Prepared 2026-10-26; not yet run on an engine. A first run tests the probe before it
// tests the engine. It never changes what nts_validate.mjs does and is not part of node scripts/check.mjs; the pure checks are tested there
// (nts-probe.test.mjs).
//   renderers  AddRenderer between existing renderers, other renderer classes, two renderers of one class, renderer counts of the templates
//   emit       which authoring step leaves a system that never emits (sim-cache counts of nine variants, with a negative control)
//   frame      Direct Frame Index linked to a user parameter set from Python (read-back, sim-cache index, screenshots at two values)
//   wire       a GLB into a mesh renderer and a sprite atlas into a Sub UV flipbook (sim-cache counts, screenshots against a baseline)
//   gradient   the System toolset's tool list (for 5.8.2 against 5.8.3) and a gradient or curve input written as a whole
// Each group gets its own throwaway project in the OS temp folder (PythonScriptPlugin, EditorScriptingUtilities, Niagara, NiagaraToolsets;
// wire adds the Interchange plugins). A group with a sim phase runs a commandlet to build assets and a level, then plays the level offscreen
// in the editor (GPU window, no interactive session). Hidden windows; only processes whose command line names the throwaway project are stopped.
// --plan prints what would run and resolves the wire assets without starting anything. The wire group needs a sample model and an atlas:
// pass --scenes <folder> (or set AGENT_UNREAL_SCENES) with the layout in examples/unreal/README.md, or --glb, --atlas-png and --atlas-json;
// when wire is named with --only and an asset is missing the run stops with exit 2 before any engine start; without --only, wire is skipped.
// Exit code 0 when every check of the groups that ran passes, 1 when a check fails, 2 on a usage or missing-asset error.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { flushLine } from './nts-validate-checks.mjs';
import { parseProbeOptions, PROBE_PHASES, USAGE, evaluateProbes, summarize, shotNames } from './nts-probe-checks.mjs';
import { resolveWireAssets, cubeGlb, decodePng } from './nts-probe-assets.mjs';

const say = (text) => flushLine(text), complain = (text) => flushLine(text, { fd: 2 });
const options = parseProbeOptions(process.argv.slice(2), process.env);
if (options.error) { complain(`${options.error}\n${USAGE}`); process.exit(2); }
const { engine, keep, plan, named } = options;
let groups = options.groups;
const cmd = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe');
const editor = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
if (!plan && !existsSync(cmd)) { complain(`not found: ${cmd}`); process.exit(2); }

const here = import.meta.dirname;
const forward = (p) => String(p).replaceAll('\\', '/');

// the wire assets are checked before anything starts
let wire;
if (groups.includes('wire')) {
  const resolved = resolveWireAssets(options, { exists: existsSync, readText: (p) => readFileSync(p, 'utf8') });
  if (resolved.error) {
    if (named) { complain(`wire: cannot start\n${resolved.error}\n${USAGE}`); process.exit(2); }
    say(`wire: skipped (name it with --only wire to make this an error)\n  ${resolved.error.split('\n').join('\n  ')}`);
    groups = groups.filter((g) => g !== 'wire');
  } else wire = resolved;
}
if (groups.length === 0) { complain('nothing to run'); process.exit(2); }

if (plan) {
  say(`plan: ${groups.join(', ')} on ${engine}`);
  for (const group of groups) {
    for (const phase of PROBE_PHASES[group]) {
      say(`  ${phase.name}: ${phase.mode === 'commandlet' ? `UnrealEditor-Cmd <project> -run=pythonscript -script=${phase.script} -unattended -nullrhi` : `UnrealEditor <project> ${phase.map} -RenderOffScreen -ExecCmds="py ${phase.script}"`}`);
    }
  }
  if (wire) say(`  wire assets: ${wire.meshes.map((m) => `${m.id}${m.path ? ` ${m.path}` : ''}`).join(', ')}; atlas ${wire.atlas.png} (grid ${wire.atlas.grid.cols}x${wire.atlas.grid.rows}${wire.atlas.grid.powerOfTwo === false ? ', sheet is not a power of two' : ''})`);
  process.exit(0);
}

const root = mkdtempSync(join(tmpdir(), 'nts-probe-'));
const dirs = {}, projects = {};
for (const group of groups) {
  dirs[group] = join(root, group);
  mkdirSync(join(dirs[group], 'Saved', 'Logs'), { recursive: true });
  projects[group] = join(dirs[group], `NtsProbe${group[0].toUpperCase()}${group.slice(1)}.uproject`);
  const plugins = ['PythonScriptPlugin', 'EditorScriptingUtilities', 'Niagara', 'NiagaraToolsets', ...(group === 'wire' ? ['Interchange', 'InterchangeEditor', 'InterchangeAssets'] : [])];
  writeFileSync(projects[group], JSON.stringify({ FileVersion: 3, EngineAssociation: '5.8', Plugins: plugins.map((Name) => ({ Name, Enabled: true })) }, null, 2));
}
const saved = (group) => join(dirs[group], 'Saved');
const reportPath = (group, phase) => join(saved(group), `${phase}.json`);
const manifestPath = (group) => join(saved(group), `${group}-manifest.json`);
const logPath = (group, phase) => join(saved(group), 'Logs', `${phase}.log`);
const readJson = (path) => { try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined; } catch { return undefined; } };

function stopProjectProcesses() {
  if (process.platform !== 'win32') return;
  const needle = root.replace(/'/g, "''");
  spawnSync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],
  { stdio: 'ignore', windowsHide: true });
}

function launch(group, phase, extraEnv) {
  const env = { ...process.env, NTS_PROBE_DIR: here, NTS_REPORT: reportPath(group, phase.name), NTS_MANIFEST: manifestPath(group), NTS_SIM_PREFIX: phase.prefix || 'nts', ...extraEnv };
  const script = resolve(here, phase.script);
  const args = phase.mode === 'commandlet'
    ? [projects[group], '-run=pythonscript', `-script=${script}`, `-abslog=${logPath(group, phase.name)}`, '-unattended', '-nullrhi', '-nosplash', '-nopause', '-nosound', '-notraceserver']
    : [projects[group], phase.map, '-RenderOffScreen', `-ExecCmds=py ${forward(script)}`, `-abslog=${logPath(group, phase.name)}`, '-notraceserver', '-nosplash', '-unattended', '-nosound'];
  const exe = phase.mode === 'commandlet' ? cmd : editor;
  const timeout = 600000;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    say(`  ${phase.name}: started${attempt > 1 ? ' (second attempt)' : ''}`);
    const result = spawnSync(exe, args, { env, stdio: 'ignore', timeout, windowsHide: true });
    say(`  ${phase.name}: exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s, report ${existsSync(reportPath(group, phase.name)) ? 'written' : 'NOT written'}`);
    if (result.status !== null) return result.status;   // a timeout is retried once; a crash is a result
    stopProjectProcesses();
  }
  return null;
}

function findFile(dir, name) {
  if (!existsSync(dir)) return undefined;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { const hit = findFile(full, name); if (hit) return hit; } else if (entry === name) return full;
  }
  return undefined;
}

function screenshots(group, sim) {
  const images = {}, notes = [];
  for (const name of shotNames(sim)) {
    const file = findFile(join(saved(group), 'Screenshots'), name);
    if (!file) { notes.push(`screenshot ${name} not found under ${join(saved(group), 'Screenshots')}`); continue; }
    try { images[name] = decodePng(readFileSync(file)); } catch (error) { notes.push(`screenshot ${name}: ${error.message}`); }
  }
  return { images, notes };
}

say(`Niagara probes in ${root} (${groups.join(', ')})`);
const reports = {};
for (const group of groups) {
  say(`${group}:`);
  const env = {};
  if (group === 'wire') {
    const cube = join(saved('wire'), 'probe-assets', 'cube.glb');
    mkdirSync(join(saved('wire'), 'probe-assets'), { recursive: true });
    writeFileSync(cube, cubeGlb());
    const meshes = wire.meshes.map((m) => (m.id === 'builtin' ? { ...m, path: forward(cube) } : { ...m, path: forward(resolve(m.path)) }));
    Object.assign(env, { NTS_WIRE_MESHES: JSON.stringify(meshes), NTS_WIRE_ATLAS_PNG: forward(resolve(wire.atlas.png)), NTS_WIRE_ATLAS_JSON: forward(resolve(wire.atlas.json)), NTS_WIRE_GRID: `${wire.atlas.grid.cols},${wire.atlas.grid.rows}` });
  }
  const phases = PROBE_PHASES[group];
  for (const phase of phases) launch(group, phase, env);
  stopProjectProcesses();
  if (phases.length === 1) reports[group] = readJson(reportPath(group, phases[0].name));
  else {
    const [build, sim] = phases;
    const simReport = readJson(reportPath(group, sim.name)), shots = screenshots(group, simReport);
    reports[group] = { build: readJson(reportPath(group, build.name)), sim: simReport, images: shots.images };
    for (const note of shots.notes) say(`  ${note}`);
  }
}

say('  judging the reports');
const checks = evaluateProbes({ groups, reports });
for (const c of checks) say(`${c.pass ? 'PASS' : 'FAIL'}  [${c.group}] ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
say(`${passed} of ${total} probe checks passed`);
const clean = passed === total;
if (keep || !clean) say(`kept ${root} (reports and logs under <group>/Saved; screenshots under <group>/Saved/Screenshots)`);
else rmSync(root, { recursive: true, force: true });
process.exit(clean ? 0 : 1);
