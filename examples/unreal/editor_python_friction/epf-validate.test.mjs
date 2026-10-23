// node --test examples/unreal/editor_python_friction/epf-validate.test.mjs  (no Unreal, no dependencies)
// The reports below are what epf_box.py and epf_import.py wrote on Unreal 5.8.2; each mutation changes one fact and expects the matching
// check to fail. The last test parses the glTF files that tiny_glb.mjs writes, so the generator cannot drift into invalid files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize, countAlphaModeLines } from './epf-validate-checks.mjs';
import { buildStatic, buildSkinned } from './tiny_glb.mjs';

const LINE = "[2026.10.23-05.06.20:102][  0]LogInterchangeEngine: Error: [ : '', Unknown] Invalid input AlphaMode for material expression node MF_Default_Body.";
const SUMMARY = `[2026.10.23-05.06.20:236][  0]LogInit: Display: ${LINE.split(']').slice(2).join(']').trim()}`;
const attemptError = (text) => ({ ok: false, error: text });
const good = (min, max) => ({ ok: true, min, max, is_valid: true });

const canned = () => ({
  box: {
    keywords_with_is_valid: attemptError('TypeError: call() takes at most 2 arguments (3 given)'),
    is_valid_only: attemptError("TypeError: call() 'is_valid' is an invalid keyword argument for this function"),
    three_positional: attemptError('TypeError: call() takes at most 2 arguments (3 given)'),
    positional: good([-1, -2, -3], [4, 5, 6]), keywords: good([-1, -2, -3], [4, 5, 6]),
    set_false: false, set_true: true, bounds_after_set: [-1, 6],
  },
  imports: {
    static_default: { returned: true, assets: { StaticMesh: ['Pane', 'Plate', 'Screen'], MaterialInstanceConstant: ['Cutout', 'Glass', 'Opaque'] } },
    static_owned: {
      returned: true, assets: { StaticMesh: ['Pane', 'Plate', 'Screen'], Material: ['Cutout', 'Glass', 'Opaque'] },
      mf_default_body_inputs: { count: 89, has_AlphaMode: false, has_AlphaCutoff: true },
      materials: { Cutout: { blend_mode: 'BLEND_MASKED', mask_clip: 0.5 }, Glass: { blend_mode: 'BLEND_TRANSLUCENT', mask_clip: 0.333 }, Opaque: { blend_mode: 'BLEND_OPAQUE', mask_clip: 0.333 } },
    },
    skinned_default: { returned: true, assets: { SkeletalMesh: ['skinned'], AnimSequence: ['skinned_Anim'], Skeleton: ['skinned_Skeleton'], MaterialInstanceConstant: ['Cloth'] } },
    skinned_owned: {
      returned: true, assets: { SkeletalMesh: ['skinned'], AnimSequence: ['skinned_Anim'], Skeleton: ['skinned_Skeleton'], PhysicsAsset: ['skinned_PhysicsAsset'], Material: ['Cloth'] },
      materials: { Cloth: { blend_mode: 'BLEND_TRANSLUCENT', mask_clip: 0.333 } },
    },
  },
  logs: { static_default: 'LogInterchangeEngine: Display: Interchange import completed', static_owned: `${LINE}\n${LINE}\n${SUMMARY}\n`, skinned_default: '', skinned_owned: `${LINE}\n${SUMMARY}\n` },
  exits: { box: 0, static_default: 0, static_owned: 1, skinned_default: 0, skinned_owned: 1 },
});

const failing = (r) => evaluate(r).filter((c) => !c.pass).map((c) => c.name);
const mutate = (fn) => { const r = canned(); fn(r); return failing(r); };

test('the 5.8.2 reports pass every check', () => {
  assert.deepEqual(failing(canned()), []);
  assert.deepEqual(summarize(evaluate(canned())), { passed: 8, total: 8 });
});

test('the log counter ignores the closing error summary', () => {
  assert.equal(countAlphaModeLines(`${LINE}\n${LINE}\n${SUMMARY}\n`), 2);
  assert.equal(countAlphaModeLines(''), 0);
});

test('Box checks fail when the constructor behaves differently', () => {
  assert.deepEqual(mutate((r) => { r.box.keywords_with_is_valid = good([-1, -2, -3], [4, 5, 6]); }), ['Box rejects is_valid as a constructor argument']);
  assert.deepEqual(mutate((r) => { r.box.keywords.is_valid = false; }), ['Box(min, max) and Box(min=, max=) build a valid box']);
  assert.deepEqual(mutate((r) => { r.box.set_false = true; }), ['is_valid is set with set_editor_property']);
});

test('import checks fail when the log line, the assets or the exit code change', () => {
  const owned = 'an owned pipeline imports meshes and materials and logs the AlphaMode line once per non-opaque material';
  assert.deepEqual(mutate((r) => { r.logs.static_default = `${LINE}\n`; }), ['the default glTF stack imports a static file without the log line']);
  assert.deepEqual(mutate((r) => { r.logs.static_owned = `${LINE}\n`; }), [owned]);
  assert.deepEqual(mutate((r) => { r.imports.static_owned.assets.StaticMesh.pop(); }), [owned]);
  assert.deepEqual(mutate((r) => { r.imports.static_owned.materials.Glass.blend_mode = 'BLEND_OPAQUE'; }), [owned]);
  assert.deepEqual(mutate((r) => { delete r.imports.skinned_owned.assets.AnimSequence; }), ['an owned pipeline imports a skinned file with a clip and still logs the line once']);
  assert.deepEqual(mutate((r) => { r.logs.skinned_owned = ''; }), ['an owned pipeline imports a skinned file with a clip and still logs the line once']);
  assert.deepEqual(mutate((r) => { r.logs.skinned_default = `${LINE}\n`; }), ['an owned pipeline imports a skinned file with a clip and still logs the line once']);
  assert.deepEqual(mutate((r) => { r.imports.static_owned.mf_default_body_inputs.has_AlphaMode = true; }), ['MF_Default_Body has no AlphaMode input']);
  assert.deepEqual(mutate((r) => { r.exits.static_owned = 0; }), ['the commandlet exit code is 1 when the line is logged, though every asset imported']);
});

test('missing reports fail instead of throwing', () => {
  const checks = evaluate({});
  assert.equal(checks.length, 8);
  assert.ok(checks.every((c) => c.pass === false));
});

// Walk a .glb: header, JSON chunk, BIN chunk; every accessor must lie inside its buffer view and every view inside the buffer.
function parseGlb(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'glTF');
  assert.equal(buf.readUInt32LE(4), 2);
  assert.equal(buf.readUInt32LE(8), buf.length);
  const jsonLength = buf.readUInt32LE(12);
  assert.equal(buf.toString('ascii', 16, 20), 'JSON');
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLength));
  const binAt = 20 + jsonLength;
  const binLength = buf.readUInt32LE(binAt);
  assert.equal(buf.toString('ascii', binAt + 4, binAt + 8).replace(/\0/g, ''), 'BIN');
  assert.equal(binAt + 8 + binLength, buf.length);
  assert.equal(jsonLength % 4, 0);
  assert.equal(binLength % 4, 0);
  return { json, binLength };
}

test('tiny_glb.mjs writes valid binary glTF files', () => {
  for (const [name, buf, materials] of [['static', buildStatic(), ['Opaque', 'Glass', 'Cutout']], ['skinned', buildSkinned(), ['Cloth']]]) {
    const { json, binLength } = parseGlb(buf);
    assert.equal(json.buffers[0].byteLength, binLength, name);
    assert.deepEqual(json.materials.map((m) => m.name), materials, name);
    for (const view of json.bufferViews) assert.ok(view.byteOffset + view.byteLength <= binLength, `${name} view`);
    for (const acc of json.accessors) assert.ok(acc.bufferView < json.bufferViews.length && acc.count > 0, `${name} accessor`);
  }
  const skinned = parseGlb(buildSkinned()).json;
  assert.equal(skinned.animations[0].name, 'Sway');
  assert.deepEqual(skinned.skins[0].joints, [1, 2]);
  assert.equal(parseGlb(buildStatic()).json.materials[1].alphaMode, 'BLEND');
});
