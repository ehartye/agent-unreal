// Judges what insights_capture.mjs collects from an Unreal Insights trace. Pure functions, no Unreal and no dependencies; the node test feeds
// them CSV text and logs shaped like the ones Unreal 5.8.2 wrote.
//   Timer statistics CSV  (TimingInsights.ExportTimerStatistics): one row per timer, times in seconds.
//   Timing events CSV     (TimingInsights.ExportTimingEvents):    one row per timer instance, times in seconds.

export const STATS_COLUMNS = ['Name', 'Count', 'C.Avg', 'Incl', 'I.Min', 'I.Max', 'I.Avg', 'I.Med', 'Excl', 'E.Min', 'E.Max', 'E.Avg', 'E.Med'];
export const EVENT_COLUMNS = ['ThreadName', 'TimerName', 'StartTime', 'EndTime', 'Duration', 'Depth'];
export const FRAME_TIMER = 'FEngineLoop::Tick';

/** Splits CSV text into { header, rows } where each row is an object keyed by header. Handles double-quoted fields. */
export function parseCsv(text) {
  const lines = String(text ?? '').split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const split = (line) => {
    const out = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out;
  };
  const header = split(lines[0]);
  const rows = lines.slice(1).map((l) => { const f = split(l); return Object.fromEntries(header.map((h, i) => [h, f[i]])); });
  return { header, rows };
}

/** Nearest-rank percentile: the smallest value with at least p percent of the values at or below it. p in (0, 100]. */
export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1];
}

/** Frame statistics in the units given. `high` is the percentile reported next to the maximum (default 99). */
export function summarizeFrames(frameMs, high = 99) {
  const n = frameMs.length;
  if (n === 0) return { frames: 0 };
  const mean = frameMs.reduce((a, b) => a + b, 0) / n;
  return { frames: n, mean, p50: percentile(frameMs, 50), high, pHigh: percentile(frameMs, high), max: Math.max(...frameMs), min: Math.min(...frameMs) };
}

/** Compares a window with a budget: the slow tail decides, the mean is context. */
export function budgetVerdict(summary, budgetMs) {
  const over = (v) => v > budgetMs;
  return { budgetMs, pass: summary.frames > 0 && !over(summary.pHigh) && !over(summary.max), highOk: !over(summary.pHigh), maxOk: !over(summary.max), meanOk: !over(summary.mean) };
}

/** Frame times (ms) of one timer on one thread from a timing-events CSV. The region export includes the frame that was running when the region began and
 *  the one running when it ended; `dropBoundary` removes those two partial frames. */
export function frameTimesMs(eventsCsvText, { timer = FRAME_TIMER, thread = 'GameThread', dropBoundary = true } = {}) {
  const { header, rows } = parseCsv(eventsCsvText);
  if (!EVENT_COLUMNS.every((c) => header.includes(c))) return { ok: false, reason: `columns ${header.join(',')}`, ms: [] };
  let events = rows.filter((r) => r.TimerName === timer && r.ThreadName === thread).map((r) => ({ start: Number(r.StartTime), ms: Number(r.Duration) * 1000 }));
  events.sort((a, b) => a.start - b.start);
  const all = events.map((e) => e.ms);
  if (dropBoundary && events.length > 2) events = events.slice(1, -1);
  const ms = events.map((e) => e.ms);
  return { ok: ms.length > 0 && ms.every((v) => Number.isFinite(v) && v > 0), reason: '', ms, all };
}

/** Reads one timer's row from a timer-statistics CSV. Values stay in seconds, as exported. */
export function timerRow(statsCsvText, name = FRAME_TIMER) {
  const { header, rows } = parseCsv(statsCsvText);
  const row = rows.find((r) => r.Name === name);
  return { header, row: row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, k === 'Name' ? v : Number(v)])) : undefined };
}

/** Reads the `Trace.Status` block in an editor log: destination file and enabled channels of the last status printed. */
export function traceStatus(logText) {
  const blocks = String(logText ?? '').split('Trace status').slice(1);
  const last = blocks[blocks.length - 1] ?? '';
  const file = /Tracing to '([^']+)'/.exec(last)?.[1];
  const channels = /Enabled channels: ([^\r\n]+)/.exec(last)?.[1].split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  return { statuses: blocks.length, file, channels };
}

/** Error lines the Insights process logged while exporting. */
export function exportErrors(logText) {
  return String(logText ?? '').split(/\r?\n/).filter((l) => /(TimingInsights|TraceInsights): Error/.test(l)).map((l) => l.replace(/^\[[^\]]*\]\[[^\]]*\]/, '').trim());
}

/** Judges the runs. Each run: { editorExit, trace: { size }, editorLog, report, insightsExit, insightsLog, stats, events, timersCsv, typoCsvExists }. */
export function evaluate({ runs }) {
  const checks = [];
  const add = (name, claim, pass, detail) => checks.push({ name, claim, pass: !!pass, detail });
  const each = (fn) => runs.length > 0 && runs.every(fn);
  const detail = (fn) => runs.map((r, i) => `${r.name ?? `run ${i + 1}`}: ${fn(r, i)}`).join('; ');
  const frames = runs.map((r) => frameTimesMs(r.events ?? ''));
  const rowOf = runs.map((r) => timerRow(r.stats ?? ''));
  const status = runs.map((r) => traceStatus(r.editorLog));

  add('trace written', 'a content-only project in a game process writes a .utrace file and the process exits cleanly',
    each((r) => r.editorExit === 0 && (r.trace?.size ?? 0) > 0), detail((r) => `exit ${r.editorExit}, ${r.trace?.size ?? 0} bytes`));
  add('trace control', 'Trace.File starts the trace after the warm-up when -traceautostart=0 holds it back (or -tracefile= starts it at launch), and Trace.Status reports the file and the requested channels',
    each((r, i) => /\.utrace$/.test(status[i].file ?? '') && ['Region', 'Bookmark', 'Frame', 'Cpu'].every((c) => status[i].channels.includes(c))
      && (r.start === 'launch' || r.report?.commands?.some((c) => c.startsWith('Trace.File ')))),
    detail((r, i) => `${status[i].statuses} status blocks, channels ${status[i].channels.join('/')}`));
  const order = (cmds = []) => ['Trace.Bookmark MeasuredBegin', 'Trace.RegionBegin Measured', 'Trace.RegionEnd Measured', 'Trace.Bookmark MeasuredEnd'].map((c) => cmds.indexOf(c));
  add('markers issued', 'a bookmark and Trace.RegionBegin open the window and Trace.RegionEnd and a bookmark close it (no headless command exports bookmarks, so only the region is read back)',
    each((r) => { const o = order(r.report?.commands); return o.every((v) => v >= 0) && o.every((v, k) => k === 0 || v > o[k - 1]); }), detail((r) => JSON.stringify(order(r.report?.commands))));
  add('headless export', 'UnrealInsights -NoUI -AutoQuit runs the response file and exits 0 with no export error',
    each((r) => r.insightsExit === 0 && exportErrors(r.insightsLog).length === 0), detail((r) => `exit ${r.insightsExit}, errors ${JSON.stringify(exportErrors(r.insightsLog))}`));
  add('command spelling', 'TimingInsights.ExportTimers exports the timer list; the page spelling TimingInsights.ExporTimers exports nothing',
    each((r) => (r.timersCsv ?? '').startsWith('Id,Type,Name') && r.typoCsvExists === false), detail((r) => `timers.csv ${(r.timersCsv ?? '').length} bytes, typo file ${r.typoCsvExists}`));
  add('statistics columns', `ExportTimerStatistics writes the columns ${STATS_COLUMNS.join(', ')} and a row for ${FRAME_TIMER}`,
    each((r, i) => STATS_COLUMNS.join() === rowOf[i].header.join() && !!rowOf[i].row), detail((r, i) => rowOf[i].header.join(',')));
  add('region matched', 'the -region export found the named region once and wrote one file for it; its game-thread frames are inside the window',
    each((r, i) => /Detected 1 regions/.test(r.insightsLog ?? '') && (rowOf[i].row?.Count ?? 0) > 0 && (rowOf[i].row?.Count ?? 0) <= (r.report?.frames ?? 0) + 1),
    detail((r, i) => `${rowOf[i].row?.Count} ${FRAME_TIMER} instances for ${r.report?.frames} ticks in the region`));
  add('frame times parsed', 'the timing-events export gives one Duration per game-thread frame in the window; the two partial frames at the edges are dropped',
    each((r, i) => frames[i].ok && (r.report?.pauseFor ? frames[i].ms.length < (r.report.frames - 1) : frames[i].ms.length === r.report.frames - 1)), detail((r, i) => `${frames[i].ms.length} frames, ${frames[i].all?.length} events`));
  add('units agree', 'both exports are in seconds; the event durations sum to the statistics total, which clips the two edge frames to the region, so the sum may exceed it by at most those two frames',
    each((r, i) => {
      const all = frames[i].all ?? [];
      const total = all.reduce((a, b) => a + b, 0) / 1000;
      const edges = all.length > 1 ? (all[0] + all[all.length - 1]) / 1000 : 0;
      const incl = rowOf[i].row?.Incl;
      return Number.isFinite(incl) && incl > 0 && total >= incl - 1e-6 && total - incl <= edges + 1e-6 && rowOf[i].row['I.Max'] < 5;
    }), detail((r, i) => `sum ${((frames[i].all ?? []).reduce((a, b) => a + b, 0) / 1000).toFixed(4)} s against Incl ${rowOf[i].row?.Incl}`));
  const stalls = runs.map((r, i) => (frames[i].ms ?? []).filter((v) => v >= 0.8 * (r.report?.spikeMs ?? Infinity)).length);
  add('injected stalls found', 'the frames longer than the injected stall are counted exactly, the maximum is at least the stall, and the mean sits far below the maximum',
    each((r, i) => {
      if (r.report?.pauseFor) return true;
      const s = summarizeFrames(frames[i].ms);
      return stalls[i] === r.report.spikes && r.report.spikes > 0 && s.max >= 0.8 * r.report.spikeMs && s.mean < s.max / 2;
    }), detail((r, i) => { const s = summarizeFrames(frames[i].ms); return `${stalls[i]} of ${r.report?.spikes} stalls, mean ${s.mean?.toFixed(2)}, p50 ${s.p50?.toFixed(2)}, p99 ${s.pHigh?.toFixed(2)}, max ${s.max?.toFixed(2)} ms`; }));
  const paused = runs.filter((r) => r.report?.pauseFor);
  if (paused.length > 0) {
    add('pause drops events', 'Trace.Pause and Trace.Resume leave the paused ticks out of the trace',
      paused.every((r) => { const k = runs.indexOf(r); return (rowOf[k].row?.Count ?? Infinity) <= r.report.frames + 1 - r.report.pauseFor + 1; }),
      paused.map((r) => { const k = runs.indexOf(r); return `${rowOf[k].row?.Count} instances for ${r.report.frames} ticks with ${r.report.pauseFor} paused`; }).join('; '));
  }
  const plain = runs.map((r, i) => ({ r, s: summarizeFrames(frames[i].ms) })).filter((x) => !x.r.report?.pauseFor && x.s.frames > 0);
  if (plain.length > 1) {
    const p50s = plain.map((x) => x.s.p50);
    add('repeat runs agree', 'repeated runs of the same window give a median within 25 percent of each other',
      Math.max(...p50s) / Math.min(...p50s) < 1.25, `medians ${p50s.map((v) => v.toFixed(2)).join(', ')} ms`);
  }
  return checks;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}
