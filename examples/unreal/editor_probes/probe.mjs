// node probe.mjs --engine "<UE_5.8 folder>" --project <Project.uproject> --probe doc|system|asset --report <report.json>
//                [--callables a,b] [--systems /Game/FX/NS_X] [--modules Emitter:Module] [--assets /Game/A,/Game/B] [--timeout ms] [--log <file>]
// Starts the editor hidden (no render, no window) with -ExecutePythonScript, hands the names to the probe script through environment
// variables, and waits for it to end: the editor shuts down when the script does. It deletes an old report first, so a report that exists
// afterwards was written by this run. It exits 1 and names the editor log when no report was written or the report is malformed.
// No dependencies. The pure parts (arguments, report shape, failure message) are in probe-checks.mjs and tested without Unreal.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PROBES, buildLaunch, checkReport, editorPath, missingReportMessage, summarizeReport } from './probe-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const fail = (message, code = 1) => { console.error(message); process.exit(code); };

const probe = flag('--probe');
const spec = PROBES[probe];
if (!spec) fail(`usage: node probe.mjs --engine <UE folder> --project <.uproject> --probe ${Object.keys(PROBES).join('|')} --report <file> ${Object.values(PROBES).map((p) => `[${p.flag} names]`).join(' ')}`, 2);
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) fail('--engine <UE_5.8 folder> (or UE_ROOT) is required', 2);
const editor = editorPath(engine);
if (!existsSync(editor)) fail(`not found: ${editor}`, 2);

const report = flag('--report') && resolve(flag('--report'));
const project = flag('--project') && resolve(flag('--project'));
const logPath = resolve(flag('--log') || (project ? `${dirname(project)}/Saved/Logs/probe-${probe}.log` : 'probe.log'));
const extras = Object.fromEntries(spec.extras.map((e) => [e.env, flag(e.flag) ?? process.env[e.env]]));
let launch;
try {
  launch = buildLaunch({ probe, project, report, logPath, scriptDir: import.meta.dirname, names: flag(spec.flag) ?? process.env[spec.input], extras });
} catch (error) { fail(error.message, 2); }

mkdirSync(dirname(report), { recursive: true });
mkdirSync(dirname(logPath), { recursive: true });
rmSync(report, { force: true });
const result = spawnSync(editor, launch.args, {   // node quotes an argument that has a space, which the editor reads correctly
  env: { ...process.env, ...launch.env }, stdio: 'ignore', windowsHide: true,
  timeout: Number(flag('--timeout')) || 600000,
});
const timedOut = result.error?.code === 'ETIMEDOUT';
if (!existsSync(report)) {
  fail(missingReportMessage({ probe, report, logPath, exit: result.status, timedOut, error: timedOut ? undefined : result.error?.message }));
}
let parsed;
try { parsed = JSON.parse(readFileSync(report, 'utf8')); } catch (error) { fail(`probe "${probe}" wrote a report that is not JSON (${error.message}): ${report}. Editor log: ${logPath}`); }
for (const line of summarizeReport(parsed)) console.log(line);
const problems = checkReport(probe, launch.requested, parsed);
if (problems.length) fail(`report problems:\n  ${problems.join('\n  ')}\nreport: ${report}\nEditor log: ${logPath}`);
console.log(`report: ${report}`);
