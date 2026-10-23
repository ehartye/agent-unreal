// node --test examples/unreal/landscape_bridge/landscape-bridge.test.mjs  (no Unreal, no dependencies)
// The reports below have the shape bridge_probe.py wrote on Unreal 5.8.2. The tests mutate one fact at a time and expect the matching
// check to fail, so the validator cannot pass by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, heightsMatch, summarize } from './landscape-bridge-checks.mjs';

const samples = () => [
  { vertex: [0, 0], expected_cm: 0.0, call_result: '-0.013947700150310993' },
  { vertex: [503, 503], expected_cm: 495.74, call_result: '496.0831298828125' },
  { vertex: [126, 126], expected_cm: -632.262, call_result: '-632.0469970703125' },
  { vertex: [420, 15], expected_cm: -831.682, call_result: '-832.0608520507812' },
];
const scenario = (extra = {}, readback = {}) => ({
  expected_components: 16, bridge_class_found: true, bridge_members: ['create_landscape_from_heights', 'get_landscape_height_at'],
  new_level_ok: true, created: true, save_level_ok: true, height_step_cm: 0.78125, samples: samples(),
  readback: { landscape_actors: 1, streaming_proxies: 0, components_total: 16, components_per_holder: [16], component_step_quads: 126, quad_size_cm: [100, 100], height_scale: 100, ...readback },
  actor_descs: 0, partitioned_after_save: false, actor_desc_classes: [], ...extra,
});
const good = () => ({
  build: { exit: 0, log: 'Result: Succeeded' },
  externalFiles: 7,
  scenarios: {
    plain: scenario(),
    wp0: scenario({ actor_descs: 3, partitioned_after_save: true, actor_desc_classes: ['Landscape', 'WorldDataLayers', 'WorldPartitionMiniMap'] }),
    wp2: scenario({ actor_descs: 7, partitioned_after_save: true, actor_desc_classes: ['Landscape', 'LandscapeStreamingProxy', 'WorldDataLayers', 'WorldPartitionMiniMap'] },
      { streaming_proxies: 4, components_per_holder: [4] }),
  },
});
const failedNames = (input) => evaluate(input).filter((c) => !c.pass).map((c) => c.name);

test('every check passes on the 5.8.2 results', () => {
  assert.deepEqual(failedNames(good()), []);
  assert.deepEqual(summarize(evaluate(good())), { passed: 19, total: 19 });
});

test('heightsMatch accepts half a height step and rejects more, a miss, or no samples', () => {
  assert.equal(heightsMatch(scenario()).ok, true);
  const off = scenario(); off.samples[1].call_result = '497.0';
  assert.equal(heightsMatch(off).ok, false);
  const miss = scenario(); miss.samples[2].call_result = 'None';
  assert.match(heightsMatch(miss).detail, /not found/);
  assert.equal(heightsMatch({ samples: [], height_step_cm: 0.78 }).ok, false);
  assert.equal(heightsMatch(undefined).ok, false);
});

test('each check fails when its fact changes', () => {
  let g = good(); g.build.log = 'Result: Failed';
  assert.deepEqual(failedNames(g), ['module compiles']);
  g = good(); g.scenarios.plain.bridge_members = ['create_landscape_from_heights'];
  assert.deepEqual(failedNames(g), ['functions visible in Python']);
  g = good(); g.scenarios.wp0.readback.components_total = 15;
  assert.deepEqual(failedNames(g), ['partitioned map, grid size 0: component count']);
  g = good(); g.scenarios.wp2.readback.streaming_proxies = 0;
  assert.deepEqual(failedNames(g), ['partitioned map, grid size 2: streaming proxies']);
  g = good(); g.scenarios.plain.readback.quad_size_cm = [200, 100];
  assert.deepEqual(failedNames(g), ['non-partitioned map: quad size and component size']);
  g = good(); g.scenarios.wp2.samples[0].call_result = '12.0';
  assert.deepEqual(failedNames(g), ['partitioned map, grid size 2: sampled heights']);
  g = good(); g.externalFiles = 0;
  assert.deepEqual(failedNames(g), ['partitioned map, grid size 2: streamed']);
  g = good(); g.scenarios.wp0.partitioned_after_save = false;
  assert.deepEqual(failedNames(g), ['partitioned map, grid size 0: partitioned']);
});

test('a missing scenario report fails its checks instead of throwing', () => {
  const g = good(); g.scenarios.wp2 = undefined;
  assert.ok(failedNames(g).length >= 5);
});
