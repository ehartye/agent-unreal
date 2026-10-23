// node pcg_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--shot <png path>]
// Validates the guidance in skills/unreal-procedural/references/unreal-pcg-game-process.md against a real Unreal 5.8 install. It makes a
// throwaway project in the OS temp folder (Python, PCG, Water), copies a small Landscape map into it (pcg_maps.py), builds five maps that
// differ in the PCG World Actor and its Landscape cache plus two materials (pcg_build.py), runs the experiment harness (pcg_experiments.py),
// the asynchronous-generation contrast (pcg_async.py, three runs), the editor material-flag run (pcg_flag_editor.py, rendering offscreen),
// and a game process per map (pcg_game_run.py, the editor binary with -game). Engine screenshots are decoded with the PNG reader of the
// stylized scene. The reports are judged by pcg-validate-checks.mjs. Exit code 0 when every check passes. Takes about ten minutes and needs
// a GPU for the offscreen runs. Not part of node scripts/check.mjs; the pure checks are tested there.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { decodePng } from '../stylized/png-tools.mjs';
import { evaluate, summarize } from './pcg-validate-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const shotOut = flag('--shot');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node pcg_validate.mjs --engine <UE_5.8 folder> [--keep] [--shot <png path>]'); process.exit(2); }
const bin = join(engine, 'Engine', 'Binaries', 'Win64');
const cmd = join(bin, 'UnrealEditor-Cmd.exe'), editor = join(bin, 'UnrealEditor.exe');
for (const exe of [cmd, editor]) if (!existsSync(exe)) { console.error(`not found: ${exe}`); process.exit(2); }

const here = import.meta.dirname;
const slash = (p) => p.replaceAll('\\', '/');
const root = mkdtempSync(join(tmpdir(), 'pcg-validate-'));
const project = join(root, 'PcgValidate.uproject');
writeFileSync(project, JSON.stringify({
  FileVersion: 3, EngineAssociation: '5.8',
  Plugins: ['PythonScriptPlugin', 'EditorScriptingUtilities', 'PCG', 'Water'].map((Name) => ({ Name, Enabled: true })),
}, null, 2));
mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
const reportPath = (name) => slash(join(root, 'Saved', `${name}.json`));
const logPath = (name) => slash(join(root, 'Saved', 'Logs', `${name}.log`));
const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined);
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const script = (file) => slash(resolve(here, file));

// One run; a run that times out is tried once more because the machine may be busy.
function run(label, exe, argv, name, timeoutSeconds, env = {}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    const result = spawnSync(exe, [...argv, `-abslog=${logPath(name)}`, '-unattended', '-nosplash', '-nosound', '-notraceserver'], {
      env: { ...process.env, MSYS_NO_PATHCONV: '1', PCG_REPORT: reportPath(name), ...env }, stdio: 'ignore', timeout: timeoutSeconds * 1000, windowsHide: true });
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`  ${label}: exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${seconds} s`);
    if (!result.error) return { exit: result.status, seconds };
    if (attempt === 1) console.log('  retrying once');
  }
  return { exit: undefined, seconds: undefined };
}
const editorRun = (label, name, mapPath, file, extra = [], env = {}, timeoutSeconds = 600) =>
  run(label, editor, [project, mapPath, ...extra, `-ExecCmds=py ${script(file)}`], name, timeoutSeconds, env);
const gameRun = (mapName, name, env = {}) =>
  run(`game ${mapName}`, editor, [project, `/Game/Maps/${mapName}`, '-game', '-windowed', '-ResX=1280', '-ResY=720', '-RenderOffScreen', `-ExecCmds=py ${script('pcg_game_run.py')}`], name, 900, env);
const interesting = (text, pattern) => text.split(/\r?\n/).filter((line) => pattern.test(line)).join('\n');
const logLines = (name) => interesting(readText(logPath(name)), /LogPCG: (Error|Warning)|LogMaterial: (Warning|Display): Material \/Game\//);

console.log(`PCG game-process validation in ${root}`);
run('copy the Landscape map', cmd, [project, '-run=pythonscript', `-script=${script('pcg_maps.py')}`, '-nullrhi', '-nopause'], 'maps', 600);
const maps = readJson(reportPath('maps'));
editorRun('build maps and materials', 'build', '/Game/Maps/PcgBase', 'pcg_build.py', ['-nullrhi']);
const build = readJson(reportPath('build'));
editorRun('experiment harness', 'exp', '/Game/Maps/PcgBase', 'pcg_experiments.py', ['-nullrhi']);
const exp = readJson(reportPath('exp'));
editorRun('async, same tick', 'async-same', '/Game/Maps/PcgBase', 'pcg_async.py', ['-nullrhi'], { PCG_ASYNC_MODE: 'same_tick' });
editorRun('async, staged', 'async-staged', '/Game/Maps/PcgBase', 'pcg_async.py', ['-nullrhi'], { PCG_ASYNC_MODE: 'staged' });
const execRun = run('async script under -ExecutePythonScript', editor, [project, '/Game/Maps/PcgBase', '-nullrhi', `-ExecutePythonScript=${script('pcg_async.py')}`], 'async-exec', 300,
  { PCG_ASYNC_MODE: 'staged', PCG_ASYNC_SAVE_AS: '/Game/Maps/PcgAsync_exec' });
editorRun('editor sets the material flag', 'flag', '/Game/Maps/PcgBase', 'pcg_flag_editor.py', ['-RenderOffScreen']);

const mapFiles = { noworld: 'PcgNoWorld', spawned: 'PcgSpawned', off: 'PcgCacheOff', modeonly: 'PcgModeOnly', on: 'PcgCacheOn' };
const shotFile = slash(join(root, 'Saved', 'pcg-flag-shot.png'));
const games = {};
for (const [key, mapName] of Object.entries(mapFiles)) {
  gameRun(mapName, `game-${key}`, key === 'on' ? { PCG_SHOT: shotFile } : {});
  games[key] = { report: readJson(reportPath(`game-${key}`)), log: logLines(`game-${key}`) };
}
const size = (name) => (existsSync(join(root, 'Content', 'Maps', `${name}.umap`)) ? statSync(join(root, 'Content', 'Maps', `${name}.umap`)).size : undefined);
const sizes = { nw: size('PcgNoWorld'), sp: size('PcgSpawned'), off: size('PcgCacheOff'), mode: size('PcgModeOnly'), on: size('PcgCacheOn') };

// Engine screenshot: pixels that are strongly red (the flagged material) on each half, and strongly green (the unflagged material's own colour).
let shot = {};
if (existsSync(shotFile)) {
  const img = decodePng(readFileSync(shotFile));
  let redLeft = 0, redRight = 0, green = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * 4, r = img.rgba[i], g = img.rgba[i + 1], b = img.rgba[i + 2];
    if (r > 150 && r > 2 * g && r > 2 * b) { if (x < img.width / 2) redLeft++; else redRight++; }
    if (g > 100 && g > 1.5 * r && g > 1.5 * b) green++;
  }
  shot = { width: img.width, height: img.height, red_left: redLeft, red_right: redRight, green };
  if (shotOut) { mkdirSync(dirname(resolve(shotOut)), { recursive: true }); copyFileSync(shotFile, resolve(shotOut)); console.log(`  screenshot copied to ${resolve(shotOut)}`); }
}

const checks = evaluate({
  maps, build, exp, sizes, shot, games,
  asyncSame: readJson(reportPath('async-same')), asyncStaged: readJson(reportPath('async-staged')),
  asyncExec: { exit: execRun.exit, reportExists: existsSync(reportPath('async-exec')) },
  flag: { report: readJson(reportPath('flag')), log: logLines('flag') },
});
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
