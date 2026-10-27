// node --test examples/unreal/niagara-validate.test.mjs  (no Unreal, no dependencies)
// The reports below are shaped like what the Niagara scripts write; the tests mutate one fact at a time and expect the
// matching check to fail, so the validator cannot pass by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize } from './niagara-validate-checks.mjs';

// The shape niagara_templates.py writes (descriptions shortened) and the descriptors engine_plugins.mjs reads.
const stockPath = (n) => `/Niagara/DefaultAssets/Templates/Systems/${n}`;
const templatesReport = () => ({
  engine: '5.8.4',
  templates: Object.fromEntries([
    ...['AttributeReaderTrails', 'DirectionalBurst', 'DirectionalBurstLightweight', 'FountainLightweight', 'MinimalLightweight', 'RadialBurst', 'SimpleExplosion'].map((n) => [stockPath(n), 'd']),
    ['/NiagaraFluids/Templates/Gas/2D/Systems/Grid2D_Gas_MovingFire', 'd'],
  ]),
  emitter_templates: ['/Niagara/DefaultAssets/Templates/Emitters/Fountain', '/Niagara/DefaultAssets/Templates/Emitters/Minimal'],
  stock: {
    FountainLightweight: { path: stockPath('FountainLightweight'), user_variables: [] },
    Grid2D_Gas_MovingFire: {
      path: '/NiagaraFluids/Templates/Gas/2D/Systems/Grid2D_Gas_MovingFire', user_variables: ['User.SimRT'],
      emitters: {
        SourceParticles: { renderers: [], materials: [] },
        Grid2D_Gas_SmokeFire_Emitter: { renderers: ['NiagaraSpriteRendererProperties'], materials: ['M_2D_SmokeFire'] },
      },
    },
  },
  fire_material: {
    path: '/NiagaraFluids/Materials/Grid2D/M_2D_SmokeFire', loaded: true, blend_mode: 'MaterialBlendMode.BLEND_TRANSLUCENT', shading_model: 'MaterialShadingModel.MSM_UNLIT',
    scalar: ['Blackbody', 'DensityScale', 'DepthFade', 'TemperatureCurve', 'TemperatureGain', 'TemperatureMaximum', 'Other'],
    vector: ['Density Tint', 'EnvironmentColor', 'SunColor', 'Temperature Tint'],
  },
});
const pluginsReport = () => [{ name: 'Niagara', enabledByDefault: true }, { name: 'NiagaraFluids', enabledByDefault: false }];

const good = () => ({
  templates: templatesReport(), plugins: pluginsReport(),
  traps: {
    engine: '5.8.2-56702186+++UE5+Release-5.8', duplicate_before_scan: false, duplicate_after_scan: true, spawn_in_commandlet_is_none: true,
    component_api: { set_variable_float: true, set_variable_vec3: true, set_variable_linear_color: true, set_variable_static_mesh: true, set_variable_texture: true, set_variable_object: true, get_variable_float: true, get_variable_vec3: true },
    library_mesh_override: true, system_members: ['asset_tags', 'cast_shadow', 'receives_decals'],
    external_edit_utilities_in_python: false, ext_structs_in_python: true,
    python_emitter_members: ['get_module', 'get_modules', 'get_object', 'get_properties', 'has_module', 'set_properties'], python_module_members: ['get_object'],
    niagara_libraries: ['NiagaraFunctionLibrary', 'NiagaraSimCacheFunctionLibrary'], niagara_editor_utilities_names: [],
    mesh_renderer_properties_in_python: false, factory_emitters_attribute: false,
    factory_emitters_set_error: "Failed to find property 'emitters_to_add_to_new_system' for attribute 'emitters_to_add_to_new_system' on 'NiagaraSystemFactoryNew'",
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

test('the recorded reports pass every check', () => {
  const checks = evaluate(good());
  assert.deepEqual(checks.filter((c) => !c.pass), []);
  assert.deepEqual(summarize(checks), { passed: 27, total: 27 });
});

test('a missing report fails its checks instead of throwing', () => {
  const checks = evaluate({});
  assert.ok(checks.length === 27 && checks.every((c) => !c.pass));
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

test('each stock-content claim fails when its fact changes', () => {
  assert.deepEqual(failing((r) => { r.plugins[0].enabledByDefault = false; }), ['the Niagara plugin is enabled by default']);
  assert.deepEqual(failing((r) => { r.plugins = r.plugins.filter((p) => p.name !== 'Niagara'); }), ['the Niagara plugin is enabled by default']);
  assert.deepEqual(failing((r) => { r.plugins[1].enabledByDefault = true; }), ['the Niagara Fluids plugin is not enabled by default']);
  assert.deepEqual(failing((r) => { r.traps.niagara_editor_utilities_names = ['NiagaraEditorLibrary']; }), ['Python has no Niagara editor library']);
  assert.deepEqual(failing((r) => { r.traps.mesh_renderer_properties_in_python = true; }), ['Python has no NiagaraMeshRendererProperties class']);
  assert.deepEqual(failing((r) => { r.traps.factory_emitters_set_error = ''; }), ['the system factory emitter list cannot be set from Python']);
  assert.deepEqual(failing((r) => { r.traps.factory_emitters_attribute = true; }), ['the system factory emitter list cannot be set from Python']);
  assert.deepEqual(failing((r) => { delete r.templates.templates[stockPath('RadialBurst')]; }), ['the default template systems are the documented seven and none is a fire']);
  assert.deepEqual(failing((r) => { r.templates.templates[stockPath('SimpleFire')] = 'd'; }), ['the default template systems are the documented seven and none is a fire']);
  assert.deepEqual(failing((r) => { r.templates.emitter_templates = []; }), ['the default template emitters are under /Templates/Emitters']);
  assert.deepEqual(failing((r) => { r.templates.stock.FountainLightweight.user_variables = ['User.Color']; }), ['FountainLightweight exposes no user parameters']);
  assert.deepEqual(failing((r) => { r.templates.stock.Grid2D_Gas_MovingFire.user_variables = []; }),
    ['FountainLightweight exposes no user parameters', 'the moving-fire fluid template ships and its only user parameter is User.SimRT']);
  assert.deepEqual(failing((r) => { r.templates.stock.Grid2D_Gas_MovingFire.user_variables.push('User.DrawBounds'); }), ['the moving-fire fluid template ships and its only user parameter is User.SimRT']);
  assert.deepEqual(failing((r) => { r.templates.stock.Grid2D_Gas_MovingFire.emitters.SourceParticles.renderers = ['NiagaraSpriteRendererProperties']; }), ['the fire template has a renderer-less source emitter and one sprite emitter']);
  assert.deepEqual(failing((r) => { r.templates.stock.Grid2D_Gas_MovingFire.emitters.Grid2D_Gas_SmokeFire_Emitter.renderers = ['NiagaraRibbonRendererProperties']; }), ['the fire template has a renderer-less source emitter and one sprite emitter']);
  assert.deepEqual(failing((r) => { r.templates.stock.Grid2D_Gas_MovingFire.emitters.Grid2D_Gas_SmokeFire_Emitter.materials = ['M_2D_Other']; }), ['the sprite renderer draws M_2D_SmokeFire']);
  assert.deepEqual(failing((r) => { r.templates.fire_material.blend_mode = 'MaterialBlendMode.BLEND_OPAQUE'; }), ['M_2D_SmokeFire is translucent and unlit with the documented parameters']);
  assert.deepEqual(failing((r) => { r.templates.fire_material.scalar = ['Blackbody']; }), ['M_2D_SmokeFire is translucent and unlit with the documented parameters']);
});

test('a skipped or failed stock inspection fails its checks instead of throwing', () => {
  assert.equal(failing((r) => { r.templates.stock = 'NiagaraToolsets not enabled'; }).length, 4);
  assert.ok(failing((r) => { r.templates.stock.Grid2D_Gas_MovingFire = { error: 'GetUserVariables: boom' }; }).includes('the moving-fire fluid template ships and its only user parameter is User.SimRT'));
});

test('a zero-particle authored emitter is reported but does not fail while another emits', () => {
  const detail = evaluate(good()).find((c) => c.name.startsWith('every authored emitter')).detail;
  assert.match(detail, /zero particles: ExtraBurst/);
});
