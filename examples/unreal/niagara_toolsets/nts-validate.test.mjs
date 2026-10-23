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
    ],
  },
  readback: { emitters: ['Dust', 'Motes'], lifetime_min: 2.5, material: MATERIAL, sub_image_size: { x: 4, y: 4 } },
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
  assert.deepEqual(summarize(checks), { passed: 14, total: 14 });
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
  assert.deepEqual(mutate((r) => { r.readback = undefined; }), ['the edits survive a save and a new process']);
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
  assert.equal(checks.length, 14);
  assert.ok(checks.every((c) => c.pass === false));
});
