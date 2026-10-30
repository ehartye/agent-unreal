// node ds_probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--only target,packaged] [--keep] [--variant server|listen] [--port 7777]
//                   [--project <packaged-group folder this runner kept> --skip-package] [--seconds 90] [--evidence <folder>] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
// Two questions about dedicated servers on an installed (Launcher) engine, answered by running Unreal Build Tool and a packaged game. Windows and Node only.
//   target    Q1. Writes <Project>Server.Target.cs (Type = TargetType.Server, a copy of the Game target) into a throwaway code project and runs
//             Build.bat <Project>Server Win64 Development with the compiler and SDK flags the Editor build uses. Records the exit code and the
//             build tool's message word for word. Either it is refused (Epic's page: a source build is required) or it builds.
//   packaged  Q2. Packages the same small project with no Server target (editor build, then RunUAT BuildCookRun), starts the packaged Game executable
//             as `-server -log -nullrhi -port=7777` and a second process of the same build as the client at 127.0.0.1:7777. Judges by the two logs:
//             the engine's listening line, the client's welcome line, and the replicated integer the server sets appearing in the client's log.
//             --variant listen starts the server with `?listen` instead of `-server` (a listen server, recorded as a different thing).
//   --skip-package  with --project: run the game already archived under <project>/Archive again (no build, no package)
//   --keep          keep the project folders when every check passes (always kept when one fails)
//   --seconds <n>   how long to wait for the server to listen and for the client to show the value (default 90)
//   --evidence <d>  where the logs and the receipt are copied (default: a folder under the OS temp folder, printed at the end)
// The server and the client are the one case of two engine processes at once; this runner starts nothing else and kills only the two it started.
// Prints PASS, FAIL or OBSERVE per check and "N of M checks passed". Exit code 0 when every asserted check passes.
// Not part of node scripts/check.mjs; the pure judging code (ds-probe-checks.mjs) is tested there.
import { spawn, spawnSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverToolchain, writeCodeProject, buildEditor, buildGame, packageGame } from '../native-build.mjs';
import { readEngineVersion, describeEngine } from '../engine-version.mjs';
import { serverTargetSource, classifyServerBuild, captureBuildMessage, serverArguments, clientArguments, evaluate, summarize, parseServerLog, parseClientLog, DEFAULT_PORT, DEFAULT_MAP, GAME_MODE } from './ds-probe-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const skipPackage = args.includes('--skip-package');
const engine = flag('--engine') || process.env.UE_ROOT;
const groups = (flag('--only') || 'target,packaged').split(',').map((g) => g.trim()).filter((g) => g === 'target' || g === 'packaged');
const variant = flag('--variant') || 'server';
const waitSeconds = Number(flag('--seconds') || 90);
const usage = 'usage: node ds_probe.mjs --engine <UE_5.8 folder> [--only target,packaged] [--keep] [--variant server|listen] [--port <n>] [--project <folder> --skip-package] [--seconds <n>] [--evidence <folder>] [--compiler <x.y.z>] [--sdk <10.0.n.n>]';
if (!engine || groups.length === 0 || (variant !== 'server' && variant !== 'listen') || !(waitSeconds > 0) || (skipPackage && !flag('--project'))) { console.error(usage); process.exit(2); }
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

function start(exe, argv) {
  const child = spawn(exe, argv, { stdio: 'ignore', windowsHide: true });
  const state = { child, exit: undefined, done: false };
  child.on('exit', (code) => { state.exit = code ?? undefined; state.done = true; });
  child.on('error', (e) => { state.error = e.message; state.done = true; });
  return state;
}
const kill = (state) => { if (state && !state.done && state.child.pid) spawnSync('taskkill', ['/PID', String(state.child.pid), '/T', '/F'], { windowsHide: true }); };

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

let target; let packaged; let failedRoot = false;
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

if (groups.includes('packaged')) {
  const reuse = flag('--project') && resolve(flag('--project'));
  const { root, uproject } = reuse ? { root: reuse, uproject: join(reuse, `${name}.uproject`) } : newProject('dsp-p-');
  roots.push(root);
  const archive = join(root, 'Archive');
  const saved = join(root, 'Saved');
  mkdirSync(join(saved, 'Logs'), { recursive: true });
  packaged = { variant, root };
  note(`Q2 project ${root}`);
  if (!skipPackage) {
    const editorLog = join(saved, 'build-editor.log');
    packaged.build = await buildEditor({ engine, uproject, name, toolchain, logPath: editorLog });
    note(`Q2 build Editor target: exit ${packaged.build.exit}, ${packaged.build.seconds} s${packaged.build.timedOut ? ' (timed out)' : ''}`);
    keepFile(editorLog, 'build-editor.log');
    if (packaged.build.exit === 0) {
      rmSync(archive, { recursive: true, force: true });
      const packageLog = join(saved, 'package.log');
      packaged.package = await packageGame({ engine, uproject, archiveDirectory: archive, toolchain, logPath: packageLog });
      note(`Q2 package (BuildCookRun): exit ${packaged.package.exit}, ${packaged.package.seconds} s${packaged.package.timedOut ? ' (timed out)' : ''}`);
      keepFile(packageLog, 'package.log');
      if (packaged.package.exit !== 0) note(`Q2 package message:\n${captureBuildMessage(readText(packageLog)).text.split('\n').slice(0, 12).join('\n')}`);
    }
  } else {
    packaged.build = { exit: 0 }; packaged.package = { exit: 0 };
  }
  packaged.exe = packaged.build?.exit === 0 && packaged.package?.exit === 0 ? findExe(archive) : undefined;
  if (packaged.exe) {
    note(`Q2 packaged game: ${packaged.exe}`);
    const wanted = Number(flag('--port') || DEFAULT_PORT);
    packaged.port = await freeUdpPort(wanted);
    if (packaged.port !== wanted) note(`Q2 port ${wanted} was busy; using ${packaged.port}`);
    const stamp = Date.now();
    const serverLogFile = join(saved, 'Logs', `server-${stamp}.log`).replace(/\\/g, '/');
    const clientLogFile = join(saved, 'Logs', `client-${stamp}.log`).replace(/\\/g, '/');
    const server = start(packaged.exe, serverArguments({ port: packaged.port, log: serverLogFile, variant }));
    let client;
    try {
      const began = Date.now();
      while (!parseServerLog(readText(serverLogFile)).listening && !server.done && Date.now() - began < waitSeconds * 1000) await sleep(500);
      const listening = parseServerLog(readText(serverLogFile)).listening;
      note(`Q2 server ${listening ? 'reports listening' : 'did not report listening'} after ${Math.round((Date.now() - began) / 1000)} s${server.done ? ` (exited: ${server.exit ?? server.error})` : ''}`);
      if (listening) {
        await sleep(1000);
        client = start(packaged.exe, clientArguments({ port: packaged.port, log: clientLogFile }));
        const clientStart = Date.now();
        while (!/DsProbe: client received Value=/.test(readText(clientLogFile)) && !client.done && Date.now() - clientStart < waitSeconds * 1000) await sleep(500);
        const c = parseClientLog(readText(clientLogFile));
        note(`Q2 client ${c.welcomed ? 'was welcomed' : 'was not welcomed'}; values received [${c.received.join(', ')}] after ${Math.round((Date.now() - clientStart) / 1000)} s${client.done ? ` (exited: ${client.exit ?? client.error})` : ''}`);
        await sleep(3000);
      } else {
        note('Q2 client not started: the server never reported listening');
      }
    } finally {
      packaged.serverExit = server.exit; packaged.clientExit = client?.exit;
      kill(server); kill(client);
    }
    packaged.serverLog = readText(serverLogFile);
    packaged.clientLog = readText(clientLogFile);
    writeFileSync(join(evidence, `server-${variant}.log`), packaged.serverLog);
    writeFileSync(join(evidence, `client-${variant}.log`), packaged.clientLog);
  }
}

const checks = evaluate({ target, packaged, groups });
for (const c of checks) console.log(`${c.observe ? 'OBSERVE' : c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total, observed } = summarize(checks);
console.log(`${passed} of ${total} checks passed, ${observed} observed (recorded, not judged)`);
writeFileSync(join(evidence, 'receipt.json'), JSON.stringify({ groups, variant, checks, target: target && { exit: target.exit, seconds: target.seconds, timedOut: target.timedOut, classified: classifyServerBuild(target) },
  packaged: packaged && { variant: packaged.variant, port: packaged.port, exe: packaged.exe, build: packaged.build, package: packaged.package, serverExit: packaged.serverExit, clientExit: packaged.clientExit,
    server: parseServerLog(packaged.serverLog), client: parseClientLog(packaged.clientLog) } }, null, 2));
note(`evidence copied to ${evidence}`);
const ok = passed === total;
if (ok && !keep && !failedRoot && !flag('--project')) for (const r of roots) rmSync(r, { recursive: true, force: true });
else note(`project folders kept: ${roots.join(', ')}`);
process.exit(ok ? 0 : 1);
