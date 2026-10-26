// node world_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--shot <png path>]
// Validates the World Partition guidance in skills/unreal-procedural/references/unreal-world-partition.md , unreal-world-partition-landscape.md and unreal-world-partition-commandlets.md against a real Unreal 5.8 install.
// It makes a throwaway project in the OS temp folder (Python, Landmass, Water, PCG), copies the
// Open World template and a Water sample map into it, converts the sample map with the World Partition conversion commandlet, inspects
// each map, places Water, Landmass and PCG actors, and carves a river in a rendering editor. A second part creates maps with
// LevelEditorSubsystem.new_level in three run modes, converts and rebuilds a small map with the conversion and builder commandlets, lists
// the console commands and reads the Water Zone settings. The reports are judged by world-validate-checks.mjs. Exit code 0 when every
// check passes. Engine steps take about nine minutes once shaders are cached (the first minimap build compiles them). Not part of node scripts/check.mjs; the pure checks are tested there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, sep } from 'node:path';
import { evaluate, evaluateAutomation, summarize } from './world-validate-checks.mjs';

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

// ---- Automation: new_level, the conversion flags, the builder commandlets, the console commands and the Water Zone settings
const contentDir = join(root, 'Content');
const listFiles = () => (existsSync(contentDir) ? readdirSync(contentDir, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile()).map((e) => `Content/${join(e.parentPath, e.name).slice(contentDir.length + 1).split(sep).join('/')}`).sort() : []);
const newSince = (before) => listFiles().filter((f) => !before.includes(f));
const newLevelEnv = (map, partitioned, extra = {}) => ({ WORLD_NEW_MAP: map, WORLD_PARTITIONED: partitioned ? '1' : '0', ...extra });
const nlEditor = run('new_level in the editor (-nullrhi)', editor, editorRun('world_newlevel.py', '-nullrhi'), 'nl-editor', 480000, newLevelEnv('/Game/Maps/NewWpEditor', true, { WORLD_TICK: '1' }));
const nlCmd = run('new_level in -run=pythonscript', cmd, commandlet('world_newlevel.py'), 'nl-cmd', 300000, newLevelEnv('/Game/Maps/NewWpCmd', true));
const nlRepeat = run('new_level on an existing path (expected to fail)', cmd, commandlet('world_newlevel.py'), 'nl-repeat', 300000, newLevelEnv('/Game/Maps/NewWpCmd', true));
const nlExec = run('new_level in -ExecutePythonScript', cmd, [project, `-ExecutePythonScript=${resolve(here, 'world_newlevel.py')}`, '-nullrhi'], 'nl-exec', 300000, newLevelEnv('/Game/Maps/NewWpExec', true));
run('new_level without the partition flag, four cubes', cmd, commandlet('world_newlevel.py'), 'nl-plain', 300000, newLevelEnv('/Game/Maps/PlainLevel', false, { WORLD_ACTORS: '4' }));
run('new_level without the partition flag, four cubes (for the in-place conversion)', cmd, commandlet('world_newlevel.py'), 'nl-inplace', 300000, newLevelEnv('/Game/Maps/PlainInPlace', false, { WORLD_ACTORS: '4' }));
const newLevel = { editor: readJson(reportPath('nl-editor')), cmd: readJson(reportPath('nl-cmd')), exec: readJson(reportPath('nl-exec')), plain: readJson(reportPath('nl-plain')),
  exits: [nlEditor.exit, nlCmd.exit, nlExec.exit], repeat: { ...readJson(reportPath('nl-repeat')), exit: nlRepeat.exit, log: readText(logPath('nl-repeat')) } };
const newMapFiles = listFiles().filter((f) => /NewWpCmd/.test(f));

const convertArgs = (map, ...flags) => [project, '-run=WorldPartitionConvertCommandlet', map, '-SCCProvider=None', ...flags, '-AllowCommandletRendering', '-nullrhi'];
const convertStep = (label, name, argv) => { const before = listFiles(); const result = run(label, cmd, argv, name, 600000); return { ...result, newFiles: newSince(before) }; };
const reportOnly = convertStep('convert PlainLevel with -ReportOnly', 'cv-report', convertArgs('/Game/Maps/PlainLevel', '-ConversionSuffix', '-ReportOnly'));
const generateIni = { ...convertStep('convert PlainLevel with -GenerateIni', 'cv-ini', convertArgs('/Game/Maps/PlainLevel', '-ConversionSuffix', '-GenerateIni')),
  ini: readText(join(contentDir, 'Maps', 'PlainLevel.ini')) };
const suffix = convertStep('convert PlainLevel with -ConversionSuffix', 'cv-suffix', convertArgs('/Game/Maps/PlainLevel', '-ConversionSuffix'));
const inPlace = convertStep('convert PlainInPlace without -ConversionSuffix', 'cv-inplace', convertArgs('/Game/Maps/PlainInPlace'));
const convertSet = { reportOnly, generateIni, suffix, inPlace,
  source: inspect('PlainLevel (source)', '/Game/Maps/PlainLevel', 'inspect-plain'), converted: inspect('PlainLevel_WP', '/Game/Maps/PlainLevel_WP', 'inspect-plain-wp'),
  inPlaceMap: inspect('PlainInPlace (converted in place)', '/Game/Maps/PlainInPlace', 'inspect-inplace') };

const builder = (label, name, builderName, extra, nullRhi = true, timeout = 600000) => {
  const argv = [project, '/Game/Maps/PlainLevel_WP', '-run=WorldPartitionBuilderCommandlet', `-builder=${builderName}`, ...extra, ...(nullRhi ? ['-nullrhi'] : [])];
  return { ...run(label, cmd, argv, name, timeout), log: readText(logPath(name)) };
};
const mapFile = join(contentDir, 'Maps', 'PlainLevel_WP.umap');
const noScc = ['-SCCProvider=None'];
const builders = {
  resaveAll: builder('Resave Actors builder', 'bd-resave', 'WorldPartitionResaveActorsBuilder', noScc),
  resaveActorClass: builder('Resave Actors builder, -ActorClass', 'bd-resave-class', 'WorldPartitionResaveActorsBuilder', [...noScc, '-ActorClass=StaticMeshActor']),
  resaveActorClassName: builder('Resave Actors builder, -ActorClassName', 'bd-resave-name', 'WorldPartitionResaveActorsBuilder', [...noScc, '-ActorClassName=StaticMeshActor']),
};
const mapStamp = statSync(mapFile).mtimeMs;
builders.foliage = builder('Foliage builder, 512', 'bd-foliage', 'WorldPartitionFoliageBuilder', [...noScc, '-NewGridSize=512']);
builders.foliage.mapChanged = statSync(mapFile).mtimeMs !== mapStamp;
builders.foliage2 = builder('Foliage builder, 1024', 'bd-foliage2', 'WorldPartitionFoliageBuilder', [...noScc, '-NewGridSize=1024']);
const minimapState = (label, name) => { run(label, cmd, commandlet('world_minimap.py'), name, 300000, { WORLD_MAP: '/Game/Maps/PlainLevel_WP' }); return readJson(reportPath(name)); };
builders.minimapBefore = minimapState('minimap state before', 'mm-before');
builders.minimapNullRhi = builder('MiniMap builder with -nullrhi (expected to fail)', 'bd-minimap-null', 'WorldPartitionMiniMapBuilder', [...noScc, '-AllowCommandletRendering']);
builders.minimapRendering = builder('MiniMap builder with rendering', 'bd-minimap', 'WorldPartitionMiniMapBuilder', [...noScc, '-AllowCommandletRendering'], false, 900000);
builders.minimapAfter = minimapState('minimap state after the rendering run', 'mm-after');

run('console commands in the editor', editor, editorRun('world_console.py', '-nullrhi'), 'console', 480000, { WORLD_MAP: '/Game/Maps/WorldLarge' });
const consoleRun = { report: readJson(reportPath('console')), log: readText(logPath('console')) };
run('Water Zone settings in the editor', editor, editorRun('world_water_props.py', '-nullrhi'), 'water-props', 480000);
const waterProps = readJson(reportPath('water-props'));

const checks = [...evaluate({
  maps, convert, convertWithoutFlag, inspected, placeCommandlet, place: readJson(reportPath('place')), placeRun, placeLog, carve: readJson(reportPath('carve')), carveRun,
}), ...evaluateAutomation({ newLevel, newMapFiles, large: inspected.large, convert: convertSet, builders, consoleRun, waterProps })];
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
