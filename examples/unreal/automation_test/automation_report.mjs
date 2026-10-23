// node automation_report.mjs <index.json> --filter AgentUnrealProbe [--min-tests 1] [--max-age-seconds 3600]
// Reads the automation report Unreal writes with -ReportExportPath=<dir> (<dir>/index.json) and decides whether the run passed.
// Exit code 0 only when every test in the report succeeded. The process exit code of the editor is not used: on 5.8.2 it was 0 for a
// failing run that used -TestExit and 255 for a failing run that ended with "; Quit". No dependencies.
import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/** Parse index.json text. The engine writes it with a UTF-8 byte order mark, which JSON.parse rejects. */
export function parseReport(text) {
  return JSON.parse(String(text).replace(/^\uFEFF/, ''));
}

/**
 * Judge a parsed report. `filter` is the prefix passed to "Automation RunTests"; every test in the report must start with it.
 * Returns { ok, reasons[], counts, tests[] }.
 */
export function verdict(report, { filter, minTests = 1 } = {}) {
  const reasons = [];
  const tests = Array.isArray(report?.tests) ? report.tests : null;
  if (!tests) return { ok: false, reasons: ['report has no tests array'], counts: {}, tests: [] };
  const counts = { succeeded: report.succeeded, succeededWithWarnings: report.succeededWithWarnings, failed: report.failed, notRun: report.notRun, inProcess: report.inProcess, listed: tests.length };
  for (const key of ['succeeded', 'failed', 'notRun', 'inProcess']) {
    if (!Number.isInteger(report[key])) reasons.push(`report field ${key} is missing`);
  }
  if (tests.length < minTests) reasons.push(`${tests.length} tests in the report; at least ${minTests} expected`);
  if (report.failed > 0) reasons.push(`${report.failed} failed`);
  if (report.notRun > 0) reasons.push(`${report.notRun} not run`);
  if (report.inProcess > 0) reasons.push(`${report.inProcess} still in process`);
  if (filter) {
    const stray = tests.filter((t) => !String(t.fullTestPath).startsWith(filter)).map((t) => t.fullTestPath);
    if (stray.length) reasons.push(`tests outside the filter ${filter}: ${stray.join(', ')}`);
  }
  const notPassing = tests.filter((t) => t.state !== 'Success');
  for (const t of notPassing) {
    const messages = (t.entries ?? []).map((e) => `${e.event?.message ?? ''} [${String(e.filename ?? '').split(/[\/]/).pop()}:${e.lineNumber}]`).join(' | ');
    reasons.push(`${t.fullTestPath} is ${t.state}${messages ? `: ${messages}` : ''}`);
  }
  return { ok: reasons.length === 0, reasons, counts, tests: tests.map((t) => ({ path: t.fullTestPath, state: t.state, errors: t.errors, warnings: t.warnings })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const file = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
  if (!file) { console.error('usage: node automation_report.mjs <index.json> --filter <prefix> [--min-tests n] [--max-age-seconds n]'); process.exit(2); }
  let result;
  try {
    const maxAge = flag('--max-age-seconds');
    if (maxAge && (Date.now() - statSync(file).mtimeMs) / 1000 > Number(maxAge)) result = { ok: false, reasons: [`report is older than ${maxAge} s`], counts: {}, tests: [] };
    else result = verdict(parseReport(readFileSync(file, 'utf8')), { filter: flag('--filter'), minTests: Number(flag('--min-tests') ?? 1) });
  } catch (e) {
    result = { ok: false, reasons: [`report unreadable: ${e.message}`], counts: {}, tests: [] };
  }
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
