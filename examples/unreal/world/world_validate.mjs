// node world_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--shot <png path>]
// Validates the World Partition guidance in skills/unreal-features/references/unreal-landmass.md and unreal-water.md
// against a real Unreal 5.8 install. It makes a throwaway project in the OS temp folder (Python, Landmass, Water, PCG), copies the
// Open World template and a Water sample map into it, converts the sample map with the World Partition conversion commandlet, inspects
// each map, places Water, Landmass and PCG actors, and carves a river in a rendering editor. The reports are judged by
// world-validate-checks.mjs. Exit code 0 when every check passes. Takes several minutes. Not part of node scripts/check.mjs; the pure
// checks are tested there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { evaluate, summarize } from './world-validate-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const shotOut = flag('--shot');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node world_validate.mjs --engine <UE_5.8 folder> [--keep] [--shot <png path>]'); process.exit(2); }
const bin = join(engine, 'Engine', 'Binaries', 'Win64');
const cmd = join(bin, 'UnrealEditor-Cmd.exe'), editor = join(bin, 'UnrealEditor.exe');
for (const exe of [cmd, editor]) if (!existsSync(exe)) { console.error(`not found: ${exe}`); process.exit(2); }

const here = import.meta.dirname;
const root = mkdtempSync(join(tmpdir(), 'world-validate-'));
const project = join(root, 'WorldValidate.uproject');
writeFileSync(project, JSON.stringify({
  FileVersion: 3, EngineAssociation: '5.8',
  Plugins: ['PythonScriptPlugin', 'EditorScriptingUtilities', 'Landmass', 'Water', 'PCG'].map((Name) => ({ Name, Enabled: true })),
}, null, 2));
mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
const reportPath = (name) => join(root, 'Saved', `${name}.json`);
const logPath = (name) => join(root, 'Saved', 'Logs', `${name}.log`);
const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined);
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');

function run(label, exe, argv, name, timeout, env = {}) {
  const started = Date.now();
  const result = spawnSync(exe, [...argv, `-abslog=${logPath(name)}`, '-unattended', '-nosplash', '-nosound', '-notraceserver'], {
    env: { ...process.env, WORLD_REPORT: reportPath(name), ...env }, stdio: 'ignore', timeout, windowsHide: true });
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`  ${label}: exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${seconds} s`);
  return { exit: result.status, seconds };
}
const commandlet = (file) => [project, '-run=pythonscript', `-script=${resolve(here, file)}`, '-nullrhi', '-nopause'];
const editorRun = (file, ...extra) => [project, ...extra, `-ExecCmds=py ${resolve(here, file)}`];
const inspect = (label, map, name) => { run(`inspect ${label}`, cmd, commandlet('world_inspect.py'), name, 300000, { WORLD_MAP: map }); return readJson(reportPath(name)); };

console.log(`World Partition validation in ${root}`);
run('copy maps', cmd, commandlet('world_maps.py'), 'maps', 300000);
const maps = readJson(reportPath('maps'));
const filesUnder = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length : 0);
if (maps) maps.external_actor_files = filesUnder(join(root, 'Content', '__ExternalActors__', 'Maps', 'WorldLarge'));
const noFlagRun = run('convert without -AllowCommandletRendering (expected to fail)', cmd, [project, '-run=WorldPartitionConvertCommandlet', '/Game/Maps/WorldSmall', '-SCCProvider=None', '-ConversionSuffix', '-nullrhi'], 'convert-no-flag', 300000);
const convertWithoutFlag = { ...noFlagRun, log: readText(logPath('convert-no-flag')) };
const convertRun = run('convert WorldSmall', cmd, [project, '-run=WorldPartitionConvertCommandlet', '/Game/Maps/WorldSmall', '-SCCProvider=None', '-ConversionSuffix', '-AllowCommandletRendering', '-nullrhi'], 'convert', 300000);
const convert = { ...convertRun, converted_map: existsSync(join(root, 'Content', 'Maps', 'WorldSmall_WP.umap')),
  ini: readText(join(root, 'Content', 'Maps', 'WorldSmall.ini')), log: readText(logPath('convert')) };
const inspected = {
  control: inspect('engine default map', '/Engine/Maps/Templates/Template_Default', 'inspect-control'),
  large: inspect('WorldLarge', '/Game/Maps/WorldLarge', 'inspect-large'),
  small: inspect('WorldSmall (not partitioned)', '/Game/Maps/WorldSmall', 'inspect-small'),
  smallWp: inspect('WorldSmall_WP (converted)', '/Game/Maps/WorldSmall_WP', 'inspect-small-wp'),
};
// The first conversion wrote WorldSmall.ini beside the map. Its LandscapeGridSize is the number of components per proxy side.
const iniPath = join(root, 'Content', 'Maps', 'WorldSmall.ini');
writeFileSync(iniPath, readText(iniPath).replace(/LandscapeGridSize=\d+/, 'LandscapeGridSize=1'));
run('convert again with LandscapeGridSize=1', cmd, [project, '-run=WorldPartitionConvertCommandlet', '/Game/Maps/WorldSmall', '-SCCProvider=None', '-ConversionSuffix', '-AllowCommandletRendering', '-nullrhi'], 'convert-grid1', 300000);
inspected.smallWpGrid1 = inspect('WorldSmall_WP (grid size 1)', '/Game/Maps/WorldSmall_WP', 'inspect-small-wp-grid1');
// A water body spawned in the commandlet stops on a Slate assertion. This step is expected to fail.
const crash = run('place in a commandlet (expected to fail)', cmd, commandlet('world_place_commandlet.py'), 'place-commandlet', 300000);
const placeCommandlet = { ...crash, log: readText(logPath('place-commandlet')), report: readJson(reportPath('place-commandlet')) };
const placeRun = run('place in the editor (-nullrhi)', editor, editorRun('world_place.py', '-nullrhi'), 'place', 480000);
const placeLog = readText(logPath('place'));
const carveRun = run('carve in the editor (offscreen)', editor, editorRun('world_carve.py', '-RenderOffScreen'), 'carve', 480000,
  { WORLD_SHOT: join(root, 'Saved', 'world-overview.png') });
const shot = join(root, 'Saved', 'world-overview.png');
if (shotOut && existsSync(shot)) { mkdirSync(dirname(resolve(shotOut)), { recursive: true }); copyFileSync(shot, resolve(shotOut)); console.log(`  screenshot copied to ${resolve(shotOut)}`); }

const checks = evaluate({
  maps, convert, convertWithoutFlag, inspected, placeCommandlet, place: readJson(reportPath('place')), placeRun, placeLog, carve: readJson(reportPath('carve')), carveRun,
});
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
