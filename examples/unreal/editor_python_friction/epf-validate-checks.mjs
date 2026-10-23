// Pure checks for epf_validate.mjs: turn the JSON reports and log text of epf_box.py and epf_import.py into pass or fail results, one per
// claim in skills/unreal-editor-scripting/references/unreal-editor-python.md (Box) and skills/unreal-import/references/unreal-import-notes.md
// (the Interchange AlphaMode log line). No Unreal, no files: epf-validate.test.mjs feeds it canned reports, and epf_validate.mjs real ones.

// The line itself starts with a timestamp; the log's closing error summary repeats it behind "LogInit: Display:", which is not counted.
const LINE = /^\[[^\]]*\]\[[^\]]*\]LogInterchangeEngine: Error: .*Invalid input AlphaMode for material expression node MF_Default_Body\./gm;
export const countAlphaModeLines = (log) => (String(log || '').match(LINE) || []).length;
const count = (report, cls) => (((report || {}).assets || {})[cls] || []).length;

/**
 * @param {{ box?: object, imports?: Record<string, object>, logs?: Record<string, string>, exits?: Record<string, number|null> }} r
 *   imports and logs are keyed static_default, static_owned, skinned_default, skinned_owned
 * @returns {{ name: string, claim: string, pass: boolean, detail: string }[]}
 */
export function evaluate(r) {
  const box = r.box || {}, imp = r.imports || {}, logs = r.logs || {}, exits = r.exits || {};
  const out = [];
  const check = (name, claim, pass, detail = '') => out.push({ name, claim, pass: Boolean(pass), detail: String(detail) });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // Box
  check('Box rejects is_valid as a constructor argument',
    'unreal.Box(min=, max=, is_valid=True), Box(is_valid=True) and Box(min, max, True) raise TypeError',
    ['keywords_with_is_valid', 'is_valid_only', 'three_positional'].every((k) => box[k] && box[k].ok === false && /^TypeError/.test(box[k].error)),
    ['keywords_with_is_valid', 'is_valid_only', 'three_positional'].map((k) => (box[k] || {}).error).join(' | '));
  check('Box(min, max) and Box(min=, max=) build a valid box',
    'The constructor takes min and max; the box is valid and keeps both corners',
    ['positional', 'keywords'].every((k) => box[k] && box[k].ok && box[k].is_valid === true && same(box[k].min, [-1, -2, -3]) && same(box[k].max, [4, 5, 6])),
    JSON.stringify(box.positional));
  check('is_valid is set with set_editor_property',
    'set_editor_property("is_valid", False) then True round-trips and leaves min and max alone',
    box.set_false === false && box.set_true === true && same(box.bounds_after_set, [-1, 6]), `${box.set_false} then ${box.set_true}`);

  // Interchange
  const materialsOf = (n) => (imp[n] || {}).materials || {};
  check('the default glTF stack imports a static file without the log line',
    'Default stack: three static meshes and three materials, no AlphaMode line',
    imp.static_default && imp.static_default.returned === true && count(imp.static_default, 'StaticMesh') === 3
      && Object.values(imp.static_default.assets || {}).flat().length === 6 && countAlphaModeLines(logs.static_default) === 0,
    `${JSON.stringify(imp.static_default && imp.static_default.assets)}; lines ${countAlphaModeLines(logs.static_default)}`);
  const so = imp.static_owned || {};
  check('an owned pipeline imports meshes and materials and logs the AlphaMode line once per non-opaque material',
    'Owned pipeline (import_materials True): three static meshes, three Materials with the right blend modes; two log lines (BLEND and MASK)',
    so.returned === true && count(so, 'StaticMesh') === 3 && count(so, 'Material') === 3
      && (materialsOf('static_owned').Opaque || {}).blend_mode === 'BLEND_OPAQUE' && (materialsOf('static_owned').Glass || {}).blend_mode === 'BLEND_TRANSLUCENT'
      && (materialsOf('static_owned').Cutout || {}).blend_mode === 'BLEND_MASKED' && (materialsOf('static_owned').Cutout || {}).mask_clip === 0.5
      && countAlphaModeLines(logs.static_owned) === 2,
    `${JSON.stringify(so.materials)}; lines ${countAlphaModeLines(logs.static_owned)}, exit ${exits.static_owned}`);
  const sk = imp.skinned_owned || {};
  const sd = imp.skinned_default || {};
  check('an owned pipeline imports a skinned file with a clip and still logs the line once',
    'One skeletal mesh, one skeleton, one animation sequence and one Material from a BLEND material; one AlphaMode line; the default stack logs none',
    sk.returned === true && count(sk, 'SkeletalMesh') === 1 && count(sk, 'Skeleton') === 1 && count(sk, 'AnimSequence') === 1 && count(sk, 'Material') === 1
      && (sk.materials || {}).Cloth && sk.materials.Cloth.blend_mode === 'BLEND_TRANSLUCENT' && countAlphaModeLines(logs.skinned_owned) === 1
      && sd.returned === true && count(sd, 'SkeletalMesh') === 1 && count(sd, 'AnimSequence') === 1 && countAlphaModeLines(logs.skinned_default) === 0,
    `${JSON.stringify(sk.assets)}; lines ${countAlphaModeLines(logs.skinned_owned)}, exit ${exits.skinned_owned}; default stack lines ${countAlphaModeLines(logs.skinned_default)}`);
  const body = so.mf_default_body_inputs || {};
  check('MF_Default_Body has no AlphaMode input',
    'The glTF body function has function inputs such as AlphaCutoff and none named AlphaMode, which is the input the importer sets',
    body.count > 0 && body.has_AlphaCutoff === true && body.has_AlphaMode === false, JSON.stringify(body));
  check('the commandlet exit code is 1 when the line is logged, though every asset imported',
    'An error-level log line fails the commandlet exit code; read the report, not the code',
    exits.static_owned === 1 && so.returned === true && !so.error, `exit ${exits.static_owned}, returned ${so.returned}`);
  return out;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}
