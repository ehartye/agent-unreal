// Pure checks for world_validate.mjs: turns the JSON reports of the world scripts into pass or fail results, one per claim in
// skills/unreal-features/references/unreal-landmass.md and unreal-water.md. No Unreal, no files: world-validate.test.mjs feeds it
// canned reports, and world_validate.mjs feeds it real ones.

const near = (a, b, tol = 1) => typeof a === 'number' && Math.abs(a - b) <= tol;
const isTrue = (v) => v === 'True' || v === true;
const isFalse = (v) => v === 'False' || v === false;
const count = (text, pattern) => (String(text || '').match(pattern) || []).length;

/**
 * @param {object} r the reports: maps, convert, convertWithoutFlag, inspected {control, large, small, smallWp}, placeCommandlet,
 *   place, placeLog, carve
 * @returns {{ name: string, claim: string, pass: boolean, detail: string }[]}
 */
export function evaluate(r) {
  const maps = r.maps || {}, convert = r.convert || {}, noFlag = r.convertWithoutFlag || {}, ins = r.inspected || {};
  const control = ins.control || {}, large = ins.large || {}, small = ins.small || {}, smallWp = ins.smallWp || {}, grid1 = ins.smallWpGrid1 || {};
  const crash = r.placeCommandlet || {}, place = r.place || {}, carve = r.carve || {};
  const placed = place.placed || {};
  const out = [];
  const check = (name, claim, pass, detail = '') => out.push({ name, claim, pass: Boolean(pass), detail: String(detail) });
  const copies = (maps.steps || []).filter((s) => s.step === 'copy');

  // A partitioned map from the template
  check('the Open World template copies as a partitioned map',
    'Load /Engine/Maps/Templates/OpenWorld and Save As into /Game; get_actor_descs returns descriptors only for a partitioned map',
    copies.length === 2 && copies.every((s) => s.loaded && s.saved) && maps.external_actor_files >= large.actor_descs && large.partitioned === true && large.actor_descs >= 100
      && control.partitioned === false && small.partitioned === false,
    `copies ${copies.length}, external actor files ${maps.external_actor_files}, WorldLarge descriptors ${large.actor_descs}, default template ${control.actor_descs}, sample map ${small.actor_descs}`);
  const ls = large.landscape || {};
  check('the template Landscape is one Landscape actor and 64 streaming proxies',
    'Landscape actor not spatially loaded; 8 by 8 spatially loaded LandscapeStreamingProxy actors of 2 by 2 components, 126-quad components, 2 edit layers',
    ls.landscape_actor_spatially_loaded === false && ls.landscape_actor_components === 0 && large.proxies_in_world_before_load_actors === 0 && ls.streaming_proxies === 64 && ls.streaming_proxies_spatially_loaded === 64
      && ls.components_total === 256 && Array.isArray(ls.components_per_holder) && ls.components_per_holder.every((n) => n === 4)
      && ls.component_size_quads === 126 && Array.isArray(ls.proxy_grid) && ls.proxy_grid.join() === '8,8'
      && Array.isArray(ls.proxy_size_cm) && ls.proxy_size_cm.join() === '25200,25200' && (ls.edit_layers || []).join() === 'Base Landscape,Flat Middle',
    JSON.stringify(ls));

  const creators = (ls.python_creation_members || []).join(), editorCreators = (place.landscape_creation_members || []).join();
  const expectedCreators = 'landscape_export_heightmap_to_render_target,landscape_import_heightmap_from_render_target,landscape_import_weightmap_from_render_target';
  check('Python has no Landscape creation function',
    'Landscape and LandscapeProxy expose only the heightmap and weightmap render-target import and export among create, import, export and spawn members, in the commandlet and the editor',
    creators === expectedCreators && editorCreators === expectedCreators, `commandlet: ${creators}; editor: ${editorCreators}`);

  // A second size through the conversion commandlet
  const sl = small.landscape || {}, wl = smallWp.landscape || {};
  check('the conversion commandlet partitions a Landscape map into one proxy',
    'WorldPartitionConvertCommandlet <map> -SCCProvider=None -ConversionSuffix -AllowCommandletRendering writes <map>_WP; Landscape grid size 4 gives one proxy for 2 by 2 components',
    convert.exit === 0 && convert.converted_map === true && /LandscapeGridSize=4\b/.test(convert.ini || '')
      && small.partitioned === false && sl.streaming_proxies === 0 && sl.components_total === 4 && sl.component_size_quads === 255
      && smallWp.partitioned === true && wl.streaming_proxies === 1 && wl.streaming_proxies_spatially_loaded === 1
      && wl.components_total === 4 && wl.landscape_actor_spatially_loaded === false,
    `exit ${convert.exit}, source proxies ${sl.streaming_proxies}, converted proxies ${wl.streaming_proxies}, components ${wl.components_total}`);
  const g1 = grid1.landscape || {};
  check('LandscapeGridSize in the generated .ini sets the proxy size',
    'Edit LandscapeGridSize in <map>.ini and convert again: 1 gives one component per proxy, so 4 proxies for the 4 components',
    grid1.partitioned === true && g1.streaming_proxies === 4 && g1.components_total === 4 && (g1.components_per_holder || []).every((n) => n === 1)
      && Array.isArray(g1.proxy_grid) && g1.proxy_grid.join() === '2,2',
    `proxies ${g1.streaming_proxies}, components per proxy ${(g1.components_per_holder || []).join('-')}`);
  check('the conversion commandlet refuses to run without -AllowCommandletRendering',
    'Pass -AllowCommandletRendering with -nullrhi',
    noFlag.exit === 1 && /The option "-AllowCommandletRendering" is required/.test(noFlag.log || ''), `exit ${noFlag.exit}`);
  const bc = smallWp.by_class || {};
  const spatial = (name) => (bc[name] ? `${bc[name].spatially_loaded}/${bc[name].count}` : 'absent');
  check('converted water actors: bodies are spatially loaded, the zone and brush manager are not',
    'WaterBodyLake and WaterBodyRiver are spatially loaded; WaterZone and WaterBrushManager are always loaded',
    bc.WaterBodyLake && bc.WaterBodyRiver && bc.WaterZone && bc.WaterBrushManager
      && bc.WaterBodyLake.spatially_loaded === bc.WaterBodyLake.count && bc.WaterBodyRiver.spatially_loaded === bc.WaterBodyRiver.count
      && bc.WaterZone.spatially_loaded === 0 && bc.WaterBrushManager.spatially_loaded === 0,
    `lake ${spatial('WaterBodyLake')}, river ${spatial('WaterBodyRiver')}, zone ${spatial('WaterZone')}, brush manager ${spatial('WaterBrushManager')}`);

  // Placing from Python
  check('a water body in a commandlet stops the engine; the editor does not',
    'Place Water actors in UnrealEditor.exe (-nullrhi), not UnrealEditor-Cmd.exe',
    crash.exit !== 0 && /CurrentBaseApplication\.IsValid/.test(crash.log || '') && (crash.report || {}).zone_spawned === true && (crash.report || {}).river_spawned === undefined && Array.isArray(place.descriptors_after_reload) && place.save_as === true,
    `commandlet exit ${crash.exit}, zone spawned ${(crash.report || {}).zone_spawned}, river spawned ${(crash.report || {}).river_spawned}, editor saved ${place.save_as}`);
  check('placed actors report their partition settings',
    'New Water Zone, Landmass brush manager and brush are not spatially loaded; a River and a PCG volume are; runtime grid None, no data layers',
    isFalse((placed.water_zone || {}).is_spatially_loaded) && isFalse((placed.landmass_manager || {}).is_spatially_loaded)
      && isFalse((placed.landmass_brush || {}).is_spatially_loaded) && isTrue((placed.river || {}).is_spatially_loaded)
      && isTrue((placed.pcg_volume || {}).is_spatially_loaded)
      && Object.values(placed).every((p) => p.runtime_grid === 'None' && p.data_layer_assets === '[]'),
    Object.entries(placed).map(([k, v]) => `${k}=${v.is_spatially_loaded}`).join(', '));
  const desc = Object.fromEntries((place.descriptors_after_reload || []).map((d) => [d.label, d.spatially_loaded]));
  check('the saved descriptors keep those settings',
    'After Save As and reopen, the River descriptor is spatially loaded and the zone, brush manager and brush descriptors are not',
    desc.WaterBodyRiver === true && desc.WaterZone === false && desc.LandmassBrushManager === false && desc.CustomBrush_Landmass === false,
    JSON.stringify(desc));
  const tuned = (place.descriptors_after_reload || []).find((d) => d.label === 'RiverTuned') || {};
  check('a water body can be always loaded, on a runtime grid and in a Data Layer',
    'Set is_spatially_loaded and runtime_grid with set_editor_property; add the actor to a Data Layer with DataLayerEditorSubsystem; the descriptor keeps all three',
    place.data_layer_added === true && isFalse((place.river_tuned_after || {}).is_spatially_loaded) && (place.river_tuned_after || {}).runtime_grid === 'MainGrid'
      && tuned.spatially_loaded === false && tuned.runtime_grid === 'MainGrid' && tuned.data_layers && tuned.data_layers !== '[]',
    JSON.stringify(tuned));
  check('Water Mesh Actor is the Water Zone class', 'unreal.WaterMeshActor and unreal.WaterZone are the same class (/Script/Water.WaterZone)',
    place.water_mesh_actor_is_zone === true && (placed.water_mesh_actor || {}).class_path === '/Script/Water.WaterZone',
    (placed.water_mesh_actor || {}).class_path);
  check('placing a river adds the Water brush manager and a Water edit layer',
    'Do not place a Water Brush Manager yourself: the first water body adds Landscape_WaterBrushManager and the Water edit layer',
    !(place.edit_layers_before || []).includes('Water') && (place.edit_layers_after || []).includes('Water')
      && (place.added_by_engine || []).some((n) => n.startsWith('Landscape_WaterBrushManager')) && desc.Landscape_WaterBrushManager === false
      && (place.water_brush_manager_class || [])[0] === '/Script/WaterEditor.WaterBrushManager',
    `${(place.edit_layers_before || []).join()} -> ${(place.edit_layers_after || []).join()}`);
  const warnings = count(r.placeLog, /Accessed None trying to read \(real\) property BrushManager/g);
  check('a Landmass brush placed from Python is not attached to the Landscape',
    'The brush manager has no Landscape, Python has no brush members on Landscape, and the brush logs Accessed None for BrushManager; add brushes in Landscape mode',
    place.landmass_manager_target === 'None' && Array.isArray(place.landscape_brush_members) && place.landscape_brush_members.length === 0 && warnings > 0,
    `target ${place.landmass_manager_target}, brush members ${(place.landscape_brush_members || []).length}, ${warnings} log warnings`);

  // The carve
  const before = (carve.before || {}).heights || [], after = (carve.after || {}).heights || [];
  const river = carve.river || {};
  const changed = before.length === after.length ? after.filter((h, i) => Math.abs(h - before[i]) >= 100).length : 0;
  check('the river carve reaches the heightmap of a partitioned map',
    'After the river is placed and the edit layers update, the strip drops to the river height minus its depth',
    before.length === 16 && before.every((h) => near(h, before[0])) && carve.before.render_ok === true && carve.after.render_ok === true && carve.float_target_render_ok === false
      && near(Math.min(...after), river.expected_bed) && changed >= 10 && (carve.edit_layers_after || []).includes('Water') && river.spatially_loaded === true
      && carve.landscape_proxies_loaded_at_open === carve.landscape_proxies_total,
    `before ${before[0]} flat, after min ${Math.min(...after)} (expected ${river.expected_bed}), ${changed} of ${after.length} samples changed`);
  check('a screenshot of the partitioned scene from above is written', 'SceneCapture2D with RenderingLibrary.export_render_target',
    (carve.shot || {}).exists === true, JSON.stringify(carve.shot));

  // PCG
  const grid = (place.descriptors_after_reload || []).filter((d) => d.class === 'PCGPartitionActor');
  check('a partitioned PCG volume adds a PCG World Actor and partition grid actors',
    'Setting is_component_partitioned adds one PCGWorldActor (not spatially loaded, 25600 cm grid) and spatially loaded PCGPartitionGridActor actors',
    place.pcg_world_actors_before === 0 && place.pcg_partitioned_before === false && place.pcg_partitioned_after === true && place.pcg_world_actors_after === 1
      && place.pcg_grid_size_cm === 25600 && desc.PCGWorldActor === false && grid.length >= 1 && grid.every((d) => d.spatially_loaded === true),
    `world actors ${place.pcg_world_actors_before} -> ${place.pcg_world_actors_after}, grid ${place.pcg_grid_size_cm} cm, ${grid.length} grid actors`);
  return out;
}

export const summarize = (checks) => ({ passed: checks.filter((c) => c.pass).length, total: checks.length });
