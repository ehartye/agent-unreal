// node --test examples/unreal/rendering_probes/rp-viewport.test.mjs  (no Unreal, no dependencies)
// The report and the observation sheet below are written by hand to the shape rp_viewport_probe.py and rp_viewport.mjs produce; no engine has produced either yet, so the shape is an
// assumption that the first run confirms. The observations are a person's, so no run of this file proves the renderer draws anything. Each test changes one fact and expects the
// matching check to fail, and an empty input fails every check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MESSAGE_START, PHASES, evaluateExtras, evaluateViewport, observationTemplate, summarize } from './rp-viewport-checks.mjs';

const extras = () => ({
  engine: '5.8.2', mode: 'extras', errors: [],
  existing_level: { found_total: 2, found: ['RpMoon', 'RpSun'], before: { RpSun: 0, RpMoon: 0 }, after: { RpSun: 1, RpMoon: 0 } },
  unregistered: { ok: true, value: 3 },
  renderer: { forward_shading: 0 },
});
const light = (priority) => ({ label: 'x', priority, intensity: 1.0, visible: true });
const interactiveReport = () => ({
  engine: '5.8.2', mode: 'interactive', errors: [], done: true, renderer: { forward_shading: 0 }, phase_seconds: 30,
  phases: PHASES.map((p, i) => ({ name: p.name, action: p.action, started_seconds: 20 + 30 * i, lights: p.priorities.map(light) })),
});
const observed = () => {
  const sheet = observationTemplate();
  const visible = { tie: true, raise_setter: false, back_to_tie: true, raise_property: false, back_property: true, moon_component_hidden: false, moon_zero_intensity: true, moon_actor_hidden_in_editor: false };
  for (const [name, v] of Object.entries(visible)) sheet[name].message_visible = v;
  sheet.tie.text_seen = `${MESSAGE_START} to be the single one used for forward shading`;
  sheet.tie.colour = 'orange';
  return sheet;
};

const failingExtras = (r) => evaluateExtras(r).filter((c) => !c.pass).map((c) => c.name);
const failingView = (input) => evaluateViewport(input).filter((c) => !c.pass).map((c) => c.name);
const mutExtras = (fn) => { const r = extras(); fn(r); return failingExtras(r); };
const mutView = (fn) => { const input = { report: interactiveReport(), observed: observed() }; fn(input); return failingView(input); };
const LEVEL = 'the existing-level form finds both lights and sets each component';
const UNREG = 'the setter on a component the world has not registered records an outcome';
const RENDERER = 'the renderer setting is read';

test('the canned extras report passes every check', () => {
  assert.deepEqual(failingExtras(extras()), []);
  assert.deepEqual(summarize(evaluateExtras(extras())), { passed: 3, total: 3 });
});

test('the existing-level form fails when a light is not found or the priority does not read back', () => {
  assert.deepEqual(mutExtras((r) => { r.existing_level.found = ['RpSun']; }), [LEVEL]);
  assert.deepEqual(mutExtras((r) => { r.existing_level.after = { RpSun: 0, RpMoon: 0 }; }), [LEVEL]);
  assert.deepEqual(mutExtras((r) => { r.existing_level.after = { RpSun: 1, RpMoon: 1 }; }), [LEVEL]);
  assert.deepEqual(mutExtras((r) => { r.existing_level = { traceback: 'KeyError' }; }), [LEVEL]);
});

test('an unregistered-component outcome is recorded whichever way it went, and a probe bug is not an outcome', () => {
  assert.deepEqual(mutExtras((r) => { r.unregistered = { ok: false, error: 'DirectionalLightComponent: could not set the property' }; }), []);
  assert.deepEqual(mutExtras((r) => { r.unregistered = { ok: false, error: "'DirectionalLightComponent' object has no attribute 'is_registered'" }; }), [UNREG]);
  assert.deepEqual(mutExtras((r) => { r.unregistered = { ok: false }; }), [UNREG]);
  assert.deepEqual(mutExtras((r) => { r.unregistered = { ok: true, value: 'x' }; }), [UNREG]);
  assert.deepEqual(mutExtras((r) => { delete r.unregistered; }), [UNREG]);
});

test('the renderer setting must be an integer', () => {
  assert.deepEqual(mutExtras((r) => { delete r.renderer; }), [RENDERER]);
  assert.deepEqual(mutExtras((r) => { r.renderer.forward_shading = 'unavailable'; }), [RENDERER]);
});

test('an empty extras report fails every check instead of throwing', () => {
  for (const input of [{}, undefined]) assert.ok(evaluateExtras(input).every((c) => c.pass === false));
});

test('the interactive phases, a full report and a complete sheet pass every check', () => {
  assert.deepEqual(failingView({ report: interactiveReport(), observed: observed() }), []);
  assert.equal(evaluateViewport({ report: interactiveReport(), observed: observed() }).length, 2 + PHASES.length + 1);
  assert.deepEqual(PHASES.map((p) => p.name), ['tie', 'raise_setter', 'back_to_tie', 'raise_property', 'back_property', 'moon_component_hidden', 'moon_zero_intensity', 'moon_actor_hidden_in_editor']);
});

test('the source-predicted phases fail when the observation says otherwise', () => {
  assert.deepEqual(mutView(({ observed: o }) => { o.tie.message_visible = false; }), ['tie: the message is visible']);
  assert.deepEqual(mutView(({ observed: o }) => { o.raise_setter.message_visible = true; }), ['raise_setter: the message is hidden']);
  assert.deepEqual(mutView(({ observed: o }) => { o.back_to_tie.message_visible = false; }), ['back_to_tie: the message is visible']);
});

test('the phases the source does not settle pass with either answer and fail without one', () => {
  for (const name of ['raise_property', 'back_property', 'moon_component_hidden', 'moon_zero_intensity', 'moon_actor_hidden_in_editor']) {
    assert.deepEqual(mutView(({ observed: o }) => { o[name].message_visible = !o[name].message_visible; }), [], name);
    assert.deepEqual(mutView(({ observed: o }) => { o[name].message_visible = null; }), [`${name}: the outcome is recorded`], name);
  }
});

test('the tie text and colour must be filled in', () => {
  const NAME = 'the tie message starts with the expected words and is orange';
  assert.deepEqual(mutView(({ observed: o }) => { o.tie.colour = ''; }), [NAME]);
  assert.deepEqual(mutView(({ observed: o }) => { o.tie.colour = 'white'; }), [NAME]);
  assert.deepEqual(mutView(({ observed: o }) => { o.tie.text_seen = 'Lighting needs to be rebuilt'; }), [NAME]);
});

test('a report that did not finish, a mis-scripted phase or a forward renderer fails', () => {
  assert.deepEqual(mutView(({ report: r }) => { r.done = false; }), ['the script ran every phase and the lights read back as scripted']);
  assert.deepEqual(mutView(({ report: r }) => { r.phases.pop(); }), ['the script ran every phase and the lights read back as scripted']);
  assert.deepEqual(mutView(({ report: r }) => { r.phases[1].lights[0].priority = 0; }), ['the script ran every phase and the lights read back as scripted']);
  assert.deepEqual(mutView(({ report: r }) => { r.renderer.forward_shading = 1; }), ['the observations are for a deferred renderer']);
});

test('an empty interactive input fails every check instead of throwing', () => {
  for (const input of [{}, undefined]) assert.ok(evaluateViewport(input).every((c) => c.pass === false));
});

test('the observation template has a blank entry for every phase', () => {
  const sheet = observationTemplate();
  assert.deepEqual(Object.keys(sheet), PHASES.map((p) => p.name));
  assert.deepEqual(sheet.tie, { message_visible: null, text_seen: '', colour: '', screenshot: '' });
});

test('the probe script lists the same phases, in the same order, as the checks', () => {
  const text = readFileSync(join(import.meta.dirname, 'rp_viewport_probe.py'), 'utf8');
  const named = [...text.matchAll(/^\s+\("([a-z_]+)", "/gm)].map((m) => m[1]);
  assert.deepEqual(named, PHASES.map((p) => p.name));
  assert.ok(text.includes('RP_MODE'));
});
