// Pure checks for probe_timeout.mjs: judge how probe.mjs behaves when the editor is still running at its --timeout. No Unreal, no files, no processes, no dependencies.
//   A run is { exit, stdout, stderr, elapsedMs, reportExists, report, logText } as the runner measures it from a child `node probe.mjs ...`.
// The expectations come from probe.mjs and probe-checks.mjs (exit 1, missingReportMessage with timedOut) and from the Node documentation of spawnSync's timeout
// (the child is killed, the call returns). Whether the editor and its helper processes really end is the thing a first run on an engine shows.

export const HOLD_LOG_MARKER = '[hang_probe] holding for';

/** Process entries from PowerShell's `ConvertTo-Json` output: nothing, one object or an array become an array of { pid, name }. */
export function parseProcessJson(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return [];
  let value;
  try { value = JSON.parse(trimmed); } catch { return []; }
  const rows = Array.isArray(value) ? value : [value];
  return rows.filter((r) => r && typeof r === 'object')
    .map((r) => ({ pid: Number(r.ProcessId ?? r.pid), name: String(r.Name ?? r.name ?? '') }))
    .filter((r) => Number.isFinite(r.pid));
}

/**
 * @param {{ control?: object, timeout?: object, leftovers?: {pid:number,name:string}[], timeoutMs: number, graceMs?: number, reportPath?: string, logPath?: string, controlSeconds?: number }} r
 * @returns {{ name: string, claim: string, pass: boolean, detail: string }[]}
 */
export function evaluateTimeout(r) {
  const { control = {}, timeout = {}, leftovers = [], timeoutMs, graceMs = 20000, reportPath, logPath, controlSeconds = 3 } = r ?? {};
  const out = [];
  const check = (name, claim, pass, detail = '') => out.push({ name, claim, pass: Boolean(pass), detail: String(detail) });
  const held = control.report?.[String(controlSeconds)];

  check('a hold shorter than the limit finishes and writes its report',
    'With a --timeout far above the hold, probe.mjs exits 0 and the hang probe report has slept_seconds for the requested hold',
    control.exit === 0 && control.reportExists === true && typeof held?.slept_seconds === 'number' && held.slept_seconds >= controlSeconds - 0.5,
    `exit ${control.exit}; report ${control.reportExists ? 'written' : 'missing'}; slept ${held?.slept_seconds}`);

  check('the editor was running the script when the limit passed',
    `The editor log of the timed-out run has "${HOLD_LOG_MARKER}", so the launcher cut off a script in progress and not a start-up`,
    String(timeout.logText ?? '').includes(HOLD_LOG_MARKER), logPath ? `log ${logPath}` : 'no log path');

  check('the launcher exits 1 when the limit passes first',
    'probe.mjs fails with exit code 1, not 0 (a report) and not 2 (a usage error)', timeout.exit === 1, `exit ${timeout.exit}`);

  const stderr = String(timeout.stderr ?? '');
  check('the failure message names the limit, the report and the log',
    'stderr says the probe wrote no report because the editor did not finish before the time limit, and names the report path and the Editor log path',
    /wrote no report/.test(stderr) && /did not finish before the time limit/.test(stderr) && (!reportPath || stderr.includes(reportPath))
      && /Editor log: \S/.test(stderr) && (!logPath || stderr.includes(logPath)),
    stderr.trim().split(/\r?\n/)[0] || 'stderr is empty');

  check('the timed-out run left no report',
    'No report file exists after the launcher gave up', timeout.reportExists === false, `report ${timeout.reportExists ? 'exists' : 'absent'}`);

  const elapsed = Number(timeout.elapsedMs);
  check('the launcher returned at the limit',
    `probe.mjs returned between the limit (${timeoutMs} ms) and the limit plus ${graceMs} ms`,
    Number.isFinite(elapsed) && elapsed >= timeoutMs - 500 && elapsed <= timeoutMs + graceMs, `${Number.isFinite(elapsed) ? Math.round(elapsed) : elapsed} ms`);

  check('no editor process naming the project is left running',
    'After the launcher returned, no process whose command line names the throwaway project exists',
    leftovers.length === 0, leftovers.length ? leftovers.map((p) => `${p.name} (pid ${p.pid})`).join(', ') : 'none');
  return out;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}
