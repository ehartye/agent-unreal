// Judges what automation_reference.mjs collects. Pure functions, no Unreal; the node test feeds them data shaped like the reports and logs of
// automation_test.mjs's 5.8.2 runs. The log line formats are those in the engine source (AutomationControllerManager.cpp, AutomationCommandline.cpp).
// What no engine run has produced yet is marked in README.md ("Reference commands"): the Group: and ExcludeTest runs.
import { parseReport, verdict } from './automation_report.mjs';

export const REASON = 'DeliberateFailureKeptOutOfTheLane';

const judge = (run, filter) => {
  if (!run?.reportText) return { ok: false, reasons: ['no report file'], counts: {}, tests: [], report: undefined };
  try { const report = parseReport(run.reportText); return { ...verdict(report, { filter }), report }; } catch (e) { return { ok: false, reasons: [`unreadable: ${e.message}`], counts: {}, tests: [], report: undefined }; }
};

/** The exit code the engine prints in the final log line, or undefined when the line is missing. */
export function logExitCode(log) {
  const m = /\*\*\*\* TEST COMPLETE\. EXIT CODE: (-?\d+) \*\*\*\*/.exec(String(log ?? ''));
  return m ? Number(m[1]) : undefined;
}

/** Every "Test Completed. Result={...} Name={...} Path={...}" line: [{ result, name, path }]. */
export function completedTests(log) {
  return [...String(log ?? '').matchAll(/Test Completed\. Result=\{([^}]*)\} Name=\{([^}]*)\} Path=\{([^}]*)\}/g)].map((m) => ({ result: m[1], name: m[2], path: m[3] }));
}

const stateOf = (report, path) => (report?.tests ?? []).find((t) => t.fullTestPath === path);
const paths = (report) => (report?.tests ?? []).map((t) => t.fullTestPath).sort();

/** The config text the runner writes for the Group: runs and, later, for the exclusion run (shared with the runner so the two cannot drift). */
export function configText({ exclude = false } = {}) {
  const lines = [
    '[/Script/AutomationController.AutomationControllerSettings]',
    '+Groups=(Name="ProbePassing", Filters=((Contains="AgentUnrealProbe.Passing")))',
    '+Groups=(Name="ProbeAll", Filters=((Contains="AgentUnrealProbe.", MatchFromStart=true)))',
  ];
  if (exclude) lines.push('', '[AutomationTestExcludelist]', `+ExcludeTest=(Test="AgentUnrealProbe.DeliberateFailure",Reason="${REASON}",Warn=False)`);
  return lines.join('\n') + '\n';
}

/** input: { build, runs: { exactPass, exactFail, groupOne, groupAll, groupMissing, exclude, dataValidation } }, each run { exit, reportText, log } */
export function evaluate({ build, runs = {} }) {
  const checks = [];
  const add = (name, claim, pass, detail, info = false) => checks.push({ name, claim, pass: !!pass, detail, info });
  add('test module compiles', 'the simple tests build in the 5.8 editor target', build?.exit === 0 && /Result: Succeeded/.test(build?.log ?? ''), `exit ${build?.exit}`);

  const pass = judge(runs.exactPass, 'AgentUnrealProbe.Passing');
  const passLog = runs.exactPass?.log ?? '';
  add('the documented command shape runs a test', '-Unattended -NullRHI -ExecCmds="Automation RunTest <filter>;Quit" -ReportExportPath=<dir> runs the filtered test, writes the report and the process exits 0',
    pass.ok && pass.counts.succeeded === 1 && pass.counts.failed === 0 && runs.exactPass?.exit === 0, `verdict ok=${pass.ok} counts=${JSON.stringify(pass.counts)} exit ${runs.exactPass?.exit} ${pass.reasons.join('; ')}`);
  const done = completedTests(passLog);
  add('the log carries the documented lines', 'the log has "Test Started.", "Test Completed. Result={Success}" for the test and "**** TEST COMPLETE. EXIT CODE: 0 ****"',
    /Test Started\. Name=\{[^}]*\} Path=\{AgentUnrealProbe\.Passing\}/.test(passLog) && done.some((t) => t.result === 'Success' && t.path === 'AgentUnrealProbe.Passing') && logExitCode(passLog) === 0,
    `completed ${JSON.stringify(done)}; exit-code line ${logExitCode(passLog)}`);

  const fail = judge(runs.exactFail, 'AgentUnrealProbe.DeliberateFailure');
  add('a failing test makes the exit code non-zero', 'the same command shape on a failing test exits non-zero, prints a non-zero EXIT CODE line and the report counts failed 1',
    !fail.ok && fail.counts.failed === 1 && runs.exactFail?.exit !== 0 && runs.exactFail?.exit !== undefined && (logExitCode(runs.exactFail?.log) ?? 0) !== 0,
    `exit ${runs.exactFail?.exit}; exit-code line ${logExitCode(runs.exactFail?.log)}; counts ${JSON.stringify(fail.counts)}`);

  const one = judge(runs.groupOne);
  const all = judge(runs.groupAll);
  add('Group: selects the group', 'Group:<Name> from DefaultEngine.ini runs the tests whose filters match: one group a single test, another group both',
    JSON.stringify(paths(one.report)) === JSON.stringify(['AgentUnrealProbe.Passing']) && JSON.stringify(paths(all.report)) === JSON.stringify(['AgentUnrealProbe.DeliberateFailure', 'AgentUnrealProbe.Passing']),
    `group one ran ${JSON.stringify(paths(one.report))}; group all ran ${JSON.stringify(paths(all.report))}`);
  const missing = judge(runs.groupMissing);
  add('an unknown group does not look like a pass', 'a group name that is not in the config logs "No matching group named" and the run has no passing report',
    /No matching group named NoSuchGroup/.test(runs.groupMissing?.log ?? '') && !missing.ok, `log line ${/No matching group named NoSuchGroup/.test(runs.groupMissing?.log ?? '')}; report ${missing.ok ? 'ok' : (missing.reasons.join('; ') || 'none')}; exit ${runs.groupMissing?.exit}`);

  const excluded = judge(runs.exclude, 'AgentUnrealProbe');
  const skipped = stateOf(excluded.report, 'AgentUnrealProbe.DeliberateFailure');
  const reasonText = JSON.stringify(skipped?.entries ?? []);
  add('ExcludeTest skips a test with its reason', 'an excluded test reports state Skipped with the reason attached as an event, the other test passes and the run exits 0',
    skipped?.state === 'Skipped' && reasonText.includes(REASON) && stateOf(excluded.report, 'AgentUnrealProbe.Passing')?.state === 'Success' && runs.exclude?.exit === 0 && (excluded.report?.failed ?? 1) === 0,
    skipped ? `state ${skipped.state}; reason in events ${reasonText.includes(REASON)}; exit ${runs.exclude?.exit}; counts ${JSON.stringify(excluded.counts)}` : `no skipped test in the report (${excluded.reasons.join('; ') || 'report present'})`);

  const dv = runs.dataValidation;
  if (dv) add('observation: data validation commandlet', 'UnrealEditor-Cmd.exe <project> -run=DataValidation on a project with no assets (a smoke run: no validator fails here, so "failures print to the console" is not exercised)',
    true, `exit ${dv.exit}; error lines ${(String(dv.log ?? '').match(/Error:/g) ?? []).length}`, true);
  add('observation: counters of a skipped test', 'how the report counts a test that was excluded', true, `${JSON.stringify(excluded.counts)}`, true);
  return checks;
}

export function summarize(checks) {
  const counted = checks.filter((c) => !c.info);
  return { passed: counted.filter((c) => c.pass).length, total: counted.length };
}
