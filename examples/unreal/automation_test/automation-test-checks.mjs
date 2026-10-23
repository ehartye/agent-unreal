// Judges what automation_test.mjs collected. Pure functions, no Unreal; the node test feeds them data shaped like the 5.8.2 runs.
import { parseReport, verdict } from './automation_report.mjs';

const judge = (run, filter) => {
  if (!run?.reportText) return { ok: false, reasons: ['no report file'], counts: {}, tests: [], report: undefined };
  try { const report = parseReport(run.reportText); return { ...verdict(report, { filter }), report }; } catch (e) { return { ok: false, reasons: [`unreadable: ${e.message}`], counts: {}, tests: [] }; }
};

/** input: { build, badBuild, runs: { quitPass, quitFail, exitFail, editorBoth, noMatch } } */
export function evaluate({ build, badBuild, runs }) {
  const checks = [];
  const add = (name, claim, pass, detail) => checks.push({ name, claim, pass: !!pass, detail });
  add('test module compiles', 'a simple test with EditorContext | ProductFilter builds in the 5.8 editor target',
    build?.exit === 0 && /Result: Succeeded/.test(build?.log ?? ''), `exit ${build?.exit}`);

  const log = badBuild?.log ?? '';
  add('old flag style is rejected', 'EAutomationTestFlags::Type does not compile; a missing filter or context flag fails a static_assert',
    badBuild?.exit !== 0 && /C2838: 'Type': illegal qualified name/.test(log) && /exactly 1 filter type specified/.test(log) && /no application flag/.test(log),
    `exit ${badBuild?.exit}; Type error ${/C2838/.test(log)}, filter assert ${/exactly 1 filter/.test(log)}, context assert ${/no application flag/.test(log)}`);

  const pass = judge(runs.quitPass, 'AgentUnrealProbe.Passing');
  add('passing test reported as success', 'the report lists the test as Success with failed 0 and the verdict is ok',
    pass.ok && pass.counts.succeeded === 1 && pass.counts.failed === 0, `verdict ok=${pass.ok} counts=${JSON.stringify(pass.counts)} reasons=${pass.reasons.join('; ')}`);
  add('passing run exit code', 'the "; Quit" form exits 0 when the test passes', runs.quitPass?.exit === 0, `exit ${runs.quitPass?.exit}`);

  const fail = judge(runs.quitFail, 'AgentUnrealProbe.DeliberateFailure');
  const failed = fail.report?.tests?.[0];
  add('failing test reported as failed', 'the report counts failed 1, state Fail, with the message and source line, and the verdict rejects it',
    !fail.ok && fail.counts.failed === 1 && failed?.state === 'Fail' && /five/.test(failed?.entries?.[0]?.event?.message ?? '') && failed?.entries?.[0]?.lineNumber > 0,
    `verdict ok=${fail.ok} counts=${JSON.stringify(fail.counts)} state=${failed?.state} message=${failed?.entries?.[0]?.event?.message} line=${failed?.entries?.[0]?.lineNumber}`);
  add('exit code of a failing "; Quit" run', 'recorded: the "; Quit" form exits non-zero for a failing run', runs.quitFail?.exit !== 0 && runs.quitFail?.exit !== undefined, `exit ${runs.quitFail?.exit}`);

  const both = judge(runs.exitFail, 'AgentUnrealProbe');
  add('-TestExit run with a failing test', 'with -TestExit the process exit code is 0 while the report counts the failure (the report is the verdict)',
    runs.exitFail?.exit === 0 && !both.ok && both.counts.failed === 1 && both.counts.succeeded === 1, `exit ${runs.exitFail?.exit}; verdict ok=${both.ok} counts=${JSON.stringify(both.counts)}`);

  const editor = judge(runs.editorBoth, 'AgentUnrealProbe');
  add('UnrealEditor.exe gives the same report', 'the editor binary with -nullrhi runs the same filter and reports the same counts as UnrealEditor-Cmd.exe',
    !editor.ok && editor.counts.failed === 1 && editor.counts.succeeded === 1, `exit ${runs.editorBoth?.exit}; counts=${JSON.stringify(editor.counts)}`);

  const none = judge(runs.noMatch, 'AgentUnrealProbe');
  add('a filter that matches nothing', 'no report file is written, the log says no tests matched, and the verdict rejects it',
    !runs.noMatch?.reportText && /No automation tests matched/.test(runs.noMatch?.log ?? '') && !none.ok, `exit ${runs.noMatch?.exit}; report written ${!!runs.noMatch?.reportText}`);
  return checks;
}

export const summarize = (checks) => ({ passed: checks.filter((c) => c.pass).length, total: checks.length });
