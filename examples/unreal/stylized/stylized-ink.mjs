// Pure judging code for the ink-brush groups of the stylized probe (outline, ribbon, mesh, cost): a pixel ring check, a frame
// difference, the shot measurements, the CSV and nvidia-smi readers and the gate that decides whether a frame-cost figure may be
// recorded. No Unreal, no files: stylized-validate.test.mjs feeds it small images and canned readings, and stylized_validate.mjs
// feeds it the engine screenshots and the CSV files of a run.
import { bandsIn } from './stylized-measure.mjs';
import { pixel } from './png-tools.mjs';

/** The groups of the probe. `base` is the original 17 checks; the other four are the ink-brush questions. */
export const GROUPS = ['base', 'outline', 'ribbon', 'mesh', 'cost'];

/** The outline colour as the sprites show it (stylized_ink.py OUTLINE_COLOR, linear 0.05 0.85 0.75, about 64 237 225 in sRGB before the tone mapper); each run measures the real value on a flat swatch. */
export const OUTLINE_FALLBACK = [64, 237, 225];

/** The stations of each group, in the order stylized_ink.py lists them (the test compares the two). */
export const STATIONS = {
  outline: ['o_swatch', 'o_none', 'o_ramp', 'o_flange', 'o_stencil_sprite', 'o_stencil_mesh'],
  ribbon: ['r_smooth', 'r_ink', 'r_edge', 'r_stencil'],
  mesh: ['m_smooth', 'm_ink', 'm_stencil'],
  cost: ['c_control', 'c_ink', 'c_drawn'],
};

export const WALL_PIXEL = [1000, 100];     // a pixel of the backdrop wall in every ink station
const FULL = null;                         // the whole image

const near = (p, c, t) => Math.max(Math.abs(p[0] - c[0]), Math.abs(p[1] - c[1]), Math.abs(p[2] - c[2])) <= t;

/** Summed-area table of a 0/1 mask (Uint8Array, width x height); box(x0, y0, x1, y1) is inclusive and clamped. */
function area(mask, width, height) {
  const w = width + 1, sat = new Int32Array(w * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += mask[y * width + x];
      sat[(y + 1) * w + x + 1] = sat[y * w + x + 1] + row;
    }
  }
  return (x0, y0, x1, y1) => {
    const a = Math.max(0, x0), b = Math.max(0, y0), c = Math.min(width - 1, x1) + 1, d = Math.min(height - 1, y1) + 1;
    return sat[d * w + c] - sat[b * w + c] - sat[d * w + a] + sat[b * w + a];
  };
}

/**
 * Is there a ring of outline-coloured pixels around the shape? The shape is every pixel that differs from the backdrop by more than
 * `bgTolerance`; its boundary is the shape pixels with a background pixel beside them (the image edge counts as shape, so a ribbon
 * that runs off the frame has only its two long edges). The outline colour is `colour` within `tolerance` per channel.
 *   coverage  share of boundary pixels with an outline-coloured pixel within `depth` pixels of them
 *   pixels    outline-coloured pixels in the shape
 *   hugging   share of those pixels within `reach` pixels of the boundary (a ring hugs the contour; a filled blob does not)
 *   found     coverage >= minCoverage, pixels >= minPixels and hugging >= 0.9
 * @param {{ width: number, height: number, rgba: Uint8Array }} img
 */
export function outlineRing(img, { colour, backdrop = pixel(img, ...WALL_PIXEL), tolerance = 60, bgTolerance = 14, depth = 4, reach = 30, minCoverage = 0.85, minPixels = 150, region = FULL } = {}) {
  const { width, height } = img, r = region || { x0: 0, y0: 0, x1: width, y1: height };
  const shape = new Uint8Array(width * height), outline = new Uint8Array(width * height);
  let shapeCount = 0, outlineCount = 0;
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
    const i = y * width + x, p = [img.rgba[i * 4], img.rgba[i * 4 + 1], img.rgba[i * 4 + 2]];
    if (!near(p, backdrop, bgTolerance)) {
      shape[i] = 1; shapeCount++;
      if (near(p, colour, tolerance)) { outline[i] = 1; outlineCount++; }
    }
  }
  const isShape = (x, y) => (x < r.x0 || y < r.y0 || x >= r.x1 || y >= r.y1 ? 1 : shape[y * width + x]);
  const boundary = new Uint8Array(width * height);
  let boundaryCount = 0;
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
    if (shape[y * width + x] && !(isShape(x - 1, y) && isShape(x + 1, y) && isShape(x, y - 1) && isShape(x, y + 1))) { boundary[y * width + x] = 1; boundaryCount++; }
  }
  if (boundaryCount === 0 || outlineCount === 0) {
    return { found: false, coverage: 0, pixels: outlineCount, hugging: 0, shape: shapeCount, boundary: boundaryCount };
  }
  const outlineBox = area(outline, width, height), boundaryBox = area(boundary, width, height);
  let hit = 0, hug = 0;
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
    const i = y * width + x;
    if (boundary[i] && outlineBox(x - depth, y - depth, x + depth, y + depth) > 0) hit++;
    if (outline[i] && boundaryBox(x - reach, y - reach, x + reach, y + reach) > 0) hug++;
  }
  const coverage = +(hit / boundaryCount).toFixed(3), hugging = +(hug / outlineCount).toFixed(3);
  return { found: coverage >= minCoverage && outlineCount >= minPixels && hugging >= 0.9, coverage, pixels: outlineCount, hugging, shape: shapeCount, boundary: boundaryCount };
}

/** Pixels that differ by more than `tolerance` in any channel between two frames of the same size (a frame difference), inside the region. */
export function changedPixels(a, b, { tolerance = 8, region = FULL } = {}) {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`frames differ in size: ${a.width}x${a.height} and ${b.width}x${b.height}`);
  const r = region || { x0: 0, y0: 0, x1: a.width, y1: a.height };
  let n = 0;
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
    const i = (y * a.width + x) * 4;
    if (Math.abs(a.rgba[i] - b.rgba[i]) > tolerance || Math.abs(a.rgba[i + 1] - b.rgba[i + 1]) > tolerance || Math.abs(a.rgba[i + 2] - b.rgba[i + 2]) > tolerance) n++;
  }
  return n;
}

/** The share of the image that is not backdrop: a station that drew nothing reads near 0. */
export function drawnShare(img, { bgTolerance = 14, region = FULL } = {}) {
  const r = region || { x0: 0, y0: 0, x1: img.width, y1: img.height }, bg = pixel(img, ...WALL_PIXEL);
  let n = 0;
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) if (!near(pixel(img, x, y), bg, bgTolerance)) n++;
  return +(n / ((r.x1 - r.x0) * (r.y1 - r.y0))).toFixed(4);
}

export const REGIONS = {
  ribbon: { x0: 0, y0: 200, x1: 1280, y1: 520 },
  mesh: { x0: 440, y0: 160, x1: 840, y1: 560 },
};

/** A stepped look in a frame: at least two flat bands and few levels, mostly flat, against a control that is a gradient (many levels, mostly not flat; a gradient clamps flat at its ends, so the control may hold a band or two). */
export const stepped = (m, control) => Boolean(m && control && m.bands >= 2 && m.levels <= 8 && m.flatShare >= 0.5 && control.levels >= 12 && control.flatShare <= 0.5);

/**
 * Everything the new checks need from the engine screenshots. `load(name)` returns a decoded stylized_<name>.png; a shot that is
 * missing (a group that did not run, or a failed capture) leaves its entry undefined, so a partial run still judges what it has.
 */
export function measureInk(load, groups = GROUPS) {
  const out = { rings: {}, bands: {}, changed: {}, drawn: {} }, grab = (name) => { try { return load(name); } catch { return undefined; } };
  const on = (g) => groups.includes(g);
  const swatch = on('outline') ? grab('o_swatch') : undefined;
  out.colour = swatch ? pixel(swatch, 640, 360) : undefined;
  const colour = out.colour || OUTLINE_FALLBACK;
  const ring = (name, opts = {}) => { const img = grab(name); if (img) out.rings[name] = outlineRing(img, { colour, ...opts }); return img; };
  if (on('outline')) {
    for (const name of ['o_none', 'o_ramp', 'o_flange']) ring(name);
    for (const name of ['o_stencil_sprite', 'o_stencil_mesh']) {
      const lit = ring(name), off = grab(name + '_off');
      if (lit && off) out.changed[name] = changedPixels(lit, off);
      if (off) out.rings[name + '_off'] = outlineRing(off, { colour });
    }
  }
  if (on('ribbon')) {
    for (const name of ['r_smooth', 'r_ink', 'r_edge']) { const img = grab(name); if (img) { out.bands[name] = bandsIn(img, REGIONS.ribbon); out.drawn[name] = drawnShare(img); } }
    ring('r_edge');
    const lit = ring('r_stencil'), off = grab('r_stencil_off');
    if (lit && off) out.changed.r_stencil = changedPixels(lit, off);
  }
  if (on('mesh')) {
    for (const name of ['m_smooth', 'm_ink']) { const img = grab(name); if (img) { out.bands[name] = bandsIn(img, REGIONS.mesh); out.drawn[name] = drawnShare(img); } }
    const lit = ring('m_stencil'), off = grab('m_stencil_off');
    if (lit && off) out.changed.m_stencil = changedPixels(lit, off);
  }
  if (on('cost')) for (const name of ['c_control', 'c_ink', 'c_drawn']) { const img = grab(name); if (img) out.drawn[name] = drawnShare(img); }
  return out;
}

// ---------------------------------------------------------------- frame cost

/** nvidia-smi `--query-gpu=...utilization.gpu,memory.used --format=csv,noheader[,nounits]` lines to samples: "1 %, 26158 MiB" or "2026/10/29 14:03:11.123, 3 %, 26158 MiB". */
export function parseSmi(text = '') {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(',').map((c) => c.trim());
    if (cells.length < 2) continue;
    const mem = cells[cells.length - 1].match(/^(\d+)(?:\s*MiB)?$/), util = cells[cells.length - 2].match(/^(\d+)(?:\s*%)?$/);
    if (!util || !mem) continue;
    const stamp = cells.length >= 3 ? Date.parse(cells[0].replaceAll('/', '-').replace(' ', 'T')) : NaN;
    out.push({ util: Number(util[1]), memMiB: Number(mem[1]), ...(Number.isFinite(stamp) ? { t: stamp } : {}) });
  }
  return out;
}

/**
 * One numeric column of a CSV-profiler file. The file has a header row (EVENTS, then the stat names) first and again last (the
 * last is the complete one), metadata rows start with `[`, and a data row holds as many cells as the stats seen up to that frame, so
 * rows differ in length; a stat keeps its column number, which is read from the last header that names it.
 */
export function parseCsvColumn(text = '', name) {
  const rows = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('[')).map((l) => l.split(',').map((c) => c.trim()));
  const headers = rows.filter((r) => r[0] === 'EVENTS' || r.includes(name));
  const header = [...headers].reverse().find((r) => r.includes(name));
  if (!header) return [];
  const col = header.indexOf(name);
  return rows.filter((r) => !headers.includes(r) && r.length > col && r[col] !== '').map((r) => Number(r[col])).filter((v) => Number.isFinite(v));
}

export const median = (xs) => { if (!xs.length) return undefined; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const percentile = (xs, p) => { if (!xs.length) return undefined; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const round = (v, d = 3) => (v === undefined ? undefined : +v.toFixed(d));

/**
 * May a millisecond difference between the ink look and the control be recorded? Only when other processes' use of the GPU is low and
 * the repeats agree. Their use is read when this probe's own process is not running, in the readings taken just before it
 * starts and just after it ends (`other`); the readings taken during the run include the editor itself and are kept as a record
 * (`during`, and `inWindows` for those that fall inside a measured window). A second guard sits in the data: every scene is measured
 * in `rounds` windows, and when the medians of one scene differ by more than `maxSpread`, something else was using the GPU.
 *
 * @param {{ before: {util:number,memMiB:number}[], after: {util:number,memMiB:number}[], during?: {t?:number,util:number,memMiB:number}[],
 *           windows: { scene: string, round: number, gpuMs: number[], t0?: number, t1?: number }[], counts?: Record<string, number> }} r
 * @param {{ thresholdPct?: number, maxSpread?: number, trim?: number, minFrames?: number, control?: string, look?: string }} opts
 */
export function costVerdict(r, { thresholdPct = 10, maxSpread = 0.1, trim = 10, minFrames = 100, control = 'c_control', look = 'c_ink' } = {}) {
  const readings = {
    before: (r.before || []).map((s) => s.util), after: (r.after || []).map((s) => s.util),
    memBeforeMiB: (r.before || []).map((s) => s.memMiB), duringMax: Math.max(0, ...(r.during || []).map((s) => s.util)),
  };
  const windows = r.windows || [];
  readings.inWindows = (r.during || []).filter((s) => s.t !== undefined && windows.some((w) => w.t0 !== undefined && s.t >= w.t0 * 1000 && s.t <= w.t1 * 1000)).map((s) => s.util);
  const decline = (reason, code) => ({ status: 'not measured', code, reason, readings });
  if (!readings.before.length || !readings.after.length) return decline('no GPU readings before and after the run', 'no-readings');
  const other = Math.max(...readings.before, ...readings.after);
  readings.otherMax = other;
  if (other >= thresholdPct) return decline(`other processes used ${other} percent of the GPU (limit ${thresholdPct})`, 'busy');
  const scenes = {};
  for (const w of windows) {
    const frames = (w.gpuMs || []).slice(trim);
    if (frames.length < minFrames) return decline(`window ${w.scene} round ${w.round} holds ${frames.length} frames (need ${minFrames})`, 'no-window');
    (scenes[w.scene] ||= []).push({ round: w.round, median: median(frames), p95: percentile(frames, 95), frames: frames.length });
  }
  for (const name of [control, look]) if (!scenes[name]) return decline(`no measured window for ${name}`, 'no-window');
  const counts = r.counts || {};
  if (counts[control] === undefined || counts[control] !== counts[look]) return decline(`particle counts differ or are unknown (${control} ${counts[control]}, ${look} ${counts[look]})`, 'counts');
  const result = { counts: counts[control], scenes: {} };
  for (const [name, rounds] of Object.entries(scenes)) {
    const meds = rounds.map((x) => x.median), spread = rounds.length > 1 ? (Math.max(...meds) - Math.min(...meds)) / Math.min(...meds) : 0;
    result.scenes[name] = { medianMs: round(median(meds)), p95Ms: round(median(rounds.map((x) => x.p95))), rounds: rounds.map((x) => round(x.median)), frames: rounds.map((x) => x.frames), spread: round(spread) };
    if (spread > maxSpread) return { ...decline(`the rounds of ${name} differ by ${round(spread * 100, 1)} percent (limit ${maxSpread * 100})`, 'unstable'), result };
  }
  const diff = result.scenes[look].medianMs - result.scenes[control].medianMs;
  return { status: 'measured', code: 'measured', reason: '', readings, result: { ...result, diffMs: round(diff), ratio: round(result.scenes[look].medianMs / result.scenes[control].medianMs, 2) } };
}

/** One line for the run log and the console. */
export function describeCost(v) {
  const readings = `GPU use before ${JSON.stringify(v.readings?.before)} after ${JSON.stringify(v.readings?.after)} percent, during the run up to ${v.readings?.duringMax}`;
  if (v.status !== 'measured') return `not measured (${v.code}): ${v.reason}; ${readings}`;
  const s = v.result.scenes;
  return `ink minus control ${v.result.diffMs} ms (control ${s.c_control.medianMs}, ink ${s.c_ink.medianMs}, ratio ${v.result.ratio}; ${v.result.counts} particles); ${readings}`;
}
