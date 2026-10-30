// node stylized_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--only base,outline,ribbon,mesh,cost] [--keep] [--shots <folder>] [--evidence <folder>]
// Validates the stylized-look guidance (Substrate Toon, flipbook and stepped-ramp Niagara sprites) and the ink-brush questions (an outline
// on a drawn particle, the drawn look on a ribbon and a mesh particle, and what the look costs) against a real Unreal 5.8 install.
// It makes a throwaway project in the OS temp folder (Substrate on, Blendable GBuffer, custom depth with stencil, fx.ForceCompileOnLoad=1) and,
// for the base group, a bare one, runs the scripts in this folder (stylized_build.py, stylized_render.py, stylized_persist.py twice,
// stylized_cvar.py), decodes the engine screenshots with a small PNG reader, measures them (stylized-measure.mjs, stylized-ink.mjs) and checks
// each claim (stylized-validate-checks.mjs). --only names the groups to run (default all); the base group is the original 17 checks.
// The cost group reads the CSV profiler files of the offscreen run and applies a gate: the ink-minus-control figure is kept only when the GPU
// was nearly idle before and after the run (nvidia-smi, when it is installed) and the repeated windows agree; otherwise it is "not measured".
// --evidence copies the reports, logs, screenshots, CSV files and GPU readings of the run to a folder before the throwaway project is deleted.
// Exit code 0 when every check passes. Takes about five minutes and needs a GPU for the offscreen run. Not part of node scripts/check.mjs;
// the pure checks and measurements are tested there.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { decodePng } from './png-tools.mjs';
import { cellFillCounts, measureAll } from './stylized-measure.mjs';
import { costVerdict, describeCost, GROUPS, measureInk, parseCsvColumn, parseSmi } from './stylized-ink.mjs';
import { evaluate, evaluateInk, summarize } from './stylized-validate-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep'), shotsOut = flag('--shots'), evidenceOut = flag('--evidence');
const engine = flag('--engine') || process.env.UE_ROOT;
const groups = (flag('--only') || GROUPS.join(',')).split(',').map((g) => g.trim()).filter(Boolean);
if (!engine || groups.some((g) => !GROUPS.includes(g))) { console.error(`usage: node stylized_validate.mjs --engine <UE_5.8 folder> [--only ${GROUPS.join(',')}] [--keep] [--shots <folder>] [--evidence <folder>]`); process.exit(2); }
const base = groups.includes('base'), ink = groups.some((g) => g !== 'base');
const bin = join(engine, 'Engine', 'Binaries', 'Win64');
const cmd = join(bin, 'UnrealEditor-Cmd.exe'), editor = join(bin, 'UnrealEditor.exe');
for (const exe of [cmd, editor]) if (!existsSync(exe)) { console.error(`not found: ${exe}`); process.exit(2); }

const here = import.meta.dirname;
const slash = (p) => p.replaceAll('\\', '/');
const root = mkdtempSync(join(tmpdir(), 'stylized-validate-'));
const bare = base ? mkdtempSync(join(tmpdir(), 'stylized-bare-')) : undefined;
const project = join(root, 'StylizedValidate.uproject'), bareProject = bare && join(bare, 'Bare.uproject');
const plugins = (names) => names.map((Name) => ({ Name, Enabled: true }));
writeFileSync(project, JSON.stringify({ FileVersion: 3, EngineAssociation: '5.8', Plugins: plugins(['PythonScriptPlugin', 'EditorScriptingUtilities', 'Niagara', 'NiagaraToolsets']) }, null, 2));
mkdirSync(join(root, 'Config'), { recursive: true });
// r.CustomDepth=3 is the project setting "Enabled with Stencil"; fx.ForceCompileOnLoad=1 recompiles a toolset-edited system when another process loads it
writeFileSync(join(root, 'Config', 'DefaultEngine.ini'), '[/Script/Engine.RendererSettings]\nr.Substrate=True\nr.Substrate.ProjectGBufferFormat=0\nr.CustomDepth=3\n\n[ConsoleVariables]\nfx.ForceCompileOnLoad=1\n');
const saved = (name) => join(root, 'Saved', name);
mkdirSync(join(root, 'Saved'), { recursive: true });
if (base) {
  writeFileSync(bareProject, JSON.stringify({ FileVersion: 3, EngineAssociation: '5.8', Plugins: plugins(['PythonScriptPlugin']) }, null, 2));
  mkdirSync(join(bare, 'Saved'), { recursive: true });
}

function run(label, exe, argv, env, timeout) {
  const started = Date.now();
  const result = spawnSync(exe, argv, { env: { ...process.env, ...env }, stdio: 'ignore', timeout, windowsHide: true });
  console.log(`  ${label}: exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
}
const headless = ['-unattended', '-nullrhi', '-nosplash', '-nopause', '-nosound', '-notraceserver'];
const script = (proj, file, log, extra = []) => [slash(proj), '-run=pythonscript', `-script=${slash(resolve(here, file))}`, ...headless, `-abslog=${slash(log)}`, ...extra];
const text = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
const json = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined);
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// GPU readings: nvidia-smi when it is installed. The readings before and after the run are taken with no engine process of this probe running,
// so they are the other users' load; the readings during the run include the editor and are kept as a record.
const SMI = ['--query-gpu=utilization.gpu,memory.used', '--format=csv,noheader'];
function smiSamples(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const r = spawnSync('nvidia-smi', SMI, { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) break;
    out.push(...parseSmi(r.stdout));
    if (i < count - 1) pause(1000);
  }
  return out;
}

console.log(`Stylized validation of ${groups.join(', ')} in ${root}`);
const env = { STYLIZED_GROUPS: groups.join(','), STYLIZED_DIR: here };
if (base) run('bare project cvars', cmd, script(bareProject, 'stylized_cvar.py', join(bare, 'Saved', 'cvar.log')), { STYLIZED_REPORT: join(bare, 'Saved', 'cvar.json') }, 200000);
run('build (assets and level)', cmd, script(project, 'stylized_build.py', saved('build.log')), { ...env, STYLIZED_REPORT: saved('build.json') }, 700000);
const before = smiSamples(5);
console.log(`  GPU before the run (utilization.gpu %, memory MiB): ${before.map((s) => `${s.util} % ${s.memMiB}`).join('; ') || 'no nvidia-smi readings'}`);
const smiFile = saved('smi-during.csv'), smiFd = openSync(smiFile, 'w');
const sampler = spawn('nvidia-smi', ['--query-gpu=timestamp,utilization.gpu,memory.used', '--format=csv,noheader', '-l', '1'], { stdio: ['ignore', smiFd, 'ignore'], windowsHide: true });
sampler.on('error', () => {});
run('render (offscreen play, screenshots)', editor, [slash(project), '/Game/Maps/StylizedProbe', '-RenderOffScreen', `-ExecCmds=py ${slash(resolve(here, 'stylized_render.py'))}`,
  `-abslog=${slash(saved('render.log'))}`, '-notraceserver', '-nosplash', '-unattended', '-nosound'], { ...env, STYLIZED_REPORT: saved('render.json'), MSYS_NO_PATHCONV: '1' }, 1500000);
sampler.kill();
closeSync(smiFd);
const after = smiSamples(5);
console.log(`  GPU after the run: ${after.map((s) => `${s.util} % ${s.memMiB}`).join('; ') || 'no nvidia-smi readings'}`);
if (base) {
  for (const mode of ['write', 'read']) {
    run(`toon profile override, ${mode} process`, cmd, script(project, 'stylized_persist.py', saved(`persist-${mode}.log`), ['-LogCmds=global Log']),
      { STYLIZED_PERSIST: mode, STYLIZED_REPORT: saved(`persist-${mode}.json`) }, 300000);
  }
}

// Measure the screenshots.
const shotFile = (name) => join(root, 'Saved', 'Screenshots', 'WindowsEditor', `stylized_${name}.png`);
const shot = (name) => decodePng(readFileSync(shotFile(name)));
let measures, inkMeasures;
if (base) {
  try {
    const flipbook = decodePng(readFileSync(saved('stylized/drawn_flipbook.png')));
    measures = measureAll(shot, cellFillCounts(flipbook), [2, 9, 13]);
    if (shotsOut) {
      mkdirSync(shotsOut, { recursive: true });
      for (const name of ['meshes', 'toon_masked', 'toon_translucent', 'stepped', 'smooth', 'frame_9_bright', 'frame_9_dark', 'drawn_t0', 'drawn_t3']) {
        copyFileSync(shotFile(name), join(shotsOut, `stylized_${name}.png`));
      }
    }
  } catch (error) {
    console.log(`  measuring failed: ${error.message}`);
  }
}
const render = json(saved('render.json'));
if (ink) {
  try { inkMeasures = measureInk(shot, groups); } catch (error) { console.log(`  measuring the ink-brush shots failed: ${error.message}`); }
}

// Frame cost: the GPUTime column of each window's CSV file, the readings, and the gate.
let cost;
if (groups.includes('cost')) {
  const windows = ((render || {}).windows || []).map((w) => {
    const file = join(root, 'Saved', 'Profiling', 'CSV', w.file);
    return { scene: w.scene, round: w.round, t0: w.t0, t1: w.t1, error: w.error, gpuMs: existsSync(file) ? parseCsvColumn(text(file), 'GPUTime') : [] };
  });
  const during = parseSmi(text(smiFile));
  cost = costVerdict({ before, after, during, windows, counts: (render || {}).counts });
  console.log(`  frame cost: ${describeCost(cost)}`);
  console.log(`  windows: ${windows.map((w) => `${w.scene} r${w.round} ${w.gpuMs.length} frames${w.error ? ` (${w.error})` : ''}`).join(', ') || 'none'}; viewport ${JSON.stringify((render || {}).viewport)}`);
  if (evidenceOut) { mkdirSync(evidenceOut, { recursive: true }); writeFileSync(join(evidenceOut, 'cost.json'), JSON.stringify({ cost, before, after, during, windows: windows.map(({ gpuMs, ...rest }) => ({ ...rest, frames: gpuMs.length, gpuMs })) }, null, 1)); }
}

const logs = { build: text(saved('build.log')), render: text(saved('render.log')), persistWrite: text(saved('persist-write.log')), persistRead: text(saved('persist-read.log')) };
const checks = [];
if (base) {
  checks.push(...evaluate({
    bare: json(join(bare, 'Saved', 'cvar.json')), build: json(saved('build.json')), render, persistWrite: json(saved('persist-write.json')), persistRead: json(saved('persist-read.json')), logs, measures,
  }));
}
if (ink) checks.push(...evaluateInk({ groups, build: json(saved('build.json')), render, measures: inkMeasures, cost, logs }));
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);

if (evidenceOut) {
  mkdirSync(evidenceOut, { recursive: true });
  const copy = (from, name) => { if (existsSync(from)) copyFileSync(from, join(evidenceOut, name)); };
  for (const name of readdirSync(join(root, 'Saved'))) if (/\.(json|log|csv)$/.test(name)) copy(join(root, 'Saved', name), name);
  if (existsSync(join(root, 'Saved', 'Screenshots', 'WindowsEditor'))) for (const name of readdirSync(join(root, 'Saved', 'Screenshots', 'WindowsEditor'))) if (/^stylized_.*\.png$/.test(name)) copy(join(root, 'Saved', 'Screenshots', 'WindowsEditor', name), name);
  if (existsSync(join(root, 'Saved', 'Profiling', 'CSV'))) for (const name of readdirSync(join(root, 'Saved', 'Profiling', 'CSV'))) copy(join(root, 'Saved', 'Profiling', 'CSV', name), name);
  writeFileSync(join(evidenceOut, 'checks.json'), JSON.stringify(checks, null, 1));
  console.log(`evidence copied to ${evidenceOut}`);
}
if (keep) console.log(`kept ${root}${bare ? ` and ${bare}` : ''}`); else { rmSync(root, { recursive: true, force: true }); if (bare) rmSync(bare, { recursive: true, force: true }); }
process.exit(passed === total ? 0 : 1);
