// node insights_stats.mjs --engine "<UE_5.8 folder>" [--held 300000] [--freed 1500000] [--keep]
// Run on 5.8.2 (8 of 8 checks pass). The opt-in measurement-commands phase of the Insights example: it does not change what insights_capture.mjs does.
// Runs the measurement commands that skills/unreal-quality/references/unreal-quality-measurement.md and unreal-quality-profiling-tools.md name:
//   stats run   a game process (UnrealEditor-Cmd.exe -game -nullrhi) that runs stat help, a bare stat, stat unit, stat fps and stat startfile / stopfile;
//               the log and the files under Saved/Profiling/UnrealStats are judged.
//   memory run  the same kind of process started with -trace=default,memory, which allocates a held and a freed array between bookmarks; UnrealInsights.exe
//               then answers three Memory Insights queries (Memory Leaks, Limited Lifetime, Active Alloc) with MemoryInsights.ExportAllocs.
//   control run the same process started with -trace=default only, asked the Active Alloc query.
// It writes a content-only project (PythonScriptPlugin only) in the OS temp folder. Disk: the memory trace is far larger than the default one (it records
// every allocation from process start); expect hundreds of megabytes to a few gigabytes in the OS temp folder, removed unless --keep.
// Exit code 0 when every counted check passes. Not part of node scripts/check.mjs; the checks are tested there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { evaluate, summarize } from './insights-stats-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node insights_stats.mjs --engine <UE_5.8 folder> [--held 300000] [--freed 1500000] [--keep]'); process.exit(2); }
const bin = join(engine, 'Engine', 'Binaries', 'Win64');
const editor = join(bin, 'UnrealEditor-Cmd.exe');
const insights = join(bin, 'UnrealInsights.exe');
for (const exe of [editor, insights]) if (!existsSync(exe)) { console.error(`not found: ${exe}`); process.exit(2); }
const held = Number(flag('--held') || 300000);
const freed = Number(flag('--freed') || 1500000);

const here = import.meta.dirname;
const root = mkdtempSync(join(tmpdir(), 'insights-stats-')).replaceAll('\\', '/');
const fwd = (p) => p.replaceAll('\\', '/');
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const readJson = (p) => { try { return existsSync(p) ? JSON.parse(readText(p)) : undefined; } catch { return undefined; } };
// A timed-out run can leave Unreal behind; stop only processes whose command line names this scratch folder.
function stopScratch() {
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${root.replaceAll('/', '*')}*' -and $_.Name -like 'Unreal*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
  spawnSync('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true, stdio: 'ignore' });
}
function run(exe, argv, env, timeout) {
  const result = spawnSync(exe, argv, { env: { ...process.env, ...env }, stdio: 'ignore', timeout, windowsHide: true });
  if (result.error) stopScratch();
  return result;
}

const project = `${root}/Project`;
mkdirSync(`${project}/Saved/Logs`, { recursive: true });
mkdirSync(`${root}/Traces`, { recursive: true });
mkdirSync(`${root}/Out`, { recursive: true });
writeFileSync(`${project}/Probe.uproject`, JSON.stringify({ FileVersion: 3, EngineAssociation: '5.8', Plugins: [{ Name: 'PythonScriptPlugin', Enabled: true }] }, null, 2));
console.log(`Insights stats validation in ${root}`);

const common = ['-game', '-nullrhi', '-unattended', '-nosplash', '-nopause', '-nosound', '-notraceserver'];
const probe = `-ExecCmds=py ${fwd(resolve(here, 'insights_stats_probe.py'))}`;

// 1. stat commands
const statsReport = `${root}/Out/stats-report.json`;
const statsLog = `${project}/Saved/Logs/stats.log`;
let t0 = Date.now();
const statsRun = run(editor, [`${project}/Probe.uproject`, ...common, `-abslog=${statsLog}`, probe], { STATS_MODE: 'stats', STATS_REPORT: statsReport }, 600000);
console.log(`  stats: exit ${statsRun.status}${statsRun.error ? ` (${statsRun.error.message})` : ''}, ${Math.round((Date.now() - t0) / 1000)} s`);
const statsDir = `${project}/Saved/Profiling/UnrealStats`;
const stats = { exit: statsRun.status, report: readJson(statsReport), log: readText(statsLog), uestats: existsSync(statsDir) ? readdirSync(statsDir).filter((f) => f.endsWith('.uestats')) : [] };

// 2. memory traces: one with the memory channel from process start, one without
function traced(label, channels) {
  const trace = `${root}/Traces/${label}.utrace`;
  const reportPath = `${root}/Out/${label}-report.json`;
  const log = `${project}/Saved/Logs/${label}.log`;
  const started = Date.now();
  const launched = run(editor, [`${project}/Probe.uproject`, ...common, `-trace=${channels}`, `-tracefile=${trace}`, `-abslog=${log}`, probe],
    { STATS_MODE: 'memory', STATS_REPORT: reportPath, STATS_HELD_ELEMENTS: String(held), STATS_FREED_ELEMENTS: String(freed) }, 900000);
  console.log(`  ${label}: editor exit ${launched.status}${launched.error ? ` (${launched.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
  const out = `${root}/Out/${label}`;
  mkdirSync(out, { recursive: true });
  const rsp = `${root}/Out/${label}.rsp`;
  const columns = '-Columns=Size,StartTime,EndTime';
  writeFileSync(rsp, [
    `MemoryInsights.ExportAllocs -Rule=aAf -BookmarkA=LeakC -Output=${out}/active.csv ${columns}`,
    `MemoryInsights.ExportAllocs -Rule=AaBCf -BookmarkA=LeakA -BookmarkB=LeakB -BookmarkC=LeakC -Output=${out}/leaks.csv ${columns}`,
    `MemoryInsights.ExportAllocs -Rule=AaBfC -BookmarkA=LeakA -BookmarkB=LeakB -BookmarkC=LeakC -Output=${out}/limited.csv ${columns}`,
  ].join('\n') + '\n');
  const insightsLog = `${root}/Out/${label}-insights.log`;
  const t1 = Date.now();
  const exported = existsSync(trace) ? run(insights, [`-OpenTraceFile=${trace}`, '-NoUI', '-AutoQuit', `-ExecOnAnalysisCompleteCmd=@=${rsp}`, `-abslog=${insightsLog}`], {}, 1800000) : { status: 'no trace' };
  console.log(`  ${label}: insights exit ${exported.status}, ${Math.round((Date.now() - t1) / 1000)} s`);
  return { exit: launched.status, report: readJson(reportPath), insightsLog: readText(insightsLog), traceBytes: existsSync(trace) ? statSync(trace).size : 0,
    exports: { active: readText(`${out}/active.csv`), leaks: readText(`${out}/leaks.csv`), limited: readText(`${out}/limited.csv`) } };
}
const memory = traced('memory', 'default,memory');
const control = traced('nomemory', 'default');

const checks = evaluate({ stats, memory, control, options: { heldElements: held, freedElements: freed } });
for (const c of checks) console.log(`${c.info ? 'INFO' : c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
