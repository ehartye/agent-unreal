// node chaos_break.mjs --engine "<UE_5.8 folder>" [--sizes] [--material engine|project] [--render] [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
// Prepared, not yet run on an engine. Validates skills/unreal-effects/references/unreal-chaos-destruction-native.md against a real Unreal 5.8 install:
// a Geometry Collection built from a static mesh in a commandlet (append, Voronoi fracture, convex hulls, simulation data, save), then broken in a
// running game process, counting the pieces that separate and checking the controls that must not break.
// It writes a throwaway code project in the OS temp folder with two modules (module/ChaosBreakBuild: editor, a commandlet; module/ChaosBreak: runtime,
// a game instance subsystem), builds the Editor target, runs the commandlet once, then starts the game three times on an engine map:
//   verbose   -LogCmds="LogChaos Verbose"        the judged run
//   silent    no log switch                      the same scenarios at normal verbosity
//   exec      -ExecCmds="log LogChaos Verbose"   the console-command form (an observation)
// --sizes also builds the fine-spacing asset (a noise point spacing of 1 cm) so its file size is recorded. --material project builds a project
// material with the Geometry Collections usage flag; --render starts the game with a renderer (offscreen) so the material usage warning can appear.
// The compiler and Windows SDK are discovered from the installed Visual Studio (override with --compiler / --sdk).
// Exit code 0 when every counted check passes. Not part of node scripts/check.mjs; the checks are tested there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverToolchain, writeCodeProject, buildEditor } from '../native-build.mjs';
import { evaluate, summarize, parseReport } from './chaos-break-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const sizes = args.includes('--sizes');
const render = args.includes('--render');
const material = flag('--material') || 'engine';
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine || !['engine', 'project'].includes(material)) {
  console.error('usage: node chaos_break.mjs --engine <UE_5.8 folder> [--sizes] [--material engine|project] [--render] [--keep] [--compiler <x.y.z>] [--sdk <10.0.n.n>]');
  process.exit(2);
}
const bin = join(engine, 'Engine', 'Binaries', 'Win64');
const cmdExe = join(bin, 'UnrealEditor-Cmd.exe');
const guiExe = join(bin, 'UnrealEditor.exe');
for (const exe of [cmdExe, guiExe]) if (!existsSync(exe)) { console.error(`not found: ${exe}`); process.exit(2); }

const here = import.meta.dirname;
const name = 'ChaosBreakProbe';
const root = mkdtempSync(join(tmpdir(), 'chaos-break-'));
mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const MAP = '/Engine/Maps/Templates/Template_Default';   // source: Engine/Content/Maps/Templates/Template_Default.umap

// A timed-out run can leave Unreal behind; stop only processes whose command line names this scratch folder.
function stopScratch() {
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${root.replaceAll('\\', '*').replaceAll('/', '*')}*' -and $_.Name -like 'Unreal*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
  spawnSync('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true, stdio: 'ignore' });
}

console.log(`Chaos break validation in ${root}`);
const toolchain = discoverToolchain({ compiler: flag('--compiler'), sdk: flag('--sdk') });
console.log(`  toolchain: compiler ${toolchain.compiler}, SDK ${toolchain.sdk} (${toolchain.notes.join('; ')})`);
// Fracture needs PlanarCut, which needs GeometryProcessing (their .uplugin descriptors list the dependencies); ChaosSolverPlugin is on by default.
const uproject = writeCodeProject({ root, name, plugins: ['Fracture', 'PlanarCut', 'GeometryProcessing', 'ChaosSolverPlugin'],
  modules: [{ name: 'ChaosBreak', type: 'Runtime', sourceDir: join(here, 'module', 'ChaosBreak') }, { name: 'ChaosBreakBuild', type: 'Editor', sourceDir: join(here, 'module', 'ChaosBreakBuild') }] });
const buildLog = join(root, 'Saved', 'build.log');
const built = await buildEditor({ engine, uproject, name, toolchain, logPath: buildLog });
console.log(`  build: exit ${built.exit}, ${built.seconds} s${built.timedOut ? ' (timed out)' : ''}`);
const build = { ...built, log: readText(buildLog) };

const variants = ['healthy', 'nohull', 'update_hulls', 'simdata_first', ...(sizes ? ['fine_spacing'] : [])];
const buildReportPath = join(root, 'Saved', 'chaos-build.json');
if (built.exit === 0) {
  const started = Date.now();
  const r = spawnSync(cmdExe, [uproject, '-run=ChaosBreakBuild', `-Report=${buildReportPath}`, `-Variants=${variants.join("+")}`, `-Material=${material}`, '-OutDir=/Game/Chaos',
    '-unattended', '-nullrhi', '-nosplash', '-nopause', '-nosound', '-notraceserver', `-abslog=${join(root, 'Saved', 'Logs', 'chaos-build.log')}`],
    { stdio: 'ignore', timeout: 900000, windowsHide: true });
  if (r.error) stopScratch();
  console.log(`  commandlet: exit ${r.status}${r.error ? ` (${r.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
}
const buildReport = parseReport(readText(buildReportPath));

const asset = (v) => `/Game/Chaos/GC_${v}.GC_${v}`;
const scenarios = [
  ['healthy_strain', asset('healthy'), 'strain', 'deferred'],
  ['healthy_late', asset('healthy'), 'strain', 'late'],
  ['healthy_idle', asset('healthy'), 'none', 'deferred'],
  ['nohull_strain', asset('nohull'), 'strain', 'deferred'],
  ['noproxy_strain', asset('healthy'), 'noproxy', 'deferred'],
  ...['update_hulls', 'simdata_first', ...(sizes ? ['fine_spacing'] : [])].map((v) => [`${v}_strain`, asset(v), 'strain', 'deferred']),
].filter(([, path]) => (buildReport?.variants ?? []).some((v) => v.ok && path === asset(v.name)));

function playGame(label, extra) {
  const reportPath = join(root, 'Saved', `chaos-run-${label}.json`);
  const logFile = join(root, 'Saved', 'Logs', `chaos-run-${label}.log`);
  const started = Date.now();
  const r = spawnSync(render ? guiExe : cmdExe, [uproject, MAP, '-game', ...(render ? ['-RenderOffScreen', '-windowed', '-ResX=640', '-ResY=360'] : ['-nullrhi']),
    '-unattended', '-nosplash', '-nopause', '-nosound', '-notraceserver', `-abslog=${logFile}`, `-CBScenarios=${scenarios.map((s) => s.join('|')).join(';')}`, `-CBReport=${reportPath}`, ...extra],
    { stdio: 'ignore', timeout: 600000, windowsHide: true });
  if (r.error) stopScratch();
  console.log(`  game (${label}): exit ${r.status}${r.error ? ` (${r.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
  return { exit: r.status, report: parseReport(readText(reportPath)), log: readText(logFile) };
}
const runs = {};
if (scenarios.length) {
  runs.verbose = playGame('verbose', ['-LogCmds=LogChaos Verbose']);
  runs.silent = playGame('silent', []);
  runs.exec = playGame('exec', ['-ExecCmds=log LogChaos Verbose']);
} else {
  console.log('  no asset was built, so no game run was started');
}

const checks = evaluate({ build, buildReport, runs, options: { checkMaterial: render && material === 'project' } });
for (const c of checks) console.log(`${c.info ? 'INFO' : c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
