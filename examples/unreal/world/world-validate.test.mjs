// node --test examples/unreal/world/world-validate.test.mjs  (no Unreal, no dependencies)
// The reports below are what the world scripts wrote on Unreal 5.8.2; the tests mutate one fact at a time and expect the matching
// check to fail, so the validator cannot pass by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize } from './world-validate-checks.mjs';

const spatialDefaults = { runtime_grid: 'None', data_layer_assets: '[]' };
const good = () => ({
  maps: { external_actor_files: 144, steps: [{ step: 'copy', loaded: true, saved: true, actor_descs: 138 }, { step: 'copy', loaded: true, saved: true, actor_descs: 0 }] },
  convert: { exit: 0, converted_map: true, ini: '[/Script/UnrealEd.WorldPartitionConvertCommandlet]\nLandscapeGridSize=4\nDataLayerAssetFolder=/Game/DataLayers/WorldSmall_WP/\n' },
  convertWithoutFlag: { exit: 1, log: 'LogWorldPartitionConvertCommandlet: Error: The option "-AllowCommandletRendering" is required.' },
  inspected: {
    control: { partitioned: false, actor_descs: 0 },
    large: {
      partitioned: true, actor_descs: 138, proxies_in_world_before_load_actors: 0,
      landscape: { landscape_actor_spatially_loaded: false, landscape_actor_components: 0,
        python_creation_members: ['landscape_export_heightmap_to_render_target', 'landscape_import_heightmap_from_render_target', 'landscape_import_weightmap_from_render_target'], streaming_proxies: 64, streaming_proxies_spatially_loaded: 64, components_total: 256,
        components_per_holder: [4, 4], component_size_quads: 126, proxy_grid: [8, 8], proxy_size_cm: [25200, 25200], edit_layers: ['Base Landscape', 'Flat Middle'] },
    },
    smallWpGrid1: { partitioned: true, landscape: { streaming_proxies: 4, components_total: 4, components_per_holder: [1, 1], proxy_grid: [2, 2] } },
    small: { partitioned: false, actor_descs: 0, landscape: { streaming_proxies: 0, components_total: 4, component_size_quads: 255 } },
    smallWp: {
      partitioned: true, actor_descs: 17,
      by_class: { WaterBodyLake: { count: 1, spatially_loaded: 1 }, WaterBodyRiver: { count: 1, spatially_loaded: 1 },
        WaterZone: { count: 1, spatially_loaded: 0 }, WaterBrushManager: { count: 1, spatially_loaded: 0 } },
      landscape: { landscape_actor_spatially_loaded: false, streaming_proxies: 1, streaming_proxies_spatially_loaded: 1, components_total: 4 },
    },
  },
  placeCommandlet: { exit: 4294967295, log: 'Assertion failed: CurrentBaseApplication.IsValid() [File:SlateApplicationBase.h]', report: { zone_spawned: true } },
  place: {
    placed: {
      landmass_manager: { is_spatially_loaded: 'False', ...spatialDefaults }, landmass_brush: { is_spatially_loaded: 'False', ...spatialDefaults },
      water_zone: { is_spatially_loaded: 'False', ...spatialDefaults },
      water_mesh_actor: { class_path: '/Script/Water.WaterZone', is_spatially_loaded: 'False', ...spatialDefaults },
      river: { is_spatially_loaded: 'True', ...spatialDefaults }, pcg_volume: { is_spatially_loaded: 'True', ...spatialDefaults },
    },
    edit_layers_before: ['Base Landscape', 'Flat Middle'], edit_layers_after: ['Base Landscape', 'Flat Middle', 'Water'],
    data_layer_added: true, river_tuned_after: { is_spatially_loaded: 'False', runtime_grid: 'MainGrid' },
    water_brush_manager_class: ['/Script/WaterEditor.WaterBrushManager'],
    landscape_creation_members: ['landscape_export_heightmap_to_render_target', 'landscape_import_heightmap_from_render_target', 'landscape_import_weightmap_from_render_target'],
    landmass_manager_target: 'None', landscape_brush_members: [], water_mesh_actor_is_zone: true,
    pcg_world_actors_before: 0, pcg_partitioned_before: false, pcg_partitioned_after: true, pcg_world_actors_after: 1, pcg_grid_size_cm: 25600,
    added_by_engine: ['Landscape_WaterBrushManager_0', 'PCGWorldActor_UAID_1'], save_as: true,
    descriptors_after_reload: [
      { class: 'WaterBrushManager', label: 'Landscape_WaterBrushManager', spatially_loaded: false },
      { class: 'LandmassManagerBase', label: 'LandmassBrushManager', spatially_loaded: false },
      { class: 'LandscapeBlueprintBrush', label: 'CustomBrush_Landmass', spatially_loaded: false },
      { class: 'WaterZone', label: 'WaterZone', spatially_loaded: false },
      { class: 'WaterBodyRiver', label: 'WaterBodyRiver', spatially_loaded: true },
      { class: 'WaterBodyRiver', label: 'RiverTuned', spatially_loaded: false, runtime_grid: 'MainGrid', data_layers: '[{}]' },
      { class: 'PCGWorldActor', label: 'PCGWorldActor', spatially_loaded: false },
      { class: 'PCGPartitionActor', label: 'PCGPartitionGridActor_25600_0_0', spatially_loaded: true },
      { class: 'PCGPartitionActor', label: 'PCGPartitionGridActor_25600_0_-1', spatially_loaded: true },
    ],
  },
  placeLog: 'LogScript: Warning: Accessed None trying to read (real) property BrushManager in /Landmass/Landscape/BlueprintBrushes/CustomBrush_Landmass.CustomBrush_Landmass_C\n',
  carve: {
    float_target_render_ok: false, landscape_proxies_total: 64, landscape_proxies_loaded_at_open: 64, edit_layers_after: ['Base Landscape', 'Flat Middle', 'Water'],
    before: { render_ok: true, heights: Array(16).fill(0) },
    river: { z: -600, depth: 400, width: 3000, expected_bed: -1000, spatially_loaded: true },
    after: { render_ok: true, heights: [-660.9, -1000, -1000, -603.9, -550.8, -490.6, -583.6, -1000, -1000, -921.9, -532.8, -350.8, -437.5, -583.6, -943.8, -1000] },
    shot: { exists: true },
  },
});

const failing = (mutate) => { const r = good(); mutate(r); return evaluate(r).filter((c) => !c.pass).map((c) => c.name); };

test('the recorded Unreal 5.8.2 reports pass every check', () => {
  const checks = evaluate(good());
  assert.deepEqual(checks.filter((c) => !c.pass), []);
  assert.deepEqual(summarize(checks), { passed: 17, total: 17 });
});

test('a missing report fails its checks instead of throwing', () => {
  const checks = evaluate({});
  assert.ok(checks.length === 17 && checks.every((c) => !c.pass));
});

test('each guidance claim fails when its fact changes', () => {
  assert.deepEqual(failing((r) => { r.inspected.large.partitioned = false; }), ['the Open World template copies as a partitioned map']);
  assert.deepEqual(failing((r) => { r.inspected.control.partitioned = true; }), ['the Open World template copies as a partitioned map']);
  assert.deepEqual(failing((r) => { r.inspected.large.landscape.streaming_proxies = 63; }), ['the template Landscape is one Landscape actor and 64 streaming proxies']);
  assert.deepEqual(failing((r) => { r.inspected.large.landscape.landscape_actor_spatially_loaded = true; }), ['the template Landscape is one Landscape actor and 64 streaming proxies']);
  assert.deepEqual(failing((r) => { r.inspected.large.landscape.python_creation_members.push('create_landscape'); }), ['Python has no Landscape creation function']);
  assert.deepEqual(failing((r) => { r.place.landscape_creation_members.push('create_landscape'); }), ['Python has no Landscape creation function']);
  assert.deepEqual(failing((r) => { r.maps.external_actor_files = 1; }), ['the Open World template copies as a partitioned map']);
  assert.deepEqual(failing((r) => { r.inspected.large.proxies_in_world_before_load_actors = 64; }), ['the template Landscape is one Landscape actor and 64 streaming proxies']);
  assert.deepEqual(failing((r) => { r.place.water_brush_manager_class = ['/Script/Water.Other']; }), ['placing a river adds the Water brush manager and a Water edit layer']);
  assert.deepEqual(failing((r) => { r.carve.float_target_render_ok = true; }), ['the river carve reaches the heightmap of a partitioned map']);
  assert.deepEqual(failing((r) => { r.convert.ini = 'LandscapeGridSize=8'; }), ['the conversion commandlet partitions a Landscape map into one proxy']);
  assert.deepEqual(failing((r) => { r.inspected.smallWp.landscape.streaming_proxies = 4; }), ['the conversion commandlet partitions a Landscape map into one proxy']);
  assert.deepEqual(failing((r) => { r.inspected.smallWpGrid1.landscape.streaming_proxies = 1; }), ['LandscapeGridSize in the generated .ini sets the proxy size']);
  assert.deepEqual(failing((r) => { r.convertWithoutFlag.exit = 0; }), ['the conversion commandlet refuses to run without -AllowCommandletRendering']);
  assert.deepEqual(failing((r) => { r.inspected.smallWp.by_class.WaterBodyRiver.spatially_loaded = 0; }), ['converted water actors: bodies are spatially loaded, the zone and brush manager are not']);
  assert.deepEqual(failing((r) => { r.placeCommandlet.report.river_spawned = true; }), ['a water body in a commandlet stops the engine; the editor does not']);
  assert.deepEqual(failing((r) => { r.placeCommandlet.exit = 0; }), ['a water body in a commandlet stops the engine; the editor does not']);
  assert.deepEqual(failing((r) => { r.place.placed.water_zone.is_spatially_loaded = 'True'; }), ['placed actors report their partition settings']);
  assert.deepEqual(failing((r) => { r.place.placed.river.runtime_grid = 'MainGrid'; }), ['placed actors report their partition settings']);
  assert.deepEqual(failing((r) => { r.place.descriptors_after_reload[4].spatially_loaded = false; }), ['the saved descriptors keep those settings']);
  assert.deepEqual(failing((r) => { r.place.descriptors_after_reload[5].data_layers = '[]'; }), ['a water body can be always loaded, on a runtime grid and in a Data Layer']);
  assert.deepEqual(failing((r) => { r.place.data_layer_added = false; }), ['a water body can be always loaded, on a runtime grid and in a Data Layer']);
  assert.deepEqual(failing((r) => { r.place.water_mesh_actor_is_zone = false; }), ['Water Mesh Actor is the Water Zone class']);
  assert.deepEqual(failing((r) => { r.place.edit_layers_after = r.place.edit_layers_before; }), ['placing a river adds the Water brush manager and a Water edit layer']);
  assert.deepEqual(failing((r) => { r.place.landmass_manager_target = 'Landscape'; }), ['a Landmass brush placed from Python is not attached to the Landscape']);
  assert.deepEqual(failing((r) => { r.placeLog = ''; }), ['a Landmass brush placed from Python is not attached to the Landscape']);
  assert.deepEqual(failing((r) => { r.carve.after.heights = r.carve.before.heights; }), ['the river carve reaches the heightmap of a partitioned map']);
  assert.deepEqual(failing((r) => { r.carve.landscape_proxies_loaded_at_open = 12; }), ['the river carve reaches the heightmap of a partitioned map']);
  assert.deepEqual(failing((r) => { r.carve.shot.exists = false; }), ['a screenshot of the partitioned scene from above is written']);
  assert.deepEqual(failing((r) => { r.place.pcg_world_actors_after = 0; }), ['a partitioned PCG volume adds a PCG World Actor and partition grid actors']);
  assert.deepEqual(failing((r) => { r.place.descriptors_after_reload = r.place.descriptors_after_reload.filter((d) => d.class !== 'PCGPartitionActor'); }), ['a partitioned PCG volume adds a PCG World Actor and partition grid actors']);
});
