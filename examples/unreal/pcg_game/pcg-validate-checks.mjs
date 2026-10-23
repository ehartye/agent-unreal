// Pure checks for pcg_validate.mjs: turns the JSON reports, log lines and file sizes of the PCG game-process scripts into pass or fail
// results, one per claim in skills/unreal-procedural/references/unreal-pcg-game-process.md. No Unreal, no files: pcg-validate.test.mjs feeds it
// canned reports and pcg_validate.mjs feeds it real ones.

const has = (text, needle) => String(text || '').includes(needle);
const num = (v) => (typeof v === 'number' ? v : NaN);
const spread = (s) => (s && typeof s.p90 === 'number' ? s.p90 - s.p10 : NaN);

// The engine texts the guidance quotes, so an agent can match them in a log.
export const TEXT = {
  noWorldActor: 'Landscape data is unable to access the landscape cache (Note: Will happen if there is no PCG world actor.',
  notSerialized: 'PCG Landscape cache (on the PCG World Actor) is not set to be serialized and will not work in non-editor modes.',
  missingFlag: 'Material /Game/Pcg/M_Unflagged.M_Unflagged missing usage flag InstancedStaticMeshes! Default Material will be used in game.',
  autoFlag: 'Material /Game/Pcg/M_Auto.M_Auto needed to set usage flag InstancedStaticMeshes',
  readOnly: "Property 'MeshSelectorParameters' for attribute 'mesh_selector_parameters' on 'PCGStaticMeshSpawnerSettings' is read-only and cannot be set",
  protectedRead: "Property 'bUseSeed' for attribute 'use_seed' on 'PCGStaticMeshSpawnerSettings' is protected and cannot be read",
  protectedSet: "Property 'bUseSeed' for attribute 'use_seed' on 'PCGStaticMeshSpawnerSettings' is protected and cannot be set",
  boolFromFloat: "Cannot nativize 'float' as 'bTiling' (BoolProperty)",
};

/**
 * @param {object} r the reports: maps, build, exp, asyncSame, asyncStaged, asyncExec {exit, reportExists}, flag {report, log},
 *   games {noworld, spawned, off, modeonly, on} each {report, log}, sizes {nw, sp, off, mode, on} (bytes), shot {red_left, red_right, green}
 * @returns {{ name: string, claim: string, pass: boolean, detail: string }[]}
 */
export function evaluate(r) {
  const maps = r.maps || {}, build = r.build || {}, exp = r.exp || {}, g = r.games || {}, sizes = r.sizes || {};
  const game = (k) => (g[k] && g[k].report) || {};
  const glog = (k) => (g[k] && g[k].log) || '';
  const sp = exp.mesh_selector || {}, ns = exp.noise_scale || {}, attr = exp.attr_noise || {}, chain = exp.edge_chain || {};
  const flags = exp.noise_flags || {}, thresh = exp.noise_threshold || {};
  const out = [];
  const check = (name, claim, pass, detail = '') => out.push({ name, claim, pass: Boolean(pass), detail: String(detail) });
  const bm = build.maps || {};

  check('a small Landscape map is the starting point',
    'Python cannot create a Landscape, so a map copy that already has one is the base; the Water sample map has one Landscape',
    maps.loaded === true && maps.saved === true && Array.isArray(maps.landscapes) && maps.landscapes.length === 1 && maps.landscapes[0].class === 'Landscape',
    JSON.stringify(maps.landscapes));

  check('without a PCGWorldActor a game process cannot reach the Landscape cache',
    'Get Landscape Data logs the "unable to access the landscape cache" text and the sampler produces no instances',
    bm.nw && bm.nw.world_actors_in_map === 0 && game('noworld').pcg_world_actors === 0 && game('noworld').total_instances === 0
      && has(glog('noworld'), TEXT.noWorldActor) && !has(glog('noworld'), TEXT.notSerialized),
    `world actors ${game('noworld').pcg_world_actors}, instances ${game('noworld').total_instances}`);

  check('the editor adds a PCGWorldActor itself when it generates; Python can spawn one, and a game process then finds it',
    'After a generation the map holds one PCGWorldActor; one spawned from Python is found in the game process, where the error changes to the not-serialized text',
    bm.off && bm.off.world_actors_before === 0 && bm.off.world_actors_after_generation === 1 && bm.sp && bm.sp.world_actors_in_map === 1
      && game('spawned').pcg_world_actors === 1 && has(glog('spawned'), TEXT.notSerialized) && !has(glog('spawned'), TEXT.noWorldActor),
    `after generation ${bm.off && bm.off.world_actors_after_generation}, spawned map game actors ${game('spawned').pcg_world_actors}`);

  const spawnedBuild = build.python_spawned_then_build || {};
  check('after a Python spawn, pcg.BuildLandscapeCache in the editor leaves two PCGWorldActors',
    'A PCGWorldActor spawned from Python, then the console command, gives two actors in the editor world; the maps built from the actor an editor generation creates hold one',
    spawnedBuild.actors_after_spawn === 1 && spawnedBuild.actors_after_build_command === 2 && bm.on && bm.on.world_actors_in_map === 1,
    `after spawn ${spawnedBuild.actors_after_spawn}, after the command ${spawnedBuild.actors_after_build_command}`);

  check('a PCGWorldActor with the default cache mode logs the not-serialized error and spawns nothing',
    'The cache serialization_mode defaults to NEVER_SERIALIZE; a game process then logs the not-serialized text and generates no instances',
    /NEVER_SERIALIZE/.test(String(bm.off && bm.off.default_mode)) && /NEVER_SERIALIZE/.test(String(bm.sp && bm.sp.default_mode))
      && /NEVER_SERIALIZE/.test(String(game('off').cache_mode)) && game('off').total_instances === 0 && game('spawned').total_instances === 0
      && has(glog('off'), TEXT.notSerialized),
    `default ${bm.off && bm.off.default_mode}, instances ${game('off').total_instances}`);

  const onVols = Object.values(game('on').volumes || {}), modeVols = Object.values(game('modeonly').volumes || {});
  check('serialization_mode ALWAYS_SERIALIZE lets the game process generate',
    'With the mode set to ALWAYS_SERIALIZE both volumes spawn instances in the game process and neither Landscape cache error is logged',
    /ALWAYS_SERIALIZE/.test(String(game('on').cache_mode)) && onVols.length === 2 && onVols.every((v) => v.completed && v.instances > 0)
      && modeVols.length === 2 && modeVols.every((v) => v.completed && v.instances > 0)
      && !has(glog('on'), TEXT.notSerialized) && !has(glog('on'), TEXT.noWorldActor) && !has(glog('modeonly'), TEXT.notSerialized),
    `built cache: ${onVols.map((v) => v.instances)}, mode only: ${modeVols.map((v) => v.instances)}`);

  const grew = num(sizes.on) - num(sizes.mode), modeOnlyGrowth = num(sizes.mode) - num(sizes.off);
  check('building the cache adds its data to the saved map; the mode alone does not',
    'pcg.BuildLandscapeCache with ALWAYS_SERIALIZE makes the saved map several megabytes larger; setting the mode alone leaves the file size about the same',
    bm.on && bm.on.cache_entry_count > 0 && bm.mode && bm.mode.cache_entry_count === 0 && grew > 2_000_000 && Math.abs(modeOnlyGrowth) < 20_000,
    `built ${sizes.on} bytes, mode only ${sizes.mode}, default ${sizes.off}, growth ${grew}`);

  check('Static Mesh Spawner: Python accepts the selector edit and the seed, and refuses the rest with these messages',
    'mesh_selector_parameters is read-only, use_seed is protected, seed is accepted; set_mesh_selector_type then an in-place entry edit spawns the mesh',
    has(sp.set_mesh_selector_parameters, TEXT.readOnly) && has(sp.read_use_seed, TEXT.protectedRead) && has(sp.set_use_seed, TEXT.protectedSet)
      && sp.set_seed === 'ok' && sp.entries === 1 && exp.baseline && exp.baseline.completed && exp.baseline.instances > 1000 && exp.baseline.instances === exp.baseline.points,
    `baseline instances ${exp.baseline && exp.baseline.instances}`);

  const shot = r.shot || {};
  const matOn = game('on').materials || {};
  check('instances with a material that lacks used_with_instanced_static_meshes render with the default material in a game process',
    'In the engine screenshot the flagged material draws its colour and the unflagged one draws none; the log says the default material will be used; the editor sets the flag itself',
    matOn.M_Flagged === true && matOn.M_Unflagged === false && game('on').screenshot_written === true
      && shot.red_right > 5000 && shot.red_left < 100 && shot.green < 100
      && has(glog('on'), TEXT.missingFlag) && !has(glog('on'), 'M_Flagged.M_Flagged missing usage flag')
      && r.flag && r.flag.report && r.flag.report.flag_before_use === false && r.flag.report.flag_set_by_editor === true && has(r.flag.log, TEXT.autoFlag),
    `red pixels left ${shot.red_left}, right ${shot.red_right}, green ${shot.green}`);

  const s1 = ns['1.0'] || {}, s04 = ns['0.4'] || {}, s15 = ns['1.5'] || {}, s5 = ns['5.0'] || {}, tiny = ns['5e-5'] || {};
  const range = (s) => (s.correlation ? s.correlation.range_m : NaN);
  check('Spatial Noise: the correlation range tracks 100 m divided by the transform scale, and a tiny scale gives one value',
    'The range over which noise values stay correlated is about 95 m at scale 1 and grows as the scale falls (75 m at 1.5, 25 m at 5); scale 5e-5 gives one value',
    range(s04) > range(s1) && range(s1) > range(s15) && range(s15) > range(s5) && range(s1) >= 80 && range(s1) <= 115 && range(s04) >= 120
      && tiny.points > 1000 && tiny.max - tiny.min < 0.001,
    `range at 0.4 ${range(s04)}, 1.0 ${range(s1)}, 1.5 ${range(s15)}, 5.0 ${range(s5)} m; 5e-5 spread ${tiny.max - tiny.min}`);

  check('Spatial Noise: Perlin values sit in a narrow band, contrast widens it, and a Density Filter at a fixed threshold is all or nothing for a constant',
    'At scale 1 the 10th to 90th percentile spans about 0.35; contrast 6 spans nearly 0 to 1; a 0.6 filter removes every point of the near-constant noise and keeps some of the normal noise',
    spread(s1) > 0.25 && spread(s1) < 0.45 && s1.min > 0.05 && s1.max < 0.95 && spread(flags.contrast6_stats) > 0.9 && flags.contrast6_stats.min <= 0.01 && flags.contrast6_stats.max >= 0.99
      && thresh['const_5e-5'] && thresh['const_5e-5'].instances === 0 && thresh.perlin_1_0 && thresh.perlin_1_0.instances > 100 && thresh.perlin_1_0.instances < thresh.perlin_1_0.of,
    `scale 1 spread ${spread(s1).toFixed(3)}, contrast 6 spread ${spread(flags.contrast6_stats).toFixed(3)}, const kept ${thresh['const_5e-5'] && thresh['const_5e-5'].instances}`);

  check('Spatial Noise tiling is a bool',
    'tiling reads back as a Python bool, and a float is refused with the nativize message',
    flags['tiling=True'] === 'ok' && flags.tiling_type === 'bool' && has(flags['tiling=5.0'], TEXT.boolFromFloat),
    String(flags.tiling_type));

  check('Attribute Noise defaults to Set, which overwrites upstream density; Multiply thins',
    'Default mode SET; after a noise-driven density and a 0.5 Density Filter about half of the points survive with Set and under a fifth with Multiply',
    /SET/.test(String(attr.default_mode)) && attr.set && attr.multiply && attr.sampler_points > 1000
      && attr.set.instances > 0.35 * attr.sampler_points && attr.set.instances < 0.6 * attr.sampler_points && attr.multiply.instances < 0.2 * attr.sampler_points && attr.multiply.instances > 0,
    `of ${attr.sampler_points}: Set ${attr.set && attr.set.instances}, Multiply ${attr.multiply && attr.multiply.instances}`);

  const c = (k) => chain[k] || {};
  check('Edge Mask then Attribute Noise MULTIPLY then Density Filter works on a Landscape-wide volume',
    'On a volume over the whole 510 m Landscape the chain spawns instances, as do the Edge Mask with the filter and Perlin with Multiply',
    c('edge_multiply_filter').instances > 100 && c('edge_filter').instances > 100 && c('perlin_multiply_filter').instances > 0 && c('edge').stats && c('edge').stats.max > 0.99,
    `chain ${c('edge_multiply_filter').instances}, edge+filter ${c('edge_filter').instances}`);

  check('on a 40 m volume the Edge Mask never reaches 0.5, so any 0.5 filter empties the output, with or without Attribute Noise',
    'The Edge Mask density on a 40 m volume peaks near 0.2 (blend distance 1.0 is 100 m at scale 1); a 0.5 filter after it, or after the Multiply, leaves no points; blend distance 0.1 or transform scale 10 fixes it',
    c('small_sampler').stats && c('small_sampler').stats.points > 500 && c('small_edge').stats.max < 0.25 && c('small_edge_filter').stats.points === 0
      && c('small_edge_multiply_filter').stats.points === 0 && c('small_edge_blend10m_multiply_filter').instances > 50 && c('small_edge_scale10_multiply_filter').instances > 50,
    `edge max ${c('small_edge').stats && c('small_edge').stats.max}, fixed ${c('small_edge_blend10m_multiply_filter').instances}/${c('small_edge_scale10_multiply_filter').instances}`);

  const cv = exp.cvars || {};
  check('the runtime-generation and frame-time console variables have these 5.8.2 defaults',
    'Runtime generation on, pooling on, pool 100, 16 generating components, debugging off, radius multiplier 1, pcg.FrameTime 5 ms, pcg.EditorFrameTime 15 ms',
    cv['pcg.RuntimeGeneration.Enable'] === 1 && cv['pcg.RuntimeGeneration.EnablePooling'] === 1 && cv['pcg.RuntimeGeneration.BasePoolSize'] === 100
      && cv['pcg.RuntimeGeneration.NumGeneratingComponents'] === 16 && cv['pcg.RuntimeGeneration.EnableDebugging'] === 0
      && cv['pcg.RuntimeGeneration.GlobalRadiusMultiplier'] === 1 && cv['pcg.FrameTime'] === 5 && cv['pcg.EditorFrameTime'] === 15,
    JSON.stringify(cv));

  const same = r.asyncSame || {}, staged = r.asyncStaged || {}, exec = r.asyncExec || {};
  check('generate() is asynchronous: saving in the same tick saves nothing, saving after the generated event saves the instances',
    'Same tick: no instances at generate(), none at save, some later, none in the reloaded map. Staged: the saved map holds the generated instances',
    same.instances_right_after_generate === 0 && same.instances_when_saved === 0 && same.saved === true && same.instances_after_generation_finished > 0 && same.instances_in_saved_map === 0
      && staged.instances_right_after_generate === 0 && staged.instances_when_saved > 0 && staged.saved === true && staged.instances_in_saved_map === staged.instances_when_saved,
    `same tick saved map ${same.instances_in_saved_map}, staged ${staged.instances_in_saved_map}`);

  check('-ExecutePythonScript quits before a tick callback runs',
    'A script that registers a Slate post-tick callback and is run with -ExecutePythonScript never writes the callback report',
    exec.exit === 0 && exec.reportExists === false, `exit ${exec.exit}, report written ${exec.reportExists}`);

  return out;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}
