// node --test examples/unreal/editor_probes/probes-validate.test.mjs  (no Unreal, no dependencies)
// The runs below have the shape probe.mjs and probes_fixture.py write. The values are the ones the README section "What a run showed" records; no
// engine has run this validator yet. Each test changes one fact and expects the matching check to fail, so the judge cannot pass by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSET_NAMES, DOC_NAMES, FIXTURE_STEPS, MODULE_NAMES, PATHS, SYSTEM_NAMES, evaluate, summarize } from './probes-validate-checks.mjs';
import { checkReport } from './probe-checks.mjs';

const input = (name, value, kind = 'NiagaraFloat') => ({ name, value: { struct: { refPath: `/Script/Niagara.${kind}` }, value: { value } } });
const initInputs = (lifetimeMin) => [input('Lifetime Min', lifetimeMin), input('Lifetime', 0, 'NiagaraExt_StackInputData_Unsupported')];
const stacks = () => ({ EmitterSpawnScript: ['EmitterState'], EmitterUpdateScript: ['SpawnRate'], ParticleSpawnScript: ['InitializeParticle'], ParticleUpdateScript: ['ParticleState'] });
const emitter = (name) => ({ summary: { emitterName: name }, data: {}, modules: stacks(), renderers: name === 'Motes' ? [{ Material: { refPath: `${PATHS.material}.M_Probe` } }] : [{ Material: 'unavailable' }] });

const run = (report, seconds = 16) => ({ exit: 0, stdout: '', stderr: '', seconds, report });
const makeGood = () => ({
  fixture: { engine: '5.8.x', steps: FIXTURE_STEPS.map((step) => ({ step, ok: true })) },
  doc: run({
    [DOC_NAMES[0]]: { status: 'found', kind: 'callable', doc: 'X.save_asset(asset_to_save, only_if_is_dirty=True) -> bool\nSave the specified asset.' },
    [DOC_NAMES[1]]: { status: 'found', kind: 'class', doc: 'Library of utility functions for working with assets in the editor.\n\nC++ Source: ...' },
    [DOC_NAMES[2]]: { status: 'missing', reason: "unreal.EditorAssetLibrary has no attribute 'save_assets'", nearby: ['save_asset', 'save_directory'] },
  }),
  system: run({
    [PATHS.system]: {
      status: 'found', problems: [], system_data: {},
      summary: { systemName: 'NS_Probe', emitters: [{ emitterName: 'Dust' }, { emitterName: 'Motes' }] },
      emitters: { Dust: emitter('Dust'), Motes: emitter('Motes') },
      modules: {
        'Dust:ParticleSpawnScript:InitializeParticle': { status: 'found', inputs: initInputs(15) },
        'Motes:ParticleSpawnScript:InitializeParticle': { status: 'found', inputs: initInputs(2.5) },
        'Dust:Nothing': { status: 'missing', reason: 'no emitter in this system has a module named Nothing in emitter Dust' },
      },
    },
    [PATHS.gone]: { status: 'missing', reason: `no asset at ${PATHS.gone}` },
    [PATHS.material]: { status: 'unavailable', reason: `${PATHS.material} is a Material, not a NiagaraSystem` },
  }),
  asset: run({
    [PATHS.cube]: { status: 'found', class: 'StaticMesh', material_slots: [{ slot: 'WorldGridMaterial', material: '/Engine/EngineMaterials/WorldGridMaterial.WorldGridMaterial' }],
      bounds: { origin: { x: 0, y: 0, z: 0 }, box_extent: { x: 50, y: 50, z: 50 }, sphere_radius: 86.6 }, nanite_enabled: false },
    [PATHS.cubeNanite]: { status: 'found', class: 'StaticMesh', material_slots: [], bounds: { origin: {}, box_extent: { x: 50, y: 50, z: 50 }, sphere_radius: 86.6 }, nanite_enabled: true },
    [PATHS.material]: { status: 'found', class: 'Material', blend_mode: 'BLEND_MASKED', shading_model: 'MSM_DEFAULT_LIT', two_sided: true, used_with_nanite: false,
      used_with_niagara_sprites: true, used_with_niagara_ribbons: false, used_with_niagara_mesh_particles: false },
    [PATHS.instance]: { status: 'found', class: 'MaterialInstanceConstant', parent: `${PATHS.material}.M_Probe`, scalar_parameters: { Opacity: 0.5 } },
    [PATHS.system]: { status: 'unavailable', reason: 'no description for class NiagaraSystem', class: 'NiagaraSystem' },
  }),
  broken: { exit: 1, stdout: '', report: undefined, seconds: 15,
    stderr: 'probe "doc" wrote no report: the editor exited with code 0 and C:/t/Saved/broken.json does not exist. Editor log: C:/t/Saved/Logs/probe-broken.log\n' },
});
const good = () => structuredClone(makeGood());
const failing = (mutate) => { const g = good(); mutate(g); return evaluate(g).filter((c) => !c.pass && !c.observe).map((c) => c.name); };
const failingAll = (mutate) => { const g = good(); mutate(g); return evaluate(g).filter((c) => !c.pass).map((c) => c.name); };
const sys = (g) => g.system.report[PATHS.system];

test('the recorded values pass: every asserted check and every observation', () => {
  const checks = evaluate(good());
  assert.deepEqual(checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`), []);
  const sum = summarize(checks);
  assert.equal(sum.passed, sum.total);
  assert.equal(sum.total, 21);
  assert.equal(sum.observed, 5);
  assert.equal(sum.observedRecorded, 5);
});

test('the sample reports are well formed for the launcher, so the test data matches what probe.mjs accepts', () => {
  const g = good();
  assert.deepEqual(checkReport('doc', DOC_NAMES, g.doc.report), []);
  assert.deepEqual(checkReport('system', SYSTEM_NAMES, g.system.report), []);
  assert.deepEqual(checkReport('asset', ASSET_NAMES, g.asset.report), []);
});

test('no runs at all fails every asserted check without throwing', () => {
  const checks = evaluate({});
  assert.equal(checks.filter((c) => !c.observe && c.pass).length, 0);
  assert.equal(summarize(checks).observedRecorded, 0);
  assert.doesNotThrow(() => evaluate());
});

test('a fixture with a failed step, an error or a missing step is named', () => {
  assert.deepEqual(failing((g) => { g.fixture.steps[2] = { step: 'material', ok: false, error: 'Traceback\nRuntimeError: no' }; }), ['fixture built']);
  assert.deepEqual(failing((g) => { g.fixture.error = 'Traceback'; }), ['fixture built']);
  assert.deepEqual(failing((g) => { g.fixture.steps.pop(); }), ['fixture built']);
  assert.match(evaluate({ ...good(), fixture: { steps: [{ step: 'cube', ok: false, error: 'boom\nmore' }] } })[0].detail, /cube: boom/);
});

test('doc: a launcher failure or a missing entry fails the run check', () => {
  assert.deepEqual(failing((g) => { g.doc.exit = 1; }), ['doc: the run reports every requested name']);
  assert.deepEqual(failing((g) => { delete g.doc.report[DOC_NAMES[1]]; }), ['doc: the run reports every requested name', 'doc: a class docstring has no signature']);
});

test('doc: the signature, the class description and the missing name are each judged', () => {
  assert.deepEqual(failing((g) => { g.doc.report[DOC_NAMES[0]].doc = 'Save the specified asset.'; }), ['doc: a callable begins with its signature']);
  assert.deepEqual(failing((g) => { g.doc.report[DOC_NAMES[0]].doc = 'X.save_asset(asset_to_save) -> bool'; }), ['doc: a callable begins with its signature']);
  assert.deepEqual(failing((g) => { g.doc.report[DOC_NAMES[0]].kind = 'value'; }), ['doc: a callable begins with its signature']);
  assert.deepEqual(failing((g) => { g.doc.report[DOC_NAMES[1]].doc = 'X.save_asset(asset_to_save) -> bool'; }), ['doc: a class docstring has no signature']);
  assert.deepEqual(failing((g) => { g.doc.report[DOC_NAMES[1]].kind = 'callable'; }), ['doc: a class docstring has no signature']);
  assert.deepEqual(failing((g) => { g.doc.report[DOC_NAMES[2]].status = 'found'; }), ['doc: a name that does not exist is missing and points at the real one']);
  assert.deepEqual(failing((g) => { g.doc.report[DOC_NAMES[2]].nearby = ['save_directory']; }), ['doc: a name that does not exist is missing and points at the real one']);
});

test('system: the emitters, stacks and renderer material are judged', () => {
  assert.deepEqual(failing((g) => { sys(g).summary.emitters.pop(); }), ['system: a toolset-made system reads back with its two emitters']);
  assert.deepEqual(failing((g) => { delete sys(g).emitters.Dust; }), ['system: a toolset-made system reads back with its two emitters', 'system: module names per script stack']);
  assert.deepEqual(failing((g) => { sys(g).emitters.Motes.modules = 'unavailable'; }), ['system: module names per script stack']);
  assert.deepEqual(failing((g) => { sys(g).emitters.Dust.modules.ParticleSpawnScript = []; }), ['system: module names per script stack']);
  assert.deepEqual(failing((g) => { sys(g).emitters.Motes.renderers = [{ Material: { refPath: '/Game/Other.Other' } }]; }), ["system: the sprite renderer's Material reads back"]);
  assert.deepEqual(failing((g) => { sys(g).emitters.Motes.renderers = []; }), ["system: the sprite renderer's Material reads back"]);
});

test('system: the lifetime values are read from InitializeParticle whatever the stack is called', () => {
  assert.deepEqual(failing((g) => { sys(g).modules['Motes:ParticleSpawnScript:InitializeParticle'].inputs = initInputs(5); }), ['system: Lifetime Min in Motes']);
  assert.deepEqual(failing((g) => { sys(g).modules['Dust:ParticleSpawnScript:InitializeParticle'].inputs = initInputs(2.5); }), ['system: Lifetime Min in Dust']);
  assert.deepEqual(failing((g) => { sys(g).modules['Dust:ParticleSpawnScript:InitializeParticle'].status = 'unavailable'; }), ['system: Lifetime Min in Dust']);
  assert.deepEqual(failing((g) => {
    const m = sys(g).modules;
    m['Motes:PSpawn:InitializeParticle'] = m['Motes:ParticleSpawnScript:InitializeParticle'];
    delete m['Motes:ParticleSpawnScript:InitializeParticle'];
  }), []);
  assert.deepEqual(failing((g) => { sys(g).modules['Motes:ParticleSpawnScript:InitializeParticle'].inputs = [input('Lifetime Max', 2.5)]; }), ['system: Lifetime Min in Motes']);
});

test('system: a missing module, a missing path and a non-system path are each judged', () => {
  assert.deepEqual(failing((g) => { delete sys(g).modules['Dust:Nothing']; }), ['system: a module that no emitter has is missing']);
  assert.deepEqual(failing((g) => { sys(g).modules['Dust:Nothing'].status = 'found'; }), ['system: a module that no emitter has is missing']);
  assert.deepEqual(failing((g) => { g.system.report[PATHS.gone].status = 'unavailable'; }), ['system: a path with no asset is missing']);
  assert.deepEqual(failing((g) => { g.system.report[PATHS.material] = { status: 'found' }; }), ['system: a Material path is unavailable']);
  assert.deepEqual(failing((g) => { g.system.exit = 1; }), ['system: the run reports every requested name']);
  assert.deepEqual(failing((g) => { g.system.report[PATHS.system].status = 'missing'; }).includes('system: a toolset-made system reads back with its two emitters'), true);
});

test('asset: the cube copies are judged on slot, extent and the Nanite flag', () => {
  assert.deepEqual(failing((g) => { g.asset.report[PATHS.cube].material_slots = []; }), ['asset: the engine cube copy']);
  assert.deepEqual(failing((g) => { g.asset.report[PATHS.cube].material_slots[0].material = '/Game/Other.Other'; }), ['asset: the engine cube copy']);
  assert.deepEqual(failing((g) => { g.asset.report[PATHS.cube].bounds.box_extent.z = 51; }), ['asset: the engine cube copy']);
  assert.deepEqual(failing((g) => { g.asset.report[PATHS.cube].nanite_enabled = true; }), ['asset: the engine cube copy']);
  assert.deepEqual(failing((g) => { g.asset.report[PATHS.cube].nanite_enabled = 'unavailable'; }), ['asset: the engine cube copy']);
  assert.deepEqual(failing((g) => { g.asset.report[PATHS.cubeNanite].nanite_enabled = false; }), ['asset: Nanite saved on a copy reads back true']);
});

test('asset: the material, its instance and the Niagara system path are judged', () => {
  for (const [key, value] of [['blend_mode', 'BLEND_OPAQUE'], ['shading_model', 'MSM_UNLIT'], ['two_sided', false], ['used_with_niagara_sprites', false],
    ['used_with_nanite', true], ['used_with_niagara_ribbons', 'unavailable']]) {
    assert.deepEqual(failing((g) => { g.asset.report[PATHS.material][key] = value; }), ['asset: a masked, two-sided material with the sprite flag'], key);
  }
  assert.deepEqual(failing((g) => { g.asset.report[PATHS.instance].parent = null; }), ['asset: an instance reads its parent and parameter']);
  assert.deepEqual(failing((g) => { g.asset.report[PATHS.instance].scalar_parameters = { Opacity: 1 }; }), ['asset: an instance reads its parent and parameter']);
  assert.deepEqual(failing((g) => { g.asset.report[PATHS.instance].scalar_parameters = {}; }), ['asset: an instance reads its parent and parameter']);
  assert.deepEqual(failing((g) => { g.asset.report[PATHS.system] = { status: 'found', class: 'StaticMesh' }; }), ['asset: a Niagara system path is unavailable']);
  assert.deepEqual(failing((g) => { g.asset.exit = 1; g.asset.report = undefined; }).includes('asset: the run reports every requested name'), true);
});

test('launcher: a script that cannot parse must leave no report and say so', () => {
  const name = 'launcher: a script that cannot parse leaves no report and a clear message';
  assert.deepEqual(failing((g) => { g.broken.exit = 0; }), [name]);
  assert.deepEqual(failing((g) => { g.broken.report = {}; }), [name]);
  assert.deepEqual(failing((g) => { g.broken.stderr = 'something else\n'; }), [name]);
  assert.deepEqual(failing((g) => { g.broken.stderr = g.broken.stderr.replace('exited with code 0', 'exited with code 3'); }), [name]);
  assert.deepEqual(failing((g) => { g.broken.stderr = g.broken.stderr.replace(/ Editor log: .*/, ''); }), [name]);
});

test('observations are recorded, never judged', () => {
  // An unexpected Lifetime kind, a problems list, other stack names and a slow run cannot fail anything.
  const odd = good();
  sys(odd).problems = ['x: boom'];
  sys(odd).emitters.Dust.modules = { Other: ['InitializeParticle'] };
  odd.doc.seconds = 400;
  assert.deepEqual(evaluate(odd).filter((c) => !c.pass), []);
  // A value that was not recorded leaves its observation unrecorded and the asserted counts alone.
  assert.deepEqual(failingAll((g) => { sys(g).modules['Dust:ParticleSpawnScript:InitializeParticle'].inputs = [input('Lifetime Min', 15)]; sys(g).modules['Motes:ParticleSpawnScript:InitializeParticle'].inputs = [input('Lifetime Min', 2.5)]; }),
    ['observe: the template Lifetime input']);
  assert.deepEqual(failingAll((g) => { delete sys(g).problems; }), ['observe: problems the system read lists']);
  assert.deepEqual(failingAll((g) => { delete g.asset.seconds; }), ['observe: launcher seconds']);
  assert.deepEqual(failingAll((g) => { delete g.doc.report[DOC_NAMES[2]].nearby; }), ['doc: a name that does not exist is missing and points at the real one', 'observe: nearby names of the missing callable']);
});

test('summarize counts asserted checks apart from observations', () => {
  assert.deepEqual(summarize([{ pass: true }, { pass: false }, { pass: true, observe: true }, { pass: false, observe: true }]), { passed: 1, total: 2, observed: 2, observedRecorded: 1 });
});

test('the fixture script builds the paths and the values the checks expect', () => {
  const py = readFileSync(join(import.meta.dirname, 'probes_fixture.py'), 'utf8');
  for (const [key, path] of Object.entries(PATHS)) {
    if (key === 'gone') continue;                       // a path that must not exist
    const [, dir, name] = path.match(/^(\/Game\/\w+)\/(\w+)$/);
    assert.ok(py.includes(`DIR = "${dir}"`), `${key}: directory ${dir}`);
    assert.ok(py.includes(`"${name}"`) || py.includes(`/${name}"`), `${key}: ${name}`);
  }
  for (const step of FIXTURE_STEPS) assert.ok(py.includes(`step("${step}"`), `step ${step}`);
  assert.ok(py.includes('LIFETIME_MIN = 2.5'));
  assert.ok(py.includes('"RecycleParticlesInView"') && py.includes('"HangingParticulates"'));
});
