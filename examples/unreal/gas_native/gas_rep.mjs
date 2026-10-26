// node gas_rep.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--reuse <kept project folder>] [--render] [--pie-readback] [--timeout 150]
//                  [--compiler 14.44.35228] [--sdk 10.0.26100.0]
// Run on Unreal 5.8.3 (10 of 10 asserted checks; `--render` was not run). Asks of a dedicated server and one client on this machine: does an actor with an Ability System
// Component in Mixed replication mode (owner = a player state) replicate a granted ability, an active Gameplay Effect and an attribute
// value to the client, and what does a client-side activation do? The scenario is module/GasNative/GasNativeRep.cpp, in the same module
// that gas_native.mjs builds; the judge is gas-rep-checks.mjs.
//
// Steps: build the Editor target (no packaging, no Game or Server target: the editor binary runs as a game with -game and as a dedicated
// server with -server -game, which is how an installed engine without source runs a server); optionally read the Play In Editor
// multiplayer settings back from Python (--pie-readback, one extra editor start); start the server on a free UDP port; wait for the
// "GasNativeRep: server ready" log line; start the client at 127.0.0.1:<port>; wait for both receipts with a hard timeout; kill whatever
// is left; judge the two receipts together. The client runs with -nullrhi, or with -RenderOffScreen when --render is given.
// --reuse <folder> skips the build and runs again in a project folder kept by an earlier --keep.
// Takes about two minutes to build and 20 to 40 s for the scenario (server timer 8 s after the join, client 5 s after its map loads).
// Exit code 0 when every check passes. Not part of node scripts/check.mjs; the checks are tested there.
import { spawn, spawnSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverToolchain, writeCodeProject, buildEditor } from '../native-build.mjs';
import { evaluate, summarize, serverArguments, clientArguments, observationRows } from './gas-rep-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const render = args.includes('--render');
const pieRequested = args.includes('--pie-readback');
const engine = flag('--engine') || process.env.UE_ROOT;
const timeoutSeconds = Number(flag('--timeout') || 150);
if (!engine) { console.error('usage: node gas_rep.mjs --engine <UE_5.8 folder> [--keep] [--reuse <folder>] [--render] [--pie-readback] [--timeout <s>] [--compiler <x.y.z>] [--sdk <10.0.n.n>]'); process.exit(2); }
const editorCmd = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe');
const editorGui = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
for (const exe of [editorCmd, editorGui]) if (!existsSync(exe)) { console.error(`not found: ${exe}`); process.exit(2); }

const here = import.meta.dirname;
const name = 'GasNativeRepProject';
const reuse = flag('--reuse');
const root = reuse ? resolve(reuse) : mkdtempSync(join(tmpdir(), 'gas-rep-'));
mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const readJson = (p) => { try { return existsSync(p) ? JSON.parse(readText(p)) : undefined; } catch { return undefined; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fwd = (p) => p.replace(/\\/g, '/');

/** A UDP port that was free a moment ago; the engine listens on UDP. */
function freeUdpPort() {
  return new Promise((ok, fail) => {
    const socket = createSocket('udp4');
    socket.once('error', fail);
    socket.bind(0, '127.0.0.1', () => { const { port } = socket.address(); socket.close(() => ok(port)); });
  });
}

function start(exe, argv) {
  const child = spawn(exe, argv, { stdio: 'ignore', windowsHide: true });
  const state = { child, exit: undefined, done: false };
  child.on('exit', (code) => { state.exit = code ?? undefined; state.done = true; });
  child.on('error', (e) => { state.error = e.message; state.done = true; });
  return state;
}
function kill(state) {
  if (state && !state.done && state.child.pid) spawnSync('taskkill', ['/PID', String(state.child.pid), '/T', '/F'], { windowsHide: true });
}

console.log(`Replicated Gameplay Ability System validation in ${root}`);
let uproject; let build;
if (reuse) {
  uproject = join(root, `${name}.uproject`);
  if (!existsSync(uproject)) { console.error(`not a kept project folder: ${uproject}`); process.exit(2); }
  build = { exit: 0, log: 'Result: Succeeded (reused)', seconds: 0 };
  console.log('  build: skipped (--reuse)');
} else {
  const toolchain = discoverToolchain({ compiler: flag('--compiler'), sdk: flag('--sdk') });
  console.log(`  toolchain: compiler ${toolchain.compiler}, SDK ${toolchain.sdk} (${toolchain.notes.join('; ')})`);
  uproject = writeCodeProject({ root, name, plugins: ['GameplayAbilities', ...(pieRequested ? ['PythonScriptPlugin', 'EditorScriptingUtilities'] : [])],
    modules: [{ name: 'GasNative', type: 'Runtime', sourceDir: join(here, 'module', 'GasNative') }] });
  const buildLog = join(root, 'Saved', 'build.log');
  const built = await buildEditor({ engine, uproject, name, toolchain, logPath: buildLog });
  console.log(`  build: exit ${built.exit}, ${built.seconds} s${built.timedOut ? ' (timed out)' : ''}`);
  build = { ...built, log: readText(buildLog) };
}

let server; let client; let serverExit; let clientExit; let serverLog = ''; let clientLog = ''; let pie; let serverReceiptJson; let clientReceiptJson;
if (build.exit === 0) {
  const stamp = Date.now();
  const serverReceipt = fwd(join(root, 'Saved', `gas-rep-server-${stamp}.json`));
  const clientReceipt = fwd(join(root, 'Saved', `gas-rep-client-${stamp}.json`));
  const serverLogFile = fwd(join(root, 'Saved', 'Logs', `gas-rep-server-${stamp}.log`));
  const clientLogFile = fwd(join(root, 'Saved', 'Logs', `gas-rep-client-${stamp}.log`));

  if (pieRequested) {
    const pieReport = fwd(join(root, 'Saved', `gas-rep-pie-${stamp}.json`));
    const result = spawnSync(editorGui, [uproject, '-nullrhi', `-ExecCmds=py ${fwd(resolve(here, 'gas_rep_pie_readback.py'))}`, `-abslog=${fwd(join(root, 'Saved', 'Logs', `gas-rep-pie-${stamp}.log`))}`, '-unattended', '-nosplash', '-nosound', '-notraceserver'],
      { env: { ...process.env, GAS_REP_PIE_REPORT: pieReport, MSYS_NO_PATHCONV: '1' }, stdio: 'ignore', timeout: 600000, windowsHide: true });
    pie = readJson(pieReport);
    console.log(`  PIE settings read-back: exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, report ${pie ? 'written' : 'missing'}`);
  }

  const port = await freeUdpPort();
  console.log(`  scenario: server on UDP port ${port}, map ${fwd(serverArguments({ uproject, port, receipt: '', log: '' })[1])}`);
  const began = Date.now();
  server = start(editorCmd, serverArguments({ uproject: fwd(uproject), port, receipt: serverReceipt, log: serverLogFile }));
  try {
    const readyDeadline = Date.now() + 120000;
    while (!/GasNativeRep: server ready/.test(readText(serverLogFile)) && !server.done && Date.now() < readyDeadline) await sleep(250);
    const ready = /GasNativeRep: server ready/.test(readText(serverLogFile));
    console.log(`  server ${ready ? 'ready' : 'did not become ready'} after ${Math.round((Date.now() - began) / 1000)} s${server.done ? ` (already exited: ${server.exit ?? server.error})` : ''}`);
    if (ready) {
      await sleep(1000);
      client = start(editorGui, clientArguments({ uproject: fwd(uproject), port, receipt: clientReceipt, log: clientLogFile, render }));
      const deadline = Date.now() + timeoutSeconds * 1000;
      while (Date.now() < deadline && !(server.done && client.done)) {
        if (existsSync(serverReceipt) && existsSync(clientReceipt)) { await sleep(5000); break; }   // both wrote; give them a moment to exit
        await sleep(500);
      }
    }
  } finally {
    const leftovers = [server, client].filter((s) => s && !s.done).length;
    kill(server); kill(client);
    if (leftovers) console.log(`  killed ${leftovers} process(es) still running`);
  }
  serverExit = server?.exit; clientExit = client?.exit;
  console.log(`  scenario finished after ${Math.round((Date.now() - began) / 1000)} s: server exit ${serverExit ?? 'none'}, client exit ${clientExit ?? 'none'}`);
  serverLog = readText(serverLogFile); clientLog = readText(clientLogFile);
  serverReceiptJson = readJson(serverReceipt); clientReceiptJson = readJson(clientReceipt);
}

const checks = evaluate({ build, server: serverReceiptJson, client: clientReceiptJson, serverLog, clientLog, serverExit, clientExit, pie, pieRequested });
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
console.log('readings (expected values come from engine source; only the checks above assert):');
for (const r of observationRows({ server: serverReceiptJson, client: clientReceiptJson })) {
  const verdict = r.matches === undefined ? 'reading' : (r.matches ? 'as expected' : 'DIFFERS');
  console.log(`  [${verdict}] ${r.name}: observed ${JSON.stringify(r.observed)}${r.expect !== undefined ? `, expected ${JSON.stringify(r.expect)}` : ''}`);
}
if (pie) console.log(`PIE settings (observe): ${JSON.stringify(pie.reads ?? pie)}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (keep || reuse) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
