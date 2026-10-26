// node landscape_world.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--only landmass|pcg|unload] [--rendering] [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
// PREPARED, NOT YET RUN ON AN ENGINE. Engine probes for three open rows of the procedural-world references:
//   landmass  Can Python put a Landmass brush manager on a Landscape edit layer? (landmass_probe.py: a ladder of rungs, a negative control
//             and the bridge's attach_brush_to_layer; heights read in a rendering editor.)
//   pcg       Does a PCG graph with a Landscape input and a Surface Sampler produce points across the proxies of a partitioned Landscape in
//             the editor? (pcg_partition_probe.py: a non-partitioned control, then the partitioned volume, counts per grid actor.)
//   unload    Does any Python route leave a Landscape streaming proxy unloaded in the editor? (wp_unload_probe.py: recorded, not asserted.)
// It writes a throwaway code project in the OS temp folder with the LandscapeBridge module (module/LandscapeBridge, which now also holds the
// brush functions), the Landmass and PCG plugins, builds the Editor target, and starts one editor per phase. The map made by the pcg phase is
// the one the unload phase opens, so run them in this order (the default), or run unload alone and it makes the map itself.
// Editors start with -nullrhi. --rendering uses -RenderOffScreen instead and sets LW_RENDER=1: the landmass phase then waits for the edit
// layer merge and compares heights (the merge draws on the GPU, so heights need a rendering editor; on a machine with no desktop session
// a rendering editor needs -RenderOffScreen). Build about 40 s to 5 min; each editor run 1 to 4 min; the landmass phase in a rendering editor
// can take 10 to 20 min the first time (the brush materials compile).
// Exit code 0 when every assert check passes; observe lines never fail the run. Not part of node scripts/check.mjs; the checks are tested there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverToolchain, writeCodeProject, buildEditor } from '../native-build.mjs';
import { evaluate, summarize } from './landscape-world-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const rendering = args.includes('--rendering');
const only = flag('--only');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine || (only && !['landmass', 'pcg', 'unload'].includes(only))) {
  console.error('usage: node landscape_world.mjs --engine <UE_5.8 folder> [--only landmass|pcg|unload] [--rendering] [--keep] [--compiler <x.y.z>] [--sdk <10.0.n.n>]');
  process.exit(2);
}
const editor = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
if (!existsSync(editor)) { console.error(`not found: ${editor}`); process.exit(2); }

const here = import.meta.dirname;
const name = 'LandscapeWorld';
const root = mkdtempSync(join(tmpdir(), 'landscape-world-'));
mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const readJson = (p) => (existsSync(p) ? JSON.parse(readText(p)) : undefined);
const wanted = (phase) => !only || only === phase;

console.log(`Landscape world probes in ${root} (${rendering ? 'rendering editor, -RenderOffScreen' : '-nullrhi'})`);
const toolchain = discoverToolchain({ compiler: flag('--compiler'), sdk: flag('--sdk') });
console.log(`  toolchain: compiler ${toolchain.compiler}, SDK ${toolchain.sdk} (${toolchain.notes.join('; ')})`);
const uproject = writeCodeProject({ root, name, plugins: ['PythonScriptPlugin', 'EditorScriptingUtilities', 'Landmass', 'PCG'],
  modules: [{ name: 'LandscapeBridge', type: 'Editor', sourceDir: join(here, 'module', 'LandscapeBridge') }] });
const buildLog = join(root, 'Saved', 'build.log');
const built = await buildEditor({ engine, uproject, name, toolchain, logPath: buildLog });
console.log(`  build: exit ${built.exit}, ${built.seconds} s${built.timedOut ? ' (timed out)' : ''}`);
const build = { ...built, log: readText(buildLog) };

function phase(label, script, timeoutSeconds) {
  const report = join(root, 'Saved', `${label}.json`);
  const env = { ...process.env, LW_REPORT: report, LW_RENDER: rendering ? '1' : '0', MSYS_NO_PATHCONV: '1' };
  const started = Date.now();
  const result = spawnSync(editor, [uproject, rendering ? '-RenderOffScreen' : '-nullrhi', `-ExecCmds=py ${resolve(here, script)}`,
    `-abslog=${join(root, 'Saved', 'Logs', `${label}.log`)}`, '-unattended', '-nosplash', '-nosound', '-notraceserver'],
  { env, stdio: 'ignore', timeout: timeoutSeconds * 1000, windowsHide: true });
  console.log(`  ${label}: exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
  return readJson(report);
}
const reports = built.exit === 0 ? {
  landmass: wanted('landmass') ? phase('landmass', 'landmass_probe.py', rendering ? 2700 : 900) : undefined,
  pcg: wanted('pcg') ? phase('pcg', 'pcg_partition_probe.py', 1200) : undefined,
  unload: wanted('unload') ? phase('unload', 'wp_unload_probe.py', 900) : undefined,
} : {};

const checks = evaluate({ build, ...reports, only });
for (const c of checks) console.log(`${c.observe ? 'OBSERVE' : c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total, observed } = summarize(checks);
console.log(`${passed} of ${total} checks passed, ${observed} observations recorded`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
