// node gameplay_cameras.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
//                           [--map /Engine/Maps/Entry] [--sessions manager,component,stock]
// Prepared for skills/unreal-gameplay/references/unreal-gameplay-cameras.md; run on 5.8.4 (see the README status and findings).
// It writes a throwaway code project in the OS temp folder with one runtime module (module/CameraProbe): a pawn with a Gameplay
// Cameras component whose rigs are built in code with the plugin's assemblers, a controller that picks the camera manager class, and a
// game mode that runs a scripted scenario from Tick. It builds the Editor target with Unreal Build Tool, then starts the game
// (UnrealEditor.exe -game -nullrhi, fixed 30 fps time step) once per session and judges the JSON report each one writes.
// The compiler and Windows SDK are discovered from the installed Visual Studio (override with --compiler / --sdk).
// Exit code 0 when every check passes. Not part of node scripts/check.mjs; the checks are tested there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverToolchain, writeCodeProject, buildEditor } from '../native-build.mjs';
import { evaluate, summarize } from './gameplay-cameras-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node gameplay_cameras.mjs --engine <UE_5.8 folder> [--keep] [--compiler <x.y.z>] [--sdk <10.0.n.n>] [--map <engine map>] [--sessions manager,component,stock]'); process.exit(2); }
const editor = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
if (!existsSync(editor)) { console.error(`not found: ${editor}`); process.exit(2); }
const map = flag('--map') || '/Engine/Maps/Entry';
const wanted = (flag('--sessions') || 'manager,component,stock').split(',').map((s) => s.trim()).filter(Boolean);
const unknown = wanted.filter((s) => !['manager', 'component', 'stock'].includes(s));
if (unknown.length) { console.error(`unknown session: ${unknown.join(', ')}`); process.exit(2); }

const here = import.meta.dirname;
const name = 'GameplayCamerasProbe';
const root = mkdtempSync(join(tmpdir(), 'gameplay-cameras-'));
mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const readJson = (p) => { try { return existsSync(p) ? JSON.parse(readText(p)) : undefined; } catch { return undefined; } };

console.log(`Gameplay Cameras validation in ${root}`);
const toolchain = discoverToolchain({ compiler: flag('--compiler'), sdk: flag('--sdk') });
console.log(`  toolchain: compiler ${toolchain.compiler}, SDK ${toolchain.sdk} (${toolchain.notes.join('; ')})`);
const uproject = writeCodeProject({ root, name, plugins: ['GameplayCameras'], modules: [{ name: 'CameraProbe', type: 'Runtime', sourceDir: join(here, 'module', 'CameraProbe') }] });
const buildLog = join(root, 'Saved', 'build.log');
const built = await buildEditor({ engine, uproject, name, toolchain, logPath: buildLog });
console.log(`  build: exit ${built.exit}, ${built.seconds} s${built.timedOut ? ' (timed out)' : ''}`);
const build = { ...built, log: readText(buildLog) };

// One game process per session. The map argument carries the game mode in its options, so Git Bash must not rewrite it
// (spawnSync passes it untouched; MSYS_NO_PATHCONV is set for a child that goes through a shell).
function run(host) {
  const report = join(root, 'Saved', `cameras-${host}.json`);
  const logFile = join(root, 'Saved', 'Logs', `cameras-${host}.log`);
  const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
  const gameArgs = [uproject, `${map}?game=/Script/CameraProbe.CameraProbeGameMode`, '-game', '-nullrhi', '-nosound', '-unattended', '-nosplash', '-notraceserver',
    '-UseFixedTimeStep', '-FPS=30', `-CamHost=${host}`, `-CamReport=${report}`, `-abslog=${logFile}`];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    const result = spawnSync(editor, gameArgs, { env, stdio: 'ignore', timeout: 600000, windowsHide: true });
    console.log(`  game session (${host}): exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
    if (existsSync(report)) break;
  }
  return { report: readJson(report), log: readText(logFile) };
}
const sessions = {};
if (built.exit === 0) for (const host of wanted) sessions[host] = run(host);

const checks = evaluate({ build, sessions });
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
