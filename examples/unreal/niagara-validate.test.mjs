// node --test examples/unreal/niagara-validate.test.mjs  (no Unreal, no dependencies)
// The reports below are what the Niagara scripts wrote on Unreal 5.8.2; the tests mutate one fact at a time and expect the
// matching check to fail, so the validator cannot pass by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize } from './niagara-validate-checks.mjs';

const good = () => ({
  traps: {
    engine: '5.8.2-56702186+++UE5+Release-5.8', duplicate_before_scan: false, duplicate_after_scan: true, spawn_in_commandlet_is_none: true,
    component_api: { set_variable_float: true, set_variable_vec3: true, set_variable_linear_color: true, set_variable_static_mesh: true, set_variable_texture: true, set_variable_object: true, get_variable_float: true, get_variable_vec3: true },
    library_mesh_override: true, system_members: ['asset_tags', 'cast_shadow', 'receives_decals'],
    external_edit_utilities_in_python: false, ext_structs_in_python: true,
    python_emitter_members: ['get_module', 'get_modules', 'get_object', 'get_properties', 'has_module', 'set_properties'], python_module_members: ['get_object'],
  },
  build: { steps: [{ step: 'duplicate', ok: true, saved: true }, { step: 'duplicate', ok: true, saved: true }, { step: 'save_map', ok: true }] },
  author: {
    engine: '5.8.2-56702186+++UE5+Release-5.8', python_members_of_toolset_class: [], system_tool_count: 46,
    calls: [{ tool: 'CreateNiagaraSystem', complete: true, error: '' }, { tool: 'GetSystemSummary', complete: true, error: '' }, { tool: 'AddEmitter', complete: true, error: '' }, { tool: 'GetSystemSummary', complete: true, error: '' }],
    emitters_before: ['LocationBasedRibbon', 'DirectionalBurst'], emitters_after: ['LocationBasedRibbon', 'DirectionalBurst', 'ExtraBurst'], saved: true, map_saved: true,
  },
  authorRerun: { error: 'Traceback (most recent call last):\nRuntimeError: /Game/FX/NS_Authored already exists: delete it in the editor before rerunning\n' },
  verify: {
    compile: { NS_Stateful: { aggregateStatus: 'UpToDate' }, NS_Lightweight: { aggregateStatus: 'UpToDate' }, NS_Authored: { aggregateStatus: 'UpToDate' } },
    samples: [{ systems: {
      FxStateful: { captured: true, valid: true, emitters: { OmnidirectionalBurst: 100, UpwardMeshBurst: 80, SimpleSpriteBurst: 10 } },
      FxLightweight: { captured: true, valid: true, emitters: { None: 0 } },
      FxAuthored: { captured: true, valid: true, emitters: { LocationBasedRibbon: 120, DirectionalBurst: 20, ExtraBurst: 0 } },
    } }],
  },
});

const failing = (mutate) => { const r = good(); mutate(r); return evaluate(r).filter((c) => !c.pass).map((c) => c.name); };

test('the recorded Unreal 5.8.2 reports pass every check', () => {
  const checks = evaluate(good());
  assert.deepEqual(checks.filter((c) => !c.pass), []);
  assert.deepEqual(summarize(checks), { passed: 15, total: 15 });
});

test('a missing report fails its checks instead of throwing', () => {
  const checks = evaluate({});
  assert.ok(checks.length === 15 && checks.every((c) => !c.pass));
});

test('each guidance claim fails when its fact changes', () => {
  assert.deepEqual(failing((r) => { r.traps.duplicate_before_scan = true; }), ['duplicate_asset fails before the registry scan and works after']);
  assert.deepEqual(failing((r) => { r.traps.spawn_in_commandlet_is_none = false; }), ['spawn_system_at_location returns None in a commandlet map']);
  assert.deepEqual(failing((r) => { r.traps.component_api.set_variable_float = false; }), ['NiagaraComponent has typed runtime setters and getters']);
  assert.deepEqual(failing((r) => { r.traps.system_members.push('add_emitter'); }), ['NiagaraSystem has no authoring methods in Python']);
  assert.deepEqual(failing((r) => { r.author.python_members_of_toolset_class = ['add_emitter']; }), ['toolset functions are not Python members']);
  assert.deepEqual(failing((r) => { r.author.system_tool_count = 47; }), ['the System toolset lists 46 tools']);
  assert.deepEqual(failing((r) => { r.author.emitters_after = r.author.emitters_before; }), ['a system is authored through execute_tool']);
  assert.deepEqual(failing((r) => { r.authorRerun = { error: 'access violation' }; }), ['a rerun refuses instead of deleting']);
  assert.deepEqual(failing((r) => { r.verify.compile.NS_Authored.aggregateStatus = 'Dirty'; }), ['compile state completes from the editor tick']);
  assert.deepEqual(failing((r) => { r.verify.compile_timeout = ['NS_Authored']; }), ['compile state completes from the editor tick']);
  assert.deepEqual(failing((r) => { r.verify.samples[0].systems.FxStateful.emitters.SimpleSpriteBurst = 0; }), ['a stateful template reports particles per emitter']);
  assert.deepEqual(failing((r) => { r.verify.samples[0].systems.FxLightweight.emitters = { Fountain: 12 }; }), ['a stateless template reports one emitter named None with no positions']);
  assert.deepEqual(failing((r) => { r.verify.samples[0].systems.FxAuthored.emitters = { LocationBasedRibbon: 0, DirectionalBurst: 0, ExtraBurst: 0 }; }), ['every authored emitter is in the cache, and at least one emits']);
  assert.deepEqual(failing((r) => { r.traps.external_edit_utilities_in_python = true; }), ['the C++ authoring class is not in Python, its data structs are']);
  assert.deepEqual(failing((r) => { r.traps.python_emitter_members.push('add_module'); }), ['NiagaraPythonEmitter and NiagaraPythonModule cannot add anything']);
});

test('a zero-particle authored emitter is reported but does not fail while another emits', () => {
  const detail = evaluate(good()).find((c) => c.name.startsWith('every authored emitter')).detail;
  assert.match(detail, /zero particles: ExtraBurst/);
});
