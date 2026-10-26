// node --test examples/unreal/editor_probes/probe-timeout.test.mjs  (no Unreal, no dependencies)
// The runs below are what probe.mjs and hang_probe.py are written to produce; they are not observations. The shape (exit code, stderr text from missingReportMessage, report
// from hang_probe.py) is an assumption until probe_timeout.mjs has run on an engine: the first run confirms it. Each test changes one fact and expects the matching check to fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTimeout, parseProcessJson, summarize, HOLD_LOG_MARKER } from './probe-timeout-checks.mjs';
import { missingReportMessage } from './probe-checks.mjs';

const REPORT = 'C:\\t\\probe-timeout-x\\timeout.json';
const LOG = 'C:\\t\\probe-timeout-x\\Saved\\Logs\\timeout.log';
const good = () => ({
  timeoutMs: 60000, reportPath: REPORT, logPath: LOG, controlSeconds: 3,
  control: { exit: 0, reportExists: true, report: { 3: { status: 'found', requested_seconds: 3, slept_seconds: 3.0 } } },
  timeout: {
    exit: 1, elapsedMs: 60250, reportExists: false, logText: `LogPython: ${HOLD_LOG_MARKER} 600 s\n`,
    stderr: `${missingReportMessage({ probe: 'hang', report: REPORT, logPath: LOG, timedOut: true })}\n`,
  },
  leftovers: [],
});
const failing = (r) => evaluateTimeout(r).filter((c) => !c.pass).map((c) => c.name);
const mutate = (fn) => { const r = good(); fn(r); return failing(r); };
const MESSAGE = 'the failure message names the limit, the report and the log';
const HOLD = 'a hold shorter than the limit finishes and writes its report';

test('the expected run passes every check', () => {
  assert.deepEqual(failing(good()), []);
  const checks = evaluateTimeout(good());
  assert.deepEqual(summarize(checks), { passed: 7, total: 7 });
});

test('a control run that fails or holds too briefly fails the first check', () => {
  assert.deepEqual(mutate((r) => { r.control.exit = 1; }), [HOLD]);
  assert.deepEqual(mutate((r) => { r.control.reportExists = false; }), [HOLD]);
  assert.deepEqual(mutate((r) => { r.control.report[3].slept_seconds = 0.2; }), [HOLD]);
  assert.deepEqual(mutate((r) => { r.control.report = {}; }), [HOLD]);
});

test('a timeout that hit before the script started is not counted as a script in progress', () => {
  assert.deepEqual(mutate((r) => { r.timeout.logText = 'LogInit: starting\n'; }), ['the editor was running the script when the limit passed']);
  assert.deepEqual(mutate((r) => { r.timeout.logText = undefined; }), ['the editor was running the script when the limit passed']);
});

test('the launcher must exit 1, with the limit, the report and the log in its message', () => {
  assert.deepEqual(mutate((r) => { r.timeout.exit = 0; }), ['the launcher exits 1 when the limit passes first']);
  assert.deepEqual(mutate((r) => { r.timeout.exit = 2; }), ['the launcher exits 1 when the limit passes first']);
  assert.deepEqual(mutate((r) => { r.timeout.stderr = `${missingReportMessage({ probe: 'hang', report: REPORT, logPath: LOG, exit: 0 })}\n`; }), [MESSAGE]);
  assert.deepEqual(mutate((r) => { r.timeout.stderr = `probe "hang" wrote no report: the editor did not finish before the time limit and ${REPORT} does not exist.\n`; }), [MESSAGE]);
  assert.deepEqual(mutate((r) => { r.timeout.stderr = ''; }), [MESSAGE]);
});

test('a report that exists after the timeout, or a launcher that returned late or early, fails', () => {
  assert.deepEqual(mutate((r) => { r.timeout.reportExists = true; }), ['the timed-out run left no report']);
  assert.deepEqual(mutate((r) => { r.timeout.elapsedMs = 95000; }), ['the launcher returned at the limit']);
  assert.deepEqual(mutate((r) => { r.timeout.elapsedMs = 12000; }), ['the launcher returned at the limit']);
  assert.deepEqual(mutate((r) => { r.timeout.elapsedMs = undefined; }), ['the launcher returned at the limit']);
});

test('a process left naming the project fails the last check and is named', () => {
  const r = good();
  r.leftovers = [{ pid: 4242, name: 'UnrealEditor.exe' }];
  assert.deepEqual(failing(r), ['no editor process naming the project is left running']);
  assert.match(evaluateTimeout(r).at(-1).detail, /UnrealEditor\.exe \(pid 4242\)/);
});

test('process JSON from PowerShell is read as nothing, one object or an array', () => {
  assert.deepEqual(parseProcessJson(''), []);
  assert.deepEqual(parseProcessJson('not json'), []);
  assert.deepEqual(parseProcessJson('{"ProcessId":12,"Name":"UnrealEditor.exe"}'), [{ pid: 12, name: 'UnrealEditor.exe' }]);
  assert.deepEqual(parseProcessJson('[{"ProcessId":1,"Name":"a"},{"ProcessId":2,"Name":"b"}]'), [{ pid: 1, name: 'a' }, { pid: 2, name: 'b' }]);
  assert.deepEqual(parseProcessJson('[null,{"Name":"x"}]'), []);
});

test('an empty input fails the checks that need a run instead of throwing', () => {
  const checks = evaluateTimeout({ timeoutMs: 1000 });
  assert.equal(checks.length, 7);
  assert.equal(checks.filter((c) => c.pass).length, 1);   // "no process left" holds vacuously when nothing was listed
  assert.doesNotThrow(() => evaluateTimeout(undefined));
});
