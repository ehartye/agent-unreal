// node --test examples/unreal/rendering_probes/rp-validate.test.mjs  (no Unreal, no dependencies)
// The report below is what rp_probe.py wrote on Unreal 5.8.2; each mutation changes one fact and expects the matching check to fail, and an empty
// report fails all three. rp_validate.mjs feeds the same function the real report from an Unreal 5.8 run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize, countMissingCvarLines } from './rp-validate-checks.mjs';

const CHECK_1 = 'two directional lights read 0 and 0, then 1 and 0 after set_forward_shading_priority(1) on one';
const CHECK_2 = 'every other route to the property recorded an error or a read-back';
const CHECK_3 = 'the console variable lookups tell a registered name from an unknown one';

const MISSING = (name) => `[2026.10.23-05.06.20:102][  0]LogBlueprintUserMessages: Warning: Failed to find console variable '${name}'.`;
const canned = () => ({
  report: {
    engine: '5.8.2-56702186+++UE5+Release-5.8',
    lights: { before: [0, 0], mobility: '<ComponentMobility.STATIONARY: 1>', attribute_before: { value: 0, ok: true }, setter_returned: 'None', after: [1, 0] },
    routes: {
      set_editor_property: { value: 2, ok: true },
      attribute_assignment: { ok: false, error: "DirectionalLightComponent: Property 'ForwardShadingPriority' for attribute 'forward_shading_priority' on 'DirectionalLightComponent' is read-only and cannot be set" },
      setter_negative: { before: 2, value: 0, ok: true },
      setter_on_static: { before: 4, mobility: '<ComponentMobility.STATIC: 0>', value: 4, ok: true },
    },
    cvars: { allow: 0, allowed: 1 },
  },
  log: `${MISSING('r.MegaLights.Allow')}\nLogPython: other line about r.MegaLights.Allowed\n`,
});

const failing = (r) => evaluate(r).filter((c) => !c.pass).map((c) => c.name);
const mutate = (fn) => { const r = canned(); fn(r); return failing(r); };

test('the canned report passes every check', () => {
  assert.deepEqual(failing(canned()), []);
  assert.deepEqual(summarize(evaluate(canned())), { passed: 3, total: 3 });
});

test('the log counter finds the warning for one name and not for its longer neighbour', () => {
  const log = `${MISSING('r.MegaLights.Allow')}\n${MISSING('r.MegaLights.Allow')}\n`;
  assert.equal(countMissingCvarLines(log, 'r.MegaLights.Allow'), 2);
  assert.equal(countMissingCvarLines(log, 'r.MegaLights.Allowed'), 0);
  assert.equal(countMissingCvarLines('', 'r.MegaLights.Allow'), 0);
});

test('check 1 fails when a priority is read wrong before or after the call', () => {
  assert.deepEqual(mutate((r) => { r.report.lights.before = [0, 1]; }), [CHECK_1]);
  assert.deepEqual(mutate((r) => { r.report.lights.after = [0, 0]; }), [CHECK_1]);
  assert.deepEqual(mutate((r) => { r.report.lights.after = [1, 1]; }), [CHECK_1]);
  assert.deepEqual(mutate((r) => { r.report.lights.after = [1]; }), [CHECK_1]);
});

test('check 2 fails when a route recorded neither an error nor a read-back, and does not care which values it read', () => {
  assert.deepEqual(mutate((r) => { delete r.report.routes.setter_negative; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.routes.set_editor_property = { ok: false }; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.routes.attribute_assignment = { ok: true }; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.routes.setter_on_static = { ok: true, mobility: 'STATIC', value: 'x' }; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.routes.set_editor_property = { ok: false, error: 'TypeError: anything' }; }), []);
  assert.deepEqual(mutate((r) => { r.report.routes.setter_negative.value = 7; }), []);
});

test('check 3 fails when the unknown name is not reported missing or the registered one is', () => {
  assert.deepEqual(mutate((r) => { r.log = ''; }), [CHECK_3]);
  assert.deepEqual(mutate((r) => { r.log += `${MISSING('r.MegaLights.Allowed')}\n`; }), [CHECK_3]);
  assert.deepEqual(mutate((r) => { r.report.cvars.allow = 1; }), [CHECK_3]);
  assert.deepEqual(mutate((r) => { r.report.cvars.allowed = 0; }), [CHECK_3]);
  assert.deepEqual(mutate((r) => { delete r.report.cvars; }), [CHECK_3]);
});

test('check 3 also passes when the probe records why the lookup cannot be tested here', () => {
  assert.deepEqual(mutate((r) => { r.report.cvars = { allow: 0, allowed: 0, not_testable: 'the variable is registered by a module a commandlet does not load' }; r.log = ''; }), []);
  assert.deepEqual(mutate((r) => { r.report.cvars = { allow: 0, allowed: 0, not_testable: '' }; r.log = ''; }), [CHECK_3]);
});

test('an empty report fails all three checks instead of throwing', () => {
  const checks = evaluate({});
  assert.equal(checks.length, 3);
  assert.ok(checks.every((c) => c.pass === false));
  assert.deepEqual(summarize(checks), { passed: 0, total: 3 });
});
