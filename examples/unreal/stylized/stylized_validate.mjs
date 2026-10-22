// node stylized_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--shots <folder to copy the screenshots to>]
// Validates the stylized-look guidance (Substrate Toon, flipbook and stepped-ramp Niagara sprites) against a real Unreal 5.8 install.
// It makes a throwaway project in the OS temp folder (Substrate on, Blendable GBuffer) and a bare one, runs the scripts in this folder
// (stylized_build.py, stylized_render.py, stylized_persist.py twice, stylized_cvar.py), decodes the engine screenshots with a small
// PNG reader, counts flat luminance bands and flipbook areas (stylized-measure.mjs), and checks each claim (stylized-validate-checks.mjs).
// Exit code 0 when every check passes. Takes about five minutes and needs a GPU for the offscreen run. Not part of node scripts/check.mjs;
// the pure checks and measurements are tested there.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { decodePng } from './png-tools.mjs';
import { cellFillCounts, measureAll } from './stylized-measure.mjs';
import { evaluate, summarize } from './stylized-validate-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep'), shotsOut = flag('--shots');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node stylized_validate.mjs --engine <UE_5.8 folder> [--keep] [--shots <folder>]'); process.exit(2); }
const bin = join(engine, 'Engine', 'Binaries', 'Win64');
const cmd = join(bin, 'UnrealEditor-Cmd.exe'), editor = join(bin, 'UnrealEditor.exe');
for (const exe of [cmd, editor]) if (!existsSync(exe)) { console.error(`not found: ${exe}`); process.exit(2); }

const here = import.meta.dirname;
const slash = (p) => p.replaceAll('\\', '/');
const root = mkdtempSync(join(tmpdir(), 'stylized-validate-'));
const bare = mkdtempSync(join(tmpdir(), 'stylized-bare-'));
const project = join(root, 'StylizedValidate.uproject'), bareProject = join(bare, 'Bare.uproject');
const plugins = (names) => names.map((Name) => ({ Name, Enabled: true }));
writeFileSync(project, JSON.stringify({ FileVersion: 3, EngineAssociation: '5.8', Plugins: plugins(['PythonScriptPlugin', 'EditorScriptingUtilities', 'Niagara', 'NiagaraToolsets']) }, null, 2));
mkdirSync(join(root, 'Config'), { recursive: true });
writeFileSync(join(root, 'Config', 'DefaultEngine.ini'), '[/Script/Engine.RendererSettings]\nr.Substrate=True\nr.Substrate.ProjectGBufferFormat=0\n');
writeFileSync(bareProject, JSON.stringify({ FileVersion: 3, EngineAssociation: '5.8', Plugins: plugins(['PythonScriptPlugin']) }, null, 2));
const saved = (name) => join(root, 'Saved', name);
mkdirSync(join(root, 'Saved'), { recursive: true });
mkdirSync(join(bare, 'Saved'), { recursive: true });

function run(label, exe, argv, env, timeout) {
  const started = Date.now();
  const result = spawnSync(exe, argv, { env: { ...process.env, ...env }, stdio: 'ignore', timeout, windowsHide: true });
  console.log(`  ${label}: exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
}
const headless = ['-unattended', '-nullrhi', '-nosplash', '-nopause', '-nosound', '-notraceserver'];
const script = (proj, file, log, extra = []) => [slash(proj), '-run=pythonscript', `-script=${slash(resolve(here, file))}`, ...headless, `-abslog=${slash(log)}`, ...extra];
const text = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
const json = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined);

console.log(`Stylized validation in ${root}`);
run('bare project cvars', cmd, script(bareProject, 'stylized_cvar.py', join(bare, 'Saved', 'cvar.log')), { STYLIZED_REPORT: join(bare, 'Saved', 'cvar.json') }, 200000);
run('build (assets and level)', cmd, script(project, 'stylized_build.py', saved('build.log')), { STYLIZED_REPORT: saved('build.json') }, 400000);
run('render (offscreen play, screenshots)', editor, [slash(project), '/Game/Maps/StylizedProbe', '-RenderOffScreen', `-ExecCmds=py ${slash(resolve(here, 'stylized_render.py'))}`,
  `-abslog=${slash(saved('render.log'))}`, '-notraceserver', '-nosplash', '-unattended', '-nosound'], { STYLIZED_REPORT: saved('render.json'), MSYS_NO_PATHCONV: '1' }, 900000);
for (const mode of ['write', 'read']) {
  run(`toon profile override, ${mode} process`, cmd, script(project, 'stylized_persist.py', saved(`persist-${mode}.log`), ['-LogCmds=global Log']),
    { STYLIZED_PERSIST: mode, STYLIZED_REPORT: saved(`persist-${mode}.json`) }, 300000);
}

// Measure the screenshots.
let measures;
const shot = (name) => decodePng(readFileSync(join(root, 'Saved', 'Screenshots', 'WindowsEditor', `stylized_${name}.png`)));
try {
  const flipbook = decodePng(readFileSync(saved('stylized/drawn_flipbook.png')));
  measures = measureAll(shot, cellFillCounts(flipbook), [2, 9, 13]);
  if (shotsOut) {
    mkdirSync(shotsOut, { recursive: true });
    for (const name of ['meshes', 'toon_masked', 'toon_translucent', 'stepped', 'smooth', 'frame_9_bright', 'frame_9_dark', 'drawn_t0', 'drawn_t3']) {
      copyFileSync(join(root, 'Saved', 'Screenshots', 'WindowsEditor', `stylized_${name}.png`), join(shotsOut, `stylized_${name}.png`));
    }
  }
} catch (error) {
  console.log(`  measuring failed: ${error.message}`);
}

const checks = evaluate({
  bare: json(join(bare, 'Saved', 'cvar.json')), build: json(saved('build.json')), render: json(saved('render.json')),
  persistWrite: json(saved('persist-write.json')), persistRead: json(saved('persist-read.json')),
  logs: { build: text(saved('build.log')), render: text(saved('render.log')), persistWrite: text(saved('persist-write.log')), persistRead: text(saved('persist-read.log')) },
  measures,
});
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (keep) console.log(`kept ${root} and ${bare}`); else { rmSync(root, { recursive: true, force: true }); rmSync(bare, { recursive: true, force: true }); }
process.exit(passed === total ? 0 : 1);
