// node --test examples/unreal/automation_test/automation-reference.test.mjs  (no Unreal, no dependencies)
// The index.json shapes copy the 5.8.2 reports of automation_test.mjs (byte order mark included). The log lines copy the formats in the engine
// source (AutomationControllerManager.cpp, AutomationCommandline.cpp). The Skipped report is an assumption built from Epic's sample report: the
// first run confirms its shape (see README.md). Each test changes one fact and expects the matching check to change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize, logExitCode, completedTests, configText, REASON } from './automation-reference-checks.mjs';

const entry = (message, type = 'Error') => ({ event: { type, message, context: '', artifact: '00000000000000000000000000000000' }, filename: 'C:\\project\\Source\\AutomationProbe\\AutomationProbeTests.cpp', lineNumber: 25, timestamp: '2026.10.26-00.05.38' });
const testRow = (path, state, entries = []) => ({ testDisplayName: path.split('.').pop(), fullTestPath: path, tags: [], state, duration: 0.005, entries, warnings: 0, errors: state === 'Fail' ? entries.length : 0, artifacts: [] });
const report = (tests) => ({
  devices: [], reportCreatedOn: '2026.10.26-00.05.01', succeeded: tests.filter((t) => t.state === 'Success').length, succeededWithWarnings: 0,
  failed: tests.filter((t) => t.state === 'Fail').length, notRun: 0, inProcess: 0, totalDuration: 0.01, comparisonExported: false, comparisonExportDirectory: '', tests,
});
const text = (r) => '\uFEFF' + JSON.stringify(r, null, '\t');
const PASSING = testRow('AgentUnrealProbe.Passing', 'Success');
const FAILING = testRow('AgentUnrealProbe.DeliberateFailure', 'Fail', [entry("Expected 'two plus two is five' to be 5, but it was 4.")]);
const SKIPPED = testRow('AgentUnrealProbe.DeliberateFailure', 'Skipped', [entry(REASON, 'Info')]);
const logFor = (tests, exitCode) => [
  'LogAutomationCommandLine: Display: Automation: RunTests=\'AgentUnrealProbe\' Queued.',
  ...tests.flatMap(([n, p, r]) => [`LogAutomationController: Display: Test Started. Name={${n}} Path={${p}}`, `LogAutomationController: Display: Test Completed. Result={${r}} Name={${n}} Path={${p}}`]),
  `LogAutomationCommandLine: Display: **** TEST COMPLETE. EXIT CODE: ${exitCode} ****`,
].join('\n');
const passLog = logFor([['Passing', 'AgentUnrealProbe.Passing', 'Success']], 0);
const failLog = logFor([['DeliberateFailure', 'AgentUnrealProbe.DeliberateFailure', 'Fail']], -1);
const good = () => ({
  build: { exit: 0, log: 'Result: Succeeded\n' },
  runs: {
    exactPass: { exit: 0, reportText: text(report([PASSING])), log: passLog },
    exactFail: { exit: 255, reportText: text(report([FAILING])), log: failLog },
    groupOne: { exit: 0, reportText: text(report([PASSING])), log: passLog },
    groupAll: { exit: 255, reportText: text(report([FAILING, PASSING])), log: failLog },
    groupMissing: { exit: 0, reportText: '', log: 'LogAutomationCommandLine: Error: No matching group named NoSuchGroup' },
    exclude: { exit: 0, reportText: text(report([SKIPPED, PASSING])), log: logFor([['Passing', 'AgentUnrealProbe.Passing', 'Success'], ['DeliberateFailure', 'AgentUnrealProbe.DeliberateFailure', 'Skipped']], 0) },
    dataValidation: { exit: 0, log: 'LogInit: Display: done' },
  },
});
const failing = (checks) => checks.filter((c) => !c.pass && !c.info).map((c) => c.name);
const withRun = (name, patch) => { const g = good(); g.runs[name] = { ...g.runs[name], ...patch }; return evaluate(g); };

test('a good set of runs passes every counted check', () => {
  const checks = evaluate(good());
  assert.deepEqual(failing(checks), []);
  const { passed, total } = summarize(checks);
  assert.equal(passed, total);
  assert.equal(total, 7);
  assert.ok(checks.some((c) => c.info && /data validation/.test(c.name)));
});

test('logExitCode and completedTests read the engine log lines', () => {
  assert.equal(logExitCode(passLog), 0);
  assert.equal(logExitCode(failLog), -1);
  assert.equal(logExitCode('nothing'), undefined);
  assert.deepEqual(completedTests(passLog), [{ result: 'Success', name: 'Passing', path: 'AgentUnrealProbe.Passing' }]);
  assert.deepEqual(completedTests(''), []);
});

test('configText writes the groups, and the exclusion only when asked', () => {
  const plain = configText();
  assert.match(plain, /^\[\/Script\/AutomationController\.AutomationControllerSettings\]$/m);
  assert.match(plain, /\+Groups=\(Name="ProbePassing", Filters=\(\(Contains="AgentUnrealProbe\.Passing"\)\)\)/);
  assert.match(plain, /MatchFromStart=true/);
  assert.doesNotMatch(plain, /ExcludeTest/);
  const excluded = configText({ exclude: true });
  assert.match(excluded, /^\[AutomationTestExcludelist\]$/m);
  assert.match(excluded, new RegExp(`\\+ExcludeTest=\\(Test="AgentUnrealProbe\\.DeliberateFailure",Reason="${REASON}",Warn=False\\)`));
  assert.ok(!plain.includes('\r'));
});

test('a missing run or a missing report fails the checks that need it instead of throwing', () => {
  const none = evaluate({ build: undefined, runs: {} });
  for (const name of ['test module compiles', 'the documented command shape runs a test', 'the log carries the documented lines', 'a failing test makes the exit code non-zero',
    'Group: selects the group', 'ExcludeTest skips a test with its reason']) assert.ok(failing(none).includes(name), name);
  assert.deepEqual(failing(withRun('exactPass', { reportText: '' })), ['the documented command shape runs a test']);
});

test('each fact turns its own check red', () => {
  assert.deepEqual(failing(evaluate({ ...good(), build: { exit: 1, log: 'error' } })), ['test module compiles']);
  assert.deepEqual(failing(withRun('exactPass', { exit: 255 })), ['the documented command shape runs a test']);
  assert.deepEqual(failing(withRun('exactPass', { log: 'LogTemp: nothing' })), ['the log carries the documented lines']);
  assert.deepEqual(failing(withRun('exactPass', { log: passLog.replace('EXIT CODE: 0', 'EXIT CODE: -1') })), ['the log carries the documented lines']);
  assert.deepEqual(failing(withRun('exactFail', { exit: 0 })), ['a failing test makes the exit code non-zero']);
  assert.deepEqual(failing(withRun('exactFail', { log: passLog })), ['a failing test makes the exit code non-zero']);
  assert.deepEqual(failing(withRun('groupOne', { reportText: text(report([PASSING, FAILING])) })), ['Group: selects the group']);
  assert.deepEqual(failing(withRun('groupAll', { reportText: text(report([PASSING])) })), ['Group: selects the group']);
  assert.deepEqual(failing(withRun('groupMissing', { log: '' })), ['an unknown group does not look like a pass']);
  assert.deepEqual(failing(withRun('groupMissing', { reportText: text(report([PASSING])) })), ['an unknown group does not look like a pass']);
  assert.deepEqual(failing(withRun('exclude', { reportText: text(report([FAILING, PASSING])) })), ['ExcludeTest skips a test with its reason']);
  assert.deepEqual(failing(withRun('exclude', { reportText: text(report([testRow('AgentUnrealProbe.DeliberateFailure', 'Skipped', []), PASSING])) })), ['ExcludeTest skips a test with its reason']);
  assert.deepEqual(failing(withRun('exclude', { exit: 255 })), ['ExcludeTest skips a test with its reason']);
});

test('observations never fail and the summary counts only the counted checks', () => {
  const g = good();
  delete g.runs.dataValidation;
  const checks = evaluate(g);
  assert.deepEqual(failing(checks), []);
  assert.equal(summarize(checks).total, checks.filter((c) => !c.info).length);
});
