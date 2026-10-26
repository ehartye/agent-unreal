// node --test examples/unreal/gas_native/gas-native.test.mjs  (no Unreal, no dependencies)
// The report below has the shape the GasNativeProbe commandlet wrote on Unreal 5.8.2. Each test changes one fact and expects the matching
// check to fail, so the judge cannot pass by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize } from './gas-native-checks.mjs';
import { CASES, COMPONENTS, judgeCases, describeCase } from './gas-native-cases.mjs';

const COOLDOWN = 'GasNative.Cooldown.Pulse';
const step = (over) => ({ sim_time: 0, charge: 100, cooldown_tag: false, ability_active: false, ...over });
const good = () => ({
  build: { exit: 0, log: 'Result: Succeeded' },
  exit: 0,
  log: 'LogGasNativeProbe: Display: GasNativeProbe report written',
  report: {
    classes: {
      cooldown_component_present: true, cooldown_granted_tags: [COOLDOWN], cooldown_has_duration: true,
      ability_asset_tags: ['GasNative.Ability.Pulse'], cost_effect_set: true, cooldown_effect_set: true, ability_cooldown_tags: [COOLDOWN],
    },
    steps: {
      start: step({}),
      first: step({ charge: 90, cooldown_tag: true, ability_active: true, activated: true }),
      refused: step({ charge: 90, cooldown_tag: true, ability_active: true, activated: false, can_activate: false, relevant_tags: [COOLDOWN] }),
      mid_cooldown: step({ sim_time: 1.0, charge: 90, cooldown_tag: true }),
      expired: step({ sim_time: 2.1, charge: 90, ability_ended_at: 0.6, tag_gone_at: 2.1 }),
      again: step({ sim_time: 2.1, charge: 80, cooldown_tag: true, ability_active: true, activated: true }),
      runtime_add_component: { applied: true, tag_present: true },
    },
    // Each case observed what its expectation says; an observe-only case gets a plausible reading.
    component_cases: CASES.map((c) => ({ id: c.id, component: c.component, role: c.role, observed: { ...c.expect, extra_reading: 1 } })),
  },
});
const failing = (input) => evaluate(input).filter((c) => !c.pass).map((c) => c.name);
const withCase = (id, over) => { const g = good(); const row = g.report.component_cases.find((r) => r.id === id); row.observed = { ...row.observed, ...over }; return g; };
const withStep = (name, over) => { const g = good(); g.report.steps[name] = { ...g.report.steps[name], ...over }; return g; };

test('a good run passes every check', () => {
  const checks = evaluate(good());
  assert.deepEqual(failing(good()), []);
  assert.deepEqual(summarize(checks), { passed: 12 + 1 + COMPONENTS.length + 1, total: 12 + 1 + COMPONENTS.length + 1 });
});

test('a failed build fails the build check', () => {
  const g = good(); g.build = { exit: 1, log: 'error C2065' };
  assert.deepEqual(failing(g), ['module compiles']);
});

test('no report fails the probe and every check that reads it', () => {
  const g = good(); g.report = undefined; g.exit = 1;
  assert.ok(failing(g).includes('probe ran'));
  assert.ok(failing(g).includes('ability activates and pays the cost'));
});

test('a fatal error in the log fails the probe check', () => {
  const g = good(); g.log = 'LogUObjectGlobals: Fatal error: NewObject with empty name can\'t be used';
  assert.deepEqual(failing(g), ['probe ran']);
});

test('a missing component or tag fails the constructor check', () => {
  const a = good(); a.report.classes.cooldown_component_present = false;
  assert.deepEqual(failing(a), ['effect component from the constructor']);
  const b = good(); b.report.classes.cooldown_granted_tags = [];
  assert.deepEqual(failing(b), ['effect component from the constructor']);
});

test('the engine ensure about GEComponents fails the warning check', () => {
  const g = good(); g.log = 'LogOutputDevice: Warning: Ensure condition failed: GEComponents.Contains(GEComponent) [GasNativeCooldownEffect: GrantedTags should be added to GEComponents during the constructor or in PostInitProperties]';
  assert.deepEqual(failing(g), ['engine raises no constructor warning', 'component cases raise no ensure']);
});

test('SetAssetTags called outside a constructor fails the warning check', () => {
  const g = good(); g.log = 'ensure: SetAssetTags should only be used during construction as GetAbilityTags() are primarily read from the CDO';
  assert.deepEqual(failing(g), ['engine raises no constructor warning']);
});

test('wrong ability tags or cooldown wiring fails the wiring check', () => {
  const a = good(); a.report.classes.ability_asset_tags = [];
  assert.deepEqual(failing(a), ['ability tags and wiring']);
  const b = good(); b.report.classes.ability_cooldown_tags = [];
  assert.deepEqual(failing(b), ['ability tags and wiring']);
});

test('an attribute that does not change by the cost fails the cost check', () => {
  assert.deepEqual(failing(withStep('first', { charge: 100 })), ['ability activates and pays the cost']);
});

test('no cooldown tag after activation fails the tag check', () => {
  assert.deepEqual(failing(withStep('first', { cooldown_tag: false })), ['cooldown tag present']);
});

test('a second activation that succeeds fails the refusal check', () => {
  assert.deepEqual(failing(withStep('refused', { activated: true })), ['activation refused during cooldown']);
  assert.deepEqual(failing(withStep('refused', { charge: 80 })), ['activation refused during cooldown']);
});

test('a tag that never expires, or expires early, fails the duration check', () => {
  assert.deepEqual(failing(withStep('expired', { tag_gone_at: -1, cooldown_tag: true })), ['tag lasts the cooldown']);
  assert.deepEqual(failing(withStep('expired', { tag_gone_at: 0.8 })), ['tag lasts the cooldown']);
  assert.deepEqual(failing(withStep('mid_cooldown', { cooldown_tag: false })), ['tag lasts the cooldown']);
});

test('an ability that never ends fails the ability task check', () => {
  assert.deepEqual(failing(withStep('expired', { ability_ended_at: -1 })), ['ability task ends the ability']);
});

test('a refused re-activation after expiry fails the again check', () => {
  assert.deepEqual(failing(withStep('again', { activated: false, charge: 90 })), ['activates again after the cooldown']);
});

test('AddComponent at run time that does not reach the target fails its check', () => {
  const g = good(); g.report.steps.runtime_add_component = { applied: true, tag_present: false };
  assert.deepEqual(failing(g), ['AddComponent outside a constructor']);
});

test('the case table is well formed', () => {
  const ids = CASES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const c of COMPONENTS) assert.ok(CASES.some((x) => x.component === c.name && x.role === 'effect'), `${c.name} has an effect case`);
  for (const c of COMPONENTS) assert.ok(CASES.some((x) => x.component === c.name && x.role === 'control'), `${c.name} has a control`);
  for (const c of CASES) {
    assert.ok(['assert', 'observe'].includes(c.mode), c.id);
    assert.match(c.source, /^Engine\/Plugins\/Runtime\/GameplayAbilities\/.+:\d+$/, `${c.id} cites an install-relative path:line`);
    assert.ok(c.why.length > 10, c.id);
    if (c.mode === 'assert') assert.ok(Object.keys(c.expect).length > 0, `${c.id} asserts something`);
  }
});

test('a missing case fails the recorded check and its component, and no other component', () => {
  const g = good(); g.report.component_cases = g.report.component_cases.filter((r) => r.id !== 'immunity_blocks');
  assert.deepEqual(failing(g), ['component cases recorded', 'effect component: Immunity']);
});

test('a case recorded twice, or one the judge does not know, fails the recorded check', () => {
  const a = good(); a.report.component_cases.push({ ...a.report.component_cases[0] });
  assert.deepEqual(failing(a), ['component cases recorded', 'effect component: AssetTags']);
  const b = good(); b.report.component_cases.push({ id: 'invented', component: 'Immunity', role: 'effect', observed: {} });
  assert.deepEqual(failing(b), ['component cases recorded']);
});

test('an observation that contradicts its expectation fails that component only', () => {
  assert.deepEqual(failing(withCase('immunity_blocks', { victim_applied: true })), ['effect component: Immunity']);
  assert.deepEqual(failing(withCase('block_blocks', { activation_returned: true })), ['effect component: BlockAbilityTags']);
  assert.deepEqual(failing(withCase('chance_zero', { applied_count: 3 })), ['effect component: ChanceToApply']);
  assert.deepEqual(failing(withCase('requirements_ongoing', { inhibited_with_gate: true })), ['effect component: TargetTagRequirements']);
  assert.deepEqual(failing(withCase('abilities_removed', { spec_after_removal: true })), ['effect component: Abilities']);
});

test('a control that behaves like the effect fails its component', () => {
  assert.deepEqual(failing(withCase('remove_other_control', { victim_tag_after: false })), ['effect component: RemoveOther']);
  assert.deepEqual(failing(withCase('cancel_control', { active_after: false })), ['effect component: CancelAbilityTags']);
});

test('a missing observed field is a mismatch, not a pass', () => {
  const g = good(); const row = g.report.component_cases.find((r) => r.id === 'custom_refused'); delete row.observed.applied;
  assert.deepEqual(failing(g), ['effect component: CustomCanApply']);
  const result = judgeCases(g.report).find((r) => r.id === 'custom_refused');
  assert.match(describeCase(result), /applied expected false, observed missing/);
});

test('an observe-only case passes with any reading and fails only when it is not recorded', () => {
  assert.deepEqual(failing(withCase('chance_half', { applied_count: 17 })), []);
  assert.deepEqual(failing(withCase('cancel_on_execution_infinite', { active_after: false, mode_written: false })), []);
  const g = good(); g.report.component_cases = g.report.component_cases.filter((r) => r.id !== 'chance_half');
  assert.deepEqual(failing(g), ['component cases recorded', 'effect component: ChanceToApply']);
  const result = judgeCases(withCase('chance_half', { applied_count: 17 }).report).find((r) => r.id === 'chance_half');
  assert.match(describeCase(result), /\[observe\].*"applied_count":17/);
});

test('a row filed under the wrong component or role fails its component', () => {
  const g = good(); g.report.component_cases.find((r) => r.id === 'block_control').role = 'effect';
  assert.deepEqual(failing(g), ['effect component: BlockAbilityTags']);
});

test('a failed ensure in the log fails the ensure check only', () => {
  const g = good(); g.log = 'LogOutputDevice: Warning: Ensure condition failed: ensureMsgf [AbilitySystemComponent.cpp] ';
  assert.deepEqual(failing(g), ['component cases raise no ensure']);
});

test('no report fails every component check', () => {
  const g = good(); g.report = undefined; g.exit = 1;
  const names = failing(g);
  assert.ok(names.includes('component cases recorded'));
  for (const c of COMPONENTS) assert.ok(names.includes(`effect component: ${c.name}`), c.name);
});
