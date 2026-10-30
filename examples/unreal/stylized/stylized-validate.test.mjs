// node --test examples/unreal/stylized/stylized-validate.test.mjs  (no Unreal, no dependencies)
// The reports below are what the stylized scripts measured on Unreal 5.8.2; each test changes one fact and expects the matching check
// to fail, so the validator cannot pass by accident. The image tests build small PNGs in memory and run the real reader and counters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { countNear, decodePng, foreground, pixel, regionHash } from './png-tools.mjs';
import { bandsIn, cellFillCounts, drawnShot, measureAll } from './stylized-measure.mjs';
import { evaluate, evaluateInk, logProblems, readGetAll, summarize } from './stylized-validate-checks.mjs';
import { changedPixels, costVerdict, describeCost, drawnShare, GROUPS, measureInk, median, outlineRing, parseCsvColumn, parseSmi, percentile, STATIONS } from './stylized-ink.mjs';
import { readFileSync } from 'node:fs';

// ---- PNG helpers: encode a colour function into a PNG so decodePng sees what the engine's writer produces (RGBA, filter 0 or 1)
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
function encodePng(width, height, colorAt, { sub = false } = {}) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x++) row.set([...colorAt(x, y), 255], 1 + x * 4);
    if (sub) { row[0] = 1; for (let i = width * 4; i >= 1; i--) if (i > 4) row[i] = (row[i] - row[i - 4]) & 255; }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const BG = [36, 44, 63];
const image = (colorAt, opts) => decodePng(encodePng(1280, 720, colorAt, opts));

test('decodePng reads unfiltered and Sub-filtered RGBA rows', () => {
  for (const sub of [false, true]) {
    const img = image((x, y) => [x % 256, y % 256, (x + y) % 256], { sub });
    assert.deepEqual([img.width, img.height], [1280, 720]);
    assert.deepEqual(pixel(img, 300, 200), [300 % 256, 200, 500 % 256]);
  }
});

test('luminanceBands counts flat steps and reports no band for a gradient', () => {
  const stepped = image((x, y) => (Math.hypot(x - 640, y - 360) > 200 ? BG : x < 560 ? [30, 30, 100] : x < 700 ? [200, 180, 100] : [240, 230, 120]));
  const region = { x0: 380, y0: 100, x1: 900, y1: 620 };
  const s = bandsIn(stepped, region);
  assert.equal(s.bands, 3);
  assert.ok(s.flatShare > 0.95 && s.levels <= 4);
  const smooth = image((x, y) => (Math.hypot(x - 640, y - 360) > 200 ? BG : [x % 256 >> 0, 120, 60]));
  const g = bandsIn(smooth, region);
  assert.equal(g.bands, 0);
  assert.ok(g.levels >= 12 && g.flatShare === 0);
});

test('foreground, countNear and regionHash measure against the backdrop', () => {
  const img = image((x, y) => (x >= 600 && x < 680 && y >= 300 && y < 400 ? [240, 229, 110] : BG));
  const whole = { x0: 0, y0: 0, x1: 1280, y1: 720 };
  assert.equal(foreground(img, BG, 5, whole).length, 80 * 100);
  assert.equal(countNear(img, [243, 229, 110], 8, whole), 80 * 100);
  assert.equal(countNear(img, [10, 10, 10], 8, whole), 0);
  const same = image((x, y) => (x >= 600 && x < 680 && y >= 300 && y < 400 ? [240, 229, 110] : BG));
  assert.equal(regionHash(img, whole), regionHash(same, whole));
  assert.notEqual(regionHash(img, whole), regionHash(image(() => BG), whole));
});

test('cellFillCounts reads each flipbook cell and drawnShot reads the on-screen area', () => {
  // a 4x4 flipbook, 8 px cells; cell k has k+1 fill pixels in a row at the top
  const flip = decodePng(encodePng(32, 32, (x, y) => { const k = Math.floor(y / 8) * 4 + Math.floor(x / 8); return y % 8 === 0 && x % 8 <= k ? [240, 196, 64] : [0, 0, 0]; }));
  assert.deepEqual(cellFillCounts(flip), Array.from({ length: 16 }, (_, k) => Math.min(k + 1, 8)));
  const shot = image((x, y) => (Math.abs(x - 640) < 50 && Math.abs(y - 360) < 40 ? [243, 229, 110] : BG));
  const d = drawnShot(shot);
  assert.equal(d.fill, 99 * 79);
  assert.deepEqual(d.center, [243, 229, 110]);
});

test('measureAll maps the shot names to the measurements', () => {
  const sprite = (colorAt) => image((x, y) => (Math.hypot(x - 640, y - 360) > 200 ? BG : colorAt(x, y)));
  const flat = sprite((x) => (x < 600 ? [200, 180, 100] : [240, 230, 120]));
  const gradient = sprite((x) => [x % 256, 100, 60]);
  const drawn = (half) => image((x, y) => (Math.abs(x - 640) < half && Math.abs(y - 360) < half ? [243, 229, 110] : BG));
  const cells = Array.from({ length: 16 }, (_, k) => 100 + k * 10);
  const load = (name) => {
    if (name === 'meshes') return flat;
    if (name === 'smooth') return gradient;
    if (name.startsWith('drawn_t')) return drawn(30 + Number(name.slice(7)) * 5);
    if (name.startsWith('frame_')) { const f = Number(name.split('_')[1]); return drawn(Math.sqrt(cells[f] * 13 + 1) / 2); }
    return flat;
  };
  const m = measureAll(load, cells, [2, 9, 13]);
  assert.ok(m.toonSphere && m.stepped.bands >= 1 && m.smooth.bands === 0);
  assert.equal(new Set(m.timed).size, 8);
  assert.ok(m.fixedRatioSpread < 0.1);
  assert.equal(m.bright.center[0], 243);
});

test('readGetAll and logProblems parse the engine log', () => {
  const log = "[x][  0]0) MaterialInstanceConstant /Game/Stylized/MI_ToonLit.MI_ToonLit.ToonProfileOverride = /Script/Engine.ToonProfile'/Game/Stylized/TP_Ink.TP_Ink'\n"
    + '[x][  0]0) MaterialInstanceConstant /Game/Stylized/MI_ToonLit.MI_ToonLit.bOverrideToonProfile = True\n';
  assert.equal(readGetAll(log, 'ToonProfileOverride'), '/Game/Stylized/TP_Ink.TP_Ink');
  assert.equal(readGetAll(log, 'bOverrideToonProfile'), 'True');
  assert.equal(readGetAll('', 'ToonProfileOverride'), undefined);
  assert.equal(readGetAll(log.replace(/= .*TP_Ink'/, '= None'), 'ToonProfileOverride'), 'None');
  assert.deepEqual(logProblems('LogMaterial: Display: fine\nLogShaderCompilers: Error: bad\nLogTemp: ok\nLogMaterial: Warning: [M_X] missing'), ['LogShaderCompilers: Error: bad', 'LogMaterial: Warning: [M_X] missing']);
  assert.deepEqual(logProblems('LogNiagara: Display: compiled'), []);
});

// ---- the checks, with the numbers measured on Unreal 5.8.2
const good = () => ({
  bare: { 'r.Substrate': 0, 'r.Substrate.ProjectGBufferFormat': 1 },
  build: {
    substrate_cvar: 1, gbuffer_format_cvar: 0,
    steps: ['toon_profile', 'toon_lit', 'toon_sprite_masked', 'toon_sprite_translucent', 'toon_instance'].map((step) => ({
      step, ok: true,
      ...(step === 'toon_profile' ? { saved: true, default_diffuse_ramp_keys: [[0, 0], [0.25, 0], [0.26, 0.25], [0.5, 0.25], [0.51, 0.5], [0.75, 0.5], [0.76, 0.75], [0.99, 0.75], [1, 1]] } : {}),
      ...(step === 'toon_lit' ? { toon_inputs: ['BaseColor', 'Metallic', 'Specular', 'Roughness', 'Normal', 'EmissiveColor', 'PatternUVs', 'Anisotropy', 'Tangent'] } : {}),
    })),
  },
  render: {
    compile: Object.fromEntries(['NS_Drawn', 'NS_Drawn2', 'NS_Drawn9', 'NS_Drawn13', 'NS_Smooth', 'NS_Stepped', 'NS_ToonMasked', 'NS_ToonTranslucent'].map((n) => [n, { aggregateStatus: 'UpToDate', bHasErrors: false }])),
    flipbook_sample: { sub_image_index: [15.97, ...Array.from({ length: 119 }, (_, i) => (i + 1) * (16 / 120))] },
  },
  persistWrite: { set_by_property_name: false, property_name_error: "MaterialInstanceConstant: Failed to find property 'toon_profile_override'", override_flag_after: true, saved: true },
  persistRead: { override_flag: true },
  logs: {
    build: 'LogPython: Display: ok', render: 'LogPython: Display: ok',
    persistWrite: "0) MaterialInstanceConstant /Game/Stylized/MI_ToonLit.MI_ToonLit.ToonProfileOverride = /Script/Engine.ToonProfile'/Game/Stylized/TP_Ink.TP_Ink'",
    persistRead: "0) MaterialInstanceConstant /Game/Stylized/MI_ToonLit.MI_ToonLit.ToonProfileOverride = /Script/Engine.ToonProfile'/Game/Stylized/TP_Ink.TP_Ink'\n0) MaterialInstanceConstant /Game/Stylized/MI_ToonLit.MI_ToonLit.bOverrideToonProfile = True",
  },
  measures: {
    toonSphere: { bands: 2, levels: 8, flatShare: 0.528 }, plainSphere: { bands: 0, levels: 18, flatShare: 0 },
    toonMasked: { bands: 3, levels: 6, flatShare: 0.804, pixels: 164144 }, toonTranslucent: { bands: 2, levels: 5, flatShare: 0.83, pixels: 164144 },
    stepped: { bands: 3, levels: 5, flatShare: 0.953 }, smooth: { bands: 1, levels: 16, flatShare: 0.14 },
    timed: [54773, 40260, 51613, 40260, 56192, 37308, 56192, 64034],
    fixed: [{ frame: 2 }, { frame: 9 }, { frame: 13 }], fixedRatioSpread: 0.001, fixedRatioMedian: 12.75,
    bright: { fill: 38201, center: [243, 229, 110], backdrop: [237, 237, 236] }, dark: { fill: 38201, center: [243, 230, 110], backdrop: [36, 44, 63] },
  },
});
const failing = (mutate) => { const r = good(); mutate(r); return evaluate(r).filter((c) => !c.pass).map((c) => c.name); };

test('the recorded Unreal 5.8.2 results pass every check', () => {
  const checks = evaluate(good());
  assert.deepEqual(checks.filter((c) => !c.pass), []);
  assert.deepEqual(summarize(checks), { passed: 17, total: 17 });
});

test('missing results fail their checks instead of throwing', () => {
  const checks = evaluate({});
  assert.ok(checks.length === 17 && checks.every((c) => !c.pass));
});

test('each claim fails when its fact changes', () => {
  assert.deepEqual(failing((r) => { r.bare['r.Substrate'] = 1; }), ['a bare project has Substrate off and the Adaptive GBuffer']);
  assert.deepEqual(failing((r) => { r.build.steps[2].ok = false; }), ['a Toon Profile, Toon materials and a Toon instance are authored and saved from Python']);
  assert.deepEqual(failing((r) => { r.build.steps[0].default_diffuse_ramp_keys = [[0, 0], [1, 1]]; }), ['a new Toon Profile ships a stepped diffuse ramp']);
  assert.deepEqual(failing((r) => { r.build.steps[1].toon_inputs.push('Opacity'); }), ['the Toon BSDF has no opacity input, so a Weight node carries the translucent coverage']);
  assert.deepEqual(failing((r) => { r.measures.toonTranslucent.pixels = 100000; }), ['the Toon BSDF has no opacity input, so a Weight node carries the translucent coverage']);
  assert.deepEqual(failing((r) => { r.measures.toonSphere.bands = 1; }), ['the Toon material steps the lighting on an opaque mesh']);
  assert.deepEqual(failing((r) => { r.measures.plainSphere.bands = 2; }), ['the Toon material steps the lighting on an opaque mesh']);
  assert.deepEqual(failing((r) => { r.measures.toonMasked.flatShare = 0.2; }), ['a Toon material on a masked sprite is lit and stepped']);
  assert.deepEqual(failing((r) => { r.measures.toonTranslucent.bands = 1; }), ['a Toon material on a translucent sprite is lit and stepped']);
  assert.deepEqual(failing((r) => { r.logs.render = 'LogMaterial: Error: [M_Drawn] compile failed'; }), ['the materials compile without errors or fallbacks']);
  assert.deepEqual(failing((r) => { r.render.compile.NS_Smooth.aggregateStatus = 'Dirty'; }), ['every authored Niagara system compiles']);
  assert.deepEqual(failing((r) => { r.render.flipbook_sample.sub_image_index[50] = 1; }), ['the sub-image index advances with the particle age']);
  assert.deepEqual(failing((r) => { r.measures.timed = Array(8).fill(40260); }), ['screenshots of the running flipbook show different frames']);
  assert.deepEqual(failing((r) => { r.measures.fixedRatioSpread = 0.2; }), ['SubUV Direct Index shows the chosen cell']);
  assert.deepEqual(failing((r) => { r.measures.dark.fill = 30000; }), ['the flipbook sprite ignores the scene light and the backdrop']);
  assert.deepEqual(failing((r) => { r.measures.dark.backdrop = [230, 230, 230]; }), ['the flipbook sprite ignores the scene light and the backdrop']);
  assert.deepEqual(failing((r) => { r.measures.stepped.levels = 30; r.measures.stepped.bands = 3; }), ['a floor-quantized ramp material renders flat bands on a particle']);
  assert.deepEqual(failing((r) => { r.measures.stepped.bands = 4; }), ['the Niagara Dynamic Material Parameter reaches the material']);
  assert.deepEqual(failing((r) => { r.persistWrite.set_by_property_name = true; r.persistWrite.property_name_error = ''; }), ['the Python property name for the override does not exist', 'a Toon Profile override survives save and an editor restart']);
  assert.deepEqual(failing((r) => { r.logs.persistRead = r.logs.persistRead.replace(/ToonProfileOverride = .*TP_Ink'/, 'ToonProfileOverride = None'); }), ['a Toon Profile override survives save and an editor restart']);
});

// ---------------------------------------------------------------- ink-brush groups: the pixel judging code
const OUT = [64, 237, 225], BODY = [240, 196, 64];
const raw = (colorAt, width = 1280, height = 720) => {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set([...colorAt(x, y), 255], (y * width + x) * 4);
  return { width, height, rgba };
};
/** A disc of `body` colour with an outer ring of `ring` colour `thick` pixels wide, on the backdrop. */
const disc = ({ r = 100, thick = 0, ring = OUT, body = BODY, arc = 360, inside = null } = {}) => raw((x, y) => {
  const d = Math.hypot(x - 640, y - 360), angle = ((Math.atan2(y - 360, x - 640) * 180) / Math.PI + 360) % 360;
  if (d <= r) return inside || body;
  return thick && d <= r + thick && angle < arc ? ring : BG;
});

test('outlineRing finds a ring around a shape and nothing around a bare one', () => {
  const ringed = outlineRing(disc({ thick: 8 }), { colour: OUT });
  assert.equal(ringed.found, true);
  assert.ok(ringed.coverage >= 0.95 && ringed.hugging >= 0.99 && ringed.pixels > 4000, JSON.stringify(ringed));
  const bare = outlineRing(disc(), { colour: OUT });
  assert.deepEqual([bare.found, bare.pixels], [false, 0]);
});

test('outlineRing rejects a partial arc, a filled blob of the colour, a near colour, and a ring too thin to count', () => {
  const arc = outlineRing(disc({ thick: 8, arc: 150 }), { colour: OUT });
  assert.ok(!arc.found && arc.coverage < 0.6, JSON.stringify(arc));
  const blob = outlineRing(disc({ inside: OUT }), { colour: OUT });
  assert.ok(!blob.found && blob.hugging < 0.7, JSON.stringify(blob));
  assert.equal(outlineRing(disc({ thick: 8, ring: [200, 60, 60] }), { colour: OUT }).found, false);
  assert.equal(outlineRing(disc({ r: 8, thick: 2 }), { colour: OUT }).found, false);
  const shifted = disc({ thick: 8, ring: [80, 225, 215] });   // the colour as a post process may shift it
  assert.equal(outlineRing(shifted, { colour: OUT }).found, true);
  assert.equal(outlineRing(shifted, { colour: OUT, tolerance: 5 }).found, false);
});

test('outlineRing treats the frame edge as shape, so a ribbon that runs off the frame needs only its long edges', () => {
  const ribbon = raw((x, y) => (y < 250 || y >= 470 ? BG : y < 258 || y >= 462 ? OUT : BODY));
  const r = outlineRing(ribbon, { colour: OUT });
  assert.ok(r.found && r.coverage >= 0.99, JSON.stringify(r));
  const plain = raw((x, y) => (y < 250 || y >= 470 ? BG : BODY));
  assert.equal(outlineRing(plain, { colour: OUT }).found, false);
});

test('changedPixels counts the frame difference and refuses frames of different sizes', () => {
  const a = disc(), b = disc({ thick: 8 });
  const n = changedPixels(a, b);
  assert.ok(n > 4000 && n < 6000, String(n));
  assert.equal(changedPixels(a, a), 0);
  assert.throws(() => changedPixels(a, raw(() => BG, 640, 360)), /differ in size/);
});

test('drawnShare reads how much of the frame is not backdrop', () => {
  assert.equal(drawnShare(raw(() => BG)), 0);
  assert.ok(Math.abs(drawnShare(disc({ r: 100 })) - (Math.PI * 100 * 100) / (1280 * 720)) < 0.002);
});

// ---------------------------------------------------------------- ink-brush groups: measuring a run
/** Frames for every station: a stepped sphere or ribbon, a smooth control, ringed stencil frames and their stencil-off twins. */
function inkFrames() {
  const stepsOf = (x) => (x < 580 ? [30, 30, 100] : x < 640 ? [120, 100, 100] : x < 700 ? [200, 180, 100] : [240, 230, 120]);
  const sphere = (colorAt) => raw((x, y) => (Math.hypot(x - 640, y - 360) > 140 ? BG : colorAt(x, y)));
  const strip = (colorAt, ring) => raw((x, y) => (y < 250 || y >= 470 ? BG : ring && (y < 258 || y >= 462) ? OUT : colorAt(x, y)));
  const gradient = (x) => [x % 256, 120, 60];
  const frames = {
    o_swatch: disc({ r: 120, body: OUT }), o_none: disc(), o_ramp: disc({ thick: 8 }), o_flange: disc({ thick: 8 }),
    o_stencil_sprite: disc({ thick: 8 }), o_stencil_sprite_off: disc(), o_stencil_mesh: disc({ r: 140, thick: 8 }), o_stencil_mesh_off: disc({ r: 140 }),
    r_smooth: strip((x) => gradient(x)), r_ink: strip((x) => stepsOf(x)), r_edge: strip((x) => stepsOf(x), true), r_stencil: strip((x) => stepsOf(x), true), r_stencil_off: strip((x) => stepsOf(x)),
    m_smooth: sphere((x) => gradient(x)), m_ink: sphere((x) => stepsOf(x)), m_stencil: disc({ r: 140, thick: 8 }), m_stencil_off: disc({ r: 140 }),
    c_control: disc({ r: 200 }), c_ink: disc({ r: 200 }), c_drawn: disc({ r: 200 }),
  };
  return (name) => { if (!frames[name]) throw new Error('no frame ' + name); return frames[name]; };
}

test('measureInk turns the station frames into rings, bands, frame differences and the swatch colour', () => {
  const m = measureInk(inkFrames());
  assert.deepEqual(m.colour, OUT);
  assert.equal(m.rings.o_none.found, false);
  for (const name of ['o_ramp', 'o_flange', 'o_stencil_sprite', 'o_stencil_mesh', 'r_edge', 'r_stencil', 'm_stencil']) assert.equal(m.rings[name].found, true, name);
  assert.equal(m.rings.o_stencil_sprite_off.found, false);
  assert.ok(m.changed.o_stencil_sprite > 4000 && m.changed.m_stencil > 4000);
  assert.ok(m.bands.r_ink.bands >= 2 && m.bands.r_smooth.bands === 0 && m.bands.m_ink.bands >= 2 && m.bands.m_smooth.levels >= 12);
  assert.ok(m.drawn.c_ink > 0.05);
});

test('measureInk leaves the entries of a missing frame undefined and ignores groups that did not run', () => {
  const frames = inkFrames();
  const m = measureInk((name) => { if (name === 'o_flange') throw new Error('missing'); return frames(name); }, ['outline']);
  assert.equal(m.rings.o_flange, undefined);
  assert.equal(m.rings.o_ramp.found, true);
  assert.deepEqual(Object.keys(m.bands), []);
  assert.equal(measureInk(() => { throw new Error('none'); }).colour, undefined);
});

// ---------------------------------------------------------------- ink-brush groups: readings and the cost gate
test('parseSmi reads nvidia-smi lines with and without a timestamp and skips others', () => {
  assert.deepEqual(parseSmi('1 %, 26158 MiB\n'), [{ util: 1, memMiB: 26158 }]);
  const stamped = parseSmi('2026/10/29 14:03:11.123, 7 %, 26200 MiB\n\ngarbage\nNo devices were found\n');
  assert.equal(stamped.length, 1);
  assert.deepEqual([stamped[0].util, stamped[0].memMiB], [7, 26200]);
  assert.ok(Number.isFinite(stamped[0].t));
  assert.deepEqual(parseSmi(''), []);
});

test('parseCsvColumn reads a CSV-profiler column with the header first or last and skips metadata rows', () => {
  const first = 'EVENTS,FrameTime,GPUTime\n,16.6,3.1\n,16.7,3.3\n[Platform],Windows\n';
  assert.deepEqual(parseCsvColumn(first, 'GPUTime'), [3.1, 3.3]);
  const last = ',16.6,3.1\n,16.7,3.3\nEVENTS,FrameTime,GPUTime\n[HasHeaderRowAtEnd],1\n';
  assert.deepEqual(parseCsvColumn(last, 'GPUTime'), [3.1, 3.3]);
  assert.deepEqual(parseCsvColumn(first, 'Nope'), []);
  assert.deepEqual([median([3, 1, 2]), median([1, 2, 3, 4]), median([]), percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)], [2, 2.5, undefined, 10]);
});

const windowsOf = ({ control = 1.0, ink = 1.6, rounds = 2, frames = 200, jitter = 0.01, inkRounds } = {}) => ['c_control', 'c_ink'].flatMap((scene) => Array.from({ length: rounds }, (_, round) => {
  const base = scene === 'c_control' ? control : (inkRounds ? inkRounds[round] : ink);
  return { scene, round, t0: 1000 + round * 20, t1: 1010 + round * 20, gpuMs: Array.from({ length: frames + 10 }, (_, i) => (i < 10 ? 9 : base + (i % 3) * jitter)) };
}));
const quiet = () => ({ before: [{ util: 1, memMiB: 26158 }, { util: 2, memMiB: 26158 }], after: [{ util: 1, memMiB: 26158 }], during: [{ t: 1005000, util: 55, memMiB: 28000 }, { t: 5000, util: 3, memMiB: 28000 }], windows: windowsOf(), counts: { c_control: 256, c_ink: 256 } });

test('costVerdict records the millisecond difference when the GPU was nearly idle around the run and the rounds agree', () => {
  const v = costVerdict(quiet());
  assert.equal(v.status, 'measured');
  assert.ok(Math.abs(v.result.diffMs - 0.6) < 0.02, JSON.stringify(v.result));
  assert.equal(v.result.counts, 256);
  assert.deepEqual([v.readings.before, v.readings.after, v.readings.duringMax, v.readings.inWindows], [[1, 2], [1], 55, [55]]);
  assert.match(describeCost(v), /ink minus control 0\.6\d* ms/);
});

test('costVerdict says "not measured" with the readings when other processes are busy, the rounds disagree, or the data is short', () => {
  const busy = costVerdict({ ...quiet(), before: [{ util: 1, memMiB: 1 }, { util: 38, memMiB: 1 }] });
  assert.deepEqual([busy.status, busy.code], ['not measured', 'busy']);
  assert.match(describeCost(busy), /not measured \(busy\).*38 percent.*before \[1,38\]/);
  assert.equal(costVerdict({ ...quiet(), after: [{ util: 10, memMiB: 1 }] }).code, 'busy', 'ten percent is not under ten percent');
  const drift = costVerdict({ ...quiet(), windows: windowsOf({ inkRounds: [1.6, 2.2] }) });
  assert.deepEqual([drift.status, drift.code], ['not measured', 'unstable']);
  assert.ok(drift.result.scenes.c_ink.spread > 0.3);
  assert.equal(costVerdict({ ...quiet(), windows: windowsOf({ frames: 20 }) }).code, 'no-window');
  assert.equal(costVerdict({ ...quiet(), windows: windowsOf().filter((w) => w.scene === 'c_control') }).code, 'no-window');
  assert.equal(costVerdict({ ...quiet(), counts: { c_control: 256, c_ink: 255 } }).code, 'counts');
  assert.equal(costVerdict({ ...quiet(), before: [], after: [] }).code, 'no-readings');
});

// ---------------------------------------------------------------- ink-brush groups: the checks
const allWork = Object.fromEntries(['ramp', 'flange', 'stencil_sprite', 'stencil_mesh', 'ribbon_stepped', 'ribbon_edge', 'ribbon_stencil', 'mesh_stepped', 'mesh_stencil'].map((k) => [k, true]));
const inkRun = () => {
  const counts = Object.fromEntries(Object.values(STATIONS).flat().map((s) => [s, s.startsWith('c_') ? 256 : 1]));
  const compile = Object.fromEntries(['NS_Swatch', 'NS_OutlineRamp'].map((n) => [n, { aggregateStatus: 'UpToDate', bHasErrors: false }]));
  return { groups: GROUPS, expected: { ...allWork }, measures: measureInk(inkFrames()), cost: costVerdict(quiet()), render: { counts, compile }, logs: { build: 'LogPython: ok', render: 'LogPython: ok' } };
};
const failingInk = (mutate) => { const r = inkRun(); mutate(r); return evaluateInk(r).filter((c) => !c.pass).map((c) => c.name); };

test('the ink-brush checks pass when the frames agree with the table', () => {
  const checks = evaluateInk(inkRun());
  assert.deepEqual(checks.filter((c) => !c.pass), []);
  assert.deepEqual(summarize(checks), { passed: 16, total: 16 });
});

test('a method that does not work is a recorded negative result, not a failing probe', () => {
  const r = inkRun();
  r.expected.flange = false;
  r.measures.rings.o_flange = { ...r.measures.rings.o_flange, found: false, coverage: 0, pixels: 0 };
  const checks = evaluateInk(r);
  assert.deepEqual(checks.filter((c) => !c.pass), []);
  assert.ok(checks.some((c) => c.name === 'a coverage flange (second sprite renderer behind the first) draws no ring'));
});

test('each ink-brush claim fails when its fact changes', () => {
  assert.deepEqual(failingInk((r) => { r.measures.rings.o_ramp.found = false; }), ['a coverage-ramp outline in the flipbook material draws a ring']);
  assert.deepEqual(failingInk((r) => { r.measures.rings.o_none.found = true; r.measures.rings.o_none.pixels = 900; }), ['the drawn flipbook with no outline method has no ring']);
  assert.deepEqual(failingInk((r) => { r.measures.changed.o_stencil_sprite = 12; }), ['a custom-depth stencil outline on the sprite renderer draws a ring']);
  assert.deepEqual(failingInk((r) => { r.measures.rings.r_edge.found = false; }), ['a coverage-ramp outline on a ribbon draws a ring']);
  assert.deepEqual(failingInk((r) => { r.measures.bands.r_smooth = { bands: 2, levels: 4, flatShare: 0.9 }; }), ['the ink material on a ribbon renderer is lit in flat bands']);
  assert.deepEqual(failingInk((r) => { r.measures.bands.m_ink.bands = 1; }), ['the ink material on a mesh-particle renderer is lit in flat bands']);
  assert.deepEqual(failingInk((r) => { r.measures.colour = [20, 20, 20]; }), ['a flat swatch shows the outline colour']);
  assert.deepEqual(failingInk((r) => { r.render.counts.r_ink = 0; }), ['every ink station emits particles']);
  assert.deepEqual(failingInk((r) => { r.render.compile.NS_Swatch.aggregateStatus = 'Dirty'; }), ['every authored Niagara system compiles']);
  assert.deepEqual(failingInk((r) => { r.logs.render = 'LogMaterial: Error: [M_RibbonInk] failed'; }), ['the ink-brush materials compile without errors or fallbacks']);
  assert.deepEqual(failingInk((r) => { r.render.counts.c_ink = 128; }), ['the cost scenes hold the same particle count']);
  assert.deepEqual(failingInk((r) => { r.cost = costVerdict({ ...quiet(), windows: [] }); }), ['the frame cost is recorded, or declined with the GPU readings']);
  assert.deepEqual(failingInk((r) => { delete r.expected.ramp; }), ['a coverage-ramp outline in the flipbook material draws a ring']);
});

test('a busy GPU is a complete answer for the cost check', () => {
  const r = inkRun();
  r.cost = costVerdict({ ...quiet(), before: [{ util: 60, memMiB: 1 }] });
  assert.deepEqual(evaluateInk(r).filter((c) => !c.pass), []);
});

test('the node station table matches stylized_ink.py, which the build and render scripts share', () => {
  const py = readFileSync(new URL('./stylized_ink.py', import.meta.url), 'utf8');
  const rows = [...py.matchAll(/\("([a-z_]+)", "(outline|ribbon|mesh|cost)", "NS_\w+", (?:True|False)\)/g)].map((m) => [m[2], m[1]]);
  const byGroup = {};
  for (const [group, name] of rows) (byGroup[group] ||= []).push(name);
  assert.deepEqual(byGroup, STATIONS);
  assert.deepEqual(py.match(/ALL_GROUPS = \(([^)]*)\)/)[1].replaceAll('"', '').split(',').map((g) => g.trim()), GROUPS);
});
