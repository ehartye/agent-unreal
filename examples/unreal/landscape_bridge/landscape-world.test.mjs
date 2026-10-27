// node --test examples/unreal/landscape_bridge/landscape-world.test.mjs  (no Unreal, no dependencies)
// The reports below have the shape landmass_probe.py, pcg_partition_probe.py and wp_unload_probe.py write. None of those probes has run on
// an engine yet, so each canned report is what a run that agrees with the source reading would write; the first real run replaces them.
// Each test changes one fact and expects the matching assert check to fail, so the judge cannot pass by accident, and checks that the observe
// lines never change the verdict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, leadCandidate, summarize } from './landscape-world-checks.mjs';

const LAND = '/Temp/Untitled_0.Untitled_0:PersistentLevel.Landscape_0';
const rung = (name, extra = {}) => ({ rung: name, call: {}, manager_landscape: null, bridge_owner: null, layer_index: -1, brush_counts: [0], edit_layers: ['Layer'], heights: { centre: 12.5 }, max_delta_cm: 0, ...extra });
const candidate = () => ({
  brush_class: '/Landmass/Landscape/BlueprintBrushes/CustomBrush_Landmass', map_created: true, landscape_created: true, edit_layers: ['Layer'],
  manager_spawned_by_brush: true, manager_class: '/Landmass/Landscape/BlueprintBrushes/LandmassBrushManager.LandmassBrushManager_C',
  attach_call: { ok: true, value: 'True' }, attached: true, height_changed_by_attach: true,
  rungs: [
    rung('r0_spawn_only'),
    rung('r1_set_target', { call: { ok: true, value: null } }),
    rung('r2_property', { call: { ok: true, value: null }, manager_landscape: LAND }),   // the mirror: get_landscape() prints the written value, nothing is attached
    rung('r3_bridge_attach', { call: { ok: true, value: 'True' }, manager_landscape: LAND, bridge_owner: LAND, layer_index: 0, brush_counts: [1], seconds_to_change: 14.2, max_delta_cm: 380.5 }),
    rung('r5_detach', { call: { ok: true, value: 'True' } }),
    rung('r5_detach_after_wait', { returned_to_baseline: true }),
  ],
});
const landmass = () => ({
  render: true, errors: [], bridge_members: ['attach_brush_to_layer', 'create_landscape_from_heights', 'detach_brush', 'get_brush_count_for_layer', 'get_brush_layer_index', 'get_brush_owning_landscape', 'get_landscape_height_at'],
  landscape_brush_members: [], candidates: { custom: candidate() },
});
const cell = (label, points) => ({ actor: label, label, location: [0, 0, 0], instances_on_actor: points, has_local_component: true, grid_size_cm: 25600, points, z: { sampled: points, max_cm: 0.6, mean_cm: 0.2 }, landscape_data: { class_exposed: true, count: 1, landscapes: [['a', 'b', 'c', 'd', 'e']] } });
const pcg = () => ({
  errors: [], fixture: { landscape_actors: 1, streaming_proxies: 4, components: 16, edit_layers: ['Layer'] },
  control: { partitioned_readback: false, event_fired: true, seconds_to_event: 2.1, points: 1270, z: { sampled: 400, max_cm: 0.7, mean_cm: 0.2 }, landscape_data: { class_exposed: true, count: 1, landscapes: [['a']] }, instances_on_volume: 1270 },
  partitioned: {
    partitioned_readback: true, partition_actors_created: 4, partition_actors_appeared: true, pcg_world_actors: 1, pcg_grid_size_cm: 25600, event_fired: true, seconds_to_event: 3.4, seconds_total: 6.0,
    cells: [cell('c0', 320), cell('c1', 318), cell('c2', 316), cell('c3', 316)], cells_with_points: 4, total_points: 1270, total_instances_on_cells: 1270, instances_on_volume: 0,
    original_component_output: { points: 0, landscape_data: { class_exposed: true, count: 0, landscapes: [] } }, z_max_cm: 0.9, control_points: 1270, ratio_to_control: 1,
  },
});
const step = (loaded, descriptors = 4) => ({ loaded_proxies: loaded, loaded_landscape_actors: 1, proxy_descriptors: descriptors, unloaded_proxies: descriptors - loaded });
const unload = () => ({
  errors: [], settings_class_exposed: true, setting_before: { ok: true, value: 'False' }, setting_set: { ok: true, value: null }, setting_read_back: { ok: true, value: 'True' },
  steps: { open: step(4), unload_unowned: step(4), after_load_actors: step(4), load_then_unload: step(4), setting_off: step(0), any_unloaded: true },
});
const good = () => ({ build: { exit: 0, log: 'Result: Succeeded' }, landmass: landmass(), pcg: pcg(), unload: unload() });
const failing = (mutate) => { const g = good(); mutate(g); return evaluate(g).filter((c) => !c.pass).map((c) => c.name); };

test('a run that agrees with the source reading passes every assert and records the observations', () => {
  const checks = evaluate(good());
  assert.deepEqual(checks.filter((c) => !c.pass), []);
  const sum = summarize(checks);
  assert.equal(sum.passed, sum.total);
  assert.ok(sum.observed >= 10, 'the observe lines are present');
  assert.ok(checks.filter((c) => c.observe).every((c) => c.pass === true));
});

test('a failed build fails only the build check', () => {
  assert.deepEqual(failing((g) => { g.build = { exit: 6, log: 'Result: Failed' }; }), ['module compiles']);
});

test('a missing bridge function or a script error fails the landmass phase', () => {
  assert.deepEqual(failing((g) => { g.landmass.bridge_members = g.landmass.bridge_members.filter((m) => m !== 'detach_brush'); }), ['bridge brush functions visible in Python']);
  assert.deepEqual(failing((g) => { g.landmass.errors = [{ step: 'custom', error: 'boom' }]; }), ['landmass: no script errors']);
  assert.deepEqual(failing((g) => { g.landmass.error = 'stage error'; }), ['landmass: no script errors']);
});

test('the negative control fails when the spawn already attached the manager', () => {
  assert.deepEqual(failing((g) => { Object.assign(g.landmass.candidates.custom.rungs[0], { manager_landscape: LAND, bridge_owner: LAND, layer_index: 0, brush_counts: [1] }); }),
    ['landmass r0: spawning the brush leaves the manager unattached (negative control)']);
});

test('set_target_landscape or the property write that attaches fails its check', () => {
  assert.deepEqual(failing((g) => { Object.assign(g.landmass.candidates.custom.rungs[1], { manager_landscape: LAND, bridge_owner: LAND, layer_index: 0, brush_counts: [1] }); }),
    ['landmass r1: set_target_landscape does not attach']);
  assert.deepEqual(failing((g) => { Object.assign(g.landmass.candidates.custom.rungs[2], { bridge_owner: LAND, layer_index: 0, brush_counts: [1] }); }),
    ['landmass r2: writing detail_panel_landscape does not attach']);
});

test('the property mirror alone is not a failure, because get_landscape() is only observed there', () => {
  const g = good();
  g.landmass.candidates.custom.rungs[2].manager_landscape = null;
  assert.deepEqual(evaluate(g).filter((c) => !c.pass), []);
});

test('the bridge attach fails when it returns False, lands on another layer or the owner differs', () => {
  assert.deepEqual(failing((g) => { g.landmass.candidates.custom.attach_call = { ok: true, value: 'False' }; }), ['landmass r3: the bridge attach puts the manager on layer 0']);
  assert.deepEqual(failing((g) => { g.landmass.candidates.custom.rungs[3].layer_index = 1; }), ['landmass r3: the bridge attach puts the manager on layer 0']);
  assert.deepEqual(failing((g) => { g.landmass.candidates.custom.rungs[3].manager_landscape = null; }), ['landmass r3: the bridge attach puts the manager on layer 0']);
  assert.deepEqual(failing((g) => { g.landmass.candidates.custom.rungs[3].brush_counts = [2]; }), ['landmass r3: the bridge attach puts the manager on layer 0']);
});

test('the detach fails when the manager stays on the layer', () => {
  assert.deepEqual(failing((g) => { Object.assign(g.landmass.candidates.custom.rungs[4], { layer_index: 0, brush_counts: [1], manager_landscape: LAND, bridge_owner: LAND }); }),
    ['landmass r5: the bridge detach undoes the attach']);
});

test('a Landscape without an edit layer fails the layer check', () => {
  assert.deepEqual(failing((g) => { g.landmass.candidates.custom.edit_layers = []; }), ['landmass: the bridge Landscape has an edit layer']);
  assert.deepEqual(failing((g) => { g.landmass.candidates.custom.edit_layers = ['error: no such method']; }), ['landmass: the bridge Landscape has an edit layer']);
});

test('no height change never fails the run: it is an observation', () => {
  const g = good();
  g.landmass.candidates.custom.rungs.forEach((r) => { r.max_delta_cm = 0; });
  const checks = evaluate(g);
  assert.deepEqual(checks.filter((c) => !c.pass), []);
  assert.match(checks.find((c) => c.name === 'landmass height, brush custom').detail, /"changed":false/);
});

test('without a rendering editor the height line says it was not read', () => {
  const g = good();
  g.landmass.render = false;
  assert.match(evaluate(g).find((c) => c.name === 'landmass height, brush custom').detail, /not read/);
});

test('a missing landmass report fails its asserts instead of throwing', () => {
  const failed = failing((g) => { g.landmass = undefined; });
  assert.ok(failed.length >= 6);
  assert.ok(failed.includes('landmass r3: the bridge attach puts the manager on layer 0'));
});

test('leadCandidate prefers the candidate that reached the attach rung', () => {
  const noAttach = { rungs: [rung('r0_spawn_only')] };
  const lead = leadCandidate({ candidates: { first: noAttach, second: candidate() } });
  assert.equal(lead.key, 'second');
  assert.equal(leadCandidate({ candidates: { first: noAttach } }).key, 'first');
  assert.equal(leadCandidate(undefined), undefined);
});

test('the fixture, the control and the partitioned generation each fail on their own fact', () => {
  assert.deepEqual(failing((g) => { g.pcg.fixture.streaming_proxies = 0; }), ['pcg fixture: one Landscape, four loaded proxies, sixteen components']);
  assert.deepEqual(failing((g) => { g.pcg.control.points = 0; }), ['pcg control: the non-partitioned volume generates points']);
  assert.deepEqual(failing((g) => { g.pcg.control.event_fired = false; }), ['pcg control: the non-partitioned volume generates points']);
  assert.deepEqual(failing((g) => { g.pcg.partitioned.partitioned_readback = false; }), ['pcg partitioned: the component reads back as partitioned']);
  assert.deepEqual(failing((g) => { g.pcg.partitioned.partition_actors_created = 1; }), ['pcg partitioned: grid actors appear']);
  assert.deepEqual(failing((g) => { g.pcg.partitioned.total_points = 0; g.pcg.partitioned.cells_with_points = 0; }), ['pcg partitioned: points are generated across the grid actors']);
  assert.deepEqual(failing((g) => { g.pcg.partitioned.cells_with_points = 1; }), ['pcg partitioned: points are generated across the grid actors']);
});

test('a total far from the control, a late event or a wrong surface height are observations, not failures', () => {
  const g = good();
  g.pcg.partitioned.ratio_to_control = 0.4;
  g.pcg.partitioned.event_fired = false;
  g.pcg.partitioned.z_max_cm = 800;
  g.pcg.partitioned.cells[0].landscape_data = { class_exposed: false };
  const checks = evaluate(g);
  assert.deepEqual(checks.filter((c) => !c.pass), []);
  assert.match(checks.find((c) => c.name === 'pcg partitioned: total against the control').detail, /"within_5_percent":false/);
});

test('a missing pcg report fails its asserts instead of throwing', () => {
  assert.ok(failing((g) => { g.pcg = undefined; }).length >= 5);
});

test('the unload phase fails when unload_actors moves proxies it never loaded, or the map lacks four proxies', () => {
  assert.deepEqual(failing((g) => { g.unload.steps.unload_unowned = step(2); }), ['unload: unload_actors of unowned guids changes nothing']);
  assert.deepEqual(failing((g) => { g.unload.steps.open = step(3, 3); g.unload.steps.unload_unowned = step(3, 3); }), ['unload: four proxy descriptors']);
  assert.deepEqual(failing((g) => { g.unload.errors = [{ step: 'stages', error: 'x' }]; }), ['unload: no script errors']);
  assert.ok(failing((g) => { g.unload = undefined; }).length >= 3);
});

test('a proxy that stays loaded in every step is an observation, not a failure', () => {
  const g = good();
  g.unload.steps.setting_off = step(4);
  g.unload.steps.any_unloaded = false;
  assert.deepEqual(evaluate(g).filter((c) => !c.pass), []);
});

test('only limits the judged phases', () => {
  const g = good();
  g.pcg = undefined;
  g.unload = undefined;
  assert.deepEqual(evaluate({ ...g, only: 'landmass' }).filter((c) => !c.pass), []);
  assert.equal(evaluate({ ...g, only: 'landmass' }).some((c) => c.name.startsWith('pcg')), false);
});

const merge = (rendering = 1209, nullrhi = 1209) => ({
  prepare: { errors: [], mode: 'prepare', force_layers_full_update: { ok: true }, saved: { level: { ok: true, value: 'True' } }, control: { event_fired: true, points: rendering } },
  sample: { errors: [], mode: 'sample', proxies_loaded_after_open: { descriptors: 4, loaded: 4 }, fixture: { landscape_actors: 1, streaming_proxies: 4, components: 16 }, control: { event_fired: true, points: nullrhi } },
});

test('pcgmerge runs only when asked for, and a matching or a zero -nullrhi count is an observation, not a failure', () => {
  const g = good();
  assert.equal(evaluate({ ...g, pcgmerge: merge() }).some((c) => c.name.startsWith('pcgmerge')), false, 'not part of the default run');
  for (const nullrhi of [1209, 0]) {
    const checks = evaluate({ ...g, pcgmerge: merge(1209, nullrhi), only: 'pcgmerge' });
    assert.deepEqual(checks.filter((c) => !c.pass), []);
    assert.match(checks.find((c) => c.observe).detail, nullrhi === 0 ? /"nullrhi_points":0,"equal":false/ : /"equal":true/);
  }
});

test('pcgmerge fails when the rendering editor found no points or the -nullrhi editor did not load the proxies', () => {
  const g = good();
  assert.equal(evaluate({ ...g, pcgmerge: merge(0, 0), only: 'pcgmerge' }).filter((c) => !c.pass).length, 1);
  const unloaded = merge();
  unloaded.sample.fixture.streaming_proxies = 0;
  assert.equal(evaluate({ ...g, pcgmerge: unloaded, only: 'pcgmerge' }).filter((c) => !c.pass).length, 1);
  assert.equal(evaluate({ ...g, pcgmerge: undefined, only: 'pcgmerge' }).filter((c) => !c.pass).length, 2, 'no reports fail both asserts instead of throwing');
});
