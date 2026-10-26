// node --test examples/unreal/niagara_toolsets/nts-probe.test.mjs  (no Unreal, no dependencies)
// Prepared 2026-10-26; not yet run on an engine. The canned reports below are an ASSUMPTION about what the nts_probe_*.py scripts write: they
// follow the shapes of nts_author.py and the stylized scripts, but no real report of these probes exists. A first engine run confirms the
// shapes; a field the real report spells differently makes the matching check fail, and the check or the script is fixed then.
// Each mutation changes one fact and expects the matching check to fail, so the probe cannot pass by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateProbes, summarize, parseProbeOptions, expectedRendererOrder, shotNames, PROBE_GROUPS, PROBE_PHASES } from './nts-probe-checks.mjs';
import { atlasGrid, resolveWireAssets, cubeGlb, decodePng, encodePng, changedPixels } from './nts-probe-assets.mjs';

const here = import.meta.dirname;
const read = (name) => readFileSync(join(here, name), 'utf8');

// ---- images
const solid = (width, height, rgb = [0, 0, 0]) => { const rgba = Buffer.alloc(width * height * 4); for (let i = 0; i < width * height; i++) rgba.set([...rgb, 255], i * 4); return { width, height, rgba }; };
const withSquare = (image, size, rgb = [255, 255, 255]) => { const copy = { ...image, rgba: Buffer.from(image.rgba) }; for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) copy.rgba.set([...rgb, 255], (y * image.width + x) * 4); return copy; };

// ---- canned reports
const SPRITE = 'NiagaraSpriteRendererProperties', LIGHT = 'NiagaraLightRendererProperties', RIBBON = 'NiagaraRibbonRendererProperties', MESH = 'NiagaraMeshRendererProperties';
const record = (added, sent, before, after, returned, extra = {}) => ({
  sent_index: sent, added_class: added, error: '', before, after, renderer_classes: [...new Set(after)], returned_index: returned, returned_class: added,
  ref_in_range: returned >= 0 && returned < after.length, ref_class: returned >= 0 && returned < after.length ? after[returned] : null, read_error: '', property_keys: [], ...extra,
});
const BASE = [SPRITE, LIGHT];
const TEMPLATE_NAMES = ['BlowingParticles', 'ConfettiBurst', 'DirectionalBurst', 'DynamicBeam', 'Fountain', 'HangingParticulates', 'LocationBasedRibbon', 'Minimal', 'OmnidirectionalBurst', 'RecycleParticlesInView', 'SimpleSpriteBurst', 'SingleLoopingParticle', 'StaticBeam', 'UpwardMeshBurst'];
const renderersReport = () => ({
  probe: 'renderers', engine: '5.8.2-56702186+++UE5+Release-5.8', steps: [
    { step: 'setup', toolset_registered: true },
    { step: 'insert', variants: {
      Mid: record(RIBBON, 1, BASE, [SPRITE, RIBBON, LIGHT], 1), Front: record(RIBBON, 0, BASE, [RIBBON, SPRITE, LIGHT], 0), AtCount: record(RIBBON, 2, BASE, [SPRITE, LIGHT, RIBBON], 2),
      PastCount: record(RIBBON, 3, BASE, [SPRITE, LIGHT, RIBBON], 3, { read_error: "Renderer index 3 is out of bounds for emitter 'PastCount' (has 3 renderers). Stack reference: System(NS_Renderers) / Emitter(PastCount) / Renderer[3]" }),
      MinusTwo: record(RIBBON, -2, BASE, [SPRITE, LIGHT, RIBBON], -2, { read_error: 'Renderer index -2 is out of bounds' }),
    } },
    { step: 'classes', classes: Object.fromEntries([RIBBON, MESH, LIGHT, 'NiagaraComponentRendererProperties', 'NiagaraDecalRendererProperties', 'NiagaraVolumeRendererProperties']
      .map((name) => [name, record(name, 'omitted', [SPRITE], [SPRITE, name], 1, name === LIGHT ? { property_keys: ['bAllowMegaLights', 'bMegaLightsCastShadows', 'Enabled', 'Intensity'] } : {})])) },
    { step: 'duplicate', record: record(SPRITE, 'omitted', [SPRITE], [SPRITE, SPRITE], 1), topology_renderer_count: 2, topology_class_count: 1 },
    { step: 'templates', made: Object.fromEntries(TEMPLATE_NAMES.map((n) => [n, { renderers: [n.includes('Ribbon') || n.includes('Beam') ? RIBBON : SPRITE], renderer_classes: [n.includes('Ribbon') || n.includes('Beam') ? RIBBON : SPRITE] }])) },
  ],
});

const run = (max, extra = {}) => ({ captured: true, valid: true, num_frames: 40, metric_max: max, metric_emitter: 'Probe', max_total: max, emitters: ['Probe'], read_errors: [], totals: [max], last: { Probe: max }, ...extra });
const EMIT_COMPLETED = ['SwapFountain', 'SwapBurst', 'SwapFountainModules', 'SwapSameValue', 'SwapEnum', 'SwapBool', 'SwapToggle', 'SwapWriteFirst', 'LateAdded'];
const EMIT_COUNTS = { CtlTemplate: 380, FactoryFountain: 145, FactoryBurst: 1, KeepUntouched: 0, Keep90: 0, Keep60: 97, Keep30: 49, Keep15: 24, Keep0: 0,
  SwapRateTouched: 145, SwapDurationTouched: 145, SwapBurstTouched: 5, LateTouched: 143, TouchedThenRemoved: 144 };
const EMIT_IDS = [...Object.keys(EMIT_COUNTS), ...EMIT_COMPLETED];
const emitting = (max, extra = {}) => ({ captured: true, valid: true, num_frames: 1, metric_max: max, metric_emitter: 'Probe', max_total: max, emitters: ['Probe'], read_errors: [], totals: [max], refused_frames: 0, last: { Probe: max }, max_by_emitter: { Probe: max }, ...extra });
const completed = () => ({ captured: false, valid: false, num_frames: 0, metric_max: 0, metric_emitter: null, max_total: 0, emitters: [], read_errors: [], totals: [0], refused_frames: 40, last: {}, max_by_emitter: {} });
const emitReport = () => ({
  build: { probe: 'emit-build', steps: EMIT_IDS.map((id) => ({ step: `variant_${id}`, id, emitters: ['Probe'] })) },
  sim: { probe: 'sim', samples: Object.fromEntries(EMIT_IDS.map((id) => [id, { steps: { run: EMIT_COMPLETED.includes(id) ? completed() : emitting(EMIT_COUNTS[id], id === 'LateTouched' ? { max_by_emitter: { Probe: 143, Late: 144 } } : {}) } }])),
    compile: Object.fromEntries(EMIT_IDS.map((id) => [id, { error: '', value: { aggregateStatus: 'UpToDate' } }])), issues: {}, shots: [], events: [] },
});

const frameReport = () => ({
  build: { probe: 'frame-build', steps: [
    { step: 'system', emitters: ['Sprite'], direct_mode_error: '' },
    { step: 'user_variable', add_error: '', list_error: '', names: ['User.FrameIndex'], present: true },
    { step: 'link', input_type: { classStructOrEnum: { refPath: '/Script/Niagara.NiagaraFloat' } }, topology_error: '', linked: true,
      attempts: [{ type_source: 'topology', name: 'User.FrameIndex', set_error: '', read_error: '', kind_after: 'NiagaraExt_StackInputData_Linked', link_after: 'User.FrameIndex' }] },
  ] },
  sim: { probe: 'sim', samples: { Flip: { steps: {
    base: { shot: 'nts_frame_base.png' },
    v2: { ...run(1), attributes: { Sprite: { SubImageIndex: [2, 2] } }, shot: 'nts_frame_v2.png' },
    v9: { ...run(1), attributes: { Sprite: { SubImageIndex: [9, 9] } }, shot: 'nts_frame_v9.png' },
  } } }, shots: [{ name: 'nts_frame_base.png' }, { name: 'nts_frame_v2.png' }, { name: 'nts_frame_v9.png' }] },
  images: { 'nts_frame_base.png': solid(100, 100), 'nts_frame_v2.png': withSquare(solid(100, 100), 30), 'nts_frame_v9.png': withSquare(solid(100, 100), 60) },
});

const CUBE = '/Game/Probe/Wire/Mesh_builtin/ProbeCube.ProbeCube';
const wireReport = () => ({
  build: { probe: 'wire-build', steps: [
    { step: 'mesh_sample', id: 'sample', returned: true, assets: 52, static_meshes: [], skeletal_meshes: 1, error: 'the import produced no static mesh (1 skeletal)' },
    { step: 'mesh_builtin', id: 'builtin', returned: true, assets: 3, static_meshes: [CUBE], skeletal_meshes: 0, mesh_path: CUBE, set_error: '', mesh_after: CUBE, lifetime_error: '' },
    { step: 'atlas', returned: true, texture: '/Game/Probe/Wire/Atlas/campfire.campfire', grid: [4, 2], set_error: '', sub_image_size: { x: 4, y: 2 }, material: '/Game/Probe/Wire/M_Atlas.M_Atlas' },
    { step: 'user_variable', add_error: '', names: ['User.Mesh'], saved: true },
  ] },
  sim: { probe: 'sim', samples: {
    Mesh_builtin: { steps: { base: { shot: 'nts_wire_Mesh_builtin_base.png' }, on: { ...run(80), shot: 'nts_wire_Mesh_builtin_on.png' } } },
    Atlas: { steps: { base: { shot: 'nts_wire_Atlas_base.png' }, early: { ...run(1), attributes: { Sprite: { SubImageIndex: [0.6] } } }, late: { ...run(1), attributes: { Sprite: { SubImageIndex: [4.1] } }, shot: 'nts_wire_Atlas_on.png' } } },
    MeshUser: { steps: { override: run(80) } },
  }, shots: [] },
  images: Object.fromEntries([['nts_wire_Mesh_builtin_base.png', solid(100, 100)], ['nts_wire_Mesh_builtin_on.png', withSquare(solid(100, 100), 20)], ['nts_wire_Atlas_base.png', solid(100, 100)], ['nts_wire_Atlas_on.png', withSquare(solid(100, 100), 20)]]),
});

const gradientReport = () => ({
  probe: 'gradient', engine: '5.8.2-56702186+++UE5+Release-5.8', steps: [
    { step: 'surface', registered: true, tool_count: 46, tools: ['AddEmitter'], niagara_skills: Array.from({ length: 7 }, (_, i) => `Skill${i}`) },
    { step: 'inventory', scanned_inputs: 900, kinds: { NiagaraFloat: 500, NiagaraExt_StackInputData_DataInterface: 4 }, fallback: null,
      candidates: [{ emitter: 'Fountain', script: 'ParticleUpdateScript', module: 'ScaleColor', input: 'Scale Color', kind: 'NiagaraExt_StackInputData_DataInterface', preview: '{"Curve":{}}' }] },
    { step: 'attempt', target: { emitter: 'Fountain', input: 'Scale Color' }, path: ['Curve', 'Keys', 0, 'Value'], old: 0, new: 0.25, set_error: '', read_error: '',
      kind_before: 'NiagaraExt_StackInputData_DataInterface', kind_after: 'NiagaraExt_StackInputData_DataInterface', value_after: 0.25, stored: true, same_keys: true },
  ],
});

const canned = () => ({ renderers: renderersReport(), emit: emitReport(), frame: frameReport(), wire: wireReport(), gradient: gradientReport() });
const failing = (reports, groups = PROBE_GROUPS) => evaluateProbes({ groups, reports }).filter((c) => !c.pass).map((c) => c.name);
const mutate = (group, fn) => { const r = canned(); fn(r[group]); return failing(r, [group]); };
const step = (report, name) => report.steps.find((s) => s.step === name);

test('the canned reports pass every check of every group', () => {
  const checks = evaluateProbes({ groups: PROBE_GROUPS, reports: canned() });
  assert.deepEqual(failing(canned()), []);
  assert.deepEqual(summarize(checks), { passed: checks.length, total: checks.length });
  assert.ok(checks.length >= 25);
  for (const group of PROBE_GROUPS) assert.ok(checks.some((c) => c.group === group), group);
  for (const c of checks) assert.ok(c.claim.length > 20 && c.detail.length > 0, c.name);
});

test('a missing report fails every check of its group and throws nothing', () => {
  for (const group of PROBE_GROUPS) {
    const checks = evaluateProbes({ groups: [group], reports: {} });
    assert.ok(checks.length > 0, group);
    assert.ok(checks.every((c) => !c.pass), `${group}: ${checks.filter((c) => c.pass).map((c) => c.name)}`);
  }
  assert.ok(evaluateProbes({ groups: ['emit'], reports: { emit: { build: {}, sim: { samples: null } } } }).every((c) => !c.pass));
});

test('only the groups asked for are judged', () => {
  assert.ok(evaluateProbes({ groups: ['gradient'], reports: canned() }).every((c) => c.group === 'gradient'));
  assert.deepEqual(evaluateProbes({ groups: [], reports: canned() }), []);
});

// ---- renderers
test('the renderer order rule follows AddRenderer and MoveRenderer in the engine source', () => {
  assert.deepEqual(expectedRendererOrder(['A', 'B'], 'C', 'omitted'), ['A', 'B', 'C']);
  assert.deepEqual(expectedRendererOrder(['A', 'B'], 'C', -1), ['A', 'B', 'C']);
  assert.deepEqual(expectedRendererOrder(['A', 'B'], 'C', 1), ['A', 'C', 'B']);
  assert.deepEqual(expectedRendererOrder(['A', 'B'], 'C', 0), ['C', 'A', 'B']);
  assert.deepEqual(expectedRendererOrder(['A', 'B'], 'C', 2), ['A', 'B', 'C']);
  assert.deepEqual(expectedRendererOrder(['A', 'B'], 'C', 3), ['A', 'B', 'C']);
  assert.deepEqual(expectedRendererOrder(['A', 'B'], 'C', -2), ['A', 'B', 'C']);
  assert.deepEqual(expectedRendererOrder(['A'], 'L', 5), ['A', 'L']);
});

test('renderers: each claim has a failing case', () => {
  const name1 = 'AddRenderer inserts into a list of renderers at an index between them';
  assert.deepEqual(mutate('renderers', (r) => { step(r, 'insert').variants.Mid.after = [SPRITE, LIGHT, RIBBON]; }), [name1]);
  assert.deepEqual(mutate('renderers', (r) => { step(r, 'insert').variants.Front.returned_index = 1; }), [name1]);
  assert.deepEqual(mutate('renderers', (r) => { step(r, 'insert').variants.AtCount.read_error = 'boom'; }), [name1]);
  assert.deepEqual(mutate('renderers', (r) => { step(r, 'insert').variants.Mid = { setup_error: 'AddRenderer: nope' }; }), [name1, 'an index past the new end appends, and the returned ref is not good'].slice(0, 1));
  const name2 = 'an index past the new end appends, and the returned ref is not good';
  assert.deepEqual(mutate('renderers', (r) => { step(r, 'insert').variants.PastCount.after = [SPRITE, RIBBON, LIGHT]; }), [name2]);
  assert.deepEqual(mutate('renderers', (r) => { step(r, 'insert').variants.PastCount.read_error = ''; }), [name2]);
  assert.deepEqual(mutate('renderers', (r) => { step(r, 'insert').variants.MinusTwo.returned_index = 2; }), [name2]);
  assert.deepEqual(mutate('renderers', (r) => { step(r, 'classes').classes[RIBBON].error = 'no such class'; }), ['renderer classes other than Light are added the same way']);
  assert.deepEqual(mutate('renderers', (r) => { step(r, 'classes').classes[MESH].after = [SPRITE]; }), ['renderer classes other than Light are added the same way']);
  assert.deepEqual(mutate('renderers', (r) => { step(r, 'classes').classes[LIGHT].property_keys = ['Enabled']; }), ['GetRendererData lists the properties of a new Light renderer, MegaLights switches among them']);
  const name3 = 'two renderers of one class: renderers[] shows both, rendererClasses[] shows the class once';
  assert.deepEqual(mutate('renderers', (r) => { step(r, 'duplicate').record.renderer_classes = [SPRITE, SPRITE]; }), [name3]);
  assert.deepEqual(mutate('renderers', (r) => { step(r, 'duplicate').topology_class_count = 2; }), [name3]);
  const name4 = 'the topology of each template emitter lists its renderers, so the template step can record all of them';
  assert.deepEqual(mutate('renderers', (r) => { delete step(r, 'templates').made.Minimal; }), [name4]);
  assert.deepEqual(mutate('renderers', (r) => { step(r, 'templates').made.Fountain.renderer_classes = [RIBBON]; }), [name4]);
  assert.deepEqual(mutate('renderers', (r) => { r.steps = r.steps.filter((s) => s.step !== 'insert'); }).includes(name1), true);
  assert.deepEqual(mutate('renderers', (r) => { step(r, 'insert').error = 'AddRenderer: crashed'; }), [name1, name2]);
});

// ---- emit
test('emit: each claim has a failing case', () => {
  const NAMES = {
    control: 'the sim-cache count reads a system that must emit',
    factory: 'a system from the factory emits with its emitter untouched',
    zero: 'a spawn rate of 0 counts 0 particles in a valid cache (negative control)',
    moves: 'a stack input changes the sim-cache count',
    dead: 'an emitter added to a template system does not emit until a stack input value is changed',
    revived: 'a float or int stack input changed after the last AddEmitter makes the added emitters emit',
    stays: 'a write before the last AddEmitter, a same-value write, and an enum, bool or module-toggle edit do not make it emit',
    matrix: 'every authoring route was sampled, and the cause matrix is recorded',
  };
  const sample = (r, id, value) => { r.sim.samples[id].steps.run.metric_max = value; };
  const swap = (r, id, run) => { r.sim.samples[id].steps.run = run; };
  assert.deepEqual(mutate('emit', (r) => sample(r, 'CtlTemplate', 0)), [NAMES.control]);
  assert.ok(mutate('emit', (r) => { r.sim.samples.CtlTemplate.steps.run.valid = false; }).includes(NAMES.control));
  assert.deepEqual(mutate('emit', (r) => sample(r, 'FactoryFountain', 0)), [NAMES.factory]);
  assert.deepEqual(mutate('emit', (r) => swap(r, 'FactoryBurst', completed())), [NAMES.factory]);
  assert.deepEqual(mutate('emit', (r) => sample(r, 'Keep0', 3)), [NAMES.zero]);
  assert.deepEqual(mutate('emit', (r) => { r.sim.samples.Keep0.steps.run.metric_emitter = null; }), [NAMES.zero]);
  assert.ok(mutate('emit', (r) => { r.sim.samples.Keep0.steps.run.num_frames = 0; }).includes(NAMES.zero));
  assert.deepEqual(mutate('emit', (r) => sample(r, 'Keep15', 60)), [NAMES.moves]);
  assert.deepEqual(mutate('emit', (r) => { r.build.steps.find((s) => s.step === 'variant_Keep60').error = 'RemoveEmitter: ...'; }), [NAMES.moves]);
  assert.deepEqual(mutate('emit', (r) => sample(r, 'KeepUntouched', 7)), [NAMES.dead]);
  assert.deepEqual(mutate('emit', (r) => sample(r, 'Keep90', 7)), [NAMES.dead]);
  assert.deepEqual(mutate('emit', (r) => swap(r, 'SwapFountain', emitting(31))), [NAMES.dead]);
  assert.deepEqual(mutate('emit', (r) => swap(r, 'SwapBurst', emitting(1))), [NAMES.dead]);
  assert.deepEqual(mutate('emit', (r) => swap(r, 'SwapFountainModules', emitting(29))), [NAMES.dead]);
  assert.ok(mutate('emit', (r) => { r.build.steps = r.build.steps.filter((s) => s.step !== 'variant_SwapFountain'); }).includes(NAMES.dead));
  assert.deepEqual(mutate('emit', (r) => swap(r, 'SwapRateTouched', completed())), [NAMES.revived]);
  assert.deepEqual(mutate('emit', (r) => swap(r, 'SwapDurationTouched', completed())), [NAMES.revived]);
  assert.deepEqual(mutate('emit', (r) => sample(r, 'SwapBurstTouched', 4)), [NAMES.revived]);
  assert.deepEqual(mutate('emit', (r) => { r.sim.samples.LateTouched.steps.run.max_by_emitter.Late = 0; }), [NAMES.revived]);
  assert.deepEqual(mutate('emit', (r) => swap(r, 'TouchedThenRemoved', completed())), [NAMES.revived]);
  for (const id of ['SwapWriteFirst', 'SwapSameValue', 'SwapEnum', 'SwapBool', 'SwapToggle', 'LateAdded']) assert.deepEqual(mutate('emit', (r) => swap(r, id, emitting(30))), [NAMES.stays], id);
  assert.deepEqual(mutate('emit', (r) => { delete r.sim.samples.SwapSameValue; }).sort(), [NAMES.matrix, NAMES.stays].sort());
  assert.deepEqual(mutate('emit', (r) => { r.sim.compile.FactoryBurst = { error: '', value: { aggregateStatus: 'Error' } }; }), [NAMES.matrix]);
  assert.deepEqual(mutate('emit', (r) => { r.sim.samples.Keep30.steps.run.error = 'Traceback ...'; }).sort(), [NAMES.matrix, NAMES.moves].sort());
});

test('emit: a refused capture counts as completed only when the sim report says the system was asked and refused', () => {
  const NAME = 'an emitter added to a template system does not emit until a stack input value is changed';
  // a report without refused_frames (an older shape) or with a captured cache is not a completed system
  assert.deepEqual(mutate('emit', (r) => { delete r.sim.samples.SwapFountain.steps.run.refused_frames; }), [NAME]);
  assert.deepEqual(mutate('emit', (r) => { r.sim.samples.SwapFountain.steps.run.captured = true; }), [NAME]);
  assert.deepEqual(mutate('emit', (r) => { r.sim.samples.SwapFountain.steps.run.error = 'Traceback ...'; }).includes(NAME), true);
});

test('emit: a zero or a completed system in the cause matrix is a finding, not a failure of the probe', () => {
  const out = evaluateProbes({ groups: ['emit'], reports: canned() });
  const matrix = out.find((c) => c.name.startsWith('every authoring route'));
  assert.equal(matrix.pass, true);
  assert.match(matrix.detail, /KeepUntouched=0, Keep90=0/);
  assert.match(matrix.detail, /SwapFountain=completed at once, SwapBurst=completed at once/);
});

// ---- frame
test('frame: each claim has a failing case', () => {
  assert.deepEqual(mutate('frame', (r) => { step(r.build, 'user_variable').present = false; }), ['a float user parameter is added and listed']);
  assert.deepEqual(mutate('frame', (r) => { step(r.build, 'user_variable').add_error = 'bad type'; }), ['a float user parameter is added and listed']);
  assert.deepEqual(mutate('frame', (r) => { step(r.build, 'system').direct_mode_error = 'enum'; }), ['SubUV Animation Mode is set to Direct Index']);
  assert.deepEqual(mutate('frame', (r) => { step(r.build, 'link').linked = false; }), ['Direct Frame Index reads back as linked to the user parameter']);
  assert.deepEqual(mutate('frame', (r) => { r.sim.samples.Flip.steps.v9.attributes.Sprite.SubImageIndex = [0.4]; }), ['the sprite SubImageIndex follows the user parameter']);
  assert.deepEqual(mutate('frame', (r) => { delete r.sim.samples.Flip.steps.v2.attributes; }), ['the sprite SubImageIndex follows the user parameter']);
  assert.deepEqual(mutate('frame', (r) => { r.images['nts_frame_v9.png'] = r.images['nts_frame_v2.png']; }), ['screenshots at the two values show different cells']);
  assert.deepEqual(mutate('frame', (r) => { delete r.images['nts_frame_base.png']; }), ['screenshots at the two values show different cells']);
  assert.deepEqual(mutate('frame', (r) => { r.images['nts_frame_v2.png'] = solid(50, 50); }), ['screenshots at the two values show different cells']);
});

// ---- wire
test('wire: each claim has a failing case', () => {
  assert.deepEqual(mutate('wire', (r) => { step(r.build, 'mesh_sample').skeletal_meshes = 0; }), ['the sample model import is recorded']);
  assert.deepEqual(mutate('wire', (r) => { step(r.build, 'mesh_builtin').static_meshes = []; }).slice(0, 1), ['an imported static mesh is held by the mesh renderer']);
  assert.deepEqual(mutate('wire', (r) => { step(r.build, 'mesh_builtin').mesh_after = '/Game/Other/Thing.Thing'; }).slice(0, 1), ['an imported static mesh is held by the mesh renderer']);
  assert.deepEqual(mutate('wire', (r) => { r.sim.samples.Mesh_builtin.steps.on.metric_max = 0; }), ['the mesh system emits particles']);
  assert.deepEqual(mutate('wire', (r) => { r.images['nts_wire_Mesh_builtin_on.png'] = solid(100, 100); }), ['the mesh is visible in a screenshot']);
  assert.deepEqual(mutate('wire', (r) => { step(r.build, 'atlas').sub_image_size = { x: 1, y: 1 }; }), ['the atlas image becomes a flipbook with the atlas grid as Sub Image Size']);
  assert.deepEqual(mutate('wire', (r) => { r.sim.samples.Atlas.steps.late.attributes.Sprite.SubImageIndex = [0.6]; }), ['the flipbook emits and its frame index advances']);
  assert.deepEqual(mutate('wire', (r) => { r.sim.samples.Atlas.steps.late.metric_max = 0; }), ['the flipbook emits and its frame index advances']);
  assert.deepEqual(mutate('wire', (r) => { r.images['nts_wire_Atlas_on.png'] = solid(100, 100); }), ['the flipbook is visible in a screenshot']);
  assert.deepEqual(mutate('wire', (r) => { step(r.build, 'user_variable').names = []; }), ['a Static Mesh user parameter is added and the runtime override call runs']);
  assert.deepEqual(mutate('wire', (r) => { r.sim.samples.MeshUser.steps.override.error = 'TypeError'; }), ['a Static Mesh user parameter is added and the runtime override call runs']);
});

test('wire: no sample model given is fine, and a skeletal-only sample does not stop the built-in cube carrying the chain', () => {
  const r = canned();
  r.wire.build.steps = r.wire.build.steps.filter((s) => s.step !== 'mesh_sample');
  assert.deepEqual(failing(r, ['wire']), []);
});

// ---- gradient
test('gradient: each claim has a failing case', () => {
  assert.deepEqual(mutate('gradient', (r) => { step(r, 'surface').registered = false; }), ['the System toolset registers and its tool list is recorded']);
  assert.deepEqual(mutate('gradient', (r) => { step(r, 'inventory').candidates = []; }), ['a data-interface input that mentions a curve or gradient exists on a template emitter']);
  assert.deepEqual(mutate('gradient', (r) => { step(r, 'attempt').stored = false; }), ['a gradient or curve input written as a whole reads back changed']);
  assert.deepEqual(mutate('gradient', (r) => { step(r, 'attempt').set_error = 'Failed to set data interface properties'; }), ['a gradient or curve input written as a whole reads back changed']);
  assert.deepEqual(mutate('gradient', (r) => { step(r, 'attempt').kind_after = 'NiagaraExt_StackInputData_Unsupported'; }), ['a gradient or curve input written as a whole reads back changed']);
  assert.deepEqual(mutate('gradient', (r) => { step(r, 'attempt').same_keys = false; }), ['a gradient or curve input written as a whole reads back changed']);
});

// ---- options
test('options: groups, the engine folder, the wire assets and unknown input', () => {
  const o = parseProbeOptions(['--engine', 'E'], {});
  assert.deepEqual([o.engine, o.groups, o.named, o.keep, o.plan], ['E', PROBE_GROUPS, false, false, false]);
  assert.equal(parseProbeOptions([], { UE_ROOT: 'U' }).engine, 'U');
  assert.match(parseProbeOptions([], {}).error, /no engine folder/);
  assert.deepEqual(parseProbeOptions(['--engine', 'E', '--only', 'gradient,emit'], {}).groups, ['emit', 'gradient']);
  assert.equal(parseProbeOptions(['--engine', 'E', '--only', 'wire'], {}).named, true);
  assert.match(parseProbeOptions(['--engine', 'E', '--only', 'nope'], {}).error, /unknown group nope/);
  assert.match(parseProbeOptions(['--engine', 'E', '--only', ''], {}).error, /at least one group/);
  assert.match(parseProbeOptions(['--engine'], {}).error, /needs a value/);
  assert.match(parseProbeOptions(['--engine', 'E', '--bogus'], {}).error, /unknown option --bogus/);
  assert.match(parseProbeOptions(['--engine', 'E', '--only', 'emit', '--only', 'wire'], {}).error, /given twice/);
  const w = parseProbeOptions(['--engine', 'E', '--scenes', 'S', '--glb', 'builtin', '--atlas-png', 'a.png', '--atlas-json', 'a.json', '--keep', '--plan'], {});
  assert.deepEqual([w.scenes, w.glb, w.atlasPng, w.atlasJson, w.keep, w.plan], ['S', 'builtin', 'a.png', 'a.json', true, true]);
  assert.equal(parseProbeOptions(['--engine', 'E'], { AGENT_UNREAL_SCENES: 'W' }).scenes, 'W');
});

// ---- atlas grid
const cell = (x, y, w = 32, h = 32) => ({ frame: { x, y, w, h } });
test('atlasGrid: a regular grid with repeated and odd cells', () => {
  const frames = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) frames.push(cell(c * 32, r * 32));
  frames.push(cell(0, 0), cell(32, 0), cell(0, 0, 16, 16));   // a tag copy and a named cell of another size
  const grid = atlasGrid({ frames, meta: { size: { w: 128, h: 64 } } });
  assert.deepEqual([grid.cols, grid.rows, grid.cellW, grid.cellH, grid.cells, grid.ignored, grid.full, grid.powerOfTwo], [4, 2, 32, 32, 8, 1, true, true]);
  assert.equal(atlasGrid({ frames: { a: cell(0, 0), b: cell(32, 0) }, meta: { size: { w: 64, h: 32 } } }).cols, 2);
  assert.equal(atlasGrid({ frames, meta: { size: { w: 128, h: 48 } } }).error.includes('do not cover'), true);
  assert.equal(atlasGrid({ frames: [cell(0, 0), cell(40, 0)], meta: {} }).error.includes('regular grid'), true);
  assert.equal(atlasGrid({ frames: [] }).error.includes('no frames'), true);
  assert.equal(atlasGrid(null).error.includes('no frames'), true);
  assert.equal(atlasGrid({ frames: [cell(0, 0), cell(32, 0), cell(64, 0)], meta: { size: { w: 96, h: 32 } } }).powerOfTwo, false);
  assert.equal(atlasGrid({ frames: [cell(0, 0)] }).powerOfTwo, null);
});

// ---- wire assets
test('resolveWireAssets: the workspace layout, explicit paths and clear failures', () => {
  const atlas = JSON.stringify({ frames: [cell(0, 0), cell(32, 0)], meta: { size: { w: 64, h: 32 } } });
  const files = new Set([join('W', 'assets', 'meshes', 'fox.glb'), join('W', 'assets', 'sprites', 'campfire.png'), join('W', 'assets', 'sprites', 'campfire.atlas.json')]);
  const io = (present = files, text = atlas) => ({ exists: (p) => present.has(p), readText: () => text });
  const ok = resolveWireAssets({ scenes: 'W' }, io());
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.meshes.map((m) => m.id), ['sample', 'builtin']);
  assert.equal(ok.meshes[0].path, join('W', 'assets', 'meshes', 'fox.glb'));
  assert.deepEqual([ok.atlas.grid.cols, ok.atlas.grid.rows], [2, 1]);
  const builtinOnly = resolveWireAssets({ scenes: 'W', glb: 'builtin' }, io());
  assert.deepEqual(builtinOnly.meshes.map((m) => m.id), ['builtin']);
  const none = resolveWireAssets({}, io());
  assert.match(none.error, /no scenes folder for --glb <file> \(or builtin\), --atlas-png <file>, --atlas-json <file>/);
  assert.match(none.error, /AGENT_UNREAL_SCENES/);
  assert.match(resolveWireAssets({ glb: 'builtin' }, io()).error, /no scenes folder for --atlas-png <file>, --atlas-json <file>/);
  const missing = resolveWireAssets({ scenes: 'W' }, io(new Set([join('W', 'assets', 'sprites', 'campfire.png')])));
  assert.match(missing.error, /GLB not found: .*fox\.glb/);
  assert.match(missing.error, /atlas JSON not found: .*campfire\.atlas\.json/);
  assert.match(resolveWireAssets({ scenes: 'W' }, io(files, '{')).error, /is not valid JSON/);
  assert.match(resolveWireAssets({ scenes: 'W' }, io(files, JSON.stringify({ frames: [cell(0, 0), cell(40, 0)] }))).error, /regular grid/);
  const explicit = resolveWireAssets({ glb: 'a.glb', atlasPng: 'a.png', atlasJson: 'a.json' }, { exists: () => true, readText: () => atlas });
  assert.equal(explicit.error, undefined);
  assert.equal(explicit.meshes[0].path, 'a.glb');
});

// ---- the built-in cube
test('cubeGlb: a valid binary glTF with one cube whose faces point outward', () => {
  const glb = cubeGlb(0.5);
  assert.equal(glb.readUInt32LE(0), 0x46546c67);
  assert.equal(glb.readUInt32LE(4), 2);
  assert.equal(glb.readUInt32LE(8), glb.length);
  assert.equal(glb.length % 4, 0);
  const jsonLength = glb.readUInt32LE(12);
  assert.equal(glb.readUInt32LE(16), 0x4e4f534a);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
  const binAt = 20 + jsonLength;
  assert.equal(glb.readUInt32LE(binAt + 4), 0x004e4942);
  const binLength = glb.readUInt32LE(binAt), bin = glb.subarray(binAt + 8, binAt + 8 + binLength);
  assert.equal(binAt + 8 + binLength, glb.length);
  assert.equal(json.asset.version, '2.0');
  assert.deepEqual(json.accessors.map((a) => a.count), [24, 24, 36]);
  assert.ok(json.buffers[0].byteLength <= binLength);
  assert.deepEqual(json.accessors[0].min, [-0.5, -0.5, -0.5]);
  const positions = new Float32Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + 288)), normals = new Float32Array(bin.buffer.slice(bin.byteOffset + 288, bin.byteOffset + 576));
  const indices = new Uint16Array(bin.buffer.slice(bin.byteOffset + 576, bin.byteOffset + 648));
  assert.ok(Math.max(...indices) < 24);
  for (let t = 0; t < 12; t++) {
    const [a, b, c] = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]].map((i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
    const u = b.map((v, k) => v - a[k]), w = c.map((v, k) => v - a[k]);
    const cross = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const normal = [normals[indices[t * 3] * 3], normals[indices[t * 3] * 3 + 1], normals[indices[t * 3] * 3 + 2]];
    assert.ok(cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2] > 0, `triangle ${t} winds against its normal`);
    const centre = a.map((v, k) => (v + b[k] + c[k]) / 3);
    assert.ok(centre[0] * normal[0] + centre[1] * normal[1] + centre[2] * normal[2] > 0, `triangle ${t} faces inward`);
  }
});

// ---- PNG
test('decodePng reads what encodePng writes, and changedPixels counts the difference', () => {
  const image = withSquare(solid(8, 6, [10, 20, 30]), 3, [200, 100, 50]);
  const back = decodePng(encodePng(image));
  assert.deepEqual([back.width, back.height], [8, 6]);
  assert.ok(back.rgba.equals(image.rgba));
  assert.equal(changedPixels(solid(8, 6, [10, 20, 30]), back), 9);
  assert.equal(changedPixels(solid(8, 6), solid(4, 4)), -1);
  assert.equal(changedPixels(undefined, solid(4, 4)), -1);
  assert.equal(changedPixels(solid(4, 4, [0, 0, 0]), solid(4, 4, [10, 10, 10])), 0);
  assert.throws(() => decodePng(Buffer.from('nope, not a png')), /not a PNG/);
});

test('shotNames lists the screenshots a sim report asked for', () => {
  assert.deepEqual(shotNames({ shots: [{ name: 'a.png' }, { name: 'b.png' }] }), ['a.png', 'b.png']);
  assert.deepEqual(shotNames(undefined), []);
});

// ---- the scripts and the checks agree
test('the python scripts exist, name the maps the runner plays, and write the fields the checks read', () => {
  for (const group of PROBE_GROUPS) {
    for (const phase of PROBE_PHASES[group]) {
      const source = read(phase.script);
      assert.match(source, phase.script === 'nts_probe_emit_build.py' ? /Run on 5\.8\.2 on 2026-10-26/ : /Prepared 2026-10-26; not yet run on an engine/, phase.script);
      if (phase.mode === 'editor') {
        const build = read(PROBE_PHASES[group][0].script);
        assert.ok(build.includes(`"${phase.map}"`), `${group}: build script and runner disagree on the map`);
      }
    }
  }
  assert.ok(read('nts_probe_emit_build.py').includes('"variant_" + variant'));
  for (const id of EMIT_IDS) assert.ok(read('nts_probe_emit_build.py').includes(`"${id}"`), id);
  assert.ok(read('nts_probe_sim.py').includes('"refused_frames"'));
  const frame = read('nts_probe_frame_build.py');
  for (const word of ['"id": "Flip"', 'Cam_Flip', 'User.FrameIndex', '"shot": "base"', '"shot": "v%d"', 'SubImageIndex', '"user_variable"', '"link"', '"system"']) assert.ok(frame.includes(word), word);
  const wire = read('nts_probe_wire_build.py');
  for (const word of ['"mesh_" + source["id"]', '"atlas"', 'sid + "_base"', 'sid + "_on"', '"MeshUser"', '"early"', '"late"', '"override"', '"user_variable"']) assert.ok(wire.includes(word), word);
  const sim = read('nts_probe_sim.py');
  for (const word of ['"metric_max"', '"max_by_emitter"', '"valid"', '"num_frames"', '"attributes"', '"shots"', 'override_system_user_variable_static_mesh', 'set_variable_float']) assert.ok(sim.includes(word), word);
  const renderers = read('nts_probe_renderers.py');
  for (const word of ['"insert"', '"classes"', '"duplicate"', '"templates"', '"topology_renderer_count"', '"property_keys"', '"ref_class"']) assert.ok(renderers.includes(word), word);
  const gradient = read('nts_probe_gradient.py');
  for (const word of ['"surface"', '"inventory"', '"attempt"', '"same_keys"', '"stored"', '"candidates"']) assert.ok(gradient.includes(word), word);
});

test('the default validator is untouched: it does not mention the probes', () => {
  for (const name of ['nts_validate.mjs', 'nts-validate-checks.mjs', 'nts_author.py', 'nts_readback.py', 'nts_issues.py', 'nts_recreate.py', 'nts_startup.py']) {
    assert.doesNotMatch(read(name), /nts[-_]probe/, name);
  }
});

test('the probe files carry the status line and no machine or home-directory text', () => {
  const probeFiles = readdirSync(here).filter((n) => /^nts[-_]probe/.test(n) && !n.endsWith('.test.mjs'));
  assert.ok(probeFiles.length >= 10, probeFiles.join(', '));
  for (const name of probeFiles) {
    const text = read(name);
    assert.match(text, name === 'nts_probe_emit_build.py' ? /Run on 5\.8\.2 on 2026-10-26/ : /Prepared 2026-10-26; not yet run on an engine/, name);
    assert.doesNotMatch(text, /[A-Za-z]:[\\/]Users[\\/]|\/home\/|\/Users\//, name);
    assert.doesNotMatch(text, /\r/, name);
  }
});
