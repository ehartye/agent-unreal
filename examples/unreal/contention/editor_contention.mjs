// node editor_contention.mjs wait   [--timeout-ms 300000] [--poll-ms 5000] [--allow-contention] [--stamp receipt.json] [options]
// node editor_contention.mjs sample [--allow-contention] [--stamp receipt.json] [options]     (one reading, no waiting)
// node editor_contention.mjs verify receipt.json [--allow-contention]                          (judge a stamped receipt)
// options: --exclude-pid N (repeatable)  --exclude-cmdline TEXT (repeatable)  --game-name NAME (repeatable)
//          --max-other N (default 0)  --min-free-mb N (default 4096)  --key NAME (receipt key, default "contention")
// Records and judges whether other Unreal processes share the machine with a measurement. Windows only, no dependencies.
// Exit codes: 0 quiet (or contention explicitly allowed), 3 contended and refused, 2 usage error.
// Pure functions are exported for tests; only sampleContention / listProcesses touch the machine.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import { resolve } from 'node:path';

export const DEFAULTS = Object.freeze({
  timeoutMs: 300000, // wait at most five minutes for other editors to go away
  pollMs: 5000,
  maxOtherProcesses: 0, // any other Unreal editor, commandlet or game counts
  minFreeMemoryMB: 4096, // about one more editor's working set plus headroom; see README
});

const EDITOR_NAME = /^unrealeditor(-win64-[a-z]+)?\.exe$/i;
const COMMANDLET_NAME = /^unrealeditor-cmd\.exe$/i;
const exeName = (name) => String(name).toLowerCase().replace(/\.exe$/, '') + '.exe';

// Parse the JSON that listProcesses asks PowerShell for: an array, or one bare object when a single process matches.
export function parseProcessList(text) {
  const trimmed = String(text ?? '').replace(/^﻿/, '').trim();
  if (!trimmed) return [];
  const data = JSON.parse(trimmed);
  const rows = Array.isArray(data) ? data : [data];
  return rows
    .filter((r) => r && r.ProcessId != null && r.Name)
    .map((r) => ({ pid: Number(r.ProcessId), ppid: Number(r.ParentProcessId ?? 0), name: String(r.Name), commandLine: String(r.CommandLine ?? '') }));
}

// 'editor' | 'commandlet' | 'game' | undefined. Games are the packaged executable names the caller passes.
export function classifyProcess(proc, gameNames = []) {
  if (COMMANDLET_NAME.test(proc.name)) return 'commandlet';
  if (EDITOR_NAME.test(proc.name)) return 'editor';
  const wanted = new Set(gameNames.map(exeName));
  if (wanted.has(exeName(proc.name))) return 'game';
  return undefined;
}

// The given pids plus every process below them in the parent chain.
export function processTree(procs, rootPids) {
  const tree = new Set(rootPids.map(Number));
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of procs) if (!tree.has(p.pid) && tree.has(p.ppid)) { tree.add(p.pid); grew = true; }
  }
  return tree;
}

// Build the contention block from a process list and a free-memory reading.
export function evaluateContention(procs, options = {}) {
  const {
    ownPids = [process.pid], excludePids = [], excludeCommandLine = [], gameNames = [],
    freeMemoryMB, totalMemoryMB,
    maxOtherProcesses = DEFAULTS.maxOtherProcesses, minFreeMemoryMB = DEFAULTS.minFreeMemoryMB,
  } = options;
  const skip = processTree(procs, [...ownPids, ...excludePids]);
  const needles = excludeCommandLine.map((s) => String(s).toLowerCase().replaceAll('\\', '/'));
  const others = [];
  for (const p of procs) {
    const kind = classifyProcess(p, gameNames);
    if (!kind || skip.has(p.pid)) continue;
    const cmd = p.commandLine.toLowerCase().replaceAll('\\', '/');
    if (needles.some((n) => n && cmd.includes(n))) continue;
    others.push({ pid: p.pid, name: p.name, kind });
  }
  const reasons = [];
  if (others.length > maxOtherProcesses) reasons.push(`${others.length} other Unreal process(es) running, limit ${maxOtherProcesses}: ${others.map((o) => `${o.name} ${o.pid}`).join(', ')}`);
  if (freeMemoryMB < minFreeMemoryMB) reasons.push(`free physical memory ${freeMemoryMB} MB is below ${minFreeMemoryMB} MB`);
  return {
    otherUnrealProcesses: others.length,
    freeMemoryMB,
    ...(totalMemoryMB != null ? { totalMemoryMB } : {}),
    contended: reasons.length > 0,
    reasons,
    others,
    thresholds: { maxOtherProcesses, minFreeMemoryMB },
  };
}

// Merge readings taken before and after a run: contended if any was, worst-case counts and lowest free memory.
export function combineBlocks(blocks) {
  const list = blocks.filter(Boolean);
  const reasons = [...new Set(list.flatMap((b) => b.reasons))];
  return {
    ...list[0],
    otherUnrealProcesses: Math.max(...list.map((b) => b.otherUnrealProcesses)),
    freeMemoryMB: Math.min(...list.map((b) => b.freeMemoryMB)),
    contended: list.some((b) => b.contended),
    reasons,
    others: list.flatMap((b) => b.others).filter((o, i, all) => all.findIndex((x) => x.pid === o.pid) === i),
  };
}

export class ContentionError extends Error {
  constructor(message, contention) { super(message); this.name = 'ContentionError'; this.contention = contention; }
}

// Real machine access ------------------------------------------------------------------------------------------------
export function listProcesses() {
  if (process.platform !== 'win32') throw new Error('editor_contention lists processes through PowerShell and runs on Windows only');
  const script = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress';
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
  if (r.error || r.status !== 0) throw new Error(`could not list processes: ${r.error?.message ?? r.stderr}`);
  return parseProcessList(r.stdout);
}

export function sampleContention(options = {}) {
  const { listProcesses: list = listProcesses, freeMemoryMB = Math.round(freemem() / 1048576), totalMemoryMB = Math.round(totalmem() / 1048576) } = options;
  return { ...evaluateContention(list(), { ...options, freeMemoryMB, totalMemoryMB }), sampledAt: new Date().toISOString() };
}

const realSleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Wait (bounded) until nothing else is running, then return the block. Contended after the timeout: throw ContentionError,
// or, with allowContention, return the block still marked contended with allowed: true.
export async function waitForQuiet(options = {}) {
  const { timeoutMs = DEFAULTS.timeoutMs, pollMs = DEFAULTS.pollMs, allowContention = false, sample = sampleContention, sleep = realSleep, now = Date.now } = options;
  const start = now();
  const deadline = start + timeoutMs;
  let block = await sample(options);
  while (block.contended && now() < deadline) {
    await sleep(Math.max(0, Math.min(pollMs, deadline - now())));
    block = await sample(options);
  }
  block = { ...block, waitedMs: now() - start };
  if (!block.contended) return block;
  if (allowContention) return { ...block, allowed: true };
  throw new ContentionError(
    `Refusing to measure: ${block.reasons.join('; ')} (waited ${Math.round(block.waitedMs / 1000)} s). ` +
    'Close the other Unreal processes, or pass allowContention (--allow-contention) to record the receipt flagged as contended.', block);
}

// Receipts -----------------------------------------------------------------------------------------------------------
export function stampReceipt(file, block, key = 'contention') {
  const receipt = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) : {};
  receipt[key] = block;
  writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

// For consumers that compare a receipt with a frame-time budget. A missing block is refused as well as a contended one.
export function judgeReceipt(receipt, { allowContention = false, keys = ['contention', 'contentionAfter'] } = {}) {
  const blocks = keys.map((k) => receipt?.[k]).filter(Boolean);
  if (!blocks.length) return { ok: false, reason: `receipt has no ${keys[0]} block, so it cannot be compared with a budget` };
  const bad = blocks.find((b) => b.contended);
  if (!bad) return { ok: true, reason: 'no contention recorded' };
  if (allowContention) return { ok: true, reason: `contended receipt accepted explicitly: ${bad.reasons.join('; ')}` };
  return { ok: false, reason: `receipt was recorded under contention: ${bad.reasons.join('; ')}` };
}

// CLI ----------------------------------------------------------------------------------------------------------------
export function parseArgs(argv) {
  const out = { command: argv[0], excludePids: [], excludeCommandLine: [], gameNames: [], positional: [] };
  const numeric = { '--timeout-ms': 'timeoutMs', '--poll-ms': 'pollMs', '--max-other': 'maxOtherProcesses', '--min-free-mb': 'minFreeMemoryMB' };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--allow-contention') out.allowContention = true;
    else if (numeric[a]) out[numeric[a]] = Number(argv[++i]);
    else if (a === '--exclude-pid') out.excludePids.push(Number(argv[++i]));
    else if (a === '--exclude-cmdline') out.excludeCommandLine.push(argv[++i]);
    else if (a === '--game-name') out.gameNames.push(argv[++i]);
    else if (a === '--stamp') out.stamp = argv[++i];
    else if (a === '--key') out.key = argv[++i];
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else out.positional.push(a);
  }
  return out;
}

async function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) { console.error(e.message); return 2; }
  if (opts.command === 'verify') {
    if (!opts.positional[0]) { console.error('usage: verify <receipt.json> [--allow-contention]'); return 2; }
    const verdict = judgeReceipt(JSON.parse(readFileSync(opts.positional[0], 'utf8').replace(/^﻿/, '')), opts);
    console.log(JSON.stringify(verdict));
    return verdict.ok ? 0 : 3;
  }
  if (opts.command !== 'wait' && opts.command !== 'sample') {
    console.error('usage: editor_contention.mjs wait|sample|verify ... (see the header of this file)');
    return 2;
  }
  if (opts.command === 'sample') opts.timeoutMs = 0;
  let block; let code = 0;
  try { block = await waitForQuiet(opts); } catch (e) {
    if (!(e instanceof ContentionError)) throw e;
    console.error(e.message);
    block = e.contention; code = 3;
  }
  if (opts.stamp) stampReceipt(opts.stamp, block, opts.key);
  console.log(JSON.stringify(block, null, 2));
  return code;
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 1; });
}
