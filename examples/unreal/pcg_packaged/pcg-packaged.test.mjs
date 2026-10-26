// node --test examples/unreal/pcg_packaged/pcg-packaged.test.mjs  (no Unreal, no dependencies)
// The reports below have the shape APcgPackagedGameMode and pcg_packaged_author.py are written to produce; they are built from the source reading in the checks
// file, NOT from an engine run (the probe itself ran on 5.8.3; see the README). Each test changes one fact and expects the matching check to fail, so the judge cannot pass by
// accident, and these shapes are the ones the run on 5.8.3 accepted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize, volumeName, cellsOverlapped, PATHS } from './pcg-packaged-checks.mjs';

const RUNTIME = 'P1 runtime map, headless';
const NOWORLD = 'P1 map without a PCG World Actor, headless';
const STREAM = 'P2 streaming map, headless';

const volume = (label, trigger, editorInstances = 0) => ({ label, name: label, trigger, partitioned: false, graph: PATHS.graph, editor_instances: editorInstances, editor_ism_components: 0 });
const author = () => ({
  done: true,
  warnings: [],
  steps: {
    assets: { SM_ProbeCube: { exists: true }, SM_Orphan: { exists: true }, M_ProbeUnlit: { flag: true } },
    graph: { path: PATHS.graph, expected_points_from_source: 64 },
    editor_baseline: { completed: true, points: 64, instances: 64, ism_components: 1, world_actors_added_by_editor: 0 },
    map_runtime: {
      saved: true, world_actors_in_map: 1, world_actor: { before: 0, spawned_by_script: true, after: 1 },
      radius_override_far: { requested_cm: 1000, applied: true, after: '1000' },
      volumes: [volume('runtime_near', '<PCGComponentGenerationTrigger.GENERATE_AT_RUNTIME: 2>'), volume('on_demand', '<PCGComponentGenerationTrigger.GENERATE_ON_DEMAND: 1>'), volume('runtime_far', '<PCGComponentGenerationTrigger.GENERATE_AT_RUNTIME: 2>')],
    },
    map_noworld: { saved: true, world_actors_before_destroy: 1, world_actors_in_map: 0, world_actors_after_save: 0, volumes: [volume('runtime_near', '<PCGComponentGenerationTrigger.GENERATE_AT_RUNTIME: 2>')] },
    map_stream: {
      saved: true, world_actors_in_map: 1, grid_size_cm: { before: 25600, after: 3200 }, grid_cm: 3200, volume_half_extents_cm: [56000, 1600, 500],
      a: [-50000, 0, 100], b: [50000, 0, 100], markers: { A: { spatially_loaded: 'True' }, B: { spatially_loaded: 'True' } },
      volumes: [volume('runtime_cells', '<PCGComponentGenerationTrigger.GENERATE_AT_RUNTIME: 2>')],
    },
  },
});

const snap = (instances, extra = {}) => ({ generated: false, generating: false, output_items: 0, output_points: 0, ism_components: instances > 0 ? 1 : 0, instances, procedural_instances: 0,
  mesh: instances > 0 ? PATHS.mesh : '', material: instances > 0 ? PATHS.material : '', material_flag_instanced_static_meshes: instances > 0, material_is_default: false, ...extra });
const component = (actor, trigger, overrides = {}) => ({
  actor, trigger, graph: PATHS.graph, scheduling_policy: 'PCGSchedulingPolicyDistanceAndDirection', partitioned: false, componentless: false, alive: true,
  start_events: 0, generated_events: 0, first_start_s: -1, first_generated_s: -1, last_generated_s: -1, first_instances_s: -1, manual_generate_at_s: -1,
  initial: snap(0), final: snap(0), series: [{ t: 0, generated: false, generating: false, instances: 0, output_points: 0 }], ...overrides,
});
const generated = (actor, trigger, extra = {}) => component(actor, trigger, {
  start_events: 1, generated_events: 1, first_start_s: 1.2, first_generated_s: 1.5, last_generated_s: 1.5, first_instances_s: 1.5,
  final: snap(64, { output_items: 1, output_points: 64 }),
  series: [{ t: 0, generated: false, generating: false, instances: 0, output_points: 0 }, { t: 1.25, generated: false, generating: true, instances: 0, output_points: 0 }, { t: 1.5, generated: false, generating: false, instances: 64, output_points: 64 }],
  ...extra,
});
const basics = (mode, map) => ({
  scenario: 'pcg_packaged', mode: map === 'stream' ? 'stream' : 'runtime', complete: true, engine_version: '5.8.4-58902052+++UE5+Release-5.8', build_configuration: 'Development',
  requires_cooked_data: true, with_editor: false, running_game: true, null_rhi: mode === 'headless', rhi_adapter: 'adapter', seconds: 30,
});
const cvars = { 'pcg.RuntimeGeneration.Enable': '1' };
const loadedAssets = () => [
  { path: PATHS.graph, loaded: true, class: 'PCGGraph', control: false }, { path: PATHS.mesh, loaded: true, class: 'StaticMesh', control: false },
  { path: PATHS.material, loaded: true, class: 'Material', control: false }, { path: PATHS.orphan, loaded: false, class: '', control: true },
];
const runtimeRun = (mode) => ({
  map: 'runtime', mode, exit: 0, timedOut: false, log: 'LogTemp: Display: PCG PACKAGED mode=runtime tracked=3',
  receipt: {
    ...basics(mode, 'runtime'),
    world_start: { world: 'PcgRuntime', pcg_world_actors: 1, partition_grid_size: 25600, treat_player_controllers_as_sources: true, player_controllers: 1, local_players: 1, pawn: 'DefaultPawn', view_point: [0, 0, 64], cvars },
    world_now: { pcg_world_actors: 1, subsystem_has_world_actor: true, player_controllers: 1, local_players: 1, pawn: 'DefaultPawn', view_target: 'DefaultPawn_0', view_point: [0, 0, 64], cvars },
    components: [
      generated('runtime_near', 'GenerateAtRuntime'),
      component('on_demand', 'GenerateOnDemand', {
        start_events: 1, generated_events: 1, first_start_s: 20.1, first_generated_s: 20.4, last_generated_s: 20.4, first_instances_s: 20.5, manual_generate_at_s: 20.0, final: snap(64, { output_items: 1, output_points: 64 }),
        series: [{ t: 0, generated: false, generating: false, instances: 0, output_points: 0 }, { t: 20.5, generated: false, generating: false, instances: 64, output_points: 64 }],
      }),
      component('runtime_far', 'GenerateAtRuntime'),
    ],
    assets: loadedAssets(),
  },
});
const noWorldRun = (mode) => ({
  map: 'noworld', mode, exit: 0, timedOut: false, log: '',
  receipt: {
    ...basics(mode, 'noworld'),
    world_start: { world: 'PcgNoWorld', pcg_world_actors: 0, player_controllers: 1, local_players: 1, cvars },
    world_now: { pcg_world_actors: 0, subsystem_has_world_actor: false, cvars },
    components: [component('runtime_near', 'GenerateAtRuntime')],
    assets: [],
  },
});

// A source at x = -50,000 sits in column -16 of a 3,200 cm grid; at x = 50,000 in column 15. Two rows of cells (y -1 and 0).
const cellsAround = (column) => [-2, -1, 0, 1, 2].flatMap((d) => [[column + d, -1], [column + d, 0]]);
const streamSamples = () => {
  const out = [];
  for (let t = 0; t <= 47; t += 0.5) {
    const phase = t < 12 ? 'hold_a' : t < 32 ? 'travel' : 'hold_b';
    const x = t < 12 ? -50000 : t < 32 ? -50000 + ((t - 12) / 20) * 100000 : 50000;
    const column = Math.floor(x / 3200);
    const cells = t < 3 ? [] : phase === 'hold_a' ? cellsAround(-16) : phase === 'hold_b' && t > 40 ? cellsAround(15) : cellsAround(column).slice(2, 8);
    out.push({
      t, phase, source: [x, 0, 100], levels_total: 6, levels_loaded: phase === 'hold_a' ? 2 : 3, levels_visible: 2,
      marker_a: phase === 'hold_a' || (phase === 'travel' && x < -30000), marker_b: phase === 'hold_b' || (phase === 'travel' && x > 30000),
      partition_actors: 24, partition_actors_with_instances: cells.length, partition_instances: cells.length * 100, components_generating: 0, cells, original_instances: 0,
    });
  }
  return out;
};
const streamRun = (mode) => ({
  map: 'stream', mode, exit: 0, timedOut: false, log: '',
  receipt: {
    ...basics(mode, 'stream'),
    pawn_found: true,
    world_start: { world: 'PcgStream', partitioned_world: true, pcg_world_actors: 1, partition_grid_size: 3200, player_controllers: 1, local_players: 1, cvars },
    world_now: { pcg_world_actors: 1, partition_grid_size: 3200, subsystem_has_world_actor: true, cvars },
    components: [component('runtime_cells', 'GenerateAtRuntime', { partitioned: true })],
    samples: streamSamples(),
  },
});

const good = () => ({ author: author(), runs: [runtimeRun('headless'), noWorldRun('headless'), streamRun('headless')], rows: ['p1', 'p2'] });
const failing = (mutate) => { const g = good(); mutate(g); return evaluate(g).filter((c) => !c.observe && !c.pass).map((c) => c.name); };
const run = (g, map) => g.runs.find((r) => r.map === map);
const comp = (g, map, actor) => run(g, map).receipt.components.find((c) => c.actor === actor);

test('the expected shape passes every check and records observations', () => {
  const checks = evaluate(good());
  assert.deepEqual(checks.filter((c) => !c.observe && !c.pass), []);
  const { passed, total, observed } = summarize(checks);
  assert.equal(passed, total);
  assert.ok(total >= 30, `only ${total} asserted checks`);
  assert.ok(observed >= 15, `only ${observed} observed checks`);
});

test('observe checks never fail, whatever the receipt holds', () => {
  const g = good();
  g.runs[0].receipt.world_now = {};
  g.runs[0].receipt.components = [];
  const observed = evaluate(g).filter((c) => c.observe);
  assert.ok(observed.length > 0);
  assert.ok(observed.every((c) => c.pass));
});

test('a run that did not finish fails its basics and nothing else is judged for it', () => {
  const names = failing((g) => { run(g, 'runtime').exit = 3; run(g, 'runtime').receipt.complete = false; });
  assert.deepEqual(names, [`${RUNTIME}: the run finished and wrote a complete receipt`]);
  assert.deepEqual(failing((g) => { run(g, 'runtime').receipt = undefined; }), [`${RUNTIME}: the run finished and wrote a complete receipt`]);
  assert.deepEqual(failing((g) => { run(g, 'stream').timedOut = true; }), [`${STREAM}: the run finished and wrote a complete receipt`]);
});

test('an editor-binary game or the wrong renderer fails the basics', () => {
  assert.deepEqual(failing((g) => { run(g, 'runtime').receipt.with_editor = true; }), [`${RUNTIME}: a cooked game process`]);
  assert.deepEqual(failing((g) => { run(g, 'runtime').receipt.requires_cooked_data = false; }), [`${RUNTIME}: a cooked game process`]);
  assert.deepEqual(failing((g) => { run(g, 'runtime').receipt.null_rhi = false; }), [`${RUNTIME}: renderer is null`]);
});

test('a runtime volume that does not generate fails the generation and baseline checks', () => {
  const names = failing((g) => { Object.assign(comp(g, 'runtime', 'runtime_near'), component('runtime_near', 'GenerateAtRuntime')); });
  assert.deepEqual(names, [`${RUNTIME}: GENERATE_AT_RUNTIME generates in the cooked game`, `${RUNTIME}: the output matches the editor baseline`, `${RUNTIME}: the mesh and the material are in the cook`]);
});

test('output that was baked into the map is not runtime generation', () => {
  assert.deepEqual(failing((g) => { comp(g, 'runtime', 'runtime_near').initial = snap(64); }), [`${RUNTIME}: GENERATE_AT_RUNTIME generates in the cooked game`]);
});

test('a different instance count from the editor fails the baseline check only', () => {
  assert.deepEqual(failing((g) => { comp(g, 'runtime', 'runtime_near').final = snap(60, { output_points: 60 }); }), [`${RUNTIME}: the output matches the editor baseline`]);
  assert.deepEqual(failing((g) => { g.author.steps.editor_baseline.completed = false; }), [`author: the editor baseline completed`, `${RUNTIME}: the output matches the editor baseline`]);
});

test('a mesh or material missing from the cook fails the cook checks', () => {
  assert.deepEqual(failing((g) => { comp(g, 'runtime', 'runtime_near').final.material = '/Engine/EngineMaterials/WorldGridMaterial.WorldGridMaterial'; comp(g, 'runtime', 'runtime_near').final.material_is_default = true; }),
    [`${RUNTIME}: the mesh and the material are in the cook`]);
  assert.deepEqual(failing((g) => { comp(g, 'runtime', 'runtime_near').final.mesh = '/Engine/BasicShapes/Cube.Cube'; }), [`${RUNTIME}: the mesh and the material are in the cook`]);
  assert.deepEqual(failing((g) => { run(g, 'runtime').receipt.assets[2].loaded = false; }), [`${RUNTIME}: the graph, the mesh and the material load by path`]);
  assert.deepEqual(failing((g) => { run(g, 'runtime').receipt.assets = []; }), [`${RUNTIME}: the graph, the mesh and the material load by path`, `${RUNTIME}: an unreferenced asset is not in the cook`]);
});

test('an unreferenced asset that loads means the cook control is broken', () => {
  assert.deepEqual(failing((g) => { run(g, 'runtime').receipt.assets[3].loaded = true; }), [`${RUNTIME}: an unreferenced asset is not in the cook`]);
});

test('the on-demand control must not generate by itself', () => {
  assert.deepEqual(failing((g) => {
    const c = comp(g, 'runtime', 'on_demand');
    c.series = [{ t: 3, generated: false, generating: true, instances: 12, output_points: 0 }, ...c.series];
  }), [`${RUNTIME}: GENERATE_ON_DEMAND does not generate by itself`]);
  assert.deepEqual(failing((g) => { comp(g, 'runtime', 'on_demand').first_start_s = 4; }), [`${RUNTIME}: GENERATE_ON_DEMAND does not generate by itself`]);
  assert.deepEqual(failing((g) => { comp(g, 'runtime', 'on_demand').trigger = 'GenerateAtRuntime'; }), [`${RUNTIME}: GENERATE_ON_DEMAND does not generate by itself`]);
});

test('the radius check holds when the override applied and is only observed otherwise', () => {
  assert.deepEqual(failing((g) => { comp(g, 'runtime', 'runtime_far').final = snap(64); comp(g, 'runtime', 'runtime_far').first_instances_s = 2; }), [`${RUNTIME}: a volume beyond its generation radius does not generate`]);
  const g = good();
  g.author.steps.map_runtime.radius_override_far = { requested_cm: 1000, applied: false, error: 'no such property' };
  comp(g, 'runtime', 'runtime_far').final = snap(64);
  const checks = evaluate(g);
  assert.deepEqual(checks.filter((c) => !c.observe && !c.pass), []);
  assert.ok(checks.some((c) => c.observe && /generation radius/.test(c.name)));
});

test('the world actor must register in the game', () => {
  assert.deepEqual(failing((g) => { run(g, 'runtime').receipt.world_now.subsystem_has_world_actor = false; }), [`${RUNTIME}: the saved PCG World Actor registers`]);
  assert.deepEqual(failing((g) => { run(g, 'runtime').receipt.world_start.pcg_world_actors = 0; }), [`${RUNTIME}: the saved PCG World Actor registers`]);
});

test('a usage-flag fallback in the log fails a rendered run and is only noted in a headless one', () => {
  const g = good();
  g.runs[0] = runtimeRun('rendered');
  g.runs[0].log = 'LogMaterial: Warning: Material /Game/Pcg/M_ProbeUnlit.M_ProbeUnlit missing usage flag InstancedStaticMeshes! Default Material will be used in game.';
  assert.deepEqual(evaluate(g).filter((c) => !c.observe && !c.pass).map((c) => c.name), ['P1 runtime map, rendered: no material usage-flag fallback in the log']);
  const h = good();
  h.runs[0].log = g.runs[0].log;
  assert.deepEqual(evaluate(h).filter((c) => !c.observe && !c.pass), []);
});

test('without a PCG World Actor the runtime volume must stay empty', () => {
  assert.deepEqual(failing((g) => { comp(g, 'noworld', 'runtime_near').final = snap(64); comp(g, 'noworld', 'runtime_near').generated_events = 1; }), [`${NOWORLD}: GENERATE_AT_RUNTIME does not generate without a world actor`]);
  assert.deepEqual(failing((g) => { run(g, 'noworld').receipt.world_now.pcg_world_actors = 1; run(g, 'noworld').receipt.world_now.subsystem_has_world_actor = true; }), [`${NOWORLD}: the map has no PCG World Actor`]);
});

test('streaming and per-cell generation checks fail when the cells do not follow the source', () => {
  const marks = (g) => run(g, 'stream').receipt.samples;
  assert.deepEqual(failing((g) => { marks(g).filter((s) => s.phase === 'hold_a').forEach((s) => { s.marker_b = true; }); }), [`${STREAM}: streaming loads the cells around the source`]);
  assert.deepEqual(failing((g) => { marks(g).filter((s) => s.phase === 'hold_b').forEach((s) => { s.marker_a = true; }); }), [`${STREAM}: streaming unloads behind the source and loads ahead`]);
  assert.deepEqual(failing((g) => { marks(g).filter((s) => s.phase === 'hold_b').forEach((s) => { s.cells = cellsAround(-16); }); }),
    [`${STREAM}: generated cells follow the source`]);
  assert.deepEqual(failing((g) => { marks(g).filter((s) => s.phase === 'hold_a').forEach((s) => { s.cells = []; }); }), [`${STREAM}: generation is per cell and limited to the source's range`]);
  assert.deepEqual(failing((g) => {
    marks(g).filter((s) => s.phase === 'hold_a').forEach((s) => { s.cells = Array.from({ length: 72 }, (_, i) => [-18 + (i % 36), i < 36 ? -1 : 0]); });
  }), [`${STREAM}: generation is per cell and limited to the source's range`, `${STREAM}: generated cells follow the source`, `${STREAM}: cells behind the source are cleaned up`]);
  assert.deepEqual(failing((g) => { marks(g).filter((s) => s.phase === 'travel').forEach((s) => { s.cells = Array.from({ length: 30 }, (_, i) => [-18 + i, 0]); }); }), [`${STREAM}: cells behind the source are cleaned up`]);
});

test('the streaming run needs a partitioned world, a pawn and the authored grid size', () => {
  assert.deepEqual(failing((g) => { run(g, 'stream').receipt.world_start.partitioned_world = false; }), [`${STREAM}: the world is partitioned`]);
  assert.deepEqual(failing((g) => { run(g, 'stream').receipt.pawn_found = false; }), [`${STREAM}: a pawn was found and moved`]);
  assert.deepEqual(failing((g) => { run(g, 'stream').receipt.world_start.partition_grid_size = 25600; }), [`${STREAM}: the PCG World Actor keeps the authored grid size`]);
});

test('a failed authoring step is reported by name', () => {
  assert.deepEqual(failing((g) => { g.author.done = false; g.author.error = 'Traceback ...'; }), ['author: the editor session finished']);
  assert.deepEqual(failing((g) => { g.author.steps.assets.SM_Orphan.exists = false; }), ['author: the content assets exist']);
  assert.deepEqual(failing((g) => { g.author.steps.map_runtime.volumes[0].editor_instances = 12; }), ['author: the runtime map is saved without baked output']);
  assert.deepEqual(failing((g) => { g.author.steps.map_noworld.world_actors_after_save = 1; }), ['author: the control map has no PCG World Actor when saved']);
  assert.deepEqual(failing((g) => { g.author.steps.map_stream.saved = false; }), ['author: the streaming map is saved']);
});

test('a missing run is a failure, and a row left out is not judged', () => {
  assert.deepEqual(failing((g) => { g.runs = g.runs.filter((r) => r.map !== 'noworld'); }), ['noworld: a run exists']);
  const g = good();
  g.rows = ['p1'];
  g.runs = g.runs.filter((r) => r.map !== 'stream');
  assert.deepEqual(evaluate(g).filter((c) => !c.observe && !c.pass), []);
});

test('both modes are judged when both ran', () => {
  const g = good();
  g.runs.push(runtimeRun('rendered'));
  const checks = evaluate(g);
  assert.ok(checks.some((c) => c.name.startsWith('P1 runtime map, rendered')));
  assert.deepEqual(checks.filter((c) => !c.observe && !c.pass), []);
});

test('volumeName reads the in-game name the author recorded and falls back to the label', () => {
  assert.equal(volumeName({ steps: { map_runtime: { volumes: [{ label: 'a', name: 'PCGVolume_3' }] } } }, 'map_runtime', 'a'), 'PCGVolume_3');
  assert.equal(volumeName(undefined, 'map_runtime', 'a'), 'a');
});

test('cellsOverlapped counts the cells a centred volume overlaps', () => {
  assert.equal(cellsOverlapped(56000, 1600, 3200), 72);
  assert.equal(cellsOverlapped(1600, 1600, 3200), 4);
  assert.equal(cellsOverlapped(100, 100, 3200), 4);
});
