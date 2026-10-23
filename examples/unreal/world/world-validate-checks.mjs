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

// ---------------------------------------------------------------------------------------------------------------------------------
// The automation claims of skills/unreal-features/references/unreal-world-partition.md: new_level, the proxy unit, the commandlets, the
// console commands, the Water Zone setting and the Landscape size rule.

/** Epic's Landscape technical guide, recommended sizes: [overall vertices, quads per section, sections per component side, components per side]. */
export const LANDSCAPE_SIZES = [
  [8129, 127, 2, 32], [4033, 63, 2, 32], [2017, 63, 2, 16], [1009, 63, 2, 8], [1009, 63, 1, 16], [505, 63, 2, 4],
  [505, 63, 1, 8], [253, 63, 2, 2], [253, 63, 1, 4], [127, 63, 2, 1], [127, 63, 1, 2],
];

const isPowerOfTwo = (n) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;

/** The size rule: quads per component times components per side plus 1 is the overall vertex count per side. */
export function sizeRowProblems([overall, quadsPerSection, sectionsPerSide, componentsPerSide]) {
  const problems = [];
  const quadsPerComponent = quadsPerSection * sectionsPerSide;
  if (quadsPerComponent * componentsPerSide + 1 !== overall) problems.push(`${quadsPerComponent} x ${componentsPerSide} + 1 is ${quadsPerComponent * componentsPerSide + 1}, not ${overall}`);
  if (!isPowerOfTwo(quadsPerSection + 1) || quadsPerSection + 1 > 256) problems.push(`section of ${quadsPerSection + 1} vertices is not a power of two up to 256`);
  if (![1, 2].includes(sectionsPerSide)) problems.push(`${sectionsPerSide} sections per side`);
  if (componentsPerSide * componentsPerSide > 1024) problems.push(`${componentsPerSide * componentsPerSide} components exceed 1024`);
  return problems;
}

const sumSaved = (log) => [...String(log || '').matchAll(/Saving (\d+) packages/g)].reduce((n, m) => n + Number(m[1]), 0);
const dumpedCommands = (log) => {
  const text = String(log || ''), start = text.indexOf('[world_console] BEGIN DumpConsoleCommands'), end = text.indexOf('[world_console] END DumpConsoleCommands');
  return start >= 0 && end > start ? text.slice(start, end).split(/\r?\n/).map((l) => (l.match(/\bwp\.Runtime\.\w+\s*$/) || [''])[0].trim()).filter(Boolean) : [];
};
const cmdEcho = (log, command) => new RegExp(`\\]Cmd: ${command.replace(/[.]/g, '\\.')}\\b`).test(String(log || ''));
const blankMapShape = (n) => Boolean(n && n.new_level_result === true && n.actor_descs === 2 && n.descriptor_classes && n.descriptor_classes.WorldDataLayers === 1
  && n.descriptor_classes.WorldPartitionMiniMap === 1 && Object.keys(n.descriptor_classes).length === 2 && (n.descriptors_spatially_loaded || []).length === 0
  && n.landscape_count === 0 && (n.world_partition_members || []).length === 0 && (n.world_settings_partition_members || []).length === 0);

/**
 * @param {object} r the reports: newLevel {editor, cmd, exec, plain, exits, cmdLog}, newMapFiles, large (the inspected template), convert
 *   {reportOnly, generateIni, suffix, inPlace, source, converted, inPlaceMap}, builders, consoleRun {report, log}, waterProps
 * @returns {{ name: string, claim: string, pass: boolean, detail: string }[]}
 */
export function evaluateAutomation(r) {
  const nl = r.newLevel || {}, rep = nl.repeat || {}, editor = nl.editor || {}, cmd = nl.cmd || {}, exec = nl.exec || {}, plain = nl.plain || {};
  const large = r.large || {}, ls = large.landscape || {}, cv = r.convert || {}, b = r.builders || {}, con = r.consoleRun || {}, wp = r.waterProps || {};
  const out = [];
  const check = (name, claim, pass, detail = '') => out.push({ name, claim, pass: Boolean(pass), detail: String(detail) });

  check('new_level(path, True) makes a partitioned map in the editor, in -run=pythonscript and in -ExecutePythonScript',
    'LevelEditorSubsystem.new_level(path, True) returns True and the map has actor descriptors in all three run modes; Python World has no partition members',
    blankMapShape(editor) && blankMapShape(cmd) && blankMapShape(exec) && Array.isArray(nl.exits) && nl.exits.length === 3 && nl.exits.every((e) => e === 0),
    `exits ${(nl.exits || []).join()}, descriptors ${editor.actor_descs}/${cmd.actor_descs}/${exec.actor_descs}`);
  const files = r.newMapFiles || [];
  check('the blank partitioned map holds a Data Layers actor and a minimap actor, no Landscape, and two HLOD layer assets',
    "The map is new_level's umap, two <Map>_HLODLayer_* assets and two external actor files; the Open World template adds a Landscape, 64 proxies, HLOD actors and lighting",
    files.some((f) => /Maps\/NewWpCmd\.umap$/.test(f)) && files.filter((f) => /NewWpCmd_HLODLayer_(Instanced|Merged)\.uasset$/.test(f)).length === 2
      && files.filter((f) => /__ExternalActors__\/Maps\/NewWpCmd\//.test(f)).length === 2
      && large.partitioned === true && ['Landscape', 'LandscapeStreamingProxy', 'WorldPartitionHLOD', 'SkyAtmosphere', 'DirectionalLight'].every((c) => (large.by_class || {})[c])
      && !(cmd.descriptor_classes || {}).Landscape,
    `${files.length} files; template classes ${Object.keys(large.by_class || {}).length}`);
  check('new_level without the flag makes a map with no descriptors, and refuses an existing path',
    'new_level(path) is not partitioned; new_level on an existing path returns False, logs "An asset already exists at this location" and ends the commandlet with exit 1',
    plain.new_level_result === true && plain.actor_descs === 0 && plain.saved === true && (plain.level_actor_classes_after || {}).StaticMeshActor === 4 && plain.actor_descs_after === 0
      && rep.new_level_result === false && rep.exit === 1 && /NewLevel\. Failed to validate the destination\. An asset already exists at this location\./.test(rep.log || ''),
    `plain descriptors ${plain.actor_descs}, repeat ${rep.new_level_result}, exit ${rep.exit}`);

  check('a proxy holds 2 by 2 components of 126 quads: 252 quads, 252 m, per side',
    'Template: 256 components, 126 quads each, 64 proxies in 8 by 8, 4 components per proxy, 2 per side, 252 quads (252 m at 100 cm per quad) per proxy side, 2016 quads overall',
    ls.components_total === 256 && ls.component_size_quads === 126 && ls.streaming_proxies === 64 && Array.isArray(ls.components_per_holder) && ls.components_per_holder.every((n) => n === 4)
      && ls.components_per_proxy_side === 2 && ls.proxy_side_quads === 252 && ls.proxy_side_m === 252 && ls.landscape_quads_side === 2016 && ls.landscape_quads_side === 16 * 126
      && LANDSCAPE_SIZES.some(([overall, , sections, comps]) => overall === ls.landscape_quads_side + 1 && sections === 2 && comps === 16),
    JSON.stringify({ per_side: ls.components_per_proxy_side, quads: ls.proxy_side_quads, m: ls.proxy_side_m, overall: ls.landscape_quads_side }));
  const surface = ls.python_surface || {};
  check('Python reaches neither the Landscape subsystem nor the grid size',
    'No LandscapeSubsystem or LandscapeInfo class in unreal; the only grid member on the Landscape classes is runtime_grid; component quad counts are not readable properties',
    surface.landscape_subsystem_class === false && surface.landscape_info_class === false && (surface.grid_members || []).join() === 'runtime_grid' && Array.isArray(surface.quad_properties_readable) && surface.quad_properties_readable.length === 0,
    JSON.stringify(surface));
  const bad = LANDSCAPE_SIZES.map((row) => ({ row, problems: sizeRowProblems(row) })).filter((x) => x.problems.length);
  check("every row of Epic's recommended Landscape sizes follows quads per component times components plus 1",
    'overall = quads per component * components per side + 1; section vertices a power of two up to 256; at most 1024 components',
    LANDSCAPE_SIZES.length === 11 && bad.length === 0 && sizeRowProblems([4033, 63, 2, 31]).length > 0 && sizeRowProblems([4033, 62, 2, 32]).length > 0,
    bad.length ? bad.map((x) => `${x.row.join('/')}: ${x.problems.join('; ')}`).join(' | ') : `${LANDSCAPE_SIZES.length} rows`);

  const rop = cv.reportOnly || {}, gen = cv.generateIni || {}, suf = cv.suffix || {}, inPlace = cv.inPlace || {};
  check('-ReportOnly writes nothing and -GenerateIni writes only the .ini',
    '-ReportOnly exits 0 with no new file; -GenerateIni exits 0 and writes <map>.ini (LandscapeGridSize=4, EditorHash CellSize=12800, RuntimeHashSet) but no map',
    rop.exit === 0 && Array.isArray(rop.newFiles) && rop.newFiles.length === 0 && gen.exit === 0 && (gen.newFiles || []).join() === 'Content/Maps/PlainLevel.ini'
      && /\[\/Script\/UnrealEd\.WorldPartitionConvertCommandlet\]/.test(gen.ini || '') && /LandscapeGridSize=4\b/.test(gen.ini || '') && /CellSize=12800\b/.test(gen.ini || '') && /RuntimeHashClass=.*WorldPartitionRuntimeHashSet/.test(gen.ini || ''),
    `report-only new files ${(rop.newFiles || []).length}, generate-ini new files ${(gen.newFiles || []).join()}`);
  check('-ConversionSuffix keeps the source map; without it the map is converted in place',
    'With -ConversionSuffix <map>_WP is written with HLOD layer assets and external actors and the source stays unpartitioned; without it the source map becomes partitioned and no _WP map appears',
    suf.exit === 0 && (suf.newFiles || []).includes('Content/Maps/PlainLevel_WP.umap') && (suf.newFiles || []).filter((f) => f.includes('__ExternalActors__/Maps/PlainLevel_WP/')).length === 6
      && (suf.newFiles || []).filter((f) => /PlainLevel_HLODLayer_(Instanced|Merged)\.uasset$/.test(f)).length === 2
      && (cv.source || {}).partitioned === false && (cv.converted || {}).partitioned === true && (cv.converted || {}).actor_descs === 6
      && inPlace.exit === 0 && (cv.inPlaceMap || {}).partitioned === true && (cv.inPlaceMap || {}).actor_descs === 6 && !(inPlace.newFiles || []).some((f) => f.endsWith('PlainInPlace_WP.umap')),
    `suffix exit ${suf.exit}, new files ${(suf.newFiles || []).length}, converted descriptors ${(cv.converted || {}).actor_descs}, in-place descriptors ${(cv.inPlaceMap || {}).actor_descs}`);

  const all = b.resaveAll || {}, ignored = b.resaveActorClass || {}, named = b.resaveActorClassName || {};
  check('the Resave Actors builder saves every actor; the class filter is -ActorClassName',
    '-builder=WorldPartitionResaveActorsBuilder -SCCProvider=None exits 0 and saves all 6 actor packages; -ActorClass=StaticMeshActor is ignored (6); -ActorClassName=StaticMeshActor saves the 4 cubes',
    all.exit === 0 && sumSaved(all.log) === 6 && ignored.exit === 0 && sumSaved(ignored.log) === 6 && named.exit === 0 && sumSaved(named.log) === 4,
    `saved ${sumSaved(all.log)} / ${sumSaved(ignored.log)} / ${sumSaved(named.log)}`);
  const fol = b.foliage || {}, fol2 = b.foliage2 || {};
  check('the Foliage builder changes the foliage grid size and saves the map',
    '-builder=WorldPartitionFoliageBuilder -NewGridSize=512 logs "from 25600 to 512" and rewrites the map file; a second run with 1024 logs "from 512 to 1024"',
    fol.exit === 0 && /Changing Foliage Grid Size from 25600 to 512/.test(fol.log || '') && fol.mapChanged === true && fol2.exit === 0 && /Changing Foliage Grid Size from 512 to 1024/.test(fol2.log || ''),
    `exit ${fol.exit}, map rewritten ${fol.mapChanged}`);
  const mini = b.minimapNullRhi || {}, miniGpu = b.minimapRendering || {}, mmBefore = b.minimapBefore || {}, mmAfter = b.minimapAfter || {};
  check('the MiniMap builder needs rendering: it fails with -nullrhi and builds the texture without it',
    '-builder=WorldPartitionMiniMapBuilder -AllowCommandletRendering exits 1 with -nullrhi (render target has been released) and without -nullrhi it exits 0 with no error and the minimap actor, which had no texture, holds a 26 by 2 one',
    mini.exit === 1 && /Couldn't copy render target to internal texture: Cannot update texture : render target \S+ has been released/.test(mini.log || '')
      && mmBefore.has_texture === false && miniGpu.exit === 0 && !/Couldn't copy render target/.test(miniGpu.log || '')
      && mmAfter.has_texture === true && (mmAfter.texture_size || []).join() === '26,2',
    `nullrhi exit ${mini.exit}, rendering exit ${miniGpu.exit}, texture ${mmBefore.has_texture} -> ${(mmAfter.texture_size || []).join('x')}`);

  const listed = dumpedCommands(con.log), cvars = (con.report || {}).cvars || {};
  check('the console commands Epic names exist, with MaxLoadingStreamingCells as the variable name',
    'DumpConsoleCommands lists ToggleDrawRuntimeHash2D, ToggleDrawRuntimeHash3D, OverrideRuntimeSpatialHashLoadingRange and HLOD; wp.Runtime.MaxLoadingStreamingCells is a variable (4); MaxLoadingLevelStreamingCells is not registered',
    ['wp.Runtime.ToggleDrawRuntimeHash2D', 'wp.Runtime.ToggleDrawRuntimeHash3D', 'wp.Runtime.OverrideRuntimeSpatialHashLoadingRange', 'wp.Runtime.HLOD'].every((c) => listed.includes(c))
      && cvars['wp.Runtime.MaxLoadingStreamingCells'] === 4 && cvars['wp.Runtime.MaxLoadingLevelStreamingCells'] === 0
      && /Failed to find console variable 'wp\.Runtime\.MaxLoadingLevelStreamingCells'/.test(con.log || '')
      && cmdEcho(con.log, 'wp.Runtime.MaxLoadingLevelStreamingCells') && !cmdEcho(con.log, 'wp.Runtime.ToggleDrawRuntimeHash2D') && !cmdEcho(con.log, 'wp.Runtime.HLOD'),
    `${listed.length} commands listed, cvars ${JSON.stringify(cvars)}`);

  const spatial = wp.is_spatially_loaded || {}, def = wp.zone_default || {}, set = wp.zone_after_set || {}, back = wp.zone_after_reopen || {};
  check('Water Zone Local Tessellation is off by default with a 51200 by 51200 by 10000 extent, and persists when set',
    'enable_local_only_tessellation False, local_tessellation_extent (51200, 51200, 10000); set True it survives save and reopen; zone and ocean are not spatially loaded, lake and river are',
    wp.new_level === true && wp.saved === true && def.enable_local_only_tessellation === 'False' && (def.local_tessellation_extent || []).join() === '51200,51200,10000'
      && set.enable_local_only_tessellation === 'True' && back.enable_local_only_tessellation === 'True' && (back.local_tessellation_extent || []).join() === '51200,51200,10000'
      && isFalse(spatial.zone) && isFalse(spatial.ocean) && isTrue(spatial.lake) && isTrue(spatial.river),
    `default ${def.enable_local_only_tessellation}, after reopen ${back.enable_local_only_tessellation}, spatial ${JSON.stringify(spatial)}`);
  return out;
}

export const summarize = (checks) => ({ passed: checks.filter((c) => c.pass).length, total: checks.length });
