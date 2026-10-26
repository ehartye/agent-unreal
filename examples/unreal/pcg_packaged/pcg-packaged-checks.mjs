// Judges what pcg_packaged.mjs collects from the packaged PCG probe. Pure functions: no Unreal, no dependencies.
// The expectations below were written from reading the PCG plugin source before any engine run; a check whose expectation is only a guess is an `observe` check
// (recorded and printed, never counted as a pass or a fail).
//
//   author  the report of pcg_packaged_author.py (the editor session that made the content)
//   runs    one entry per packaged-game run: { map: 'runtime' | 'noworld' | 'stream', mode: 'headless' | 'rendered', exit, timedOut, receipt, log }
//
// Where each expectation comes from (PCG plugin, Engine/Plugins/PCG/Source/PCG):
//   - UPCGSubsystem::Tick calls the runtime generation scheduler only when a PCG World Actor is registered (Private/Subsystems/PCGSubsystem.cpp), and the actor
//     registers itself in BeginPlay (Private/PCGWorldActor.cpp); the editor creates one only outside play (UPCGSubsystem::GetPCGWorldActor), so a packaged game
//     finds the one saved in the level or none.
//   - The player controllers are generation sources while the world actor's bTreatPlayerControllersAsGenerationSources is set (Private/RuntimeGen/PCGGenSourceManager.cpp).
//   - A non-partitioned GenerateAtRuntime component is queued when the distance from a source to its bounds is within the unbounded generation radius
//     (FPCGRuntimeGenScheduler::TickQueueSourcesForGeneration); partitioned ones are queued per grid cell within the cell's generation radius, and cells out of
//     range are cleaned up (TickCleanup).
//   - GenerateOnDemand generates only when asked.

export const PATHS = {
  mesh: '/Game/Pcg/SM_ProbeCube.SM_ProbeCube',
  orphan: '/Game/Pcg/SM_Orphan.SM_Orphan',
  material: '/Game/Pcg/M_ProbeUnlit.M_ProbeUnlit',
  graph: '/Game/Pcg/PCG_ProbeGrid.PCG_ProbeGrid',
  cellsGraph: '/Game/Pcg/PCG_ProbeCells.PCG_ProbeCells',
};
/** Cells further than this many grid cells from the source in x are held to be out of range once the source has settled (generation radius 2 cells, cleanup 3). */
export const SETTLED_CELL_RANGE = 4;
/** While the source travels, cleanup may lag; the number of cells holding instances must still stay far below the whole volume. */
export const TRAVEL_CELL_LIMIT_COLUMNS = 6;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const list = (v) => (Array.isArray(v) ? v : []);
const lines = (log, re) => String(log ?? '').split(/\r?\n/).filter((l) => re.test(l));

/** The in-game actor name of the volume the author labelled `label` (the author renames the actor to its label and reads the name back). */
export function volumeName(author, stepKey, label) {
  const found = list(author?.steps?.[stepKey]?.volumes).find((v) => v.label === label);
  return found?.name ?? label;
}

const componentOf = (receipt, name) => list(receipt?.components).find((c) => c.actor === name);

/** Number of grid cells a volume of `halfX` by `halfY` centimetres centred on the origin overlaps on a grid of `grid` centimetres. */
export function cellsOverlapped(halfX, halfY, grid) {
  const span = (half) => Math.floor((half - 1e-6) / grid) - Math.floor(-half / grid) + 1;
  return span(halfX) * span(halfY);
}

const cellOf = (x, grid) => Math.floor(x / grid);

function makeAdder(out, scope) {
  return {
    assert(name, claim, pass, detail) { out.push({ name: `${scope}: ${name}`, claim, pass: !!pass, observe: false, detail: String(detail ?? '') }); },
    observe(name, claim, detail) { out.push({ name: `${scope}: ${name}`, claim, pass: true, observe: true, detail: String(detail ?? '') }); },
  };
}

/** The checks every run shares: it finished, it is the cooked game, and the renderer is the one the mode asked for. Returns false when the rest cannot be judged. */
function judgeBasics(run, add) {
  const r = run.receipt;
  const finished = run.exit === 0 && !run.timedOut && r?.complete === true;
  add.assert('the run finished and wrote a complete receipt', 'the packaged game exits 0 inside the time limit and its receipt is marked complete',
    finished, `exit ${run.exit}${run.timedOut ? ' (timed out)' : ''}; receipt ${r ? `complete ${r.complete}` : 'missing'}`);
  if (!r) return false;
  add.assert('a cooked game process', 'the receipt comes from a game with cooked data, no editor code and the game flag set',
    r.requires_cooked_data === true && r.with_editor === false && r.running_game === true,
    `requires_cooked_data ${r.requires_cooked_data}, with_editor ${r.with_editor}, running_game ${r.running_game}, build ${r.build_configuration}`);
  add.assert(`renderer is ${run.mode === 'headless' ? 'null' : 'a rendering one'}`, run.mode === 'headless' ? 'a headless run starts with -nullrhi' : 'a rendered run does not use the null RHI',
    r.null_rhi === (run.mode === 'headless'), `null_rhi ${r.null_rhi}${run.mode === 'rendered' ? `, adapter ${r.rhi_adapter ? 'reported' : 'not reported'}` : ''}`);
  return finished;
}

function judgeRuntimeMap(run, author, out) {
  const add = makeAdder(out, `P1 runtime map, ${run.mode}`);
  if (!judgeBasics(run, add)) return;
  const r = run.receipt;
  const ws = r.world_start ?? {};
  const wn = r.world_now ?? {};
  const baseline = author?.steps?.editor_baseline;
  const near = componentOf(r, volumeName(author, 'map_runtime', 'runtime_near'));
  const demand = componentOf(r, volumeName(author, 'map_runtime', 'on_demand'));
  const far = componentOf(r, volumeName(author, 'map_runtime', 'runtime_far'));

  add.assert('the saved PCG World Actor registers', 'the map has one PCG World Actor and the PCG subsystem holds it as its world actor in the game',
    ws.pcg_world_actors === 1 && wn.subsystem_has_world_actor === true, `actors ${ws.pcg_world_actors}, registered ${wn.subsystem_has_world_actor}, grid ${ws.partition_grid_size}`);
  add.assert('the runtime volume is a runtime-trigger component with the scheduler policy',
    'the component loaded from the cooked map has trigger GenerateAtRuntime, a graph and a scheduling policy object',
    near?.trigger === 'GenerateAtRuntime' && !!near.graph && !!near.scheduling_policy, near ? `trigger ${near.trigger}, graph ${near.graph}, policy ${near.scheduling_policy}` : 'component not found');

  add.assert('GENERATE_AT_RUNTIME generates in the cooked game', 'the runtime volume holds no instances at its first sample and holds instances before the window ends, with at least one generated event',
    !!near && near.initial?.instances === 0 && near.final?.instances > 0 && near.generated_events >= 1,
    near ? `instances ${near.initial?.instances} -> ${near.final?.instances}; started events ${near.start_events}, generated events ${near.generated_events}` : 'component not found');
  add.assert('the output matches the editor baseline', 'the instance count in the game equals the count the same graph produced when generated on demand in the editor',
    !!near && baseline?.completed === true && near.final?.instances === baseline.instances && baseline.instances > 0,
    `game ${near?.final?.instances}, editor ${baseline?.instances} (completed ${baseline?.completed}, source-derived expectation ${author?.steps?.graph?.expected_points_from_source})`);
  add.assert('the mesh and the material are in the cook', 'the instances use the project mesh and the project material, which no cook rule lists and the graph references only by soft reference',
    !!near && near.final?.mesh === PATHS.mesh && near.final?.material === PATHS.material && near.final?.material_is_default === false,
    `mesh ${near?.final?.mesh}, material ${near?.final?.material}, default material ${near?.final?.material_is_default}`);
  const assets = list(r.assets).filter((a) => !a.control);
  add.assert('the graph, the mesh and the material load by path', 'each asset the graph uses loads by object path in the game, so it is in the cook',
    assets.length >= 3 && assets.every((a) => a.loaded === true), assets.map((a) => `${a.path} ${a.loaded}`).join('; ') || 'no asset checks in the receipt');
  const orphan = list(r.assets).find((a) => a.control);
  add.assert('an unreferenced asset is not in the cook', 'a mesh nothing references and no rule lists does not load by path, so the presence checks can tell cooked from missing',
    orphan?.loaded === false, orphan ? `${orphan.path} loaded ${orphan.loaded}` : 'no control in the receipt');
  const cutoff = demand && isNum(demand.manual_generate_at_s) && demand.manual_generate_at_s >= 0 ? demand.manual_generate_at_s : Infinity;
  add.assert('GENERATE_ON_DEMAND does not generate by itself', 'the on-demand volume has no instances, no started event and no generation in progress until the script asks',
    !!demand && demand.trigger === 'GenerateOnDemand' && demand.initial?.instances === 0
      && list(demand.series).filter((p) => p.t < cutoff).every((p) => p.instances === 0 && p.generating === false)
      && (demand.first_start_s < 0 || demand.first_start_s >= cutoff),
    demand ? `trigger ${demand.trigger}; first start ${demand.first_start_s}; manual generate at ${demand.manual_generate_at_s}` : 'component not found');
  const radius = author?.steps?.map_runtime?.radius_override_far;
  if (radius?.applied === true) {
    add.assert('a volume beyond its generation radius does not generate', 'a runtime volume 1,000 m from the player, with the unbounded generation radius made 10 m, stays empty',
      !!far && far.final?.instances === 0 && far.first_instances_s < 0 && far.generated_events === 0,
      far ? `instances ${far.final?.instances}; generated events ${far.generated_events}` : 'component not found');
  } else {
    add.observe('a volume beyond its generation radius', 'could not be made to hold: Python did not apply the radius override, so the far volume uses the default radius',
      `override ${JSON.stringify(radius ?? null)}; far volume instances ${far?.final?.instances}`);
  }

  if (run.mode === 'rendered') {
    const flagLines = lines(run.log, /missing usage flag/i);
    add.assert('no material usage-flag fallback in the log', 'the flagged material draws, so the log has no "missing usage flag" line', flagLines.length === 0, flagLines.slice(0, 3).join(' | ') || 'none');
  } else {
    add.observe('material usage-flag log lines', 'a null-RHI run may not create the scene proxies that log the fallback', `${lines(run.log, /missing usage flag/i).length} line(s)`);
  }

  add.observe('generation timing', 'seconds from BeginPlay: first started event, first generated event, first sample with instances, last generated event',
    near ? `${near.first_start_s}, ${near.first_generated_s}, ${near.first_instances_s}, ${near.last_generated_s}` : 'component not found');
  add.observe('generation source', 'the player controller and its pawn are the generation source',
    `player controllers ${wn.player_controllers}, local players ${wn.local_players}, pawn ${wn.pawn}, view target ${wn.view_target}, view point ${JSON.stringify(wn.view_point ?? null)}, treat controllers as sources ${ws.treat_player_controllers_as_sources}`);
  add.observe('scheduler console variables', 'values in the game process', JSON.stringify(wn.cvars ?? {}));
  add.observe('output data of the runtime volume', 'the generated graph output kept on the component after a runtime generation: items and points (the editor baseline points are in the author report)',
    near ? `items ${near.final?.output_items}, points ${near.final?.output_points}; editor points ${baseline?.points}` : 'component not found');
  add.observe('manual generation of the on-demand volume', 'calling Generate(true) on the on-demand component in the game process: instances after the manual window',
    demand ? `manual at ${demand.manual_generate_at_s} s; final instances ${demand.final?.instances}; generated events ${demand.generated_events}; editor ${baseline?.instances}` : 'component not found');
  add.observe('component order and counts', 'PCG components the game found', list(r.components).map((c) => `${c.actor} ${c.trigger} instances ${c.final?.instances}`).join('; '));
  const pcgLines = lines(run.log, /LogPCG: (Warning|Error)/);
  add.observe('PCG warnings and errors in the log', 'LogPCG lines at warning or error level', `${pcgLines.length} line(s)${pcgLines.length ? `: ${pcgLines.slice(0, 4).join(' | ')}` : ''}`);
}

function judgeNoWorldMap(run, author, out) {
  const add = makeAdder(out, `P1 map without a PCG World Actor, ${run.mode}`);
  if (!judgeBasics(run, add)) return;
  const r = run.receipt;
  const ws = r.world_start ?? {};
  const wn = r.world_now ?? {};
  const near = componentOf(r, volumeName(author, 'map_noworld', 'runtime_near'));
  add.assert('the map has no PCG World Actor', 'the authored map holds none and the game does not create one', ws.pcg_world_actors === 0 && wn.pcg_world_actors === 0 && wn.subsystem_has_world_actor === false,
    `actors at start ${ws.pcg_world_actors}, now ${wn.pcg_world_actors}, registered ${wn.subsystem_has_world_actor}`);
  add.assert('GENERATE_AT_RUNTIME does not generate without a world actor', 'the scheduler is not ticked, so the runtime volume stays empty with no started event',
    !!near && near.trigger === 'GenerateAtRuntime' && near.final?.instances === 0 && near.start_events === 0 && near.generated_events === 0,
    near ? `instances ${near.final?.instances}; started ${near.start_events}; generated ${near.generated_events}` : 'component not found');
  add.observe('log lines about the world actor', 'LogPCG lines mentioning the world actor or the scheduler', lines(run.log, /LogPCG/).filter((l) => /world actor|runtime gen|scheduler/i.test(l)).slice(0, 5).join(' | ') || 'none');
}

function judgeStreamMap(run, author, out) {
  const add = makeAdder(out, `P2 streaming map, ${run.mode}`);
  if (!judgeBasics(run, add)) return;
  const r = run.receipt;
  const ws = r.world_start ?? {};
  const info = author?.steps?.map_stream ?? {};
  const grid = isNum(r.world_now?.partition_grid_size) && r.world_now.partition_grid_size > 0 ? r.world_now.partition_grid_size : (info.grid_cm ?? 3200);
  const samples = list(r.samples);
  const phase = (name) => samples.filter((s) => s.phase === name);
  const endOf = (name) => phase(name).at(-1);
  const holdA = endOf('hold_a');
  const holdB = endOf('hold_b');
  const cells = (s) => list(s?.cells).map((c) => ({ x: c[0], y: c[1] }));
  const total = cellsOverlapped(info.volume_half_extents_cm?.[0] ?? 56000, info.volume_half_extents_cm?.[1] ?? 1600, grid);

  add.assert('a pawn was found and moved', 'the game mode has a pawn to move, so the streaming source and the generation source travel', r.pawn_found === true && samples.length >= 10, `pawn_found ${r.pawn_found}, samples ${samples.length}`);
  add.assert('the world is partitioned', 'the cooked map is a World Partition world at run time', ws.partitioned_world === true, `partitioned_world ${ws.partitioned_world}, world ${ws.world}`);
  const authored = info.grid_size_cm?.after;
  add.assert('the PCG World Actor keeps the authored grid size', 'the map has one PCG World Actor whose partition grid size in the game is the one set in the editor',
    ws.pcg_world_actors === 1 && (!isNum(authored) || ws.partition_grid_size === authored), `actors ${ws.pcg_world_actors}, grid in game ${ws.partition_grid_size}, authored ${authored}`);
  add.assert('streaming loads the cells around the source', 'the marker at the start is loaded while the source holds there and the marker at the far end is not',
    holdA?.marker_a === true && holdA?.marker_b === false, `end of hold A: marker A ${holdA?.marker_a}, marker B ${holdA?.marker_b}`);
  add.assert('streaming unloads behind the source and loads ahead', 'after the travel the far marker is loaded and the start marker is not',
    holdB?.marker_b === true && holdB?.marker_a === false, `end of hold B: marker A ${holdB?.marker_a}, marker B ${holdB?.marker_b}`);

  const at = cells(holdA);
  const bt = cells(holdB);
  const aCell = cellOf(info.a?.[0] ?? -50000, grid);
  const bCell = cellOf(info.b?.[0] ?? 50000, grid);
  add.assert('generation is per cell and limited to the source\'s range', 'at the start some but not all of the volume\'s cells hold instances, all within a few cells of the source',
    at.length > 0 && at.length < total && at.every((c) => Math.abs(c.x - aCell) <= SETTLED_CELL_RANGE),
    `cells with instances ${at.length} of ${total} overlapped; columns ${JSON.stringify([...new Set(at.map((c) => c.x))].sort((p, q) => p - q))}; source column ${aCell}`);
  const overlap = bt.filter((b) => at.some((a) => a.x === b.x && a.y === b.y));
  add.assert('generated cells follow the source', 'at the end some cells hold instances, all within a few cells of the new position, and none is a cell that held them at the start',
    bt.length > 0 && bt.every((c) => Math.abs(c.x - bCell) <= SETTLED_CELL_RANGE) && overlap.length === 0,
    `cells ${bt.length}; columns ${JSON.stringify([...new Set(bt.map((c) => c.x))].sort((p, q) => p - q))}; source column ${bCell}; shared with the start ${overlap.length}`);
  const widest = Math.max(0, ...samples.map((s) => list(s.cells).length));
  const limit = 2 * (2 * TRAVEL_CELL_LIMIT_COLUMNS + 1);
  add.assert('cells behind the source are cleaned up', `the number of cells holding instances never exceeds ${limit} (13 columns of 2 rows) of ${total}`, widest <= limit, `most cells at once ${widest} of ${total}`);

  const loaded = samples.map((s) => s.levels_loaded).filter(isNum);
  add.observe('streaming level counts', 'loaded streaming levels over time (the persistent level is not counted)',
    `at the end of hold A ${holdA?.levels_loaded}/${holdA?.levels_total}, of hold B ${holdB?.levels_loaded}/${holdB?.levels_total}; lowest ${Math.min(...loaded)}, highest ${Math.max(...loaded)}`);
  add.observe('partition actors and pooling', 'APCGPartitionActor count against the ones holding instances',
    `at the end of hold A ${holdA?.partition_actors} actors, ${holdA?.partition_actors_with_instances} with instances; of hold B ${holdB?.partition_actors}, ${holdB?.partition_actors_with_instances}`);
  const orig = componentOf(r, volumeName(author, 'map_stream', 'runtime_cells'));
  add.observe('the original component', 'the volume\'s own component: trigger, partitioned, events, instances on its actor (expected none: the output is on the partition actors)',
    orig ? `trigger ${orig.trigger}, partitioned ${orig.partitioned}, generated events ${orig.generated_events}, instances ${orig.final?.instances}; original_instances at the end ${holdB?.original_instances}` : 'component not found');
  const first = samples.find((s) => s.partition_instances > 0);
  add.observe('time to the first generated cell', 'seconds from BeginPlay to the first sample with partition instances', first ? `${first.t}` : 'never');
  add.observe('instances per generating cell', 'total partition instances over cells with instances at the end of hold A and hold B',
    `${holdA?.partition_instances}/${holdA?.partition_actors_with_instances}, ${holdB?.partition_instances}/${holdB?.partition_actors_with_instances}`);
  add.observe('generating at the phase ends', 'components still generating', `hold A ${holdA?.components_generating}, hold B ${holdB?.components_generating}`);
  add.observe('scheduler console variables', 'values in the game process', JSON.stringify(r.world_now?.cvars ?? {}));
  const pcgLines = lines(run.log, /LogPCG: (Warning|Error)/);
  add.observe('PCG warnings and errors in the log', 'LogPCG lines at warning or error level', `${pcgLines.length} line(s)${pcgLines.length ? `: ${pcgLines.slice(0, 4).join(' | ')}` : ''}`);
}

/** The authoring session must have made what the runs need; a missing piece is reported here instead of as a confusing failure in a run. */
function judgeAuthor(author, rows, out) {
  const add = makeAdder(out, 'author');
  const steps = author?.steps ?? {};
  add.assert('the editor session finished', 'the authoring script ran to its end with no stage error', !!author && author.done === true && !author.error, author?.error ? String(author.error).slice(0, 300) : `done ${author?.done}`);
  const assets = steps.assets ?? {};
  add.assert('the content assets exist', 'the project mesh, the unreferenced copy and the flagged material were created',
    assets.SM_ProbeCube?.exists === true && assets.SM_Orphan?.exists === true && assets.M_ProbeUnlit?.flag === true, JSON.stringify(assets).slice(0, 300));
  if (rows.includes('p1')) {
    const b = steps.editor_baseline;
    add.assert('the editor baseline completed', 'the graph generated on demand in the editor and produced instances', b?.completed === true && b.instances > 0 && b.points > 0, JSON.stringify(b ?? null));
    add.assert('the runtime map is saved without baked output', 'the maps are saved, the runtime volumes hold no instances in the editor, and the runtime map has one PCG World Actor',
      steps.map_runtime?.saved === true && steps.map_noworld?.saved === true && steps.map_runtime?.world_actors_in_map === 1
        && list(steps.map_runtime?.volumes).filter((v) => /at_?runtime/i.test(v.trigger)).every((v) => v.editor_instances === 0),
      JSON.stringify({ runtime: steps.map_runtime?.saved, noworld: steps.map_noworld?.saved, actors: steps.map_runtime?.world_actors_in_map }));
    add.assert('the control map has no PCG World Actor when saved', 'the world actor was removed and the editor did not add another before the save',
      steps.map_noworld?.world_actors_in_map === 0 && steps.map_noworld?.world_actors_after_save === 0, JSON.stringify({ inMap: steps.map_noworld?.world_actors_in_map, afterSave: steps.map_noworld?.world_actors_after_save }));
    add.observe('graph and expected points', 'Create Points Grid with extents 400, 400, 50 and cell size 100 makes 64 points by the element source', `editor baseline points ${b?.points}, instances ${b?.instances}`);
  }
  if (rows.includes('p2')) {
    const m = steps.map_stream;
    add.assert('the streaming map is saved', 'the World Partition map was created, filled and saved with one PCG World Actor', m?.saved === true && m.world_actors_in_map === 1, JSON.stringify(m ?? steps.map_stream_error ?? null).slice(0, 300));
    add.observe('markers, grid and spatial loading', 'whether Python set the grid size and whether the markers are spatially loaded', JSON.stringify({ grid: m?.grid_size_cm, markers: m?.markers }));
  }
  add.observe('authoring warnings', 'property writes the editor refused', JSON.stringify(list(author?.warnings)).slice(0, 400));
}

export function evaluate({ author, runs, rows = ['p1', 'p2'] } = {}) {
  const out = [];
  judgeAuthor(author, rows, out);
  const need = [];
  if (rows.includes('p1')) need.push('runtime', 'noworld');
  if (rows.includes('p2')) need.push('stream');
  const done = list(runs);
  for (const map of need) {
    const mine = done.filter((r) => r.map === map);
    if (mine.length === 0) out.push({ name: `${map}: a run exists`, claim: 'at least one packaged-game run was made on this map', pass: false, observe: false, detail: 'no run recorded' });
    for (const run of mine) {
      if (map === 'runtime') judgeRuntimeMap(run, author, out);
      else if (map === 'noworld') judgeNoWorldMap(run, author, out);
      else judgeStreamMap(run, author, out);
    }
  }
  return out;
}

export function summarize(checks) {
  const asserts = checks.filter((c) => !c.observe);
  return { passed: asserts.filter((c) => c.pass).length, total: asserts.length, observed: checks.length - asserts.length };
}
