// node --test examples/unreal/rendering_probes/rp-validate.test.mjs  (no Unreal, no dependencies)
// The report below is what rp_probe.py wrote on Unreal 5.8.2; each mutation changes one fact and expects the matching check to fail, and an empty
// report fails every check. rp_validate.mjs feeds the same function the real report from an Unreal 5.8 run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, summarize, countMissingCvarLines, probeBugTexts, routeProblems, planCleanup, flushLine } from './rp-validate-checks.mjs';

const CHECK_1 = 'two directional lights read 0 and 0, then 1 and 0 after set_forward_shading_priority(1) on one';
const CHECK_2 = 'every other route recorded the outcome the reference states, and none recorded a bug in the probe';
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
  const total = evaluate(canned()).length;
  assert.ok(total >= 3);
  assert.deepEqual(summarize(evaluate(canned())), { passed: total, total });
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

test('check 2 fails when a route recorded neither an error nor a read-back', () => {
  assert.deepEqual(mutate((r) => { delete r.report.routes.setter_negative; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.routes.set_editor_property = { ok: false }; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.routes.attribute_assignment = { ok: true }; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.routes.setter_on_static = { ok: true, mobility: 'STATIC', value: 'x' }; }), [CHECK_2]);
  assert.match(routeProblems({}).join('\n'), /set_editor_property recorded neither/);
});

test('check 2 fails when a recorded text is a Python AttributeError or NameError, whichever route recorded it', () => {
  // the failure that once passed: the Static route recorded a probe mistake and the run still passed
  assert.deepEqual(mutate((r) => { r.report.routes.setter_on_static = { ok: false, error: "'DirectionalLightComponent' object has no attribute 'is_registered'" }; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.routes.setter_on_static = { ok: false, error: "AttributeError: 'x' object has no attribute 'y'" }; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.routes.set_editor_property = { ok: false, error: "NameError: name 'lights' is not defined" }; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.routes.set_editor_property = { ok: false, error: "name 'light' is not defined" }; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.lights.attribute_before = { ok: false, error: "module 'unreal' has no attribute 'Missing'" }; }), [CHECK_2]);
  // any text anywhere in the report is found
  assert.deepEqual(probeBugTexts({ routes: { a: { ok: false, error: 'NameError: x' } }, extra: [{ deep: 'AttributeError' }] }), ['NameError: x', 'AttributeError']);
  // the engine's own read-only message mentions an attribute and is not a probe bug
  assert.deepEqual(probeBugTexts(canned().report), []);
});

test('check 2 fails when a stated outcome changes', () => {
  assert.deepEqual(mutate((r) => { r.report.routes.set_editor_property.value = 3; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.routes.attribute_assignment = { ok: true, value: 3 }; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.routes.attribute_assignment = { ok: false, error: 'something else went wrong' }; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.routes.setter_negative.value = 7; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.routes.setter_negative.before = 0; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.routes.setter_on_static.value = 5; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.routes.setter_on_static.before = 5; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.routes.setter_on_static.mobility = '<ComponentMobility.MOVABLE: 2>'; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.lights.mobility = '<ComponentMobility.MOVABLE: 2>'; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { delete r.report.lights.mobility; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { r.report.lights.attribute_before = { ok: false, error: 'boom' }; }), [CHECK_2]);
  assert.deepEqual(mutate((r) => { delete r.report.lights.attribute_before; }), [CHECK_2]);
  assert.deepEqual(routeProblems(canned().report), []);
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

test('an empty report fails every check instead of throwing', () => {
  const checks = evaluate({});
  assert.equal(checks.length, evaluate(canned()).length);
  assert.ok(checks.every((c) => c.pass === false));
  assert.deepEqual(summarize(checks), { passed: 0, total: checks.length });
});

test('a clean run deletes the project folder unless --keep was passed', () => {
  const ctx = { root: 'R', logPath: 'R/Saved/Logs/probe.log' };
  const passing = evaluate(canned());
  assert.deepEqual(planCleanup({ ...ctx, keep: false, report: canned().report, checks: passing }), { remove: true, message: '' });
  assert.deepEqual(planCleanup({ ...ctx, keep: true, report: canned().report, checks: passing }), { remove: false, message: 'kept R' });
});

test('a failed check or a missing report keeps the folder and names the log, even without --keep', () => {
  const ctx = { root: 'R', logPath: 'R/Saved/Logs/probe.log', keep: false };
  const r = canned();
  r.report.lights.after = [0, 0];
  const one = planCleanup({ ...ctx, report: r.report, checks: evaluate(r) });
  assert.equal(one.remove, false);
  assert.equal(one.message, '1 check failed; kept R; editor log: R/Saved/Logs/probe.log');
  const two = canned();
  two.report.lights.after = [0, 0];
  two.log = '';
  assert.match(planCleanup({ ...ctx, report: two.report, checks: evaluate(two) }).message, /^2 checks failed; kept R; editor log: /);
  const none = planCleanup({ ...ctx, report: undefined, checks: evaluate({}) });
  assert.deepEqual(none, { remove: false, message: 'no report was written; kept R; editor log: R/Saved/Logs/probe.log' });
  assert.equal(planCleanup({ ...ctx, keep: true, report: undefined, checks: [] }).remove, false);
});

test('flushLine writes the whole line at once, resumes after a partial write and a busy stream, and never throws', () => {
  const written = [];
  const partial = (fd, data, offset, length) => { const n = Math.min(length, 4); written.push([fd, Buffer.from(data.subarray(offset, offset + n)).toString()]); return n; };
  assert.equal(flushLine('phase done', { fd: 2, write: partial }), true);
  assert.equal(written.map((w) => w[1]).join(''), 'phase done\n');
  assert.ok(written.every((w) => w[0] === 2));
  let busy = 2, slept = 0, out = '';
  const flaky = (fd, data, offset, length) => { if (busy-- > 0) throw Object.assign(new Error('busy'), { code: 'EAGAIN' }); out += data.subarray(offset, offset + length); return length; };
  assert.equal(flushLine('late', { write: flaky, sleep: () => { slept++; } }), true);
  assert.deepEqual([out, slept], ['late\n', 2]);
  busy = 1; out = '';
  assert.equal(flushLine('default sleep', { write: flaky }), true);
  assert.equal(out, 'default sleep\n');
  const dir = mkdtempSync(join(tmpdir(), 'rp-flush-'));
  try {
    const file = join(dir, 'out.txt'), fd = openSync(file, 'w');
    assert.equal(flushLine('through the real writeSync', { fd }), true);
    closeSync(fd);
    assert.equal(readFileSync(file, 'utf8'), 'through the real writeSync\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const gone = () => { throw Object.assign(new Error('closed'), { code: 'EPIPE' }); };
  assert.equal(flushLine('nobody listens', { write: gone }), false);
  const stuck = () => { throw Object.assign(new Error('busy'), { code: 'EAGAIN' }); };
  assert.equal(flushLine('never', { write: stuck, sleep: () => {} }), false);
});
