// node --test examples/unreal/compare-scene/compare-perf.test.mjs  (no Unreal, no dependencies)
// The receipts below are written by hand to the shape AECompare.cpp produces (null_rhi, candidates[].stress.perf with four series of mean, p50, p95 and max). That shape is an
// assumption until the scene has run on an engine: the first run confirms it, and the numbers here are not measurements. Each test changes one fact and expects the matching
// check to fail, and an empty receipt fails every check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePerf, shapeProblems, summarize, THRESHOLDS } from './compare-perf-checks.mjs';

const series = (mean) => ({ mean, p50: mean, p95: mean * 1.1, max: mean * 1.3 });
const perf = ({ wall, game, render, gpu, available = true }) => ({
  frames: 120, gpu_time_available: available,
  wall_ms: series(wall), game_thread_ms: series(game), render_thread_ms: series(render), gpu_ms: series(gpu),
});
const candidate = (id, p) => ({ id, label: id, note: '', stress: { copies: 1, frames: 120, frame_ms_mean: p.wall_ms.mean, screenshot: '', perf: p } });
const rendered = () => ({
  scenario: 'compare', set: 'perf', null_rhi: false,
  candidates: [
    candidate('perf-baseline', perf({ wall: 8.0, game: 2.0, render: 2.5, gpu: 3.0 })),
    candidate('perf-gpu-supersample', perf({ wall: 12.5, game: 2.1, render: 3.0, gpu: 11.0 })),
    candidate('perf-cpu-spin', perf({ wall: 8.5, game: 6.0, render: 2.5, gpu: 3.1 })),
  ],
});
const headless = () => ({
  scenario: 'compare', set: 'perf', null_rhi: true,
  candidates: [
    candidate('perf-baseline', perf({ wall: 2.0, game: 1.0, render: 0, gpu: 0, available: false })),
    candidate('perf-gpu-supersample', perf({ wall: 2.0, game: 1.0, render: 0, gpu: 0, available: false })),
    candidate('perf-cpu-spin', perf({ wall: 6.0, game: 5.0, render: 0, gpu: 0, available: false })),
  ],
});

const failing = (receipt) => evaluatePerf(receipt).filter((c) => !c.pass).map((c) => c.name);
const mutate = (make, fn) => { const r = make(); fn(r); return failing(r); };
const byId = (r, id) => r.candidates.find((c) => c.id === id).stress.perf;
const SHAPE = 'every candidate has a well formed perf block';

test('a rendered receipt and a headless receipt each pass their own checks', () => {
  assert.deepEqual(failing(rendered()), []);
  assert.deepEqual(failing(headless()), []);
  const checks = evaluatePerf(rendered());
  assert.deepEqual(summarize(checks), { passed: checks.length, total: checks.length });
  assert.equal(checks.length, 7);
  assert.equal(evaluatePerf(headless()).length, 4);
});

test('shape problems name the candidate and the missing field', () => {
  assert.deepEqual(shapeProblems(rendered()), []);
  const r = rendered();
  delete byId(r, 'perf-cpu-spin').gpu_ms.p95;
  assert.deepEqual(shapeProblems(r), ['perf-cpu-spin: perf.gpu_ms.p95 is not a number']);
  const q = rendered();
  delete q.candidates[0].stress.perf;
  assert.deepEqual(shapeProblems(q), ['perf-baseline: no stress.perf block']);
  const s = rendered();
  byId(s, 'perf-baseline').frames = 3;
  assert.match(shapeProblems(s)[0], /perf\.frames is 3/);
  const u = rendered();
  delete u.null_rhi;
  assert.deepEqual(shapeProblems(u), ['null_rhi is missing or not a boolean']);
  assert.deepEqual(shapeProblems(null), ['the receipt is not an object']);
});

test('a malformed perf block fails the shape check', () => {
  assert.equal(mutate(rendered, (r) => { delete byId(r, 'perf-baseline').wall_ms; })[0], SHAPE);
  assert.equal(mutate(rendered, (r) => { byId(r, 'perf-baseline').gpu_time_available = 'yes'; })[0], SHAPE);
  assert.equal(mutate(rendered, (r) => { byId(r, 'perf-baseline').game_thread_ms.mean = null; })[0], SHAPE);
});

test('another set is not judged as the perf set', () => {
  const r = rendered();
  r.candidates = r.candidates.map((c) => ({ ...c, id: `other-${c.id}` }));
  assert.deepEqual(failing(r), ['the receipt is from the perf set']);
});

test('a rendered receipt whose GPU time was not read fails the availability check', () => {
  assert.ok(mutate(rendered, (r) => { byId(r, 'perf-baseline').gpu_time_available = false; }).includes('with a rendering RHI the GPU time is read'));
  assert.ok(mutate(rendered, (r) => { byId(r, 'perf-baseline').gpu_ms.mean = 0; }).includes('with a rendering RHI the GPU time is read'));
});

test('a GPU-side change that does not move the GPU time fails', () => {
  assert.deepEqual(mutate(rendered, (r) => { byId(r, 'perf-gpu-supersample').gpu_ms.mean = 3.1; }), ['a GPU-side change moves the GPU time']);
  // a rise that is large in ratio but tiny in milliseconds is not enough
  assert.deepEqual(mutate(rendered, (r) => {
    byId(r, 'perf-baseline').gpu_ms.mean = 0.1; byId(r, 'perf-gpu-supersample').gpu_ms.mean = 0.3; byId(r, 'perf-cpu-spin').gpu_ms.mean = 0.1;
  }), ['a GPU-side change moves the GPU time']);
});

test('a GPU-side change that moves the game thread fails', () => {
  assert.deepEqual(mutate(rendered, (r) => { byId(r, 'perf-gpu-supersample').game_thread_ms.mean = 4.5; }), ['a GPU-side change leaves the game thread alone']);
});

test('a CPU-side change that does not move the game thread, or that moves the GPU, fails', () => {
  assert.deepEqual(mutate(rendered, (r) => { byId(r, 'perf-cpu-spin').game_thread_ms.mean = 2.5; }), ['a CPU-side change moves the game thread time']);
  assert.deepEqual(mutate(rendered, (r) => { byId(r, 'perf-cpu-spin').gpu_ms.mean = 6.0; }), ['a CPU-side change leaves the GPU time alone']);
});

test('a headless receipt that records GPU time, or whose CPU row does not move, fails', () => {
  assert.deepEqual(mutate(headless, (r) => { byId(r, 'perf-baseline').gpu_ms.max = 1.2; }), ['without a rendering RHI the GPU time reads zero']);
  assert.deepEqual(mutate(headless, (r) => { byId(r, 'perf-baseline').gpu_time_available = true; }), ['without a rendering RHI the GPU time reads zero']);
  assert.deepEqual(mutate(headless, (r) => { byId(r, 'perf-cpu-spin').game_thread_ms.mean = 1.5; }), ['without a rendering RHI the game thread time still moves with CPU work']);
});

test('an empty receipt fails the shape check and the set check instead of throwing', () => {
  const checks = evaluatePerf({});
  assert.ok(checks.every((c) => c.pass === false));
  assert.ok(checks.length >= 2);
  assert.doesNotThrow(() => evaluatePerf(undefined));
  assert.ok(THRESHOLDS.gpuRiseRatio > 1);
});
