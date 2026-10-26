// Pure checks for compare_perf.mjs: judge the `perf` blocks of a compare.json receipt (AECompare.cpp). No Unreal, no files, no dependencies.
//   A receipt has `null_rhi` (bool) and candidates[]; each candidate has stress.perf = { frames, gpu_time_available, wall_ms, game_thread_ms, render_thread_ms, gpu_ms },
//   each series an object { mean, p50, p95, max } in milliseconds.
// shapeProblems() applies to any set. evaluatePerf() judges the `perf` set of PerfSets.cpp: a baseline, a GPU-side change (r.ScreenPercentage 200) and a CPU-side change (a 4 ms
// busy-wait on the game thread). The thresholds below are first guesses; a first run on an engine tests them.

export const SERIES = ['wall_ms', 'game_thread_ms', 'render_thread_ms', 'gpu_ms'];
export const STATS = ['mean', 'p50', 'p95', 'max'];

/** Margins the perf set is judged with. Change them in one place after the first run. */
export const THRESHOLDS = {
  gpuRiseRatio: 1.3,        // the supersample row's mean GPU time over the baseline's
  gpuRiseMinMs: 0.3,        // ... and at least this many milliseconds more
  gpuDriftRatio: 0.15,      // the CPU row's mean GPU time may differ from the baseline's by this fraction ...
  gpuDriftMinMs: 0.25,      // ... or by this many milliseconds, whichever is larger
  gameRiseMs: 2.0,          // the CPU row's mean game thread time over the baseline's (the spin is 4 ms)
  gameDriftMs: 1.0,         // the supersample row's mean game thread time may differ from the baseline's by this much
};

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const entries = (receipt) => (Array.isArray(receipt?.candidates) ? receipt.candidates : []);
const perfOf = (receipt, id) => entries(receipt).find((c) => c?.id === id)?.stress?.perf;

/** Problems in the shape of every perf block of a receipt, as strings (empty when the shape is sound). A candidate without a stress result is a problem too. */
export function shapeProblems(receipt) {
  const problems = [];
  if (!receipt || typeof receipt !== 'object') return ['the receipt is not an object'];
  if (typeof receipt.null_rhi !== 'boolean') problems.push('null_rhi is missing or not a boolean');
  if (entries(receipt).length === 0) problems.push('the receipt lists no candidates');
  for (const c of entries(receipt)) {
    const perf = c?.stress?.perf;
    if (!perf || typeof perf !== 'object') { problems.push(`${c?.id}: no stress.perf block`); continue; }
    if (typeof perf.gpu_time_available !== 'boolean') problems.push(`${c.id}: gpu_time_available is missing or not a boolean`);
    if (!Number.isInteger(perf.frames) || perf.frames < 10) problems.push(`${c.id}: perf.frames is ${JSON.stringify(perf.frames)}, expected at least 10`);
    for (const series of SERIES) {
      for (const stat of STATS) if (!isNumber(perf[series]?.[stat])) problems.push(`${c.id}: perf.${series}.${stat} is not a number`);
    }
  }
  return problems;
}

const mean = (perf, series) => perf?.[series]?.mean;

/**
 * The checks for a receipt of the `perf` set. With a rendering RHI: the GPU time is read, a GPU-side change moves it and a CPU-side change does not. With
 * null_rhi true (a headless run): the GPU time reads zero and the game thread time still moves with a CPU-side change.
 * @returns {{ name: string, claim: string, pass: boolean, detail: string }[]}
 */
export function evaluatePerf(receipt, t = THRESHOLDS) {
  const out = [];
  const check = (name, claim, pass, detail = '') => out.push({ name, claim, pass: Boolean(pass), detail: String(detail) });
  const problems = shapeProblems(receipt);
  check('every candidate has a well formed perf block',
    'each stress result carries wall, game thread, render thread and GPU time as mean, p50, p95 and max, and says whether the GPU time was available',
    problems.length === 0, problems.length ? problems.join(' | ') : `${entries(receipt).length} candidates`);

  const base = perfOf(receipt, 'perf-baseline'), gpu = perfOf(receipt, 'perf-gpu-supersample'), cpu = perfOf(receipt, 'perf-cpu-spin');
  const present = Boolean(base && gpu && cpu) && problems.length === 0;
  check('the receipt is from the perf set', 'candidates perf-baseline, perf-gpu-supersample and perf-cpu-spin are all present',
    Boolean(base && gpu && cpu), entries(receipt).map((c) => c?.id).join(', ') || 'no candidates');
  if (!present) return out;

  const f = (v) => (isNumber(v) ? v.toFixed(2) : String(v));
  const baseGpu = mean(base, 'gpu_ms'), gpuGpu = mean(gpu, 'gpu_ms'), cpuGpu = mean(cpu, 'gpu_ms');
  const baseGame = mean(base, 'game_thread_ms'), gpuGame = mean(gpu, 'game_thread_ms'), cpuGame = mean(cpu, 'game_thread_ms');

  if (receipt.null_rhi === true) {
    check('without a rendering RHI the GPU time reads zero',
      'a -nullrhi run records 0 for every GPU frame time and says gpu_time_available is false',
      [base, gpu, cpu].every((p) => p.gpu_time_available === false && p.gpu_ms.max === 0),
      `gpu_time_available ${[base, gpu, cpu].map((p) => p.gpu_time_available).join('/')}; gpu max ${[base, gpu, cpu].map((p) => f(p.gpu_ms.max)).join('/')} ms`);
    // The engine updates GGameThreadTime and GRenderThreadTime while it draws a viewport, which a -nullrhi run does not do, so those series read 0 here (observed on 5.8.3);
    // the wall frame time is what still shows the busy-wait.
    const baseWall = mean(base, 'wall_ms'), cpuWall = mean(cpu, 'wall_ms');
    check('without a rendering RHI the wall frame time still moves with CPU work',
      `the busy-wait row's mean wall frame time is at least ${t.gameRiseMs} ms over the baseline's`,
      cpuWall - baseWall >= t.gameRiseMs, `baseline ${f(baseWall)} ms, cpu spin ${f(cpuWall)} ms`);
    return out;
  }

  check('with a rendering RHI the GPU time is read',
    'gpu_time_available is true and the baseline row has a positive mean GPU time', base.gpu_time_available === true && baseGpu > 0,
    `gpu_time_available ${base.gpu_time_available}; baseline gpu mean ${f(baseGpu)} ms`);
  check('a GPU-side change moves the GPU time',
    `the supersample row's mean GPU time is at least ${t.gpuRiseRatio} times the baseline's and ${t.gpuRiseMinMs} ms more`,
    gpuGpu >= baseGpu * t.gpuRiseRatio && gpuGpu - baseGpu >= t.gpuRiseMinMs, `baseline ${f(baseGpu)} ms, supersample ${f(gpuGpu)} ms`);
  check('a GPU-side change leaves the game thread alone',
    `the supersample row's mean game thread time is within ${t.gameDriftMs} ms of the baseline's`,
    Math.abs(gpuGame - baseGame) <= t.gameDriftMs, `baseline ${f(baseGame)} ms, supersample ${f(gpuGame)} ms`);
  check('a CPU-side change moves the game thread time',
    `the busy-wait row's mean game thread time is at least ${t.gameRiseMs} ms over the baseline's`,
    cpuGame - baseGame >= t.gameRiseMs, `baseline ${f(baseGame)} ms, cpu spin ${f(cpuGame)} ms`);
  check('a CPU-side change leaves the GPU time alone',
    `the busy-wait row's mean GPU time is within ${Math.round(t.gpuDriftRatio * 100)}% (at least ${t.gpuDriftMinMs} ms) of the baseline's`,
    Math.abs(cpuGpu - baseGpu) <= Math.max(t.gpuDriftMinMs, baseGpu * t.gpuDriftRatio), `baseline ${f(baseGpu)} ms, cpu spin ${f(cpuGpu)} ms`);
  return out;
}

/** Informational lines about a receipt that are not checks and never fail the judge: in a headless run the game thread and render thread series read 0. */
export function notes(receipt) {
  const out = [];
  if (receipt?.null_rhi === true) {
    const zero = (series) => entries(receipt).length > 0 && entries(receipt).every((c) => c?.stress?.perf?.[series]?.max === 0);
    for (const series of ['game_thread_ms', 'render_thread_ms']) {
      out.push(`${series} ${zero(series) ? 'reads 0 in every candidate of this headless run' : 'did not read 0 in every candidate of this headless run'} (informational, not a check)`);
    }
  }
  return out;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}
