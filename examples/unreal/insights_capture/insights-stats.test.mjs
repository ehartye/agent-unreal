// node --test examples/unreal/insights_capture/insights-stats.test.mjs  (no Unreal, no dependencies)
// The stat help lines copy the registration text in the 5.8.2 install's UnrealEngine.cpp and StatsCommand.cpp. The CSV exports follow what the 5.8.2 run wrote// (a header naming the requested columns, one row per allocation, Size in bytes, EndTime +inf while alive). Each test changes one fact and expects the matching check to change.
// Each test changes one fact and expects the matching check to change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize, parseCsv, columnNumbers, STARTFILE_SOURCE_NOTE } from './insights-stats-checks.mjs';

const HELD = 300000, FREED = 1500000;
const helpLog = [
  'LogConsoleResponse: Display: FPS: Display average FPS.',
  'LogConsoleResponse: Display: Unit: Display frame times for Game Thread, Render Thread and GPU.  Also displays draw calls and primitive counts.',
  'LogConsoleResponse: Display: Empty stat command!',
  'LogConsoleResponse: Display: Here is the brief list of stats console commands',
  'LogConsoleResponse: Display: stat dumpframe [-ms=5.0] [-root=empty] [-depth=maxint] - dumps a frame of stats',
].join('\n');
const startfileLines = ['LogStats: Opening stats file: X/Saved/Profiling/UnrealStats/a.uestats.inprogress', 'LogStats: Wrote stats file: X/Saved/Profiling/UnrealStats/a.uestats'].join('\n');
const statsReport = { mode: 'stats', ticks: 51, commands: Array.from({ length: 8 }, (_, i) => ({ tick: i, command: 'stat' })) };
const csv = (sizes) => ['Size,StartTime,EndTime', ...sizes.map((s) => `${s},1.5,-1`)].join('\n');
const traceRun = (exports, extra = {}) => ({ exit: 0, report: { mode: 'memory' }, insightsLog: 'LogMemoryProfiler: Log: SUCCESS! Exported', traceBytes: 900000000, exports, ...extra });
const good = () => ({
  stats: { exit: 0, report: statsReport, log: helpLog, uestats: [] },
  memory: traceRun({ active: csv([64, 1200000, 4096]), leaks: csv([8388608, 1200000, 512]), limited: csv([6291456, 6000000, 256]) }),
  control: { exit: 0, report: { mode: 'memory' }, insightsLog: 'LogMemoryExporter: Error: AllocationsProvider exists but not initialized', traceBytes: 40000000, exports: { active: '', leaks: '', limited: '' } },
  options: { heldElements: HELD, freedElements: FREED },
});
const failing = (checks) => checks.filter((c) => !c.pass && !c.info).map((c) => c.name);

test('a good set of runs passes every counted check', () => {
  const checks = evaluate(good());
  assert.deepEqual(failing(checks), []);
  const { passed, total } = summarize(checks);
  assert.equal(passed, total);
  assert.equal(total, 8);
  assert.ok(checks.some((c) => c.info && /on-screen readout/.test(c.name)));
});

test('parseCsv and columnNumbers read the exported table', () => {
  assert.deepEqual(parseCsv('\uFEFFSize,Tag\r\n10,"a,b"\r\n20,c\r\n'), { header: ['Size', 'Tag'], rows: [['10', 'a,b'], ['20', 'c']] });
  assert.equal(parseCsv(''), undefined);
  assert.deepEqual(columnNumbers(csv([5, 7]), 'Size'), [5, 7]);
  assert.equal(columnNumbers(csv([5]), 'Nope'), undefined);
  assert.equal(columnNumbers(undefined, 'Size'), undefined);
});

test('missing runs fail the checks that need them instead of throwing', () => {
  const none = evaluate({});
  for (const name of ['the stats run finished', 'stat startfile and stopfile are compiled out of the installed build', 'stat help lists stat unit and stat fps', 'memory trace answers Active Alloc', 'Memory Leaks finds the held allocation and not the freed one']) {
    assert.ok(failing(none).includes(name), name);
  }
});

test('a build that writes a stats file, or lists the commands, fails the compiled-out check and the detail names the source reason', () => {
  const name = 'stat startfile and stopfile are compiled out of the installed build';
  const written = good();
  written.stats = { ...written.stats, uestats: ['a.uestats'], log: `${helpLog}\n${startfileLines}` };
  const checks = evaluate(written);
  assert.deepEqual(failing(checks), [name]);
  assert.ok(checks.find((c) => c.name === name).detail.includes(STARTFILE_SOURCE_NOTE));
  const listed = good();
  listed.stats = { ...listed.stats, log: `${helpLog}\nLogConsoleResponse: Display: stat startfile - starts dumping a capture` };
  assert.deepEqual(failing(evaluate(listed)), [name]);
});

test('each fact turns its own check red', () => {
  const withStats = (patch) => { const g = good(); g.stats = { ...g.stats, ...patch }; return evaluate(g); };
  assert.deepEqual(failing(withStats({ report: undefined })), ['the stats run finished', 'stat startfile and stopfile are compiled out of the installed build']);
  assert.deepEqual(failing(withStats({ log: '' })), ['stat help lists stat unit and stat fps', 'a bare stat prints the stat help']);
  assert.deepEqual(failing(withStats({ log: helpLog.replace('FPS: Display average FPS.', '') })), ['stat help lists stat unit and stat fps']);
  const withMemory = (exports, patch = {}) => { const g = good(); g.memory = traceRun({ ...g.memory.exports, ...exports }, patch); return evaluate(g); };
  assert.deepEqual(failing(withMemory({ active: '' })), ['memory trace answers Active Alloc']);
  assert.deepEqual(failing(withMemory({ leaks: csv([1200000, 6000000]) })), ['Memory Leaks finds the held allocation and not the freed one']);   // the freed array is reported as a leak
  assert.deepEqual(failing(withMemory({ leaks: csv([100, 200]) })), ['Memory Leaks finds the held allocation and not the freed one']);        // the held array is missing
  assert.deepEqual(failing(withMemory({ limited: csv([300000, 6291456]) })), ['Limited Lifetime finds the freed allocation']);
  const g = good();
  g.control = { ...g.control, exports: { active: csv([64, 128]), leaks: '', limited: '' } };
  assert.deepEqual(failing(evaluate(g)), ['a trace without the memory channel answers nothing']);
  const h = good();
  h.control = undefined;
  assert.deepEqual(failing(evaluate(h)), ['a trace without the memory channel answers nothing']);
});

test('observations never fail and the summary counts only the counted checks', () => {
  const checks = evaluate({ ...good(), control: undefined });
  assert.ok(checks.every((c) => !c.info || c.pass));
  assert.equal(summarize(checks).total, checks.filter((c) => !c.info).length);
});
