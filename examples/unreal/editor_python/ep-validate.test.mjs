// node --test examples/unreal/editor_python/ep-validate.test.mjs  (no Unreal, no dependencies)
// The reports below are what the editor Python scripts wrote on Unreal 5.8.2; each mutation changes one fact and expects the matching
// check to fail, so the validator cannot pass by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize } from './ep-validate-checks.mjs';

const LOG_NEW_LEVEL = '[2026.10.22-23.54.22:911][  0]LevelEditorSubsystem: Error: NewLevel. Failed to validate the destination. An asset already exists at this location.';
const LOG_COMPILE = 'LogShaderCompilers: Warning: Failed to compile Material /Game/Mat/M_EpRockBad.M_EpRockBad for platform PCD3D_SM5, Default Material will be used in game.\n'
  + '/Engine/Generated/Material.ush:3743:22: error: function definition is not allowed here';

const canned = {
  probe: {
 "engine": "5.8.2-56702186+++UE5+Release-5.8",
 "recreate": {
  "first_new_level": true,
  "first_save": true,
  "on_disk_after_save": true,
  "naive_delete_asset": false,
  "on_disk_after_naive_delete": true,
  "naive_new_level": false,
  "neutral_world": "/Engine/Maps/Entry.Entry",
  "neutral_delete_asset": true,
  "on_disk_after_neutral_delete": true,
  "new_level_with_file_on_disk": false,
  "new_level_before_rescan": false,
  "new_level_after_rescan": true,
  "world_after_rescan": "/Game/Maps/EpRebuild.EpRebuild",
  "helper_created": true,
  "helper_world": "/Game/Maps/EpRebuild.EpRebuild",
  "helper_saved": true,
  "helper_on_disk": true,
  "helper_created_again": true
 },
 "names": {
  "wrong_on_volume_enable_volumetric_fog": "PostProcessVolume: Failed to find property 'enable_volumetric_fog' for attribute 'enable_volumetric_fog' on 'PostProcessVolume'",
  "wrong_on_volume_bloom": "PostProcessVolume: Failed to find property 'bloom' for attribute 'bloom' on 'PostProcessVolume'",
  "wrong_on_fog_actor_density": "ExponentialHeightFog: Failed to find property 'fog_density' for attribute 'fog_density' on 'ExponentialHeightFog'",
  "wrong_on_fog_component_volumetric_fog": "ExponentialHeightFogComponent: Failed to find property 'volumetric_fog' for attribute 'volumetric_fog' on 'ExponentialHeightFogComponent'",
  "wrong_on_fog_component_inscattering_color": "ExponentialHeightFogComponent: Failed to find property 'fog_inscattering_color' for attribute 'fog_inscattering_color' on 'ExponentialHeightFogComponent'",
  "right_on_fog_component": {
   "enable_volumetric_fog": null,
   "fog_inscattering_luminance": null,
   "fog_density": null
  },
  "fog_readback": {
   "enable_volumetric_fog": true,
   "fog_density": 0.03
  },
  "probe_fog_volumetric": [
   "enable_volumetric_fog",
   "set_volumetric_fog",
   "set_volumetric_fog_albedo",
   "set_volumetric_fog_distance",
   "set_volumetric_fog_emissive",
   "set_volumetric_fog_extinction_scale",
   "set_volumetric_fog_near_fade_in_distance",
   "set_volumetric_fog_scattering_distribution"
  ],
  "probe_settings_bloom_intensity": [
   "bloom_intensity",
   "override_bloom_intensity"
  ],
  "probe_settings_auto_exposure_min": [
   "auto_exposure_min_brightness",
   "override_auto_exposure_min_brightness"
  ],
  "soft_set": {
   "wrong_name_returned": false,
   "right_name_returned": true,
   "wrong_struct_name_returned": false,
   "warnings": [
    "PostProcessVolume.enable_volumetric_fog: PostProcessVolume: Failed to find property 'enable_volumetric_fog' for attribute 'enable_volumetric_fog' on 'PostProcessVolume'",
    "PostProcessSettings.bloom: PostProcessSettings: Failed to find property 'bloom' for attribute 'bloom' on 'PostProcessSettings'"
   ],
   "bloom_intensity_readback": 3.0,
   "override_readback": true
  },
  "custom_code_in_dir": false,
  "custom_code_readback": "return 1;"
 },
 "look": {
  "rotation_call": {
   "error": "'Vector' object has no attribute 'rotation'"
  },
  "rotator_method": "<Struct 'Rotator' (0x0000021BEC581140) {pitch: 10.142106, yaw: 26.565051, roll: 0.000000}>",
  "make_rot_from_x": "<Struct 'Rotator' (0x0000021BEC581140) {pitch: 10.142106, yaw: 26.565051, roll: -0.000000}>",
  "helper": "<Struct 'Rotator' (0x0000021BEC5ED2D0) {pitch: 10.142106, yaw: 26.565051, roll: -0.000000}>",
  "same_as_rotator_method": true,
  "forward_dot_direction": 1.0
 },
 "geometry": {
  "sphere": {
   "triangles": 448,
   "num_triangle_ids": 448,
   "vertices": 226
  },
  "cut z=-30 flip=False": {
   "triangles": 254,
   "num_triangle_ids": 512,
   "vertices": 129
  },
  "cut z=-30 flip=True": {
   "triangles": 318,
   "num_triangle_ids": 512,
   "vertices": 161
  },
  "cut z=150 flip=False": {
   "triangles": 448,
   "num_triangle_ids": 448,
   "vertices": 226
  },
  "cut z=150 flip=True": {
   "triangles": 0,
   "num_triangle_ids": 448,
   "vertices": 0
  },
  "cut z=-150 flip=False": {
   "triangles": 0,
   "num_triangle_ids": 448,
   "vertices": 0
  },
  "cut z=-150 flip=True": {
   "triangles": 448,
   "num_triangle_ids": 448,
   "vertices": 226
  },
  "create_from_empty_cut": {
   "asset": null,
   "outcome": "<GeometryScriptOutcomePins.FAILURE: 0>"
  },
  "create_from_empty_mesh": {
   "asset": null,
   "outcome": "<GeometryScriptOutcomePins.FAILURE: 0>"
  },
  "boulder_base_plane_cut": {
   "triangles": 318,
   "num_triangle_ids": 512,
   "vertices": 161,
   "asset": "/Game/Meshes/SM_EpBasePlane.SM_EpBasePlane",
   "outcome": "<GeometryScriptOutcomePins.SUCCESS: 1>",
   "bounds_min_z": -30.0
  },
  "boulder_base_boolean": {
   "triangles": 318,
   "num_triangle_ids": 512,
   "vertices": 161,
   "asset": "/Game/Meshes/SM_EpBaseBoolean.SM_EpBaseBoolean",
   "outcome": "<GeometryScriptOutcomePins.SUCCESS: 1>",
   "bounds_min_z": -30.0
  },
  "noise_layer_fields": [
   "frequency",
   "frequency_shift",
   "magnitude",
   "random_seed"
  ],
  "boulder_noise": {
   "triangles": 96,
   "num_triangle_ids": 96,
   "vertices": 50,
   "asset": "/Game/Meshes/SM_EpNoiseRock.SM_EpNoiseRock",
   "outcome": "<GeometryScriptOutcomePins.SUCCESS: 1>",
   "warnings": []
  }
 },
 "instancing": {
  "default_flag": false,
  "helper_changed": [
   "M_EpCmdFlagged"
  ],
  "helper_again_changed": [],
  "plain_flag_after_instances": false,
  "flagged_flag_after_instances": true,
  "usage_via_library": true,
  "set_material_usage": "False",
  "library_usage_flag": true,
  "saved": true
 }
},
  stages: {
 "engine": "5.8.2-56702186+++UE5+Release-5.8",
 "warnings": [
  "ExponentialHeightFogComponent.volumetric_fog: ExponentialHeightFogComponent: Failed to find property 'volumetric_fog' for attribute 'volumetric_fog' on 'ExponentialHeightFogComponent'"
 ],
 "ticks": {
  "frames_for_yield_5": 5
 },
 "map": {
  "first": true,
  "on_disk": true,
  "second": true,
  "world": "/Game/Maps/EpScene.EpScene"
 },
 "rock": {
  "triangles": 100,
  "min_z": -60.0,
  "outcome": "<GeometryScriptOutcomePins.SUCCESS: 1>"
 },
 "materials": {
  "flag_default": false,
  "changed": [
   "/Game/Mat/M_EpRock.M_EpRock",
   "/Game/Mat/M_EpRockBad.M_EpRockBad"
  ],
  "flag_after": true,
  "flag_on_unlisted": false,
  "macro": {
   "pixel_instructions_same_tick": 275,
   "seconds": 0.3
  },
  "function": {
   "pixel_instructions_same_tick": 0,
   "seconds": 1.1
  },
  "has_usage_good": true
 },
 "field": {
  "flagged_flag_after_set_material": true,
  "flagged": 14,
  "unflagged_flag_after_set_material": false,
  "unflagged": 14
 },
 "camera": {
  "forward_dot_target": 1.0
 },
 "picture": {
  "path": "shots/ep-scene.png",
  "exists": true,
  "bytes": 1173227
 },
 "flag_after_render": {
  "flagged": true,
  "unflagged": true
 },
 "screenshot": {
  "exists_same_tick": false,
  "ticks_waited": 2,
  "exists_after": true
 },
 "play": {
  "world_same_tick": false,
  "ticks_waited": 1,
  "world": "/Game/Maps/UEDPIE_0_EpScene.EpScene"
 },
 "error": null,
 "reentered_ticks_skipped": 61
},
  flags: {
 "engine": "5.8.2-56702186+++UE5+Release-5.8",
 "flags": {
  "M_EpCmdPlain": false,
  "M_EpCmdFlagged": true,
  "M_EpRock": true,
  "M_EpRockAuto": true
 }
},
  ground: {
 "engine": "5.8.2-56702186+++UE5+Release-5.8",
 "map": "/Game/Maps/OpenWorldCopy",
 "world": "/Game/Maps/OpenWorldCopy.OpenWorldCopy",
 "ground_ready": true,
 "grid_hits": 81,
 "grid_total": 81,
 "highest_ground": {
  "xy": [
   40000.0,
   40000.0
  ],
  "z": 2662.494218261214
 },
 "lowest_ground_z": -0.0008463988779112697,
 "pillar": {
  "xy": [
   43000.0,
   40000.0
  ],
  "ground_z": 3535.900365739595
 },
 "grid_traced_height_ok": true,
 "grid_fixed_inside_terrain": 12,
 "fixed": {
  "camera_z": 199.9991536011221,
  "ground_z_below": 2662.494218261214,
  "inside_terrain": true,
  "terrain_blocks_view": true
 },
 "traced": {
  "camera_z": 2862.494218261214,
  "ground_z_below": 2662.494218261214,
  "inside_terrain": false,
  "terrain_blocks_view": false,
  "height_above_ground": 200.0
 },
 "shots": {
  "fixed": {
   "path": "shots/x.png",
   "exists": true,
   "sha256": "fcbba5912aa5476de0776c8f65cb8e83034ff42deca29ace7a0b75b3087fb1c3"
  },
  "traced": {
   "path": "shots/x.png",
   "exists": true,
   "sha256": "f0e33547b86bc8557e5d611a79a5f9b57cd8258036d6c508b8de9aa46e79424f"
  }
 },
 "error": null
},
};
const good = () => ({ ...structuredClone(canned), probeLog: LOG_NEW_LEVEL, stagesLog: LOG_COMPILE });
const failing = (r) => evaluate(r).filter((c) => !c.pass).map((c) => c.name);

test('the canned 5.8.2 reports pass every check', () => {
  const checks = evaluate(good());
  assert.equal(checks.length, 21);
  assert.deepEqual(failing(good()), []);
  assert.deepEqual(summarize(checks), { passed: 21, total: 21 });
});

test('missing reports fail the checks instead of throwing', () => {
  const checks = evaluate({});
  assert.equal(checks.length, 21);
  assert.equal(checks.filter((c) => c.pass).length, 0);
});

// [path in the reports, new value, the check that must fail]. Path keys contain no dots.
const mutations = [
  ['probe.recreate.naive_delete_asset', true, 'delete_asset on a loaded level'],
  ['probe.recreate.on_disk_after_naive_delete', false, 'delete_asset on a loaded level'],
  ['probeLog', 'no error text', 'delete_asset on a loaded level'],
  ['probe.recreate.new_level_before_rescan', true, 'the working order'],
  ['probe.recreate.new_level_after_rescan', false, 'the working order'],
  ['probe.recreate.helper_created_again', false, 'recreate_map creates'],
  ['stages.map.second', false, 'recreate_map creates'],
  ['probe.names.wrong_on_volume_enable_volumetric_fog', null, 'guessed property names'],
  ['probe.names.wrong_on_fog_actor_density', "ExponentialHeightFog: Failed to find property 'density'", 'guessed property names'],
  ['probe.names.right_on_fog_component', { enable_volumetric_fog: 'error', fog_inscattering_luminance: null, fog_density: null }, 'the working names'],
  ['probe.names.probe_settings_bloom_intensity', ['bloom_intensity'], 'the working names'],
  ['probe.names.soft_set.wrong_name_returned', true, 'soft_set records'],
  ['probe.names.soft_set.warnings', [], 'soft_set records'],
  ['probe.names.soft_set.bloom_intensity_readback', 1.0, 'soft_set records'],
  ['probe.names.custom_code_in_dir', true, 'not listed by dir()'],
  ['probe.look.rotation_call', { value: 'ok' }, 'Vector has no rotation()'],
  ['probe.look.forward_dot_direction', 0.5, 'Vector has no rotation()'],
  ['stages.camera.forward_dot_target', 0.2, 'Vector has no rotation()'],
  ['stages.ticks.frames_for_yield_5', 1, 'the stage runner waits'],
  ['stages.screenshot.exists_same_tick', true, 'the stage runner waits'],
  ['stages.play.ticks_waited', 0, 'the stage runner waits'],
  ['stages.error', 'Traceback', 'the stage runner waits'],
  ['stages.reentered_ticks_skipped', 0, 'Slate ticks again'],
  ['stages.materials.macro.pixel_instructions_same_tick', 0, ['recompile_material returns', 'a Custom node body']],
  ['probe.geometry.cut z=150 flip=True.triangles', 448, 'a plane cut that misses'],
  ['probe.geometry.cut z=150 flip=True.num_triangle_ids', 0, 'a plane cut that misses'],
  ['probe.geometry.create_from_empty_cut.outcome', '<GeometryScriptOutcomePins.SUCCESS: 1>', 'a plane cut that misses'],
  ['probe.geometry.cut z=-30 flip=True.triangles', 254, 'flip_cut_side chooses'],
  ['probe.geometry.boulder_base_boolean.outcome', '<GeometryScriptOutcomePins.FAILURE: 0>', 'a Boolean subtract'],
  ['probe.geometry.boulder_noise.warnings', ['x'], 'a Boolean subtract'],
  ['stages.rock.triangles', 0, 'the scene rock'],
  ['stages.materials.function.pixel_instructions_same_tick', 266, 'a Custom node body'],
  ['stagesLog', 'Failed to compile Material /Game/Mat/M_EpRockBad.M_EpRockBad Default Material will be used in game.', 'a Custom node body'],
  ['stages.materials.flag_default', true, 'the instancing flag is false'],
  ['stages.materials.changed', ['one'], 'the instancing flag is false'],
  ['probe.instancing.helper_again_changed', ['again'], 'the instancing flag is false'],
  ['flags.flags.M_EpCmdPlain', true, 'without a render'],
  ['stages.flag_after_render.unflagged', false, 'without a render'],
  ['ground.grid_hits', 80, 'a line trace finds'],
  ['ground.grid_traced_height_ok', false, 'a line trace finds'],
  ['ground.fixed.inside_terrain', false, 'a fixed world Z'],
  ['ground.traced.terrain_blocks_view', true, 'a fixed world Z'],
  ['ground.grid_fixed_inside_terrain', 0, 'a fixed world Z'],
  ['ground.shots.traced.sha256', '__SAME__', 'the two engine pictures'],
  ['ground.shots.fixed.exists', false, 'the two engine pictures'],
];
for (const [path, value, expectedIn] of mutations) {
  const expectedList = [].concat(expectedIn);
  const expected = expectedList.join('" and "');
  test(`changing ${path} fails "${expected}" and nothing else`, () => {
    const r = good();
    const keys = path.split('.');
    const last = keys.pop();
    const parent = keys.reduce((o, k) => o[k], r);
    parent[last] = value === '__SAME__' ? r.ground.shots.fixed.sha256 : value;
    const names = failing(r);
    assert.ok(names.length >= 1 && names.every((n) => expectedList.some((e) => n.includes(e))), `${path}: failed ${JSON.stringify(names)}`);
    assert.ok(expectedList.every((e) => names.some((n) => n.includes(e))), `${path}: expected ${expected}, failed ${JSON.stringify(names)}`);
  });
}
