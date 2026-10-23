// node --test examples/unreal/gas_native/gas-native.test.mjs  (no Unreal, no dependencies)
// The report below has the shape the GasNativeProbe commandlet wrote on Unreal 5.8.2. Each test changes one fact and expects the matching
// check to fail, so the judge cannot pass by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize } from './gas-native-checks.mjs';

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
  },
});
const failing = (input) => evaluate(input).filter((c) => !c.pass).map((c) => c.name);
const withStep = (name, over) => { const g = good(); g.report.steps[name] = { ...g.report.steps[name], ...over }; return g; };

test('a good run passes every check', () => {
  const checks = evaluate(good());
  assert.deepEqual(failing(good()), []);
  assert.deepEqual(summarize(checks), { passed: 12, total: 12 });
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
  assert.deepEqual(failing(g), ['engine raises no constructor warning']);
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
