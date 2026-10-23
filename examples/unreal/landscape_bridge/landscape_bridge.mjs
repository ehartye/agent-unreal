// node landscape_bridge.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
// Validates skills/unreal-features/references/unreal-python-cpp-bridge.md against a real Unreal 5.8 install. It writes a throwaway
// code project in the OS temp folder with one editor-only module (module/LandscapeBridge), builds the editor target with Unreal Build
// Tool, then starts the editor three times (bridge_probe.py): a non-partitioned map, a World Partition map with grid size 0 and a World
// Partition map with grid size 2. Each run creates a Landscape from a height array and reads back components, quad size and heights.
// The compiler and Windows SDK are discovered from the installed Visual Studio (override with --compiler / --sdk).
// Takes about five minutes. Exit code 0 when every check passes. Not part of node scripts/check.mjs; the checks are tested there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverToolchain, writeCodeProject, buildEditor } from '../native-build.mjs';
import { evaluate, summarize } from './landscape-bridge-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node landscape_bridge.mjs --engine <UE_5.8 folder> [--keep] [--compiler <x.y.z>] [--sdk <10.0.n.n>]'); process.exit(2); }
const editor = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
if (!existsSync(editor)) { console.error(`not found: ${editor}`); process.exit(2); }

const here = import.meta.dirname;
const name = 'BridgeProbe';
const root = mkdtempSync(join(tmpdir(), 'landscape-bridge-'));
mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const readJson = (p) => (existsSync(p) ? JSON.parse(readText(p)) : undefined);

console.log(`Landscape bridge validation in ${root}`);
const toolchain = discoverToolchain({ compiler: flag('--compiler'), sdk: flag('--sdk') });
console.log(`  toolchain: compiler ${toolchain.compiler}, SDK ${toolchain.sdk} (${toolchain.notes.join('; ')})`);
const uproject = writeCodeProject({ root, name, plugins: ['PythonScriptPlugin', 'EditorScriptingUtilities'],
  modules: [{ name: 'LandscapeBridge', type: 'Editor', sourceDir: join(here, 'module', 'LandscapeBridge') }] });
const buildLog = join(root, 'Saved', 'build.log');
const built = await buildEditor({ engine, uproject, name, toolchain, logPath: buildLog });
console.log(`  build: exit ${built.exit}, ${built.seconds} s${built.timedOut ? ' (timed out)' : ''}`);
const build = { ...built, log: readText(buildLog) };

function scenario(label, mapName, partitioned, grid) {
  const report = join(root, 'Saved', `${label}.json`);
  const env = { ...process.env, LB_REPORT: report, LB_MAP: `/Game/Maps/${mapName}`, LB_PARTITIONED: partitioned ? '1' : '0', LB_GRID: String(grid), MSYS_NO_PATHCONV: '1' };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    const result = spawnSync(editor, [uproject, '-nullrhi', `-ExecCmds=py ${resolve(here, 'bridge_probe.py')}`, `-abslog=${join(root, 'Saved', 'Logs', `${label}.log`)}`,
      '-unattended', '-nosplash', '-nosound', '-notraceserver'], { env, stdio: 'ignore', timeout: 900000, windowsHide: true });
    console.log(`  ${label}: exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
    if (existsSync(report)) break;
  }
  return readJson(report);
}
const scenarios = built.exit === 0 ? {
  plain: scenario('plain', 'BridgePlain', false, 2),
  wp0: scenario('wp0', 'BridgePartitioned0', true, 0),
  wp2: scenario('wp2', 'BridgePartitioned2', true, 2),
} : {};
const externalDir = join(root, 'Content', '__ExternalActors__', 'Maps', 'BridgePartitioned2');
const externalFiles = existsSync(externalDir) ? readdirSync(externalDir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length : 0;

const checks = evaluate({ build, scenarios, externalFiles });
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
