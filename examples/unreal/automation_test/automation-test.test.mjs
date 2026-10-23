// node --test examples/unreal/automation_test/automation-test.test.mjs  (no Unreal, no dependencies)
// The reports below have the shape Unreal 5.8.2 wrote (UTF-8 byte order mark included; device details left out). The tests mutate one
// fact at a time and expect the verdict or the matching check to change, so the parser cannot accept a bad run by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseReport, verdict } from './automation_report.mjs';
import { evaluate, summarize } from './automation-test-checks.mjs';

const entry = { event: { type: 'Error', message: "Expected 'two plus two is five' to be 5, but it was 4.", context: '', artifact: '00000000000000000000000000000000' },
  filename: 'C:\\project\\Source\\AutomationProbe\\AutomationProbeTests.cpp', lineNumber: 25, timestamp: '2026.10.23-00.05.38' };
const test1 = (path, state, entries = []) => ({ testDisplayName: path.split('.').pop(), fullTestPath: path, tags: [], state, duration: 0.005, entries, warnings: 0, errors: entries.length, artifacts: [] });
const report = (tests, counts = {}) => ({
  devices: [], reportCreatedOn: '2026.10.23-00.05.01', succeeded: tests.filter((t) => t.state === 'Success').length, succeededWithWarnings: 0,
  failed: tests.filter((t) => t.state === 'Fail').length, notRun: 0, inProcess: 0, totalDuration: 0.01, comparisonExported: false, comparisonExportDirectory: '', tests, ...counts,
});
const text = (r) => '\uFEFF' + JSON.stringify(r, null, '\t');
const passing = report([test1('AgentUnrealProbe.Passing', 'Success')]);
const failing = report([test1('AgentUnrealProbe.DeliberateFailure', 'Fail', [entry])]);
const both = report([test1('AgentUnrealProbe.DeliberateFailure', 'Fail', [entry]), test1('AgentUnrealProbe.Passing', 'Success')]);

test('parseReport accepts the byte order mark the engine writes', () => {
  assert.equal(parseReport(text(passing)).succeeded, 1);
  assert.throws(() => JSON.parse(text(passing)));
});

test('verdict accepts a report of only successes inside the filter', () => {
  const v = verdict(parseReport(text(passing)), { filter: 'AgentUnrealProbe' });
  assert.equal(v.ok, true);
  assert.deepEqual(v.reasons, []);
});

test('verdict rejects a failed test and names the message and source line', () => {
  const v = verdict(parseReport(text(failing)), { filter: 'AgentUnrealProbe' });
  assert.equal(v.ok, false);
  assert.match(v.reasons.join('\n'), /1 failed/);
  assert.match(v.reasons.join('\n'), /DeliberateFailure is Fail: Expected 'two plus two is five'.*AutomationProbeTests\.cpp:25/);
});

test('verdict rejects zero tests, not-run and in-process tests, and tests outside the filter', () => {
  assert.match(verdict(report([]), { filter: 'AgentUnrealProbe' }).reasons.join(), /0 tests/);
  assert.equal(verdict(report([test1('AgentUnrealProbe.Passing', 'Success')], { notRun: 1 })).ok, false);
  assert.equal(verdict(report([test1('AgentUnrealProbe.Passing', 'Success')], { inProcess: 1 })).ok, false);
  assert.match(verdict(parseReport(text(passing)), { filter: 'Other.Suite' }).reasons.join(), /outside the filter/);
});

test('verdict rejects a test whose state is not Success even when the counters look clean', () => {
  const odd = report([test1('AgentUnrealProbe.Passing', 'NotRun')], { failed: 0, succeeded: 1 });
  assert.equal(verdict(odd, { filter: 'AgentUnrealProbe' }).ok, false);
});

test('verdict rejects a document that is not a report', () => {
  assert.equal(verdict({}).ok, false);
  assert.equal(verdict({ tests: [] , succeeded: 0}).ok, false);
});

test('the command line exits 0 for a passing report and 1 for a failing, missing or unreadable one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'automation-report-'));
  try {
    const file = join(dir, 'index.json');
    const run = (...extra) => spawnSync(process.execPath, [join(import.meta.dirname, 'automation_report.mjs'), file, '--filter', 'AgentUnrealProbe', ...extra], { encoding: 'utf8' });
    writeFileSync(file, text(passing));
    assert.equal(run().status, 0);
    writeFileSync(file, text(failing));
    assert.equal(run().status, 1);
    writeFileSync(file, '{ not json');
    assert.equal(run().status, 1);
    writeFileSync(file, text(passing));
    assert.equal(run('--max-age-seconds', '-1').status, 1);
    rmSync(file);
    assert.equal(run().status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const good = () => ({
  build: { exit: 0, log: 'Result: Succeeded' },
  badBuild: { exit: 6, log: "AutomationProbeTests.cpp(38,1): error C2838: 'Type': illegal qualified name in member declaration\nerror C2338: static_assert failed: 'All AutomationTests must have exactly 1 filter type specified.  See AutomationTest.h.'\nerror C2338: static_assert failed: 'AutomationTest has no application flag.  It shouldn't run.  See AutomationTest.h.'" },
  runs: {
    quitPass: { exit: 0, reportText: text(passing), log: '' },
    quitFail: { exit: 255, reportText: text(failing), log: '' },
    exitFail: { exit: 0, reportText: text(both), log: '' },
    editorBoth: { exit: 255, reportText: text(both), log: '' },
    noMatch: { exit: 255, reportText: '', log: "LogAutomationCommandLine: Error: No automation tests matched 'AgentUnrealProbe.Nothing'" },
  },
});
const failedNames = (input) => evaluate(input).filter((c) => !c.pass).map((c) => c.name);

test('every check passes on the 5.8.2 results', () => {
  const checks = evaluate(good());
  assert.deepEqual(failedNames(good()), []);
  assert.deepEqual(summarize(checks), { passed: 9, total: 9 });
});

test('each check fails when its fact changes', () => {
  let g = good(); g.build.exit = 1;
  assert.deepEqual(failedNames(g), ['test module compiles']);
  g = good(); g.badBuild.exit = 0; g.badBuild.log = '';
  assert.deepEqual(failedNames(g), ['old flag style is rejected']);
  g = good(); g.runs.quitFail.reportText = text(passing);
  assert.ok(failedNames(g).includes('failing test reported as failed'));
  g = good(); g.runs.exitFail.exit = 255;
  assert.deepEqual(failedNames(g), ['-TestExit run with a failing test']);
  g = good(); g.runs.noMatch.reportText = text(passing);
  assert.deepEqual(failedNames(g), ['a filter that matches nothing']);
  g = good(); g.runs.quitPass.exit = 1;
  assert.deepEqual(failedNames(g), ['passing run exit code']);
});
