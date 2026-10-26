// Judges what insights_stats.mjs collects. Pure functions, no Unreal and no dependencies.
// The stat help lines copy the registration text in Engine/Source/Runtime/Engine/Private/UnrealEngine.cpp (EngineStats); the Memory Insights export is
// a CSV whose header names the requested columns (MemoryExporter.cpp). No engine run has produced either yet, so the node test builds them by hand
// and the first run confirms their shape (see README.md).
//   stats   = { exit, report, log, uestats: [file names under Saved/Profiling/UnrealStats] }
//   memory  = { exit, report, insightsLog, exports: { active, leaks, limited } (CSV text or ''), traceBytes }  a trace started with -trace=default,memory
//   control = the same shape for a trace started with -trace=default only

/** Why `stat startfile` is expected to write nothing in a default 5.8 build, from the install's source. */
export const STARTFILE_SOURCE_NOTE = 'Engine/Source/Runtime/Core/Private/Stats/StatsCommand.cpp compiles the startfile and stopfile commands only when UE_ENABLE_STATS_FILE_DEPRECATED_IN_5_8 is 1, and Engine/Source/Runtime/Core/Public/Stats/StatsFile.h defaults it to 0';

/** Parse CSV text (a byte order mark is tolerated; quoted fields may hold commas). Returns { header, rows } or undefined for empty text. */
export function parseCsv(text) {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return undefined;
  const split = (line) => { const out = []; let cur = ''; let quoted = false; for (const ch of line) { if (ch === '"') quoted = !quoted; else if (ch === ',' && !quoted) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  return { header: split(lines[0]), rows: lines.slice(1).map(split) };
}

/** The values of one column as numbers, or undefined when the column is missing. */
export function columnNumbers(csv, name) {
  const table = parseCsv(csv);
  const index = table?.header.indexOf(name);
  if (!table || index === undefined || index < 0) return undefined;
  return table.rows.map((r) => Number(r[index])).filter((v) => Number.isFinite(v));
}

const rowCount = (csv) => parseCsv(csv)?.rows.length ?? 0;
const hasLine = (log, re) => String(log ?? '').split(/\r?\n/).some((l) => re.test(l));

export function evaluate({ stats, memory, control, options = {} }) {
  const held = options.heldElements ?? 300000;
  const freed = options.freedElements ?? 1500000;
  const checks = [];
  const add = (name, claim, pass, detail, info = false) => checks.push({ name, claim, pass: !!pass, detail, info });

  const log = stats?.log ?? '';
  add('the stats run finished', 'the game process ran the stat commands and wrote its report', !!stats?.report && (stats.report.commands ?? []).length >= 8, stats?.report ? `${stats.report.commands.length} commands; exit ${stats.exit}` : 'no report');
  const unit = hasLine(log, /\bUnit\b.*Display frame times for Game Thread, Render Thread and GPU/i);
  const fps = hasLine(log, /\bFPS\b.*Display average FPS/i);
  add('stat help lists stat unit and stat fps', '"stat help" names the Unit and FPS stat commands with their descriptions, so both are registered in this build', unit && fps, `unit ${unit}, fps ${fps}`);
  add('a bare stat prints the stat help', 'an empty stat command prints "Empty stat command!" and the brief list of stat commands', hasLine(log, /Empty stat command!/) && hasLine(log, /stat dumpframe/), `header ${hasLine(log, /Empty stat command!/)}, list ${hasLine(log, /stat dumpframe/)}`);
  const listsFile = hasLine(log, /stat startfile - starts dumping a capture/) && hasLine(log, /stat stopfile - stops dumping a capture/);
  const files = stats?.uestats ?? [];
  add('stat startfile and stopfile write a .uestats file', '"stat startfile" then "stat stopfile" leaves a .uestats file under Saved/Profiling/UnrealStats',
    files.length > 0 && hasLine(log, /Wrote stats file/),
    files.length ? `files ${JSON.stringify(files)}` : `no .uestats file; help lists the commands ${listsFile}; ${STARTFILE_SOURCE_NOTE}`);
  add('observation: the on-screen readout', 'stat unit (Frame, Game, Draw, GPU, RHIT) and stat fps draw on a viewport; a headless run toggles them and cannot read them, so the bottleneck rule of thumb is not exercised here', true,
    'read the numbers in a rendered session; nothing in this run judges them', true);

  const m = memory;
  const active = columnNumbers(m?.exports?.active, 'Size');
  add('memory trace answers Active Alloc', 'a trace started with -trace=default,memory answers the Active Alloc query at a bookmark with allocations', !!active && active.length > 0,
    active ? `${active.length} allocations alive at LeakC; trace ${m.traceBytes ?? 0} bytes` : `no usable export; Insights log errors ${(String(m?.insightsLog ?? '').match(/Error:/g) ?? []).length}`);
  const leaks = columnNumbers(m?.exports?.leaks, 'Size') ?? [];
  const limited = columnNumbers(m?.exports?.limited, 'Size') ?? [];
  const heldFloor = held * 4;
  const freedFloor = freed * 4;
  add('Memory Leaks finds the held allocation and not the freed one', `the AaBCf query returns an allocation of at least ${heldFloor} bytes (the held array) and none of ${freedFloor} bytes or more (the array freed before LeakC)`,
    leaks.some((s) => s >= heldFloor && s < freedFloor) && !leaks.some((s) => s >= freedFloor), `${leaks.length} rows, largest ${leaks.length ? Math.max(...leaks) : 'none'}`);
  add('Limited Lifetime finds the freed allocation', `the AaBfC query returns an allocation of at least ${freedFloor} bytes (the array freed between LeakB and LeakC)`,
    limited.some((s) => s >= freedFloor), `${limited.length} rows, largest ${limited.length ? Math.max(...limited) : 'none'}`);
  const c = control;
  const controlActive = columnNumbers(c?.exports?.active, 'Size');
  add('a trace without the memory channel answers nothing', 'the same query on a trace started with -trace=default (no memory channel) returns no allocations',
    !!c && (controlActive === undefined || controlActive.length === 0) && rowCount(c?.exports?.active) === 0, c ? `${controlActive?.length ?? 0} rows; export written ${!!c.exports?.active}` : 'no control run');
  add('observation: trace sizes', 'the memory trace is much larger than the default one (disk cost of the channel)', true, `memory ${m?.traceBytes ?? 'n/a'} bytes, default ${c?.traceBytes ?? 'n/a'} bytes`, true);
  return checks;
}

export function summarize(checks) {
  const counted = checks.filter((c) => !c.info);
  return { passed: counted.filter((c) => c.pass).length, total: counted.length };
}
