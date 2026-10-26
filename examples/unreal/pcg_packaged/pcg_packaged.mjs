// node pcg_packaged.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--rows p1,p2] [--modes headless,rendered] [--stop-after author|package]
//                        [--project <folder this runner wrote earlier> [--skip-package]] [--rejudge <project folder>] [--seconds 20] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
// Runs the packaged PCG probe end to end on one Windows machine. Run on Unreal 5.8.3: see README.md for what it showed.
//   1. writes a throwaway code project in the OS temp folder: one game module (module/PcgPackaged), the PCG plugin listed, maps listed in MapsToCook and no
//      other cook rule (the cook of the PCG graph, the mesh and the material is what row P1 asks about);
//   2. builds the Editor target and starts the editor once (-nullrhi) on pcg_packaged_author.py, which makes the assets, the graphs and the maps and records an
//      editor baseline;
//   3. builds the Game target and packages it with RunUAT BuildCookRun (Development, Windows);
//   4. runs the packaged game once per map and mode (headless: -nullrhi; rendered: -RenderOffScreen) on APcgPackagedGameMode, which writes a JSON receipt and exits;
//   5. judges the author report and the receipts with pcg-packaged-checks.mjs and prints PASS, FAIL or OBSERVE per check.
// Rows: p1 = GENERATE_AT_RUNTIME in a cooked game (maps PcgRuntime and PcgNoWorld); p2 = a partitioned World Partition map with a moving streaming source (map PcgStream).
//   --rows <list>       default p1,p2
//   --modes <list>      default headless,rendered (the rendered run needs a GPU; a session with no desktop needs -RenderOffScreen, which the runner passes)
//   --stop-after        author: stop after the editor session; package: stop after packaging (the project is kept)
//   --project <folder>  reuse a project this runner wrote earlier (sources and content are not rewritten; the builds and the package run incrementally)
//   --skip-package      with --project: run the game already archived under <project>/Archive
//   --rejudge <folder>  judge the author report and the newest receipts under <folder> again, without starting anything
//   --seconds <n>       the observation window of the runtime rows (default 20)
//   --keep              keep the project folder when every check passes (it is always kept when a step or a check fails)
// Windows and Node only. Not part of node scripts/check.mjs; the pure checks are tested there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverToolchain, writeCodeProject, buildEditor, buildGame, packageGame } from '../native-build.mjs';
import { evaluate, summarize, PATHS } from './pcg-packaged-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const skipPackage = args.includes('--skip-package');
const engine = flag('--engine') || process.env.UE_ROOT;
const rejudge = flag('--rejudge');
const existing = flag('--project') || rejudge;
const stopAfter = flag('--stop-after');
const rows = (flag('--rows') || 'p1,p2').split(',').map((r) => r.trim()).filter((r) => r === 'p1' || r === 'p2');
const modes = (flag('--modes') || 'headless,rendered').split(',').map((m) => m.trim()).filter((m) => m === 'headless' || m === 'rendered');
const windowSeconds = Number(flag('--seconds') || 20);
const usage = 'usage: node pcg_packaged.mjs --engine <UE_5.8 folder> [--keep] [--rows p1,p2] [--modes headless,rendered] [--stop-after author|package] [--project <folder> [--skip-package]] [--rejudge <folder>] [--seconds <n>]';
if ((!engine && !rejudge) || rows.length === 0 || modes.length === 0 || (skipPackage && !flag('--project')) || !(windowSeconds > 0)) { console.error(usage); process.exit(2); }
if (stopAfter && stopAfter !== 'author' && stopAfter !== 'package') { console.error(usage); process.exit(2); }
const editorExe = engine && join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
if (!rejudge && !existsSync(editorExe)) { console.error(`not found: ${editorExe}`); process.exit(2); }

const here = import.meta.dirname;
const name = 'PcgPackagedProbe';
const moduleName = 'PcgPackaged';
const gameMode = `/Script/${moduleName}.PcgPackagedGameMode`;
const MAPS = { runtime: '/Game/Maps/PcgRuntime', noworld: '/Game/Maps/PcgNoWorld', stream: '/Game/Maps/PcgStream' };
const root = existing ? resolve(existing) : mkdtempSync(join(tmpdir(), 'pcgp-'));
if (/\s/.test(root)) { console.error(`the project folder must not contain whitespace (the game receives paths on its command line): ${root}`); process.exit(2); }
const saved = join(root, 'Saved');
mkdirSync(join(saved, 'Logs'), { recursive: true });
const uproject = join(root, `${name}.uproject`);
const archive = join(root, 'Archive');
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const readJson = (p) => { try { return existsSync(p) ? JSON.parse(readText(p)) : undefined; } catch (error) { console.log(`  ${p} is not JSON: ${error.message}`); return undefined; } };
const tail = (p, n = 25) => readText(p).split(/\r?\n/).filter(Boolean).slice(-n).join('\n');
const note = (line) => console.log(line);
const failed = (step, detail) => { note(`STOPPED at ${step}: ${detail}`); note(`project kept at ${root}`); process.exit(1); };

function judgeAndReport(runs, author) {
  const checks = evaluate({ author, runs, rows });
  for (const c of checks) console.log(`${c.observe ? 'OBSERVE' : c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
  const { passed, total, observed } = summarize(checks);
  console.log(`${passed} of ${total} checks passed, ${observed} observed (recorded, not judged)`);
  return passed === total;
}

function newestRuns(outRoot) {
  if (!existsSync(outRoot)) return [];
  const stamp = readdirSync(outRoot).filter((d) => /^\d+$/.test(d)).sort().at(-1);
  if (!stamp) return [];
  return readdirSync(join(outRoot, stamp)).map((dir) => {
    const [map, mode] = dir.split('-');
    const folder = join(outRoot, stamp, dir);
    return { map, mode, exit: 0, timedOut: false, receipt: readJson(join(folder, 'receipt.json')), log: readText(join(folder, 'game.log')), folder };
  });
}

if (rejudge) {
  const author = readJson(join(saved, 'pcg-packaged-author.json'));
  process.exit(judgeAndReport(newestRuns(join(root, 'out')), author) ? 0 : 1);
}

try {
  const version = JSON.parse(readText(join(engine, 'Engine', 'Build', 'Build.version')));
  note(`engine ${version.MajorVersion}.${version.MinorVersion}.${version.PatchVersion} (changelist ${version.Changelist}), ${engine}`);
} catch { note('engine version: Build.version unreadable'); }
note(`project folder ${root}; rows ${rows.join(',')}; modes ${modes.join(',')}`);
const toolchain = discoverToolchain({ compiler: flag('--compiler'), sdk: flag('--sdk') });
note(`toolchain: compiler ${toolchain.compiler}, SDK ${toolchain.sdk}`);

const mapList = [...(rows.includes('p1') ? ['runtime', 'noworld'] : []), ...(rows.includes('p2') ? ['stream'] : [])];
if (!flag('--project')) {
  writeCodeProject({ root, name, plugins: ['PythonScriptPlugin', 'EditorScriptingUtilities', 'PCG'], modules: [{ name: moduleName, type: 'Runtime', sourceDir: join(here, 'module', moduleName) }] });
  mkdirSync(join(root, 'Config'), { recursive: true });
  // Only the maps are listed: the graph, the mesh and the material must reach the cook through the map, which is what row P1 asks about.
  writeFileSync(join(root, 'Config', 'DefaultGame.ini'), `[/Script/UnrealEd.ProjectPackagingSettings]\n${mapList.map((m) => `+MapsToCook=(FilePath="${MAPS[m]}")`).join('\n')}\n`);
  writeFileSync(join(root, 'Config', 'DefaultEngine.ini'), `[/Script/EngineSettings.GameMapsSettings]\nGameDefaultMap=${MAPS[mapList[0]]}\nEditorStartupMap=${MAPS[mapList[0]]}\n`);

  const editorBuild = await buildEditor({ engine, uproject, name, toolchain, logPath: join(saved, 'build-editor.log') });
  note(`build Editor target: exit ${editorBuild.exit}, ${editorBuild.seconds} s${editorBuild.timedOut ? ' (timed out)' : ''}`);
  if (editorBuild.exit !== 0) failed('Editor build', `see ${join(saved, 'build-editor.log')}\n${tail(join(saved, 'build-editor.log'))}`);

  const authorReport = join(saved, 'pcg-packaged-author.json');
  const authorLog = join(saved, 'Logs', 'author.log');
  const started = Date.now();
  const env = { ...process.env, PCG_REPORT: authorReport, PCGP_ROWS: rows.join(','), MSYS_NO_PATHCONV: '1' };
  const authorRun = spawnSync(editorExe, [uproject, '-nullrhi', `-ExecCmds=py ${resolve(here, 'pcg_packaged_author.py')}`, `-abslog=${authorLog}`, '-unattended', '-nosplash', '-nosound', '-notraceserver'],
    { env, stdio: 'ignore', timeout: 1800000, windowsHide: true });
  note(`author session (editor, -nullrhi): exit ${authorRun.status}${authorRun.error ? ` (${authorRun.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
  const authored = readJson(authorReport);
  const missing = mapList.filter((m) => !existsSync(join(root, 'Content', 'Maps', `${MAPS[m].split('/').pop()}.umap`)));
  note(`author report: ${authored ? `done ${authored.done}${authored.error ? `, error ${String(authored.error).slice(0, 200)}` : ''}` : 'MISSING'}; maps missing: ${missing.join(', ') || 'none'}`);
  if (!authored || missing.length > 0) failed('authoring', `see ${authorLog}\n${tail(authorLog, 30)}`);
}
if (stopAfter === 'author') { note(`stopped after the author session; project kept at ${root}`); process.exit(0); }

if (!skipPackage) {
  const gameBuild = await buildGame({ engine, uproject, name, toolchain, logPath: join(saved, 'build-game.log') });
  note(`build Game target: exit ${gameBuild.exit}, ${gameBuild.seconds} s${gameBuild.timedOut ? ' (timed out)' : ''}`);
  if (gameBuild.exit !== 0) failed('Game build', `see ${join(saved, 'build-game.log')}\n${tail(join(saved, 'build-game.log'))}`);
  rmSync(archive, { recursive: true, force: true });
  const pack = await packageGame({ engine, uproject, archiveDirectory: archive, toolchain, logPath: join(saved, 'package.log') });
  note(`package (BuildCookRun): exit ${pack.exit}, ${pack.seconds} s${pack.timedOut ? ' (timed out)' : ''}`);
  if (pack.exit !== 0) failed('packaging', `see ${join(saved, 'package.log')}\n${tail(join(saved, 'package.log'), 40)}`);
}
if (stopAfter === 'package') { note(`stopped after packaging; project kept at ${root}`); process.exit(0); }

const findExe = (dir) => {
  if (!existsSync(dir)) return undefined;
  for (const entry of readdirSync(dir, { withFileTypes: true })) if (entry.isFile() && entry.name === `${name}.exe`) return join(dir, entry.name);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== 'Engine' && entry.name !== name) { const hit = findExe(join(dir, entry.name)); if (hit) return hit; }
  }
  return undefined;
};
const exe = findExe(archive);
if (!exe) failed('locating the packaged game', `no ${name}.exe under ${archive}`);
note(`packaged game: ${exe}`);

const outRoot = join(root, 'out', String(Date.now()));
const runs = [];
const assetArgs = `-PcgAssets=${PATHS.graph},${PATHS.mesh},${PATHS.material}`;
for (const map of mapList) {
  for (const mode of modes) {
    const folder = join(outRoot, `${map}-${mode}`);
    mkdirSync(folder, { recursive: true });
    const receiptPath = join(folder, 'receipt.json');
    const logPath = join(folder, 'game.log');
    const display = mode === 'headless' ? ['-nullrhi'] : ['-RenderOffScreen'];
    const common = [`${MAPS[map]}?game=${gameMode}`, ...display, '-unattended', '-nosplash', '-nosound', '-notraceserver', '-NoGamepad', '-ResX=1280', '-ResY=720', '-ForceRes', `-abslog=${logPath}`, `-PcgReport=${receiptPath}`];
    const specific = map === 'stream' ? ['-PcgMode=stream'] : ['-PcgMode=runtime', `-PcgSeconds=${windowSeconds}`, assetArgs, `-PcgOrphan=${PATHS.orphan}`];
    const t0 = Date.now();
    const result = spawnSync(exe, [...common, ...specific], { stdio: 'ignore', timeout: map === 'stream' ? 420000 : 300000, windowsHide: true });
    const seconds = Math.round((Date.now() - t0) / 1000);
    const timedOut = result.error?.code === 'ETIMEDOUT';
    note(`run ${map}/${mode}: exit ${result.status}${timedOut ? ' (timed out)' : ''}, ${seconds} s, receipt ${existsSync(receiptPath) ? 'written' : 'MISSING'}`);
    runs.push({ map, mode, exit: result.status, timedOut, seconds, receipt: readJson(receiptPath), log: readText(logPath), folder });
  }
}

const ok = judgeAndReport(runs, readJson(join(saved, 'pcg-packaged-author.json')));
if (ok && !keep && !flag('--project')) rmSync(root, { recursive: true, force: true }); else note(`project kept at ${root}`);
process.exit(ok ? 0 : 1);
