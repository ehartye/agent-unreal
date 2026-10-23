// node --test examples/unreal/insights_capture/insights-capture.test.mjs  (no Unreal, no dependencies)
// The CSV headers, the Trace.Status block and the log lines below have the shape Unreal 5.8.2 and UnrealInsights wrote. Each test changes one
// fact and expects the matching check to fail, so the judge cannot pass by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, percentile, summarizeFrames, budgetVerdict, frameTimesMs, timerRow, traceStatus, exportErrors, evaluate, summarize, STATS_COLUMNS } from './insights-capture-checks.mjs';

test('parseCsv reads a header, rows and quoted fields', () => {
  const t = parseCsv('Name,Count\r\n"a,b",2\nplain,3\n');
  assert.deepEqual(t.header, ['Name', 'Count']);
  assert.deepEqual(t.rows, [{ Name: 'a,b', Count: '2' }, { Name: 'plain', Count: '3' }]);
  assert.deepEqual(parseCsv(''), { header: [], rows: [] });
});

test('percentile is nearest rank', () => {
  const ten = [10, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  assert.equal(percentile(ten, 50), 5);
  assert.equal(percentile(ten, 90), 9);
  assert.equal(percentile(ten, 99), 10);
  assert.equal(percentile(ten, 100), 10);
  assert.equal(percentile(ten, 0.1), 1);
  assert.ok(Number.isNaN(percentile([], 99)));
  // 121 values with the two slowest at 40 and 50: the 99th is the 120th value.
  const v = [...Array(119).fill(4), 40, 50];
  assert.equal(percentile(v, 99), 40);
  assert.equal(percentile(v, 98), 4);
});

test('the mean hides a stall that the high percentile and the maximum show', () => {
  const frames = [...Array(98).fill(4), 30, 31];
  const s = summarizeFrames(frames);
  assert.equal(s.frames, 100);
  assert.ok(s.mean < 5 && s.p50 === 4 && s.pHigh === 30 && s.max === 31);
  assert.deepEqual(budgetVerdict(s, 8.33), { budgetMs: 8.33, pass: false, highOk: false, maxOk: false, meanOk: true });
  const flat = summarizeFrames(Array(100).fill(4));
  assert.equal(budgetVerdict(flat, 8.33).pass, true);
  assert.equal(budgetVerdict({ frames: 0 }, 8.33).pass, false);
});

// Builds the two CSV exports for a window whose full frames last `ms` milliseconds, with the two partial edge frames.
const EDGE = [1.3, 14.2];
function exportsFor(ms, { edge = EDGE, timer = 'FEngineLoop::Tick' } = {}) {
  const all = [edge[0], ...ms, edge[1]];
  let t = 8.8526;
  const rows = all.map((d) => { const start = t; t += d / 1000 + 0.0000004; return `GameThread,${timer},${start.toFixed(7)},${(start + d / 1000).toFixed(7)},${(d / 1000).toFixed(9)},0`; });
  rows.splice(2, 0, `RenderThread 0,${timer},9.0,9.1,0.100000000,0`); // another thread is not a frame
  const events = ['ThreadName,TimerName,StartTime,EndTime,Duration,Depth', ...rows].join('\n') + '\n';
  const incl = (ms.reduce((a, b) => a + b, 0) + edge[0] * 0.4 + edge[1] * 0.6) / 1000;
  const max = Math.max(...ms) / 1000;
  const stats = [STATS_COLUMNS.join(','),
    `${timer},${all.length},${all.length}.000000,${incl.toFixed(6)},0.000081,${max.toFixed(6)},0.004461,0.003867,0.001047,0.000001,0.000012,0.000009,0.000009`,
    'Frame,121,121.000000,0.538735,0.000080,0.034140,0.004452,0.003865,0.000386,0.000000,0.000005,0.000003,0.000003'].join('\n') + '\n';
  return { events, stats };
}
const window119 = () => { const ms = Array(119).fill(0).map((_, i) => 3.5 + (i % 7) * 0.2); ms[39] = 34.1; ms[79] = 34.3; return ms; };

test('frameTimesMs converts seconds, keeps one thread and drops the partial edge frames', () => {
  const ms = window119();
  const { events } = exportsFor(ms);
  const r = frameTimesMs(events);
  assert.equal(r.ok, true);
  assert.equal(r.ms.length, 119);
  assert.equal(r.all.length, 121);
  assert.ok(Math.abs(r.ms[39] - 34.1) < 1e-6);
  assert.equal(frameTimesMs(events, { dropBoundary: false }).ms.length, 121);
  assert.equal(frameTimesMs(events, { timer: 'Other' }).ok, false);
  assert.equal(frameTimesMs('Id,Name\n1,a\n').ok, false);
});

test('timerRow reads one row as numbers in seconds', () => {
  const { stats } = exportsFor(window119());
  const { header, row } = timerRow(stats);
  assert.deepEqual(header, STATS_COLUMNS);
  assert.equal(row.Count, 121);
  assert.ok(row['I.Max'] > 0.034 && row['I.Max'] < 0.035);
  assert.equal(timerRow(stats, 'Missing').row, undefined);
});

const STATUS = [
  '[2026.10.23-21.31.24:156][ 31]LogConsoleResponse: Display: Trace status ----------------------------------------------------------',
  "[2026.10.23-21.31.24:156][ 31]LogConsoleResponse: Display: Connection: Tracing to 'C:/Temp/Traces/run1.utrace', session E333 trace 0000",
  '[2026.10.23-21.31.24:156][ 32]LogConsoleResponse: Display: Enabled channels: Region, Bookmark, Frame, Cpu, Counters',
  '[2026.10.23-21.31.24:698][155]LogConsoleResponse: Display: Trace status ----------------------------------------------------------',
  "[2026.10.23-21.31.24:698][155]LogConsoleResponse: Display: Connection: Tracing to 'C:/Temp/Traces/run1.utrace', session E333 trace 6BBB",
  '[2026.10.23-21.31.24:698][155]LogConsoleResponse: Display: Enabled channels: Region, Bookmark, Frame, Cpu, Counters',
].join('\n');

test('traceStatus reads the file and channels; exportErrors finds only error lines', () => {
  const s = traceStatus(STATUS);
  assert.equal(s.statuses, 2);
  assert.equal(s.file, 'C:/Temp/Traces/run1.utrace');
  assert.deepEqual(s.channels, ['Region', 'Bookmark', 'Frame', 'Cpu', 'Counters']);
  assert.deepEqual(traceStatus("Display: Trace status ---\nDisplay: Connection: Not tracing\n").file, undefined);
  assert.deepEqual(traceStatus('').channels, []);
  const log = '[2026.10.23-21.24.27:402][  1]TimingInsights: Error: Unable to find any region with name pattern \'NoSuchRegion\'.\n[2026.10.23-21.24.27:402][  1]TraceInsights: Display: ok\nLogTraceServices: Error: [MemAlloc] Invalid Tag on Thread 2 (Tracker=0)!';
  assert.equal(exportErrors(log).length, 1);
  assert.match(exportErrors(log)[0], /NoSuchRegion/);
});

const run = (name = 'run1', ms = window119(), extra = {}) => {
  const { events, stats } = exportsFor(ms);
  return {
    name, editorExit: 0, trace: { size: 2457162 }, editorLog: STATUS, insightsExit: 0,
    insightsLog: "TraceInsights: Display: Detected 1 regions in 0.000s.\nTraceInsights: Display: Exporting timing statistics for region 'Measured'",
    report: { frames: 120, spikeMs: 30, spikes: 2, pauseFor: 0, commands: ['Trace.File C:/Temp/Traces/run1.utrace', 'Trace.Status', 'Trace.Bookmark MeasuredBegin', 'Trace.RegionBegin Measured', 'Trace.RegionEnd Measured', 'Trace.Bookmark MeasuredEnd', 'Trace.Status', 'Trace.Stop'] },
    stats, events, timersCsv: 'Id,Type,Name,File,Line\n0,CPU,<default>,,0\n', typoCsvExists: false, ...extra,
  };
};
const failing = (mutate) => { const runs = [run('run1'), run('run2', window119().map((v) => v * 1.05))]; mutate(runs); return evaluate({ runs }).filter((c) => !c.pass).map((c) => c.name); };

test('the real shape passes every check', () => {
  const checks = evaluate({ runs: [run('run1'), run('run2', window119().map((v) => v * 1.05))] });
  assert.deepEqual(checks.filter((c) => !c.pass), []);
  assert.equal(summarize(checks).passed, summarize(checks).total);
});

test('a missing trace file or a failed editor fails the first check', () => {
  assert.deepEqual(failing((r) => { r[0].trace.size = 0; }), ['trace written']);
  assert.deepEqual(failing((r) => { r[1].editorExit = 1; }), ['trace written']);
});

test('a trace that was never started fails the control check', () => {
  assert.deepEqual(failing((r) => { r[0].editorLog = 'Display: Trace status ---\nDisplay: Connection: Not tracing\n'; }), ['trace control']);
  assert.deepEqual(failing((r) => { r[0].editorLog = STATUS.replaceAll('Bookmark, ', ''); }), ['trace control']);
});

test('a trace started at launch needs no Trace.File command, a late one does', () => {
  const launch = (r) => { r.start = 'launch'; r.report.commands = r.report.commands.filter((c) => !c.startsWith('Trace.File ')); };
  assert.deepEqual(failing((r) => { launch(r[0]); launch(r[1]); }), []);
  assert.deepEqual(failing((r) => { r[0].report.commands = r[0].report.commands.filter((c) => !c.startsWith('Trace.File ')); }), ['trace control']);
});

test('markers out of order fail', () => {
  assert.deepEqual(failing((r) => { r[0].report.commands = ['Trace.File x.utrace', 'Trace.RegionBegin Measured', 'Trace.Bookmark MeasuredBegin', 'Trace.RegionEnd Measured', 'Trace.Bookmark MeasuredEnd']; }), ['markers issued']);
});

test('an export error or a bad exit fails the export check', () => {
  assert.deepEqual(failing((r) => { r[0].insightsLog += "\nTimingInsights: Error: Unable to find any region with name pattern 'Measured'."; }), ['headless export']);
  assert.deepEqual(failing((r) => { r[1].insightsExit = 3; }), ['headless export']);
});

test('the documentation spelling must export nothing and the real name must export', () => {
  assert.deepEqual(failing((r) => { r[0].typoCsvExists = true; }), ['command spelling']);
  assert.deepEqual(failing((r) => { r[0].timersCsv = ''; }), ['command spelling']);
});

test('other columns or a missing timer row fail the statistics check', () => {
  assert.deepEqual(failing((r) => { r[0].stats = r[0].stats.replace('I.Med', 'Median'); }), ['statistics columns']);
  assert.deepEqual(failing((r) => { r[0].stats = r[0].stats.replace('FEngineLoop::Tick', 'Other::Tick'); }).includes('statistics columns'), true);
});

test('a region that matched nothing fails', () => {
  assert.ok(failing((r) => { r[0].insightsLog = 'TraceInsights: Display: Detected 0 regions in 0.000s.'; }).includes('region matched'));
  assert.ok(failing((r) => { r[0].stats = STATS_COLUMNS.join(',') + '\n'; }).includes('region matched'));
});

test('a frame count that disagrees with the window fails', () => {
  const fewer = exportsFor(window119().slice(0, 100));
  assert.ok(failing((r) => { r[0].events = fewer.events; r[0].stats = fewer.stats; }).includes('frame times parsed'));
  assert.ok(failing((r) => { r[0].events = 'ThreadName,TimerName\n'; }).includes('frame times parsed'));
});

test('durations in milliseconds instead of seconds fail the units check', () => {
  assert.deepEqual(failing((r) => { r[0].stats = r[0].stats.replace(/^(FEngineLoop::Tick,\d+,[\d.]+,)([\d.]+)/m, (m, a, b) => `${a}${(Number(b) * 1000).toFixed(3)}`); }), ['units agree']);
});

test('a window that lost its stalls fails', () => {
  const flat = exportsFor(Array(119).fill(4));
  assert.deepEqual(failing((r) => { r[0].events = flat.events; r[0].stats = flat.stats; }), ['injected stalls found']);
});

test('repeated runs that disagree fail', () => {
  const slow = exportsFor(window119().map((v) => v * 2));
  assert.deepEqual(failing((r) => { r[1].events = slow.events; r[1].stats = slow.stats; }), ['repeat runs agree']);
});

test('the pause run keeps fewer events and is judged on that', () => {
  const kept = window119().slice(0, 99);
  const { events, stats } = exportsFor(kept);
  const pause = run('pause', kept, { events, stats, report: { ...run().report, pauseFor: 20 } });
  const runs = [run('run1'), run('run2', window119().map((v) => v * 1.05)), pause];
  assert.deepEqual(evaluate({ runs }).filter((c) => !c.pass), []);
  assert.ok(evaluate({ runs }).some((c) => c.name === 'pause drops events'));
  const unpaused = { ...pause, events: run().events, stats: run().stats };
  assert.ok(evaluate({ runs: [run(), run('run2'), unpaused] }).some((c) => c.name === 'pause drops events' && !c.pass));
});
