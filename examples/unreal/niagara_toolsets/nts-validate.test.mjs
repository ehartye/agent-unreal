// node --test examples/unreal/niagara_toolsets/nts-validate.test.mjs  (no Unreal, no dependencies)
// The reports below are what the Niagara toolset scripts wrote on Unreal 5.8.2; each mutation changes one fact and expects the matching
// check to fail, so the validator cannot pass by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize } from './nts-validate-checks.mjs';

const topology = ['bEnabled', 'emitterName', 'emitterSpawnScript', 'emitterUpdateScript', 'particleSpawnScript', 'particleUpdateScript', 'rendererClasses', 'renderers', 'simTarget'];
const DEFAULT_MATERIAL = { refPath: '/Niagara/DefaultAssets/DefaultSpriteMaterial.DefaultSpriteMaterial' };
const MATERIAL = { refPath: '/Game/FX/M_Worked.M_Worked' };
const CRASH_LOG = '[2026.10.23-05.04.35:343][  0]LogWindows: Error: Unhandled Exception: EXCEPTION_ACCESS_VIOLATION reading address 0x0000000000000000';

const FLOAT = '/Script/Niagara.NiagaraFloat';
const LINKED_KIND = 'NiagaraExt_StackInputData_Linked', DYNAMIC_KIND = 'NiagaraExt_StackInputData_DynamicInput';
const template = (renderer, spawn, extra = {}) => ({ description: '', renderer, sim_target: 'CPUSim', spawn_modules: spawn, modules: ['EmitterState', ...spawn, 'ParticleState'], spawn_rate: null, beam_end: null, beam_start: null,
  local_space: false, burst_count: null, lifetime_link: null, loop_behavior: 'Infinite', ...extra });
const SPRITE = 'NiagaraSpriteRendererProperties', RIBBON = 'NiagaraRibbonRendererProperties';
const MADE = {
  BlowingParticles: template(SPRITE, ['SpawnRate']), ConfettiBurst: template(SPRITE, ['SpawnBurst_Instantaneous'], { burst_count: 100, loop_behavior: 'Once' }),
  DirectionalBurst: template(SPRITE, ['SpawnBurst_Instantaneous'], { burst_count: 75, loop_behavior: 'Once' }), DynamicBeam: template(RIBBON, ['SpawnBurst_Instantaneous', 'SpawnBeam'], { modules: ['EmitterState', 'SpawnBeam', 'UpdateBeam'] }),
  Fountain: template(SPRITE, ['SpawnRate'], { spawn_rate: 90 }), HangingParticulates: template(SPRITE, ['SpawnRate']), LocationBasedRibbon: template(RIBBON, [], { loop_behavior: 'Once' }),
  Minimal: template(SPRITE, []), OmnidirectionalBurst: template(SPRITE, ['SpawnBurst_Instantaneous'], { burst_count: 100, loop_behavior: 'Once' }),
  RecycleParticlesInView: template(SPRITE, ['SpawnBurst_Instantaneous'], { burst_count: 1000, loop_behavior: 'Once', modules: ['EmitterState', 'ViewRecycler'] }),
  SimpleSpriteBurst: template(SPRITE, ['SpawnBurst_Instantaneous'], { burst_count: 1, loop_behavior: 'Once' }),
  SingleLoopingParticle: template(SPRITE, ['SpawnBurst_Instantaneous'], { burst_count: 1, lifetime_link: 'Emitter.CurrentLoopDuration', loop_behavior: 'Once',
    description: 'Emits a single particle whose lifetime is linked to emitter loop duration' }),
  StaticBeam: template(RIBBON, ['SpawnBurst_Instantaneous', 'SpawnBeam'], { beam_start: 'SimulationPosition', beam_end: { x: 200, y: 0, z: 0 } }), UpwardMeshBurst: template('NiagaraMeshRendererProperties', ['SpawnBurst_Instantaneous'], { burst_count: 80, loop_behavior: 'Once' }),
};
const HIDDEN_ERROR = "Refusing to set input 'Color': input is hidden by static-switch / conditional logic and is not currently part of the executing graph. Adjust the parent switch first.";
const DURATION_ERROR = "Refusing to set input 'Loop Duration': its VisibleCondition currently evaluates false. The input is not visible in the editor — flip the gating input first.";
const WRONG_NAME = 'Function "SetEmitterData", input param "emitter" is required by the function input schema Json, but is missing from the incoming function input params Json.\nFunction schema Json -\n{...}';

const canned = () => ({
  author: {
    engine: '5.8.2-56702186+++UE5+Release-5.8', toolset_registered: true, agent_skill_class: true, system_tool_count: 46,
    niagara_skills: ['NiagaraBlueprintInteropSkill', 'NiagaraCleanupSkill', 'NiagaraCustomHLSLSkill', 'NiagaraFundamentalsSkill', 'NiagaraLevelPlacementSkill', 'NiagaraOptimizationSkill', 'NiagaraRenderersSkill'],
    steps: [
      { step: 'create', system: true, material: true, emitters: [] },
      { step: 'add_emitters', added: { Dust: { error: '', emitterName: 'Dust', topology_keys: topology }, Motes: { error: '', emitterName: 'Motes', topology_keys: topology } }, emitters: ['Dust', 'Motes'] },
      { step: 'stack_input', get_error: '', struct: { refPath: '/Script/Niagara.NiagaraFloat' }, value_keys: ['struct', 'value'], before: 5, set_error: '', after: 2.5,
        color_struct: { refPath: '/Script/CoreUObject.LinearColor' }, color_value: { r: 1, g: 1, b: 1, a: 1 },
        enum_struct: { refPath: '/Script/NiagaraEditor.NiagaraExt_StackInputData_Enum' }, enum_keys: ['displayName', 'enum', 'enumName'],
        unknown_input_error: "Input 'No Such Input' not found in stack reference: System(NS_Worked) / Emitter(Motes)", unknown_input_complete: true },
      { step: 'renderer', default_material: DEFAULT_MATERIAL, object_error: '', after_object: DEFAULT_MATERIAL, string_error: '', after_string: MATERIAL,
        sub_image_size: { x: 4, y: 4 }, wanted: MATERIAL, renderers: [0] },
      { step: 'save', system: true, material: true },
      { step: 'templates', made: structuredClone(MADE) },
      { step: 'bound_inputs', linked_before: 'Emitter.CurrentLoopDuration', add_key_error: '', add_key_kind: LINKED_KIND, add_key_link: 'Emitter.CurrentLoopDuration',
        emptied_error: '', emptied_kind: LINKED_KIND, emptied_link: 'Module.None', emptied_is_empty: true, dynamic_error: '', dynamic_kind: DYNAMIC_KIND,
        helper_lifetime: { ok: true, error: '', was: LINKED_KIND, kind: 'NiagaraFloat', value: 3 }, helper_width: { ok: true, error: '', was: DYNAMIC_KIND, kind: 'NiagaraFloat', value: 12 },
        zero_lifetime: { ok: true, error: '', was: LINKED_KIND, kind: 'NiagaraFloat', value: 0 } },
      { step: 'hidden_input', color_visible: false, mode_is_static_switch: true, refused_ok: false, refused_error: HIDDEN_ERROR, flip_error: '', painted_ok: true, painted_value: { r: 1, g: 0.2, b: 0.1, a: 1 },
        duration_visible: false, duration_error: DURATION_ERROR, cycle_error: '', duration_ok: true, duration_value: { value: 6 } },
      { step: 'local_space', before: false, wrong_name_error: WRONG_NAME, after_wrong: false, object_error: '', after_object: false, string_error: '', after_string: true },
      { step: 'renderer_hints', sort_before: 0, sort_sprite_error: '', sort_sprite_after: 7, sort_ribbon_error: '', sort_ribbon_after: 3, ribbon_material: { refPath: '/Game/FX/M_Beam.M_Beam' },
        flagless_error: '', flagless_material: { refPath: '/Game/FX/M_NoFlag.M_NoFlag' },
        flags_flagged: { used_with_niagara_sprites: false, used_with_niagara_ribbons: true }, flags_default: { used_with_niagara_sprites: false, used_with_niagara_ribbons: false } },
    ],
  },
  readback: {
    emitters: ['Dust', 'Motes'], lifetime_min: 2.5, material: MATERIAL, sub_image_size: { x: 4, y: 4 },
    linked: { lifetime: { struct: { refPath: FLOAT }, value: { value: 3 } }, beam_width: { struct: { refPath: FLOAT }, value: { value: 12 } }, beam_material: { refPath: '/Game/FX/M_Beam.M_Beam' },
      beam_sort: 3, orb_sort: 7, orb_local_space: true },
    audit: { NS_Worked: [], NS_Linked: [], NS_Broken: [
      { emitter: 'OrbEmpty', module: 'InitializeParticle', input: 'Lifetime', problem: 'empty link: Module.None' },
      { emitter: 'OrbZero', module: 'InitializeParticle', input: 'Lifetime', problem: 'lifetime reads 0' }] },
  },
  issues: {
    results: {
      NS_Linked: { GetStackIssues: { error: '', value: { numErrors: 0, numWarnings: 0, numInfos: 8, issues: [{ severity: 'Info', shortDescription: 'Version upgrade note', location: { emitterName: 'Orb' } }] } },
        GetSystemCompileState: { error: '', value: { aggregateStatus: 'UpToDate', scripts: [{ emitterName: 'Orb', lastCompileStatus: 'UpToDate', errorSummary: '' }] } } },
      NS_Broken: { GetStackIssues: { error: '', value: { numErrors: 1, numWarnings: 1, numInfos: 14, issues: [
        { severity: 'Error', shortDescription: 'This stage has compile errors.', location: { emitterName: 'OrbEmpty' }, stackDisplayPath: '/Particle Spawn' },
        { severity: 'Warning', shortDescription: 'Materials might not render correctly.', stackDisplayPath: '/Render/Ribbon Renderer', location: { emitterName: 'BeamNoFlag' },
          longDescription: "Some materials 'M_NoFlag' do not have the correct usage flags set, and will use the default material." }] } },
        GetSystemCompileState: { error: '', value: { aggregateStatus: 'Error', scripts: [{ emitterName: 'OrbEmpty', lastCompileStatus: 'Error',
          errorSummary: 'Node pin has an undefined type. - Node: Map Get Pin: Module.None - ' + String.fromCharCode(10) + 'Error compiling input for set node. - Node: Map Set Pin: InitializeParticle.Lifetime - ' }] } } },
    },
  },
  authorLog: [
    'LogToolsetRegistry: Display: Registering Toolset NiagaraToolsets.NiagaraToolset_System',
    'LogPython: Display: Running start-up script C:/Engine/NiagaraToolsets/Content/Python/init_unreal.py... took 11.925 ms',
  ].join('\n'),
  startup: { registered: true, call_complete: true, call_error: '', emitters: ['Dust', 'Motes'] }, startupExit: 1,
  startupLog: [
    'LogPython: [nts_startup] project init_unreal.py ran',
    'LogPython: Error: AttributeError: module unreal has no attribute ExampleMissingClass',
    ...['NiagaraToolsets', 'IKRig', 'ControlRig', 'ToolsetRegistry'].map((n) => `LogPython: Display: Running start-up script ${n}/Content/Python/init_unreal.py... took 2.1 ms`),
  ].join('\n'),
  notes: {
    same_process: [
      { note: 'saved first', returned: true }, { note: 'start', asset: 'NS_Same', on_disk: true },
      { note: 'delete_asset', returned: true, file_on_disk: false, registry_has_it: false },
      { note: 'create', result: 'ok' }, { note: 'add_emitter', result: 'ok' }, { note: 'save_asset', returned: true }, { note: 'done' },
    ],
    stale: [
      { note: 'start', asset: 'NS_Stale', on_disk: true }, { note: 'delete_asset', returned: true, file_on_disk: true, registry_has_it: true },
      { note: 'create', result: 'ok' }, { note: 'add_emitter', result: 'ok' },
    ],
    rescan_only: [
      { note: 'start', asset: 'NS_Rescan', on_disk: true }, { note: 'delete_asset', returned: true, file_on_disk: true, registry_has_it: true },
      { note: 'rescanned', registry_has_it: true }, { note: 'create', result: 'ok' }, { note: 'add_emitter', result: 'ok' },
    ],
    remove_rescan: [
      { note: 'start', asset: 'NS_Fixed', on_disk: true }, { note: 'delete_asset', returned: true, file_on_disk: true, registry_has_it: true },
      { note: 'file removed' }, { note: 'rescanned', registry_has_it: false }, { note: 'create', result: 'ok' }, { note: 'add_emitter', result: 'ok' },
      { note: 'save_asset', returned: true }, { note: 'done' },
    ],
  },
  exits: { make: 0, same_process: 0, stale: 3, rescan_only: 3, remove_rescan: 0 },
  logs: { stale: CRASH_LOG, rescan_only: CRASH_LOG },
});

const failing = (r) => evaluate(r).filter((c) => !c.pass).map((c) => c.name);
const mutate = (fn) => { const r = canned(); fn(r); return failing(r); };
const step = (r, name) => r.author.steps.find((s) => s.step === name);

test('the 5.8.2 reports pass every check', () => {
  const checks = evaluate(canned());
  assert.deepEqual(failing(canned()), []);
  assert.deepEqual(summarize(checks), { passed: 24, total: 24 });
});

test('a startup traceback or a missing toolset fails the first check', () => {
  assert.deepEqual(mutate((r) => { r.authorLog += "\nLogPython: Error: AttributeError: module 'unreal' has no attribute 'AgentSkill'"; }), ['the toolset registers and the log shows no startup traceback']);
  assert.deepEqual(mutate((r) => { r.author.toolset_registered = false; }), ['the toolset registers and the log shows no startup traceback']);
});

test('the skill and start-up checks fail when the facts change', () => {
  assert.deepEqual(mutate((r) => { r.author.niagara_skills.pop(); }), ['init_unreal.py registers seven skills, and the tools register before it runs']);
  assert.deepEqual(mutate((r) => { r.authorLog = r.authorLog.split(String.fromCharCode(10)).reverse().join(String.fromCharCode(10)); }), ['init_unreal.py registers seven skills, and the tools register before it runs']);
  const raised = 'a start-up script that raises is logged and does not stop other Python';
  assert.deepEqual(mutate((r) => { r.startupLog = r.startupLog.replace('LogPython: Error: AttributeError', 'LogPython: Display: ok'); }), [raised]);
  assert.deepEqual(mutate((r) => { r.startup.registered = false; }), [raised]);
  assert.deepEqual(mutate((r) => { r.startupLog = r.startupLog.split('\n').slice(0, 3).join('\n'); }), [raised]);
  assert.deepEqual(mutate((r) => { r.startupExit = 0; }), [raised]);
});

test('call-shape checks fail when the value, the shape or the persistence changes', () => {
  assert.deepEqual(mutate((r) => { step(r, 'add_emitters').emitters = ['Dust']; }), ['a system is created with the factory and gets two emitters from Epic templates']);
  assert.deepEqual(mutate((r) => { step(r, 'stack_input').after = 5; }), ['a stack input is read, changed and written back']);
  assert.deepEqual(mutate((r) => { step(r, 'stack_input').enum_keys = ['enumName']; }), ['a color input and an enum input have their own value shapes']);
  assert.deepEqual(mutate((r) => { step(r, 'stack_input').unknown_input_error = ''; }), ['an unknown input name is reported as an error']);
  assert.deepEqual(mutate((r) => { step(r, 'renderer').after_object = MATERIAL; }), ['SetRendererData takes propertyValues as a JSON string']);
  assert.deepEqual(mutate((r) => { step(r, 'renderer').after_string = DEFAULT_MATERIAL; }), ['SetRendererData takes propertyValues as a JSON string']);
  assert.deepEqual(mutate((r) => { r.readback.lifetime_min = 5; }), ['the edits survive a save and a new process']);
  assert.deepEqual(mutate((r) => { r.readback = undefined; }), ['the edits survive a save and a new process',
    'the read-back audit flags an empty link and a zero lifetime and passes the clean systems', 'SortOrderHint is a renderer property on sprite and ribbon renderers',
    'a ribbon renderer takes a material with its own usage flag']);
});

test('the bound-input checks fail when an in-place edit starts to work or the helper stops replacing the data', () => {
  const linked = 'a linked input is replaced as a whole, not edited in place', dynamic = 'a dynamic input is replaced as a whole, not edited in place';
  const audited = 'the read-back audit flags an empty link and a zero lifetime and passes the clean systems';
  assert.deepEqual(mutate((r) => { step(r, 'bound_inputs').add_key_link = 'Module.None'; }), [linked]);
  assert.deepEqual(mutate((r) => { step(r, 'bound_inputs').emptied_is_empty = false; }), [linked]);
  assert.deepEqual(mutate((r) => { step(r, 'bound_inputs').helper_lifetime.kind = LINKED_KIND; }), [linked]);
  assert.deepEqual(mutate((r) => { step(r, 'bound_inputs').dynamic_kind = 'NiagaraFloat'; }), [dynamic]);
  assert.deepEqual(mutate((r) => { step(r, 'bound_inputs').helper_width.value = 1; }), [dynamic]);
  assert.deepEqual(mutate((r) => { r.readback.audit.NS_Linked = [{ emitter: 'Orb', module: 'InitializeParticle', input: 'Lifetime', problem: 'empty link: Module.None' }]; }), [audited]);
  assert.deepEqual(mutate((r) => { r.readback.audit.NS_Broken.pop(); }), [audited]);
  assert.deepEqual(mutate((r) => { r.readback.linked.lifetime = { struct: { refPath: FLOAT }, value: { value: 0 } }; }), [audited]);
});

test('the hidden-input checks require the whole message and the gating input', () => {
  const hiddenInput = 'a hidden input is refused and the message names the refused input, not the gating one';
  const condition = 'an input hidden by a visible condition is refused until its gating input is flipped';
  assert.deepEqual(mutate((r) => { step(r, 'hidden_input').refused_error = HIDDEN_ERROR.split('.')[0]; }), [hiddenInput]);
  assert.deepEqual(mutate((r) => { step(r, 'hidden_input').refused_error = HIDDEN_ERROR + ' Color Mode is Unset.'; }), [hiddenInput]);
  assert.deepEqual(mutate((r) => { step(r, 'hidden_input').refused_ok = true; }), [hiddenInput]);
  assert.deepEqual(mutate((r) => { step(r, 'hidden_input').mode_is_static_switch = false; }), [hiddenInput]);
  assert.deepEqual(mutate((r) => { step(r, 'hidden_input').painted_ok = false; }), [hiddenInput]);
  assert.deepEqual(mutate((r) => { step(r, 'hidden_input').duration_error = ''; }), [condition]);
  assert.deepEqual(mutate((r) => { step(r, 'hidden_input').duration_ok = false; }), [condition]);
});

test('the renderer and emitter checks fail when a property or an argument name changes', () => {
  const local = 'SetEmitterData switches an emitter to local space with emitter and emitterData';
  const sort = 'SortOrderHint is a renderer property on sprite and ribbon renderers';
  const ribbon = 'a ribbon renderer takes a material with its own usage flag';
  const covers = 'the template emitters cover the effects the templates reference names';
  assert.deepEqual(mutate((r) => { step(r, 'local_space').after_string = false; }), [local]);
  assert.deepEqual(mutate((r) => { step(r, 'local_space').after_object = true; }), [local]);
  assert.deepEqual(mutate((r) => { step(r, 'local_space').wrong_name_error = ''; }), [local]);
  assert.deepEqual(mutate((r) => { step(r, 'templates').made.Fountain.local_space = true; }), [local]);
  assert.deepEqual(mutate((r) => { step(r, 'renderer_hints').sort_ribbon_after = 0; }), [sort]);
  assert.deepEqual(mutate((r) => { r.readback.linked.orb_sort = 0; }), [sort]);
  assert.deepEqual(mutate((r) => { step(r, 'renderer_hints').flags_flagged.used_with_niagara_ribbons = false; }), [ribbon]);
  assert.deepEqual(mutate((r) => { step(r, 'renderer_hints').flags_default.used_with_niagara_ribbons = true; }), [ribbon]);
  assert.deepEqual(mutate((r) => { step(r, 'templates').made.LocationBasedRibbon.spawn_modules = ['SpawnRate']; }), [covers]);
  assert.deepEqual(mutate((r) => { step(r, 'templates').made.SingleLoopingParticle.lifetime_link = null; }), [covers]);
  assert.deepEqual(mutate((r) => { step(r, 'templates').made.StaticBeam.renderer = SPRITE; }), [covers]);
  assert.deepEqual(mutate((r) => { step(r, 'templates').made.OmnidirectionalBurst.burst_count = 1; }), [covers]);
  assert.deepEqual(mutate((r) => { step(r, 'templates').made.Fountain.spawn_rate = 50; }), [covers]);
  assert.deepEqual(mutate((r) => { step(r, 'templates').made.StaticBeam.beam_end = { x: 0, y: 0, z: 200 }; }), [covers]);
  assert.deepEqual(mutate((r) => { step(r, 'templates').made.StaticBeam.modules.push('UpdateBeam'); }), [covers]);
  assert.deepEqual(mutate((r) => { step(r, 'templates').made.SingleLoopingParticle.description = 'A particle'; }), [covers]);
});

test('the stack-issue check needs the compile error and the usage-flag warning', () => {
  const issues = 'the editor tick reports an emptied link and a ribbon material without its flag';
  assert.deepEqual(mutate((r) => { r.issues.results.NS_Broken.GetStackIssues.value.numErrors = 0; }), [issues]);
  assert.deepEqual(mutate((r) => { r.issues.results.NS_Broken.GetStackIssues.value.issues[1].longDescription = ''; }), [issues]);
  assert.deepEqual(mutate((r) => { r.issues.results.NS_Linked.GetStackIssues.value.numWarnings = 1; }), [issues]);
  assert.deepEqual(mutate((r) => { r.issues.results.NS_Broken.GetSystemCompileState.value.scripts[0].errorSummary = ''; }), [issues]);
  assert.deepEqual(mutate((r) => { r.issues = undefined; }), [issues]);
});

test('the delete-and-recreate checks tell a crash from a clean exit', () => {
  assert.deepEqual(mutate((r) => { r.exits.same_process = 3; }), ['a system made and saved in this process is deleted and recreated without a crash']);
  assert.deepEqual(mutate((r) => { r.notes.stale[1].file_on_disk = false; }), ['delete_asset on a system saved by an earlier process leaves the file']);
  assert.deepEqual(mutate((r) => { r.logs.stale = ''; }), ['creating over the left-over file and saving crashes the editor']);
  assert.deepEqual(mutate((r) => { r.notes.stale.push({ note: 'save_asset', returned: true }, { note: 'done' }); r.exits.stale = 0; }), ['creating over the left-over file and saving crashes the editor']);
  assert.deepEqual(mutate((r) => { r.exits.rescan_only = 0; r.notes.rescan_only.push({ note: 'done' }); }), ['a rescan without removing the file still crashes']);
  assert.deepEqual(mutate((r) => { r.exits.remove_rescan = 3; }), ['removing the file and rescanning lets the new system be created and saved']);
  assert.deepEqual(mutate((r) => { r.notes.remove_rescan = r.notes.remove_rescan.slice(0, -2); }), ['removing the file and rescanning lets the new system be created and saved']);
});

test('missing reports fail instead of throwing', () => {
  const checks = evaluate({});
  assert.equal(checks.length, 24);
  assert.ok(checks.every((c) => c.pass === false));
});
