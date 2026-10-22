// node --test examples/unreal/stylized/stylized-validate.test.mjs  (no Unreal, no dependencies)
// The reports below are what the stylized scripts measured on Unreal 5.8.2; each test changes one fact and expects the matching check
// to fail, so the validator cannot pass by accident. The image tests build small PNGs in memory and run the real reader and counters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { countNear, decodePng, foreground, pixel, regionHash } from './png-tools.mjs';
import { bandsIn, cellFillCounts, drawnShot, measureAll } from './stylized-measure.mjs';
import { evaluate, logProblems, readGetAll, summarize } from './stylized-validate-checks.mjs';

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
