// node ds_probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--only target,packaged,editor] [--keep] [--variant server|server-game|listen] [--port 7777]
//                   [--project <packaged-group folder this runner kept> --skip-package] [--seconds 90] [--evidence <folder>] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
// Two questions about dedicated servers on an installed (Launcher) engine, answered by running Unreal Build Tool and a packaged game. Windows and Node only.
//   target    Q1. Writes <Project>Server.Target.cs (Type = TargetType.Server, a copy of the Game target) into a throwaway code project and runs
//             Build.bat <Project>Server Win64 Development with the compiler and SDK flags the Editor build uses. Records the exit code and the
//             build tool's message word for word. Either it is refused (Epic's page: a source build is required) or it builds.
//   packaged  Q2. Packages the same small project with no Server target (editor build, then RunUAT BuildCookRun), starts the packaged Game executable
//             as `-server -log -nullrhi -port=7777` and a second process of the same build as the client at 127.0.0.1:7777. Judges by the two logs:
//             the engine's listening line, the client's welcome line, and the replicated integer the server sets appearing in the client's log.
//             --variant listen starts the server with `?listen` instead of `-server` (a listen server, recorded as a different thing);
//             --variant server-game starts it as `-server -game`.
//   editor    Q1 and Q2 of the launcher-listen spike. Builds the Editor target, packages the Game (the client), starts the engine's editor binary as
//             `UnrealEditor.exe <Project>.uproject <map URL> -server -game -log -nullrhi -port=7777` and, once its log holds the listening line,
//             the packaged Game as a second process at 127.0.0.1:7777. Judges by the two logs and records the net mode whatever it is.
//   --skip-package  with --project: run the game already archived under <project>/Archive again (no build, no package)
//   --keep          keep the project folders when every check passes (always kept when one fails)
//   --seconds <n>   how long to wait for the server to listen and for the client to show the value (default 90); each process also has a hard limit
//                   (the server 2n + 60 s, the client n + 60 s) after which the probe stops it
//   --evidence <d>  where the logs and the receipt are copied (default: a folder under the OS temp folder, printed at the end)
// The server and the client are the one case of two engine processes at once; this runner starts nothing else and kills only the two it started
// (by process id, with their own descendants).
// Prints PASS, FAIL or OBSERVE per check and "N of M checks passed". Exit code 0 when every asserted check passes.
// Not part of node scripts/check.mjs; the pure judging code (ds-probe-checks.mjs) is tested there.
import { spawn, spawnSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverToolchain, writeCodeProject, buildEditor, buildGame, packageGame } from '../native-build.mjs';
import { readEngineVersion, describeEngine } from '../engine-version.mjs';
import { serverTargetSource, classifyServerBuild, captureBuildMessage, serverArguments, clientArguments, editorExecutable, editorServerArguments, hardLimitSeconds, describeEnd, evaluate, summarize, parseServerLog, parseClientLog, VARIANTS, DEFAULT_PORT, DEFAULT_MAP, GAME_MODE } from './ds-probe-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const skipPackage = args.includes('--skip-package');
const engine = flag('--engine') || process.env.UE_ROOT;
const groups = (flag('--only') || 'target,packaged').split(',').map((g) => g.trim()).filter((g) => g === 'target' || g === 'packaged' || g === 'editor');
const variant = flag('--variant') || 'server';
const waitSeconds = Number(flag('--seconds') || 90);
const usage = 'usage: node ds_probe.mjs --engine <UE_5.8 folder> [--only target,packaged,editor] [--keep] [--variant server|server-game|listen] [--port <n>] [--project <folder> --skip-package] [--seconds <n>] [--evidence <folder>] [--compiler <x.y.z>] [--sdk <10.0.n.n>]';
if (!engine || groups.length === 0 || !VARIANTS.includes(variant) || !(waitSeconds > 0) || (skipPackage && !flag('--project'))) { console.error(usage); process.exit(2); }
if (!existsSync(join(engine, 'Engine', 'Build', 'BatchFiles', 'Build.bat'))) { console.error(`not found: ${join(engine, 'Engine', 'Build', 'BatchFiles', 'Build.bat')}`); process.exit(2); }

const here = import.meta.dirname;
const name = 'DsProbe';
const moduleName = 'DsProbe';
const evidence = resolve(flag('--evidence') || join(tmpdir(), 'ds-probe-evidence', String(Date.now())));
mkdirSync(evidence, { recursive: true });
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const note = (line) => console.log(line);
const keepFile = (from, as) => { if (existsSync(from)) copyFileSync(from, join(evidence, as)); };

function freeUdpPort(wanted) {
  return new Promise((ok) => {
    const probe = (port) => {
      const socket = createSocket('udp4');
      socket.once('error', () => { socket.close(); probe(0); });
      socket.bind(port, '0.0.0.0', () => { const found = socket.address().port; socket.close(() => ok(found)); });
    };
    probe(wanted);
  });
}

// Starts one process the probe owns. After `limitSeconds` the probe stops it (by its own process id and descendants) and marks it `limited`.
function start(exe, argv, limitSeconds) {
  const child = spawn(exe, argv, { stdio: 'ignore', windowsHide: true });
  const state = { child, exit: undefined, done: false, limited: false };
  const timer = setTimeout(() => { if (!state.done) { state.limited = true; kill(state); } }, limitSeconds * 1000);
  child.on('exit', (code) => { clearTimeout(timer); state.exit = code ?? undefined; state.done = true; });
  child.on('error', (e) => { clearTimeout(timer); state.error = e.message; state.done = true; });
  return state;
}
const kill = (state) => { if (state && !state.done && state.child.pid) spawnSync('taskkill', ['/PID', String(state.child.pid), '/T', '/F'], { windowsHide: true }); };

// One server and one client, the one case of two engine processes at once. The client starts once the server's log holds the listening line.
async function runPair({ label, serverExe, serverArgv, clientExe, serverLogFile, clientLogFile, port }) {
  const limit = hardLimitSeconds(waitSeconds);
  const result = {};
  const server = start(serverExe, serverArgv, limit.server);
  let client;
  try {
    const began = Date.now();
    while (!parseServerLog(readText(serverLogFile)).listening && !server.done && Date.now() - began < waitSeconds * 1000) await sleep(500);
    const listening = parseServerLog(readText(serverLogFile)).listening;
    note(`${label} server ${listening ? 'reports listening' : 'did not report listening'} after ${Math.round((Date.now() - began) / 1000)} s${server.done ? ` (exited: ${server.exit ?? server.error})` : ''}`);
    if (listening && clientExe) {
      await sleep(1000);
      client = start(clientExe, clientArguments({ port, log: clientLogFile }), limit.client);
      const clientStart = Date.now();
      while (!/DsProbe: client received Value=/.test(readText(clientLogFile)) && !client.done && Date.now() - clientStart < waitSeconds * 1000) await sleep(500);
      const c = parseClientLog(readText(clientLogFile));
      note(`${label} client ${c.welcomed ? 'was welcomed' : 'was not welcomed'}; values received [${c.received.join(', ')}] after ${Math.round((Date.now() - clientStart) / 1000)} s${client.done ? ` (exited: ${client.exit ?? client.error})` : ''}`);
      await sleep(3000);
    } else {
      note(`${label} client not started: ${listening ? 'there is no packaged executable' : 'the server never reported listening'}`);
    }
  } finally {
    Object.assign(result, { serverExit: server.exit, clientExit: client?.exit, serverEnded: describeEnd(server), clientEnded: client ? describeEnd(client) : undefined });
    kill(server); kill(client);
  }
  return { ...result, serverLog: readText(serverLogFile), clientLog: readText(clientLogFile) };
}

function findExe(dir) {
  if (!existsSync(dir)) return undefined;
  for (const entry of readdirSync(dir, { withFileTypes: true })) if (entry.isFile() && entry.name === `${name}.exe`) return join(dir, entry.name);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== 'Engine' && entry.name !== name) { const hit = findExe(join(dir, entry.name)); if (hit) return hit; }
  }
  return undefined;
}

function newProject(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  if (/\s/.test(root)) { console.error(`the project folder must not contain whitespace: ${root}`); process.exit(2); }
  mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
  const uproject = writeCodeProject({ root, name, modules: [{ name: moduleName, type: 'Runtime', sourceDir: join(here, 'module', moduleName) }] });
  mkdirSync(join(root, 'Config'), { recursive: true });
  // The stock Entry map, the probe's Game Mode as the project default, and nothing else: the Actor is spawned by the Game Mode.
  writeFileSync(join(root, 'Config', 'DefaultEngine.ini'), `[/Script/EngineSettings.GameMapsSettings]\nGameDefaultMap=${DEFAULT_MAP}\nServerDefaultMap=${DEFAULT_MAP}\nGlobalDefaultGameMode=${GAME_MODE}\n`);
  return { root, uproject };
}

for (const line of describeEngine(readEngineVersion(engine), engine)) note(line);
const toolchain = discoverToolchain({ compiler: flag('--compiler'), sdk: flag('--sdk') });
note(`toolchain: compiler ${toolchain.compiler}, SDK ${toolchain.sdk} (${toolchain.notes.join('; ')})`);
note(`evidence folder: ${evidence}`);

let target; let packaged; let editor; let failedRoot = false;
const roots = [];

if (groups.includes('target')) {
  const { root, uproject } = newProject('dsp-t-');
  roots.push(root);
  writeFileSync(join(root, 'Source', `${name}Server.Target.cs`), serverTargetSource({ name, modules: [moduleName] }));
  note(`Q1 project ${root}; building target ${name}Server (Win64 Development)`);
  const logPath = join(root, 'Saved', 'build-server.log');
  const built = await buildGame({ engine, uproject, name: `${name}Server`, toolchain, logPath });
  const log = readText(logPath);
  target = { exit: built.exit, seconds: built.seconds, timedOut: built.timedOut, log };
  keepFile(logPath, 'build-server.log');
  const c = classifyServerBuild(target);
  note(`Q1 Server target build: exit ${built.exit}, ${built.seconds} s${built.timedOut ? ' (timed out)' : ''}; verdict ${c.verdict}`);
  note(`Q1 build tool message, word for word:\n${c.message.text || '(no error or result line)'}`);
  if (c.verdict !== 'refused' && c.verdict !== 'builds') failedRoot = true;
}

// Editor build and package of the Game, shared by the packaged and editor groups. Resolves { build, package, exe }; --skip-package reuses a kept project.
async function buildAndPackage({ label, uproject, root }) {
  const archive = join(root, 'Archive');
  const saved = join(root, 'Saved');
  const out = {};
  if (!skipPackage) {
    const editorLog = join(saved, 'build-editor.log');
    out.build = await buildEditor({ engine, uproject, name, toolchain, logPath: editorLog });
    note(`${label} build Editor target: exit ${out.build.exit}, ${out.build.seconds} s${out.build.timedOut ? ' (timed out)' : ''}`);
    keepFile(editorLog, 'build-editor.log');
    if (out.build.exit === 0) {
      rmSync(archive, { recursive: true, force: true });
      const packageLog = join(saved, 'package.log');
      out.package = await packageGame({ engine, uproject, archiveDirectory: archive, toolchain, logPath: packageLog });
      note(`${label} package (BuildCookRun): exit ${out.package.exit}, ${out.package.seconds} s${out.package.timedOut ? ' (timed out)' : ''}`);
      keepFile(packageLog, 'package.log');
      if (out.package.exit !== 0) note(`${label} package message:\n${captureBuildMessage(readText(packageLog)).text.split('\n').slice(0, 12).join('\n')}`);
    }
  } else {
    out.build = { exit: 0 }; out.package = { exit: 0 };
  }
  out.exe = out.build?.exit === 0 && out.package?.exit === 0 ? findExe(archive) : undefined;
  return out;
}

async function pickPort(label) {
  const wanted = Number(flag('--port') || DEFAULT_PORT);
  const port = await freeUdpPort(wanted);
  if (port !== wanted) note(`${label} port ${wanted} was busy; using ${port}`);
  return port;
}

const reuseRoot = flag('--project') && resolve(flag('--project'));
const fwd = (p) => p.replace(/\\/g, '/');
const logFiles = (saved, kind) => { const stamp = Date.now(); return { server: fwd(join(saved, 'Logs', `server-${kind}-${stamp}.log`)), client: fwd(join(saved, 'Logs', `client-${kind}-${stamp}.log`)) }; };

if (groups.includes('packaged')) {
  const label = variant === 'server-game' ? 'Q3' : 'Q2';
  const { root, uproject } = reuseRoot ? { root: reuseRoot, uproject: join(reuseRoot, `${name}.uproject`) } : newProject('dsp-p-');
  roots.push(root);
  const saved = join(root, 'Saved');
  mkdirSync(join(saved, 'Logs'), { recursive: true });
  packaged = { variant, root };
  note(`${label} project ${root}`);
  Object.assign(packaged, await buildAndPackage({ label, uproject, root }));
  if (packaged.exe) {
    note(`${label} packaged game: ${packaged.exe}`);
    packaged.port = await pickPort(label);
    const files = logFiles(saved, variant);
    const ran = await runPair({ label, serverExe: packaged.exe, serverArgv: serverArguments({ port: packaged.port, log: files.server, variant }), clientExe: packaged.exe, serverLogFile: files.server, clientLogFile: files.client, port: packaged.port });
    Object.assign(packaged, ran);
    writeFileSync(join(evidence, `server-${variant}.log`), packaged.serverLog);
    writeFileSync(join(evidence, `client-${variant}.log`), packaged.clientLog);
  }
}

if (groups.includes('editor')) {
  const label = 'Q1/Q2';
  const { root, uproject } = reuseRoot ? { root: reuseRoot, uproject: join(reuseRoot, `${name}.uproject`) } : newProject('dsp-e-');
  roots.push(root);
  const saved = join(root, 'Saved');
  mkdirSync(join(saved, 'Logs'), { recursive: true });
  editor = { root };
  note(`${label} project ${root}`);
  Object.assign(editor, await buildAndPackage({ label, uproject, root }));
  const editorExe = editorExecutable(engine);
  if (editor.build?.exit === 0 && existsSync(editorExe)) {
    note(`${label} editor binary: ${editorExe}; packaged client: ${editor.exe ?? 'none'}`);
    editor.port = await pickPort(label);
    const files = logFiles(saved, 'editor');
    const ran = await runPair({ label, serverExe: editorExe, serverArgv: editorServerArguments({ uproject: fwd(uproject), port: editor.port, log: files.server }), clientExe: editor.exe, serverLogFile: files.server, clientLogFile: files.client, port: editor.port });
    Object.assign(editor, ran);
    writeFileSync(join(evidence, 'server-editor.log'), editor.serverLog);
    writeFileSync(join(evidence, 'client-editor.log'), editor.clientLog);
  }
}

const checks = evaluate({ target, packaged, editor, groups });
for (const c of checks) console.log(`${c.observe ? 'OBSERVE' : c.pass ? 'PASS' : 'FAIL'}  ${c.name}
      claim: ${c.claim}
      ${c.detail}`);
const { passed, total, observed } = summarize(checks);
console.log(`${passed} of ${total} checks passed, ${observed} observed (recorded, not judged)`);
const pairReceipt = (p) => p && { variant: p.variant, port: p.port, exe: p.exe, build: p.build, package: p.package, serverExit: p.serverExit, clientExit: p.clientExit, serverEnded: p.serverEnded, clientEnded: p.clientEnded,
  server: parseServerLog(p.serverLog), client: parseClientLog(p.clientLog) };
writeFileSync(join(evidence, 'receipt.json'), JSON.stringify({ groups, variant, checks, target: target && { exit: target.exit, seconds: target.seconds, timedOut: target.timedOut, classified: classifyServerBuild(target) },
  packaged: pairReceipt(packaged), editor: pairReceipt(editor) }, null, 2));
note(`evidence copied to ${evidence}`);
const ok = passed === total;
if (ok && !keep && !failedRoot && !reuseRoot) for (const r of roots) rmSync(r, { recursive: true, force: true });
else note(`project folders kept: ${roots.join(', ')}`);
process.exit(ok ? 0 : 1);
