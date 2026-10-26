// Judges the reports that landscape_world.mjs collects. Pure functions, no Unreal and no dependencies; landscape-world.test.mjs feeds them
// canned reports in the shape landmass_probe.py, pcg_partition_probe.py and wp_unload_probe.py write. The probes ran on Unreal 5.8.4
// (rendering editor 18 of 18 checks, -nullrhi editor 16 of 18). The expectations below were written from the install's sources before
// the first run, and the canned reports are what a run that agrees with those sources would write, not recorded results.
//
// Two kinds of check. `assert` checks have an expectation that engine source supports; they pass or fail. `observe` checks record a value
// the sources do not decide (a height change that depends on a brush Blueprint's defaults, a count that depends on how the editor loads
// proxies); they never fail and are not counted in the totals. Read the observe lines after the first run and turn the ones that held into asserts.

const NEEDED_BRIDGE = ['attach_brush_to_layer', 'detach_brush', 'get_brush_layer_index', 'get_brush_count_for_layer', 'get_brush_owning_landscape'];
const CHANGE_CM = 1.0;

const show = (v) => JSON.stringify(v);
const rungOf = (candidate, name) => (candidate?.rungs ?? []).find((r) => r.rung === name);
const noErrors = (report) => !!report && (report.errors ?? []).length === 0 && !report.error;
const errorText = (report) => (report ? show([...(report.errors ?? []).map((e) => e.step), ...(report.error ? ['stage runner'] : [])]) : 'no report');

/** The candidate that carries the attach evidence: the first one (in key order) that reached the bridge attach rung. */
export function leadCandidate(landmass) {
  const all = Object.entries(landmass?.candidates ?? {});
  const hit = all.find(([, c]) => rungOf(c, 'r3_bridge_attach'));
  return hit ? { key: hit[0], ...hit[1] } : all.length ? { key: all[0][0], ...all[0][1] } : undefined;
}

function landmassChecks(landmass, add, observe) {
  const c = leadCandidate(landmass);
  const members = landmass?.bridge_members ?? [];
  add('bridge brush functions visible in Python', 'dir(unreal.LandscapeBridgeLibrary) lists attach_brush_to_layer, detach_brush, get_brush_layer_index, get_brush_count_for_layer and get_brush_owning_landscape',
    NEEDED_BRIDGE.every((m) => members.includes(m)), `missing: ${show(NEEDED_BRIDGE.filter((m) => !members.includes(m)))}`);
  add('landmass: no script errors', 'every step of landmass_probe.py ran', noErrors(landmass), errorText(landmass));
  const layers = c?.edit_layers ?? [];
  add('landmass: the bridge Landscape has an edit layer', 'ALandscapeProxy::Import creates the default edit layer when none is imported (LandscapeEdit.cpp), so get_edit_layers lists one',
    layers.length >= 1 && !String(layers[0]).startsWith('error'), `edit layers ${show(layers)}`);

  const r0 = rungOf(c, 'r0_spawn_only'), r1 = rungOf(c, 'r1_set_target'), r2 = rungOf(c, 'r2_property');
  const r3 = rungOf(c, 'r3_bridge_attach'), r5 = rungOf(c, 'r5_detach');
  const unattached = (r) => !!r && r.manager_landscape === null && r.bridge_owner === null && r.layer_index === -1 && (r.brush_counts ?? []).every((n) => n === 0);
  add('landmass r0: spawning the brush leaves the manager unattached (negative control)', 'a spawned brush finds or spawns its manager, and the manager is on no edit layer: get_landscape() is None, the bridge finds no layer for it',
    unattached(r0), r0 ? show({ landscape: r0.manager_landscape, layer: r0.layer_index, counts: r0.brush_counts }) : 'no r0 rung');
  add('landmass r1: set_target_landscape does not attach', "ALandmassManagerBase::SetTargetLandscape only detaches the old Landscape (LandmassManagerBase.cpp), so the manager stays on no edit layer",
    unattached(r1), r1 ? show({ call: r1.call, landscape: r1.manager_landscape, layer: r1.layer_index }) : 'no r1 rung');
  add('landmass r2: writing detail_panel_landscape does not attach', 'the property change routes to SetTargetLandscape, so no edit layer holds the manager (get_landscape() may still print the written value)',
    !!r2 && r2.layer_index === -1 && r2.bridge_owner === null && (r2.brush_counts ?? []).every((n) => n === 0), r2 ? show({ call: r2.call, layer: r2.layer_index, owner: r2.bridge_owner }) : 'no r2 rung');
  add('landmass r3: the bridge attach puts the manager on layer 0', 'attach_brush_to_layer(landscape, 0, manager) returns True, the layer holds one brush, the Landscape is the brush owner and the manager reports it from get_landscape() (ALandscape::AddBrushToLayer calls SetOwningLandscape)',
    c?.attach_call?.value === 'True' && !!r3 && r3.layer_index === 0 && (r3.brush_counts ?? [])[0] === 1 && !!r3.bridge_owner && r3.manager_landscape === r3.bridge_owner,
    r3 ? show({ call: c?.attach_call, layer: r3.layer_index, counts: r3.brush_counts, owner: r3.bridge_owner, landscape: r3.manager_landscape }) : 'no r3 rung');
  add('landmass r5: the bridge detach undoes the attach', 'detach_brush removes the manager from its layer and clears its owner and get_landscape()',
    !!r5 && r5.call?.value === 'True' && unattached(r5), r5 ? show({ call: r5.call, layer: r5.layer_index, counts: r5.brush_counts, landscape: r5.manager_landscape }) : 'no r5 rung');

  // Observations
  observe('landmass r2: get_landscape() after the property write', 'the written Landscape may show in get_landscape() without an attach (a false positive for any check that reads only that call)',
    r2 ? show({ set: r2.call, landscape: r2.manager_landscape, layer: r2.layer_index }) : 'no r2 rung');
  observe('landmass: manager came from the brush', 'a spawned brush finds or spawns its own manager (ALandmassActor::FindOrSpawnManager)', c ? show({ spawned_by_brush: c.manager_spawned_by_brush, class: c.manager_class }) : 'no candidate');
  for (const [key, cand] of Object.entries(landmass?.candidates ?? {})) {
    const rungs = cand.rungs ?? [];
    const peak = Math.max(0, ...rungs.filter((r) => /^r[34]/.test(r.rung)).map((r) => r.max_delta_cm ?? 0));
    const nudge = rungs.find((r) => /^r4/.test(r.rung) && (r.max_delta_cm ?? 0) > CHANGE_CM);
    const back = rungs.find((r) => r.rung === 'r5_detach_after_wait');
    observe(`landmass height, brush ${key}`, 'with the brush attached the heightmap changes by more than one height step at some sampled spot, and returns after the detach (read in a rendering editor; the -nullrhi run did not judge it)',
      landmass?.render === true
        ? show({ peak_delta_cm: peak, changed: peak > CHANGE_CM, seconds_to_change: rungs.find((r) => r.rung === 'r3_bridge_attach')?.seconds_to_change ?? null, nudge_that_worked: nudge?.rung ?? null, returned_after_detach: back?.returned_to_baseline ?? null })
        : `not read: this run used -nullrhi (peak delta in the collision heightfield ${peak} cm)`);
  }
  observe('landmass: Python names that mention brushes on Landscape', 'before the bridge, nothing on unreal.Landscape adds a brush to a layer', show(landmass?.landscape_brush_members ?? null));
}

function pcgChecks(pcg, add, observe) {
  const fixture = pcg?.fixture, control = pcg?.control, part = pcg?.partitioned;
  add('pcg: no script errors', 'every step of pcg_partition_probe.py ran', noErrors(pcg), errorText(pcg));
  add('pcg fixture: one Landscape, four loaded proxies, sixteen components', 'the grid size 2 map the bridge makes holds the Landscape actor and four streaming proxies of four components (landscape_bridge.mjs, tested on 5.8.4)',
    fixture?.landscape_actors === 1 && fixture?.streaming_proxies === 4 && fixture?.components === 16, show(fixture));
  add('pcg control: the non-partitioned volume generates points', 'a volume with is_component_partitioned False over the whole Landscape completes and holds sampler points on the Landscape (the generated event, as in pcg_game)',
    control?.partitioned_readback === false && control?.event_fired === true && control?.points > 0, control ? show({ partitioned: control.partitioned_readback, event: control.event_fired, points: control.points }) : 'no control');
  add('pcg partitioned: the component reads back as partitioned', 'set_editor_property("is_component_partitioned", True) sticks', part?.partitioned_readback === true, show(part?.partitioned_readback));
  add('pcg partitioned: grid actors appear', 'a partitioned volume adds partition (grid) actors for the cells it overlaps; the 504 m square overlaps at least two cells of the PCG World Actor grid (world_place.py saw four)',
    part?.partition_actors_created >= 2, show({ created: part?.partition_actors_created, world_actors: part?.pcg_world_actors }));
  add('pcg partitioned: points are generated across the grid actors', 'the graph with a Landscape input and a Surface Sampler produces points in at least two grid actors when generated in the editor',
    part?.total_points > 0 && part?.cells_with_points >= 2, show({ total_points: part?.total_points, cells_with_points: part?.cells_with_points, cells: (part?.cells ?? []).length }));

  // Observations
  observe('pcg partitioned: completion event', 'the original component fires OnPCGGraphGeneratedExternal once its cells are done', show({ fired: part?.event_fired, seconds_to_event: part?.seconds_to_event, seconds_total: part?.seconds_total }));
  const ratio = part?.ratio_to_control;
  observe('pcg partitioned: total against the control', 'Surface Sampler cells are world-indexed, so the partitioned total should be close to the control total',
    show({ control_points: control?.points, partitioned_points: part?.total_points, ratio, within_5_percent: typeof ratio === 'number' ? Math.abs(ratio - 1) <= 0.05 : null }));
  observe('pcg partitioned: counts per grid actor', 'each grid actor holds the points and instances of its own cell',
    show((part?.cells ?? []).map((c) => ({ label: c.label, location: c.location, grid_cm: c.grid_size_cm, points: c.points ?? null, instances: c.instances_on_actor, local: c.has_local_component }))));
  observe('pcg partitioned: instances', 'the Static Mesh Spawner puts its instances on the grid actors, not on the volume', show({ on_cells: part?.total_instances_on_cells, on_volume: part?.instances_on_volume, control_on_volume: control?.instances_on_volume }));
  const landscapes = (part?.cells ?? []).map((c) => c.landscape_data?.landscapes?.map((l) => (Array.isArray(l) ? l.length : l)) ?? null);
  observe('pcg partitioned: the Landscape data each cell received', 'one PCGLandscapeData per cell listing the loaded Landscape actors found (the Landscape and its proxies), prepared for the cell bounds',
    show({ original_component: part?.original_component_output?.landscape_data ?? null, per_cell_count: (part?.cells ?? []).map((c) => c.landscape_data?.count ?? null), listed_per_cell: landscapes, control: control?.landscape_data ?? null }));
  observe('pcg: points against the input surface', 'a point projected on the Landscape has the input surface height there (max error across an even sample, cm)', show({ control: control?.z ?? null, partitioned_max_cm: part?.z_max_cm ?? null }));
  observe('pcg: grid size', 'the PCG World Actor grid size', show(part?.pcg_grid_size_cm ?? null));
}

function unloadChecks(unload, add, observe) {
  const steps = unload?.steps ?? {};
  add('unload: no script errors', 'every step of wp_unload_probe.py ran', noErrors(unload), errorText(unload));
  add('unload: four proxy descriptors', 'the saved map has four LandscapeStreamingProxy descriptors', steps.open?.proxy_descriptors === 4, show(steps.open));
  add('unload: unload_actors of unowned guids changes nothing', 'WorldPartitionBlueprintLibrary.UnloadActors removes guids only from the list that LoadActors filled, so calling it first leaves the loaded count as it was (documented in WorldPartitionBlueprintLibrary.cpp)',
    !!steps.open && !!steps.unload_unowned && steps.open.loaded_proxies === steps.unload_unowned.loaded_proxies, show({ open: steps.open?.loaded_proxies, after: steps.unload_unowned?.loaded_proxies }));

  observe('unload: loaded proxies after opening', 'how many of the four proxies the editor has loaded straight after load_map', show(steps.open ?? null));
  observe('unload: load_actors then unload_actors', 'the Python-owned loader list adds and removes its own references only; proxies another reference holds stay loaded', show({ after_load: steps.after_load_actors ?? null, after_unload: steps.load_then_unload ?? null }));
  observe('unload: disable_loading_of_last_loaded_regions', 'the per-project user setting stops the editor from re-loading regions the user loaded last time; Python can write it', show({ exposed: unload?.settings_class_exposed ?? null, before: unload?.setting_before ?? null, set: unload?.setting_set ?? null, read_back: unload?.setting_read_back ?? null, after_reopen: steps.setting_off ?? null }));
  observe('unload: a proxy left unloaded', 'whether any step left a proxy unloaded, which a carve test over unloaded proxies needs', show({ any_unloaded: steps.any_unloaded ?? null }));
}

/**
 * input: { build: {exit, log}, landmass, pcg, unload }; any report may be undefined (that phase did not run or wrote nothing).
 * Returns checks: { name, claim, pass, detail, observe? }. An observe check always passes and is not counted by summarize.
 */
export function evaluate({ build, landmass, pcg, unload, only } = {}) {
  const checks = [];
  const add = (name, claim, pass, detail) => checks.push({ name, claim, pass: !!pass, detail });
  const observe = (name, claim, detail) => checks.push({ name, claim, pass: true, observe: true, detail });
  add('module compiles', 'UBT builds the editor target with the LandscapeBridge module, including the brush functions', build?.exit === 0 && /Result: Succeeded/.test(build?.log ?? ''),
    `exit ${build?.exit}, ${/Result: Succeeded/.test(build?.log ?? '') ? 'Result: Succeeded' : 'no success line'}`);
  const wanted = (phase) => !only || only === phase;
  if (wanted('landmass')) landmassChecks(landmass, add, observe);
  if (wanted('pcg')) pcgChecks(pcg, add, observe);
  if (wanted('unload')) unloadChecks(unload, add, observe);
  return checks;
}

export function summarize(checks) {
  const asserted = checks.filter((c) => !c.observe);
  return { passed: asserted.filter((c) => c.pass).length, total: asserted.length, observed: checks.length - asserted.length };
}
