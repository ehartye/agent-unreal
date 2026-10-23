// node --test examples/unreal/contention/contention.test.mjs  (no Unreal, no dependencies, no real waits)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseProcessList, classifyProcess, processTree, evaluateContention, combineBlocks, waitForQuiet,
  stampReceipt, judgeReceipt, parseArgs, ContentionError, DEFAULTS,
} from './editor_contention.mjs';

const row = (ProcessId, ParentProcessId, Name, CommandLine = '') => ({ ProcessId, ParentProcessId, Name, CommandLine });
const FIXTURE = JSON.stringify([
  row(4, 0, 'System'),
  row(100, 4, 'node.exe', 'node measure.mjs'),
  row(200, 4, 'UnrealEditor.exe', 'UnrealEditor.exe C:/work/other/Other.uproject -nullrhi'),
  row(201, 200, 'UnrealEditor-Cmd.exe', 'UnrealEditor-Cmd.exe C:/work/other/Other.uproject -run=Cook'),
  row(300, 4, 'MyGame-Win64-Shipping.exe', 'MyGame-Win64-Shipping.exe -log'),
  row(400, 4, 'UnrealEditor-Cmd.exe', 'UnrealEditor-Cmd.exe C:/Temp/scratch-1/Scratch.uproject -nullrhi'),
  row(500, 4, 'ShaderCompileWorker.exe', 'ShaderCompileWorker.exe'),
  row(600, 4, 'notepad.exe'),
]);

test('parseProcessList reads an array, a single object, a byte order mark and empty text', () => {
  const procs = parseProcessList(FIXTURE);
  assert.equal(procs.length, 8);
  assert.deepEqual(procs[2], { pid: 200, ppid: 4, name: 'UnrealEditor.exe', commandLine: 'UnrealEditor.exe C:/work/other/Other.uproject -nullrhi' });
  assert.equal(procs[7].commandLine, '');
  assert.deepEqual(parseProcessList('\uFEFF' + JSON.stringify(row(7, 1, 'a.exe', null))), [{ pid: 7, ppid: 1, name: 'a.exe', commandLine: '' }]);
  assert.deepEqual(parseProcessList('  \r\n'), []);
  assert.deepEqual(parseProcessList(undefined), []);
  assert.throws(() => parseProcessList('not json'));
});

test('classifyProcess names editors, commandlets and only the games that were passed', () => {
  const p = (name) => ({ name });
  assert.equal(classifyProcess(p('UnrealEditor.exe')), 'editor');
  assert.equal(classifyProcess(p('unrealeditor.EXE')), 'editor');
  assert.equal(classifyProcess(p('UnrealEditor-Win64-DebugGame.exe')), 'editor');
  assert.equal(classifyProcess(p('UnrealEditor-Cmd.exe')), 'commandlet');
  assert.equal(classifyProcess(p('MyGame-Win64-Shipping.exe')), undefined);
  assert.equal(classifyProcess(p('MyGame-Win64-Shipping.exe'), ['MyGame-Win64-Shipping']), 'game');
  assert.equal(classifyProcess(p('mygame.exe'), ['MyGame.exe']), 'game');
  assert.equal(classifyProcess(p('ShaderCompileWorker.exe'), ['MyGame']), undefined);
  assert.equal(classifyProcess(p('UnrealEditorLauncher.exe')), undefined);
});

test('processTree follows the parent chain and ignores unrelated processes', () => {
  const procs = parseProcessList(FIXTURE);
  assert.deepEqual([...processTree(procs, [200])].sort(), [200, 201]);
  assert.deepEqual([...processTree(procs, [999])], [999]);
});

test('evaluateContention counts other editors, commandlets and named games, and keeps the measured tree out', () => {
  const procs = parseProcessList(FIXTURE);
  const base = { ownPids: [100], freeMemoryMB: 20000, totalMemoryMB: 32000 };
  const all = evaluateContention(procs, { ...base, gameNames: ['MyGame-Win64-Shipping.exe'] });
  assert.equal(all.otherUnrealProcesses, 4);
  assert.deepEqual(all.others.map((o) => [o.pid, o.kind]), [[200, 'editor'], [201, 'commandlet'], [300, 'game'], [400, 'commandlet']]);
  assert.equal(all.contended, true);
  assert.match(all.reasons[0], /4 other Unreal process\(es\)/);
  assert.equal(all.freeMemoryMB, 20000);
  // the caller's own pid and everything below it never count
  const ownEditor = evaluateContention(procs, { ...base, ownPids: [100, 200] });
  assert.deepEqual(ownEditor.others.map((o) => o.pid), [400]);
  const viaExclude = evaluateContention(procs, { ...base, excludePids: [200] });
  assert.deepEqual(viaExclude.others.map((o) => o.pid), [400]);
});

test('evaluateContention can leave out a named scratch project, with either slash style', () => {
  const procs = parseProcessList(FIXTURE);
  const r = evaluateContention(procs, { ownPids: [100], excludeCommandLine: ['C:\\Temp\\scratch-1'], freeMemoryMB: 20000 });
  assert.deepEqual(r.others.map((o) => o.pid), [200, 201]);
  const quiet = evaluateContention(procs, { ownPids: [100], excludeCommandLine: ['work/other', 'scratch-1'], freeMemoryMB: 20000 });
  assert.equal(quiet.otherUnrealProcesses, 0);
  assert.equal(quiet.contended, false);
  assert.deepEqual(quiet.reasons, []);
});

test('thresholds are parameters: process limit and free memory floor', () => {
  const procs = parseProcessList(FIXTURE);
  const common = { ownPids: [100], excludeCommandLine: ['work/other'] };
  assert.equal(evaluateContention(procs, { ...common, freeMemoryMB: 20000 }).contended, true);
  assert.equal(evaluateContention(procs, { ...common, freeMemoryMB: 20000, maxOtherProcesses: 1 }).contended, false);
  const low = evaluateContention(procs, { ownPids: [100], excludeCommandLine: ['work', 'scratch'], freeMemoryMB: 1000 });
  assert.equal(low.contended, true);
  assert.match(low.reasons.join(), new RegExp(`free physical memory 1000 MB is below ${DEFAULTS.minFreeMemoryMB} MB`));
  assert.equal(evaluateContention(procs, { ownPids: [100], excludeCommandLine: ['work', 'scratch'], freeMemoryMB: 1000, minFreeMemoryMB: 500 }).contended, false);
  assert.deepEqual(low.thresholds, { maxOtherProcesses: 0, minFreeMemoryMB: DEFAULTS.minFreeMemoryMB });
});

// A fake clock and sampler: no real waiting.
function fakeWorld(counts, free = 20000) {
  let clock = 0; let calls = 0; const sleeps = [];
  return {
    sleeps,
    now: () => clock,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    sample: () => {
      const n = counts[Math.min(calls++, counts.length - 1)];
      const others = Array.from({ length: n }, (_, i) => ({ pid: i + 1, name: 'UnrealEditor.exe', kind: 'editor' }));
      return { otherUnrealProcesses: n, freeMemoryMB: free, contended: n > 0, reasons: n ? [`${n} other Unreal process(es) running`] : [], others };
    },
    get calls() { return calls; },
  };
}

test('waitForQuiet returns at once when nothing else is running', async () => {
  const w = fakeWorld([0]);
  const block = await waitForQuiet({ ...w, timeoutMs: 60000, pollMs: 1000 });
  assert.equal(block.contended, false);
  assert.equal(w.sleeps.length, 0);
  assert.equal(block.waitedMs, 0);
});

test('waitForQuiet polls until the other editors leave, then returns a quiet block', async () => {
  const w = fakeWorld([2, 1, 0]);
  const block = await waitForQuiet({ ...w, timeoutMs: 60000, pollMs: 1000 });
  assert.equal(block.contended, false);
  assert.deepEqual(w.sleeps, [1000, 1000]);
  assert.equal(block.waitedMs, 2000);
});

test('waitForQuiet refuses after the bounded wait unless contention is allowed', async () => {
  const w = fakeWorld([1]);
  await assert.rejects(waitForQuiet({ ...w, timeoutMs: 2500, pollMs: 1000 }), (e) => {
    assert.ok(e instanceof ContentionError);
    assert.match(e.message, /Refusing to measure: 1 other Unreal process/);
    assert.match(e.message, /--allow-contention/);
    assert.equal(e.contention.contended, true);
    return true;
  });
  assert.deepEqual(w.sleeps, [1000, 1000, 500], 'the last sleep is cut to the deadline');
  const allowed = await waitForQuiet({ ...fakeWorld([1]), timeoutMs: 2500, pollMs: 1000, allowContention: true });
  assert.equal(allowed.contended, true, 'an allowed receipt is still flagged contended');
  assert.equal(allowed.allowed, true);
});

test('a zero timeout takes one reading and never sleeps', async () => {
  const w = fakeWorld([3]);
  await assert.rejects(waitForQuiet({ ...w, timeoutMs: 0 }), ContentionError);
  assert.equal(w.calls, 1);
  assert.equal(w.sleeps.length, 0);
});

test('low free memory alone makes the wait refuse', async () => {
  const w = fakeWorld([0]);
  const sample = () => ({ ...w.sample(), freeMemoryMB: 500, contended: true, reasons: ['free physical memory 500 MB is below 4096 MB'] });
  await assert.rejects(waitForQuiet({ sample, sleep: w.sleep, now: w.now, timeoutMs: 0 }), /free physical memory 500 MB/);
});

test('stampReceipt adds the block to a receipt and keeps its other fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'contention-test-'));
  try {
    const file = join(dir, 'receipt.json');
    writeFileSync(file, '\uFEFF' + JSON.stringify({ perf: { frameMsMean: 8.1 } }));
    const block = { otherUnrealProcesses: 0, freeMemoryMB: 12000, contended: false, reasons: [] };
    stampReceipt(file, block);
    stampReceipt(file, { ...block, otherUnrealProcesses: 2, contended: true, reasons: ['x'] }, 'contentionAfter');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(saved.perf, { frameMsMean: 8.1 });
    assert.deepEqual(saved.contention, block);
    assert.equal(saved.contentionAfter.otherUnrealProcesses, 2);
    const fresh = join(dir, 'new.json');
    assert.deepEqual(stampReceipt(fresh, block), { contention: block });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('judgeReceipt rejects a contended or unstamped receipt unless contention is allowed', () => {
  const quiet = { otherUnrealProcesses: 0, freeMemoryMB: 9000, contended: false, reasons: [] };
  const busy = { ...quiet, otherUnrealProcesses: 1, contended: true, reasons: ['1 other Unreal process(es) running, limit 0'] };
  assert.equal(judgeReceipt({ contention: quiet }).ok, true);
  assert.equal(judgeReceipt({ contention: quiet, contentionAfter: busy }).ok, false, 'contention that started during the run counts');
  const refused = judgeReceipt({ contention: busy });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /recorded under contention/);
  assert.equal(judgeReceipt({ contention: busy }, { allowContention: true }).ok, true);
  assert.equal(judgeReceipt({ perf: {} }).ok, false);
  assert.equal(judgeReceipt({ perf: {} }, { allowContention: true }).ok, false, 'allowing contention does not excuse a missing block');
});

test('combineBlocks keeps the worst reading of several', () => {
  const a = { otherUnrealProcesses: 0, freeMemoryMB: 9000, contended: false, reasons: [], others: [] };
  const b = { otherUnrealProcesses: 2, freeMemoryMB: 3000, contended: true, reasons: ['r'], others: [{ pid: 1 }, { pid: 2 }] };
  const c = combineBlocks([a, null, b, b]);
  assert.deepEqual([c.otherUnrealProcesses, c.freeMemoryMB, c.contended, c.reasons.length, c.others.length], [2, 3000, true, 1, 2]);
});

test('parseArgs reads the command, repeatable options and numbers', () => {
  const o = parseArgs(['wait', '--timeout-ms', '1000', '--poll-ms', '50', '--exclude-pid', '5', '--exclude-pid', '6',
    '--exclude-cmdline', 'C:/x', '--game-name', 'G', '--allow-contention', '--stamp', 'r.json', '--min-free-mb', '2048', '--max-other', '1']);
  assert.deepEqual([o.command, o.timeoutMs, o.pollMs, o.excludePids, o.excludeCommandLine, o.gameNames, o.allowContention, o.stamp, o.minFreeMemoryMB, o.maxOtherProcesses],
    ['wait', 1000, 50, [5, 6], ['C:/x'], ['G'], true, 'r.json', 2048, 1]);
  assert.deepEqual(parseArgs(['verify', 'a.json']).positional, ['a.json']);
  assert.throws(() => parseArgs(['wait', '--nope']), /unknown option/);
});
