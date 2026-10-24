// node rp_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep]
// Validates the [tested] line of skills/unreal-rendering/references/unreal-directional-lights.md against a real Unreal 5.8 install.
// It makes a throwaway project in the OS temp folder (PythonScriptPlugin, EditorScriptingUtilities), runs rp_probe.py headless (two
// DirectionalLight actors, ForwardShadingPriority read, set through set_forward_shading_priority and read again, four other routes to the
// property, two console variable lookups) and judges the report and the log with rp-validate-checks.mjs. Exit code 0 when every check
// passes. Takes about a minute (the first start of a new project is the slow part). Not part of node scripts/check.mjs; the pure checks
// are tested there. The probe is headless: it does not show the renderer's on-screen message, which needs a rendering editor viewport.
// Hidden windows; only processes whose command line names the throwaway project are stopped afterwards.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { evaluate, summarize } from './rp-validate-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node rp_validate.mjs --engine <UE_5.8 folder> [--keep]'); process.exit(2); }
const cmd = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe');
if (!existsSync(cmd)) { console.error(`not found: ${cmd}`); process.exit(2); }

const here = import.meta.dirname;
const root = mkdtempSync(join(tmpdir(), 'rp-validate-'));
const project = join(root, 'RpValidate.uproject');
writeFileSync(project, JSON.stringify({
  FileVersion: 3, EngineAssociation: '5.8',
  Plugins: ['PythonScriptPlugin', 'EditorScriptingUtilities'].map((Name) => ({ Name, Enabled: true })),
}, null, 2));
const saved = join(root, 'Saved');
mkdirSync(join(saved, 'Logs'), { recursive: true });
const reportPath = join(saved, 'probe.json'), logPath = join(saved, 'Logs', 'probe.log');
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');

// Stop editors that were started with this project (and nothing else).
function stopProjectProcesses() {
  if (process.platform !== 'win32') return;
  const needle = root.replace(/'/g, "''");
  spawnSync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],
  { stdio: 'ignore', windowsHide: true });
}

// A timeout is retried once; the commandlet's exit code is not judged (the cvar lookup logs a warning on purpose), the report is.
function run(timeout = 600000) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    rmSync(reportPath, { force: true });
    const result = spawnSync(cmd, [project, '-run=pythonscript', `-script=${resolve(here, 'rp_probe.py')}`, `-abslog=${logPath}`,
      '-unattended', '-nullrhi', '-nosplash', '-nopause', '-nosound', '-notraceserver'],
    { env: { ...process.env, RP_REPORT: reportPath }, stdio: 'ignore', timeout, windowsHide: true });
    console.log(`  probe (headless): exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
    if (result.status !== null) return result.status;
    stopProjectProcesses();
  }
  return null;
}

console.log(`Directional light priority validation in ${root}`);
run();
stopProjectProcesses();
let report;
try { report = existsSync(reportPath) ? JSON.parse(readText(reportPath)) : undefined; } catch (error) { console.error(`report is not JSON: ${error.message}`); }
if (!report) console.error(`no report was written; editor log: ${logPath}`);
else console.log(`  engine ${report.engine}`);

const checks = evaluate({ report, log: readText(logPath) });
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
