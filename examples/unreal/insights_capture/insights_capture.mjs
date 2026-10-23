// node insights_capture.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--runs 2] [--frames 120] [--warmup 30] [--budget-ms 8.33] [--pause] [--mode game|editor] [--start late|launch] [--keep]
// Validates skills/unreal-native/references/unreal-native-insights-capture.md against a real Unreal 5.8 install. It writes a content-only project
// in the OS temp folder and starts UnrealEditor-Cmd.exe hidden with -nullrhi and insights_probe.py. The script burns a known amount of game-thread
// time on every tick (plus a stall every 40th tick), wraps the measured window in Trace.RegionBegin/RegionEnd with two bookmarks, and quits.
// Tracing is held back with -traceautostart=0 and started after the warm-up with Trace.File. Then UnrealInsights.exe opens each trace with -NoUI
// -AutoQuit and runs a response file: TimingInsights.ExportTimerStatistics and TimingInsights.ExportTimingEvents for the region, ExportTimers, and the
// misspelled ExporTimers from the documentation page. insights-capture-checks.mjs parses the CSV files and judges them.
// --start launch begins the trace at process start with -tracefile= instead of holding it with -traceautostart=0 and starting it with Trace.File after the warm-up.
// --pause adds a run that calls Trace.Pause and Trace.Resume inside the region. --mode editor runs without -game (the editor caps its tick rate).
// Takes about one minute per run. Exit code 0 when every check passes. Not part of node scripts/check.mjs; the checks are tested there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { evaluate, summarize, summarizeFrames, frameTimesMs, budgetVerdict } from './insights-capture-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node insights_capture.mjs --engine <UE_5.8 folder> [--runs 2] [--frames 120] [--warmup 30] [--budget-ms 8.33] [--pause] [--mode game|editor] [--start late|launch] [--keep]'); process.exit(2); }
const bin = join(engine, 'Engine', 'Binaries', 'Win64');
const editor = join(bin, 'UnrealEditor-Cmd.exe');
const insights = join(bin, 'UnrealInsights.exe');
for (const exe of [editor, insights]) if (!existsSync(exe)) { console.error(`not found: ${exe}`); process.exit(2); }
const runsWanted = Number(flag('--runs') || 2);
const frames = Number(flag('--frames') || 120);
const warmup = Number(flag('--warmup') || 30);
const budgetMs = flag('--budget-ms') === undefined ? undefined : Number(flag('--budget-ms'));
const mode = flag('--mode') || 'game';
const startMode = flag('--start') || 'late';
const region = 'Measured';

const here = import.meta.dirname;
const root = mkdtempSync(join(tmpdir(), 'insights-capture-')).replaceAll('\\', '/');
const fwd = (p) => p.replaceAll('\\', '/');
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
function run(exe, argv, env, timeout) {
  const result = spawnSync(exe, argv, { env: { ...process.env, ...env }, stdio: 'ignore', timeout, windowsHide: true });
  if (result.error) stopScratch();
  return result;
}
// A timed-out run can leave Unreal behind; stop only processes whose command line names this scratch folder.
function stopScratch() {
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${root.replaceAll('/', '*')}*' -and $_.Name -like 'Unreal*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
  spawnSync('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true, stdio: 'ignore' });
}

const project = `${root}/Project`;
mkdirSync(`${project}/Saved/Logs`, { recursive: true });
mkdirSync(`${root}/Traces`, { recursive: true });
mkdirSync(`${root}/Out`, { recursive: true });
writeFileSync(`${project}/Probe.uproject`, JSON.stringify({ FileVersion: 3, EngineAssociation: '5.8', Plugins: [{ Name: 'PythonScriptPlugin', Enabled: true }] }, null, 2));
console.log(`Insights capture validation in ${root}`);

const plan = Array.from({ length: runsWanted }, (_, i) => ({ name: `run${i + 1}`, pause: false }));
if (args.includes('--pause')) plan.push({ name: 'pause', pause: true });
const runs = [];
for (const p of plan) {
  const trace = `${root}/Traces/${p.name}.utrace`;
  const reportPath = `${root}/Out/${p.name}-report.json`;
  const editorLog = `${project}/Saved/Logs/${p.name}.log`;
  const env = { INSIGHTS_REPORT: reportPath, ...(startMode === 'late' ? { INSIGHTS_TRACE_FILE: trace } : {}), INSIGHTS_FRAMES: String(frames), INSIGHTS_WARMUP: String(warmup), INSIGHTS_REGION: region,
    ...(p.pause ? { INSIGHTS_PAUSE_AT: String(Math.floor(frames / 3)), INSIGHTS_PAUSE_FOR: '20' } : {}) };
  const t0 = Date.now();
  const launched = run(editor, [`${project}/Probe.uproject`, ...(mode === 'game' ? ['-game'] : []), '-nullrhi', '-unattended', '-nosplash', '-nopause', '-nosound', '-notraceserver',
    ...(startMode === 'late' ? ['-traceautostart=0'] : [`-tracefile=${trace}`]), '-trace=cpu,frame,bookmark,region,counters', '-statnamedevents', `-abslog=${editorLog}`, `-ExecCmds=py ${fwd(resolve(here, 'insights_probe.py'))}`], env, 600000);
  console.log(`  ${p.name}: editor exit ${launched.status}${launched.error ? ` (${launched.error.message})` : ''}, ${Math.round((Date.now() - t0) / 1000)} s`);

  const out = `${root}/Out/${p.name}`;
  mkdirSync(out, { recursive: true });
  const rsp = `${root}/Out/${p.name}.rsp`;
  writeFileSync(rsp, [
    `TimingInsights.ExportTimerStatistics ${out}/stats-{region}.csv -region=${region} -threads=GameThread`,
    `TimingInsights.ExportTimingEvents ${out}/frames-{region}.csv -region=${region} -threads=GameThread -timers=FEngineLoop::Tick -columns=ThreadName,TimerName,StartTime,EndTime,Duration,Depth`,
    `TimingInsights.ExportTimers ${out}/timers.csv`,
    `TimingInsights.ExporTimers ${out}/timers-typo.csv`,
  ].join('\n') + '\n');
  const insightsLog = `${root}/Out/${p.name}-insights.log`;
  const t1 = Date.now();
  const exported = existsSync(trace) ? run(insights, [`-OpenTraceFile=${trace}`, '-NoUI', '-AutoQuit', `-ExecOnAnalysisCompleteCmd=@=${rsp}`, `-abslog=${insightsLog}`], {}, 600000) : { status: 'no trace' };
  console.log(`  ${p.name}: insights exit ${exported.status}, ${Math.round((Date.now() - t1) / 1000)} s`);
  runs.push({
    name: p.name, start: startMode, editorExit: launched.status, editorLog: readText(editorLog), trace: { size: existsSync(trace) ? statSync(trace).size : 0 },
    report: existsSync(reportPath) ? JSON.parse(readText(reportPath)) : undefined, insightsExit: exported.status, insightsLog: readText(insightsLog),
    stats: readText(`${out}/stats-${region}.csv`), events: readText(`${out}/frames-${region}.csv`), timersCsv: readText(`${out}/timers.csv`), typoCsvExists: existsSync(`${out}/timers-typo.csv`),
  });
}

const checks = evaluate({ runs });
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
for (const r of runs.filter((x) => !x.report?.pauseFor)) {
  const s = summarizeFrames(frameTimesMs(r.events).ms);
  console.log(`  ${r.name} (${mode}): ${s.frames} frames, mean ${s.mean?.toFixed(2)}, p50 ${s.p50?.toFixed(2)}, p99 ${s.pHigh?.toFixed(2)}, max ${s.max?.toFixed(2)} ms${budgetMs === undefined ? '' : `; against ${budgetMs} ms: ${JSON.stringify(budgetVerdict(s, budgetMs))}`}`);
}
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
