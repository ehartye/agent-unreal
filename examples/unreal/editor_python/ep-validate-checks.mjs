// Pure checks for ep_validate.mjs: turn the JSON reports and log text of the editor Python scripts into pass or fail results, one per
// claim in skills/unreal-features/references/unreal-editor-python.md and unreal-geometry-scripting.md. No Unreal, no files:
// ep-validate.test.mjs feeds it canned reports, and ep_validate.mjs feeds it real ones.

const has = (text, pattern) => pattern.test(String(text || ''));
const near = (a, b, tol = 1e-3) => typeof a === 'number' && Math.abs(a - b) <= tol;

/**
 * @param {object} r reports: probe (ep_probe.py), probeLog, stages (ep_stages.py), stagesLog, flags (ep_flags.py), ground (ep_ground.py)
 * @returns {{ name: string, claim: string, pass: boolean, detail: string }[]}
 */
export function evaluate(r) {
  const probe = r.probe || {}, stages = r.stages || {}, flags = (r.flags || {}).flags || {}, ground = r.ground || {};
  const rc = probe.recreate || {}, names = probe.names || {}, look = probe.look || {}, geo = probe.geometry || {}, inst = probe.instancing || {};
  const out = [];
  const check = (name, claim, pass, detail = '') => out.push({ name, claim, pass: Boolean(pass), detail: String(detail) });

  // 1 recreate a map that exists on disk
  check('delete_asset on a loaded level keeps the map and new_level then fails',
    'delete_asset on the open level returns False and leaves the .umap; new_level fails with "An asset already exists at this location"',
    rc.naive_delete_asset === false && rc.on_disk_after_naive_delete === true && rc.naive_new_level === false
      && has(r.probeLog, /LevelEditorSubsystem: Error: NewLevel\. Failed to validate the destination\. An asset already exists at this location\./),
    `delete_asset ${rc.naive_delete_asset}, on disk ${rc.on_disk_after_naive_delete}, new_level ${rc.naive_new_level}`);
  check('the working order is neutral map, delete, remove the file, rescan, create',
    'After leaving the level delete_asset returns True but the file stays and new_level still fails; it works only after the file is removed and the folder rescanned',
    rc.neutral_world === '/Engine/Maps/Entry.Entry' && rc.neutral_delete_asset === true && rc.on_disk_after_neutral_delete === true
      && rc.new_level_with_file_on_disk === false && rc.new_level_before_rescan === false && rc.new_level_after_rescan === true
      && rc.world_after_rescan === '/Game/Maps/EpRebuild.EpRebuild',
    `neutral delete ${rc.neutral_delete_asset}, file kept ${rc.on_disk_after_neutral_delete}, before rescan ${rc.new_level_before_rescan}, after rescan ${rc.new_level_after_rescan}`);
  check('recreate_map creates the level over a map that is on disk, twice',
    'The helper runs that order and returns True for a loaded level that is saved on disk',
    rc.helper_created === true && rc.helper_on_disk === true && rc.helper_created_again === true && rc.helper_world === '/Game/Maps/EpRebuild.EpRebuild'
      && (stages.map || {}).first === true && (stages.map || {}).second === true && (stages.map || {}).on_disk === true,
    `helper ${rc.helper_created}/${rc.helper_created_again}, rendering editor ${(stages.map || {}).first}/${(stages.map || {}).second}`);

  // 2 property names
  const bad = (text, cls, prop) => has(text, new RegExp(`${cls}: Failed to find property '${prop}' for attribute '${prop}' on '${cls}'`));
  check('guessed property names fail with the class and the name in the error',
    'enable_volumetric_fog fails on PostProcessVolume, volumetric_fog and fog_inscattering_color fail on the fog component, fog_density fails on the fog actor',
    bad(names.wrong_on_volume_enable_volumetric_fog, 'PostProcessVolume', 'enable_volumetric_fog') && bad(names.wrong_on_volume_bloom, 'PostProcessVolume', 'bloom')
      && bad(names.wrong_on_fog_component_volumetric_fog, 'ExponentialHeightFogComponent', 'volumetric_fog')
      && bad(names.wrong_on_fog_component_inscattering_color, 'ExponentialHeightFogComponent', 'fog_inscattering_color')
      && bad(names.wrong_on_fog_actor_density, 'ExponentialHeightFog', 'fog_density'),
    JSON.stringify([names.wrong_on_volume_enable_volumetric_fog, names.wrong_on_fog_component_volumetric_fog]));
  const right = names.right_on_fog_component || {};
  check('the working names are on the component and the settings struct, and a probe lists them',
    'The fog component takes enable_volumetric_fog, fog_inscattering_luminance and fog_density; PostProcessSettings has bloom_intensity and override_bloom_intensity; dir() finds them',
    right.enable_volumetric_fog === null && right.fog_inscattering_luminance === null && right.fog_density === null
      && (names.fog_readback || {}).enable_volumetric_fog === true && near((names.fog_readback || {}).fog_density, 0.03)
      && (names.probe_fog_volumetric || []).includes('enable_volumetric_fog')
      && (names.probe_settings_bloom_intensity || []).join() === 'bloom_intensity,override_bloom_intensity'
      && (names.probe_settings_auto_exposure_min || []).join() === 'auto_exposure_min_brightness,override_auto_exposure_min_brightness',
    JSON.stringify(names.probe_settings_bloom_intensity));
  const soft = names.soft_set || {};
  check('soft_set records a warning for a wrong name and sets a right one',
    'A wrong name returns False and appends one warning line; the right name returns True and the value reads back',
    soft.wrong_name_returned === false && soft.wrong_struct_name_returned === false && soft.right_name_returned === true
      && (soft.warnings || []).length === 2 && has((soft.warnings || [])[0], /^PostProcessVolume\.enable_volumetric_fog: /) && near(soft.bloom_intensity_readback, 3.0) && soft.override_readback === true,
    JSON.stringify(soft.warnings));
  check('a property that is not listed by dir() is still reached by name',
    'MaterialExpressionCustom.code is absent from dir() but set_editor_property("code") sets and get_editor_property reads it',
    names.custom_code_in_dir === false && names.custom_code_readback === 'return 1;', `in dir ${names.custom_code_in_dir}, readback ${names.custom_code_readback}`);

  // 3 rotation
  check('Vector has no rotation() and make_rot_from_x faces a direction',
    'unreal.Vector(...).rotation() raises AttributeError; MathLibrary.make_rot_from_x(direction) equals Vector.rotator() and a camera built with it faces the target (forward dot direction 1)',
    has((look.rotation_call || {}).error, /'Vector' object has no attribute 'rotation'/) && look.same_as_rotator_method === true && near(look.forward_dot_direction, 1, 1e-4)
      && near((stages.camera || {}).forward_dot_target, 1, 1e-4),
    `dot ${look.forward_dot_direction}, scene camera dot ${(stages.camera || {}).forward_dot_target}`);

  // 4 stage runner
  const shot = stages.screenshot || {}, play = stages.play || {}, mats = stages.materials || {};
  check('the stage runner waits ticks and sees results that arrive on later ticks',
    'yield 5 waits five ticks; a high-resolution screenshot file does not exist on the tick of the call and appears within a few ticks; the Play-In-Editor world appears on a later tick',
    (stages.ticks || {}).frames_for_yield_5 === 5 && shot.exists_same_tick === false && shot.ticks_waited >= 1 && shot.exists_after === true
      && play.world_same_tick === false && play.ticks_waited >= 1 && has(play.world, /UEDPIE_0_EpScene/) && stages.error === null,
    `frames ${(stages.ticks || {}).frames_for_yield_5}, screenshot after ${shot.ticks_waited} ticks, play world after ${play.ticks_waited} ticks`);
  check('Slate ticks again inside long editor calls, so the runner needs a busy guard',
    'run_stages counted tick callbacks that arrived while the generator was running (asset creation, material compile) and skipped them',
    stages.reentered_ticks_skipped > 0, `skipped ${stages.reentered_ticks_skipped}`);
  check('recompile_material returns with the shader compile finished',
    'get_statistics on the same tick reports the pixel shader instruction count of the compiled material, so a script need not wait ticks for it',
    (mats.macro || {}).pixel_instructions_same_tick > 0, `${(mats.macro || {}).pixel_instructions_same_tick} instructions`);

  // 5 geometry
  const empty = geo['cut z=150 flip=True'] || {}, emptyLow = geo['cut z=-150 flip=False'] || {}, keep = geo['cut z=-30 flip=True'] || {}, below = geo['cut z=-30 flip=False'] || {};
  check('a plane cut that misses the mesh on the kept side leaves an empty mesh',
    'Cut at z = 150 with flip_cut_side True (or z = -150 with False) leaves 0 triangles and 0 vertices; get_num_triangle_i_ds still reports the old 448; create_new_static_mesh_asset_from_mesh returns None and FAILURE',
    empty.triangles === 0 && empty.vertices === 0 && empty.num_triangle_ids === 448 && emptyLow.triangles === 0 && emptyLow.vertices === 0
      && (geo.create_from_empty_cut || {}).asset === null && has((geo.create_from_empty_cut || {}).outcome, /FAILURE/) && (geo.create_from_empty_mesh || {}).asset === null,
    `triangles ${empty.triangles}, vertices ${empty.vertices}, ids ${empty.num_triangle_ids}, create ${(geo.create_from_empty_cut || {}).outcome}`);
  check('flip_cut_side chooses the kept side',
    'A cut at z = -30 keeps the part above the plane with flip_cut_side True (min z -30, 318 triangles) and the part below with False (254 triangles); the sphere has 448',
    (geo.sphere || {}).triangles === 448 && keep.triangles === 318 && below.triangles === 254 && (geo.boulder_base_plane_cut || {}).bounds_min_z === -30,
    `above ${keep.triangles}, below ${below.triangles}`);
  const ok = (m) => m && m.triangles > 0 && m.asset && has(m.outcome, /SUCCESS/);
  check('a Boolean subtract and a noise-displaced sphere make the same prop and create an asset',
    'Subtracting a box gives a flat base (min z -30, 318 triangles); a Perlin-displaced 8-step sphere has 96 triangles; both create a Static Mesh asset',
    ok(geo.boulder_base_boolean) && geo.boulder_base_boolean.bounds_min_z === -30 && geo.boulder_base_boolean.triangles === 318 && ok(geo.boulder_noise) && geo.boulder_noise.triangles === 96
      && (geo.boulder_noise.warnings || []).length === 0 && (geo.noise_layer_fields || []).join() === 'frequency,frequency_shift,magnitude,random_seed',
    `boolean ${(geo.boulder_base_boolean || {}).triangles}, noise ${(geo.boulder_noise || {}).triangles}`);
  check('the scene rock is checked before its asset is made',
    'The scene builds its rock with a noise sphere and a plane cut, counts triangles (above 0) and creates the asset with SUCCESS',
    (stages.rock || {}).triangles > 0 && (stages.rock || {}).min_z === -60 && has((stages.rock || {}).outcome, /SUCCESS/), JSON.stringify(stages.rock));

  // 6 materials
  check('a Custom node body takes a #define macro and rejects a helper function',
    'The macro body compiles (pixel instructions above 0); the function body does not (0) and the log says "function definition is not allowed here" and that the default material will be used',
    (mats.macro || {}).pixel_instructions_same_tick > 0 && (mats.function || {}).pixel_instructions_same_tick === 0
      && has(r.stagesLog, /function definition is not allowed here/) && has(r.stagesLog, /Failed to compile Material \/Game\/Mat\/M_EpRockBad\.M_EpRockBad/)
      && has(r.stagesLog, /Default Material will be used in game/),
    `macro ${(mats.macro || {}).pixel_instructions_same_tick}, function ${(mats.function || {}).pixel_instructions_same_tick}`);
  check('the instancing flag is false on a new material and one helper sets it for a list',
    'used_with_instanced_static_meshes is False on a Python-made material; allow_instancing sets it on every material in a list (and none twice); the flag reads back',
    mats.flag_default === false && (mats.changed || []).length === 2 && mats.flag_after === true && mats.flag_on_unlisted === false
      && inst.default_flag === false && (inst.helper_changed || []).join() === 'M_EpCmdFlagged' && (inst.helper_again_changed || []).length === 0 && inst.library_usage_flag === true,
    `changed ${(mats.changed || []).length}, unlisted ${mats.flag_on_unlisted}`);
  check('without a render the saved flag stays false; a rendering editor sets it when it draws instances',
    'In a commandlet an instanced mesh component with the material does not set the flag and the saved asset reads False; the helper-set material reads True; in the rendering editor the unflagged material is True after instances were drawn',
    inst.plain_flag_after_instances === false && inst.flagged_flag_after_instances === true && flags.M_EpCmdPlain === false && flags.M_EpCmdFlagged === true
      && (stages.field || {}).unflagged_flag_after_set_material === false && (stages.flag_after_render || {}).unflagged === true && flags.M_EpRockAuto === true,
    JSON.stringify(flags));

  // 7 ground
  const fixed = ground.fixed || {}, traced = ground.traced || {}, shots = ground.shots || {};
  check('a line trace finds the ground height on the template Landscape',
    'On the Open World template Landscape every trace on an 81-point grid hits, and place_above_ground returns a point 200 cm above the hit at every point',
    ground.ground_ready === true && ground.grid_hits === 81 && ground.grid_total === 81 && ground.grid_traced_height_ok === true && traced.height_above_ground === 200,
    `hits ${ground.grid_hits}/${ground.grid_total}`);
  check('a fixed world Z puts the camera under the terrain; the traced Z does not',
    'At the highest grid point a camera at the lowest height plus 200 cm is below the ground and terrain blocks its line to the target; the traced camera is above the ground and its line is clear; some grid points have the fixed Z under the ground',
    fixed.inside_terrain === true && fixed.terrain_blocks_view === true && traced.inside_terrain === false && traced.terrain_blocks_view === false && ground.grid_fixed_inside_terrain > 0,
    `fixed under ground ${fixed.inside_terrain}, blocked ${fixed.terrain_blocks_view}; traced blocked ${traced.terrain_blocks_view}; ${ground.grid_fixed_inside_terrain} of ${ground.grid_total} points under`);
  check('the two engine pictures exist and differ',
    'SceneCapture2D exports one PNG per camera; the pictures are not identical',
    shots.fixed && shots.traced && shots.fixed.exists === true && shots.traced.exists === true && shots.fixed.sha256 && shots.fixed.sha256 !== shots.traced.sha256 && ground.error === null,
    `fixed ${(shots.fixed || {}).sha256 ? 'hashed' : 'missing'}, traced ${(shots.traced || {}).sha256 ? 'hashed' : 'missing'}`);
  return out;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}
