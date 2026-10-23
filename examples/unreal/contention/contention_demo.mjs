// node contention_demo.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--frames 200] [--threads 8] [--wait-ms 120000] [--rounds 3] [--busy] [--out result.json] [--keep]
// Shows the effect the contention block guards against. A fixed, deterministic frame-sized workload (no Unreal, no GPU) is timed
// alone, beside one and then two throwaway UnrealEditor-Cmd -nullrhi editors (each in its own project folder in the OS temp
// folder), repeated for several rounds. The first phase waits (bounded by --wait-ms) for other editors to leave, then goes on and is flagged
// if they did not. Each phase takes a contention reading before and after the timing, so the receipt says which phases the helper
// flags. Only processes whose command line names the temp folder are stopped. Not part of node scripts/check.mjs.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { sampleContention, combineBlocks, listProcesses, stampReceipt, waitForQuiet } from './editor_contention.mjs';

const SIZE = 1 << 20, MASK = SIZE - 1, PASSES = 6;
// One "frame": a fixed number of passes over a fixed-seed array. The result checksum is the same on every run.
export function frameWork() {
  const x = new Float64Array(SIZE);
  let s = 12345;
  for (let i = 0; i < SIZE; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; x[i] = s / 4294967296; }
  for (let p = 0; p < PASSES; p++) for (let i = 0; i < SIZE; i++) x[i] = x[i] * 0.9999999 + x[(i * 7 + 1) & MASK] * 1e-3;
  return x[12345];
}

if (!isMainThread) {
  parentPort.on('message', () => { parentPort.postMessage(frameWork()); });
} else {
  await main();
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const engine = flag('--engine') || process.env.UE_ROOT;
  if (!engine) { console.error('usage: node contention_demo.mjs --engine <UE_5.8 folder> [--frames 200] [--threads 8] [--wait-ms 120000] [--rounds 3] [--busy] [--out result.json] [--keep]'); process.exit(2); }
  const editorCmd = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe');
  if (!existsSync(editorCmd)) { console.error(`not found: ${editorCmd}`); process.exit(2); }
  const frames = Number(flag('--frames') || 200);
  const threads = Math.min(Number(flag('--threads') || 8), availableParallelism());
  const busy = args.includes('--busy'); // scratch editors spin their game thread instead of idling
  const rounds = Number(flag('--rounds') || 3);
  const waitMs = Number(flag('--wait-ms') || 120000);
  const out = flag('--out');
  const here = import.meta.dirname;
  const root = mkdtempSync(join(tmpdir(), 'contention-demo-'));
  const norm = (p) => p.replaceAll('\\', '/');

  const workers = Array.from({ length: threads }, () => new Worker(import.meta.filename));
  const oneFrameParallel = () => Promise.all(workers.map((w) => new Promise((done) => { w.once('message', done); w.postMessage(1); })));
  const stats = (v) => {
    const a = [...v].sort((p, q) => p - q);
    const at = (f) => a[Math.min(a.length - 1, Math.floor(f * a.length))];
    return { frames: a.length, meanMs: +(a.reduce((p, q) => p + q, 0) / a.length).toFixed(2), p50Ms: +at(0.5).toFixed(2), p95Ms: +at(0.95).toFixed(2), maxMs: +a[a.length - 1].toFixed(2) };
  };
  async function timeFrames() {
    frameWork(); await oneFrameParallel(); // warm-up
    const single = [], parallel = [];
    for (let i = 0; i < frames; i++) { const t = performance.now(); frameWork(); single.push(performance.now() - t); }
    for (let i = 0; i < frames; i++) { const t = performance.now(); await oneFrameParallel(); parallel.push(performance.now() - t); }
    return { singleThread: stats(single), forkJoin: { threads, ...stats(parallel) } };
  }

  const editors = [];
  async function startEditor(index) {
    const project = join(root, `Scratch${index}`);
    mkdirSync(join(project, 'Saved'), { recursive: true });
    writeFileSync(join(project, `Scratch${index}.uproject`), JSON.stringify({ FileVersion: 3, EngineAssociation: '5.8', Plugins: [{ Name: 'PythonScriptPlugin', Enabled: true }] }, null, 2));
    const ready = join(project, 'Saved', 'ready.txt');
    rmSync(ready, { force: true });
    const child = spawn(editorCmd, [join(project, `Scratch${index}.uproject`), '-nullrhi', '-unattended', '-nosplash', '-nopause', '-nosound', '-notraceserver',
      `-ExecCmds=py ${norm(resolve(here, 'contention_idle.py'))}`], { env: { ...process.env, AGENT_UNREAL_READY_FILE: ready, ...(busy ? { AGENT_UNREAL_BUSY_SECONDS: '1800' } : {}) }, stdio: 'ignore', windowsHide: true });
    editors.push(child);
    const started = Date.now();
    await waitFor(() => existsSync(ready), 600000, 1000, `editor ${index} did not report ready`);
    return Math.round((Date.now() - started) / 1000);
  }
  async function waitFor(condition, timeoutMs, pollMs, message) {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(message);
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
  function stopMine() {
    const mine = listProcesses().filter((p) => norm(p.commandLine).toLowerCase().includes(norm(root).toLowerCase()));
    for (const p of mine) spawnSync('taskkill.exe', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return mine.length;
  }

  const scratchProcesses = () => listProcesses().filter((p) => norm(p.commandLine).toLowerCase().includes(norm(root).toLowerCase()));
  function workingSetMB(pids) {
    if (!pids.length) return [];
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pids.join(',')}).WorkingSet64 | ForEach-Object { [math]::Round($_/1MB) }`], { encoding: 'utf8', windowsHide: true });
    return (r.stdout.match(/[0-9]+/g) ?? []).map(Number);
  }
  const median = (v) => { const a = [...v].sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : null; };
  const phases = [];
  // A reading with excludeCommandLine = the temp folder counts only editors that are not ours ("foreign"); a phase is clean when
  // there were none before and after, so any slowdown in it comes from our own scratch editors.
  async function phase(label, round, { wait = false } = {}) {
    const foreignOptions = { ownPids: [], excludeCommandLine: [root] };
    let before;
    if (wait) before = await waitForQuiet({ ...foreignOptions, timeoutMs: waitMs, pollMs: 5000, allowContention: true });
    else before = sampleContention(foreignOptions);
    const allBefore = sampleContention({ ownPids: [] });
    const timing = await timeFrames();
    const after = sampleContention(foreignOptions);
    const allAfter = sampleContention({ ownPids: [] });
    const mine = scratchProcesses();
    const clean = before.otherUnrealProcesses === 0 && after.otherUnrealProcesses === 0;
    phases.push({ label, round, scratchEditors: editors.length, scratchEditorWorkingSetMB: workingSetMB(mine.map((p) => p.pid)), clean,
      foreignOthers: [before.otherUnrealProcesses, after.otherUnrealProcesses], contention: combineBlocks([allBefore, allAfter]), ...timing });
    console.log(`round ${round} ${label}: scratch ${editors.length}, foreign others ${before.otherUnrealProcesses}/${after.otherUnrealProcesses}, all others ${allBefore.otherUnrealProcesses}/${allAfter.otherUnrealProcesses}, free ${allAfter.freeMemoryMB} MB, flagged ${allBefore.contended || allAfter.contended}, single p50 ${timing.singleThread.p50Ms} ms, fork-join p50 ${timing.forkJoin.p50Ms} ms`);
  }
  async function stopScratch() {
    stopMine(); editors.length = 0;
    await waitFor(() => scratchProcesses().length === 0, 60000, 500, 'scratch editors did not exit');
  }

  const startupSeconds = [];
  try {
    for (let round = 1; round <= rounds; round++) {
      await phase('alone', round, { wait: round === 1 });
      startupSeconds.push(await startEditor(1));
      await phase('one scratch editor', round);
      startupSeconds.push(await startEditor(2));
      await phase('two scratch editors', round);
      await stopScratch();
    }
  } finally {
    for (const w of workers) w.terminate();
    console.log(`stopped ${stopMine()} process(es) naming ${root}`);
  }
  const labels = [...new Set(phases.map((p) => p.label))];
  const summary = labels.map((label) => {
    const all = phases.filter((p) => p.label === label), clean = all.filter((p) => p.clean);
    return { label, phases: all.length, cleanPhases: clean.length, flaggedByHelper: all.filter((p) => p.contention.contended).length,
      medianOfSingleP50Ms: median(clean.map((p) => p.singleThread.p50Ms)), medianOfForkJoinP50Ms: median(clean.map((p) => p.forkJoin.p50Ms)),
      medianOfForkJoinP95Ms: median(clean.map((p) => p.forkJoin.p95Ms)) };
  });
  console.log(JSON.stringify(summary, null, 2));
  const result = { workload: { passes: PASSES, elements: SIZE, frames, threads, rounds, scratchEditors: busy ? 'busy' : 'idle' }, startupSeconds, summary, phases };
  if (out) stampReceipt(out, result, 'demo');
  if (!args.includes('--keep')) rmSync(root, { recursive: true, force: true });
  process.exit(0);
}
