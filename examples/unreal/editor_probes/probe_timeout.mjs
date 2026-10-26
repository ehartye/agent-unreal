// node probe_timeout.mjs --engine "<UE_5.8 folder>" [--timeout-ms 60000] [--keep]
// Tries probe.mjs under its --timeout. It makes a throwaway project in the OS temp folder (PythonScriptPlugin, EditorScriptingUtilities) and runs the launcher twice:
//   control  --probe hang --hold 3: the hold ends before the limit, so the launcher must exit 0 with a report (this also pays for the project's slow first start)
//   timeout  --probe hang --hold 600 --timeout <timeout-ms>: the limit passes first, so the launcher must exit 1, say that the editor did not finish before the time limit,
//            name the report and the editor log, leave no report, return at the limit, and leave no process that names the project
// then judges both with probe-timeout-checks.mjs, stops any process still naming the project, and deletes the folder after a clean run. Exit code 0 when every check passes.
// Prepared, not yet run on an engine. Takes about two minutes: the first editor start (60 to 80 s), the control (15 to 20 s), then the limit (default 60 s).
// Windows only for the process listing; on another platform the leftover check lists nothing and says so. No dependencies. Not part of node scripts/check.mjs; the checks are tested there.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOLD_LOG_MARKER, evaluateTimeout, parseProcessJson, summarize } from './probe-timeout-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node probe_timeout.mjs --engine <UE_5.8 folder> [--timeout-ms 60000] [--keep]'); process.exit(2); }
const timeoutMs = Number(flag('--timeout-ms')) || 60000;
if (timeoutMs < 20000) { console.error('--timeout-ms must be at least 20000: the editor needs time to start before the hold can begin'); process.exit(2); }

const here = import.meta.dirname;
const launcher = join(here, 'probe.mjs');
const root = mkdtempSync(join(tmpdir(), 'probe-timeout-'));
const project = join(root, 'ProbeTimeout.uproject');
writeFileSync(project, JSON.stringify({
  FileVersion: 3, EngineAssociation: '5.8',
  Plugins: ['PythonScriptPlugin', 'EditorScriptingUtilities'].map((Name) => ({ Name, Enabled: true })),
}, null, 2));
const saved = join(root, 'Saved');
mkdirSync(join(saved, 'Logs'), { recursive: true });
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');

/** Runs probe.mjs as a child and measures what the caller of the launcher sees. */
function runLauncher(label, hold, limitMs) {
  const report = join(saved, `${label}.json`), log = join(saved, 'Logs', `${label}.log`);
  console.log(`  ${label}: hold ${hold} s, launcher --timeout ${limitMs} ms`);
  const started = Date.now();
  const result = spawnSync(process.execPath, [launcher, '--engine', engine, '--project', project, '--probe', 'hang', '--hold', String(hold),
    '--report', report, '--log', log, '--timeout', String(limitMs)],
  { encoding: 'utf8', windowsHide: true, timeout: limitMs + 180000 });
  const elapsedMs = Date.now() - started;
  console.log(`  ${label}: launcher exit ${result.status}, ${Math.round(elapsedMs / 1000)} s`);
  let parsed;
  try { parsed = existsSync(report) ? JSON.parse(readText(report)) : undefined; } catch { parsed = undefined; }
  return { exit: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', elapsedMs, reportExists: existsSync(report), report: parsed, logText: readText(log), reportPath: report, logPath: log };
}

/** Processes whose command line names the throwaway project, other than the shell that asks. Windows only. */
function projectProcesses() {
  if (process.platform !== 'win32') return null;
  const needle = root.replace(/'/g, "''");
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle}') -and $_.ProcessId -ne $PID } | Select-Object ProcessId,Name | ConvertTo-Json -Compress`;
  const result = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true });
  return parseProcessJson(result.stdout);
}

console.log(`Launcher timeout validation in ${root}`);
const control = runLauncher('control', 3, 600000);
const timedOut = runLauncher('timeout', 600, timeoutMs);
const listed = projectProcesses();
if (listed === null) console.log('  process listing is Windows only; the leftover check lists nothing here');
const leftovers = listed ?? [];
for (const p of leftovers) spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });

const checks = evaluateTimeout({ control, timeout: timedOut, leftovers, timeoutMs, reportPath: timedOut.reportPath, logPath: timedOut.logPath, controlSeconds: 3 });
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (!timedOut.logText.includes(HOLD_LOG_MARKER)) console.log(`  note: the timed-out run's log has no "${HOLD_LOG_MARKER}" line; raise --timeout-ms if the editor was still starting`);
if (keep || passed !== total) console.log(`kept ${root} (editor logs in Saved/Logs)`);
else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
