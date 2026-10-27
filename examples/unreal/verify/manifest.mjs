// The engine probes and validators the repo runs to re-verify an engine build, in the order verify_all.mjs runs them.
// No dependencies; Node 20.11+. The command lines and the expected counts come from the regression pass that verified the pinned build.
//
// An entry is { name, script, args, class, expect, timeoutMs, needs?, knownFailures? }:
//   name         unique, used by --only and --skip and in the report
//   script       path under examples/unreal; the runner adds --engine <folder> in front of args
//   args         the flags the verified run used. {atlasPng} and {atlasJson} are replaced with a generated stand-in sprite atlas
//                (128 x 160 px, 8 x 10 cells of 16 px, plus Aseprite-style JSON) in a temporary folder
//   class        headless  needs no GPU (-nullrhi, or only a build / commandlet)
//                render    starts a rendering editor or game (offscreen where the probe says so); needs a GPU, with or without a desktop
//                package   builds and packages a game, then runs it
//                owner     needs a person; listed, and run only when named with --class owner or --only
//   expect       { passed, total } the "N of M ... checks passed" summary (all summary lines of a run are added together),
//                { exitOnly: true } the run only has to exit 0, or { note } the same with a sentence the report carries.
//                A partial pass names the checks that fail on the verified build in knownFailures; the runner reports it as
//                "as expected" and fails when the set of failing checks changes.
//   timeoutMs    the run is stopped after this long (a failed run, not a hung one)
//   needs        a short phrase for what the machine must have beyond the engine
const MIN = 60_000;

/** @type {ReadonlyArray<string>} */
export const CLASSES = Object.freeze(['headless', 'render', 'package', 'owner']);

const TOOLCHAIN = 'a C++ toolchain (Visual Studio build tools and a Windows SDK)';
const GPU = 'a GPU';

/** @type {ReadonlyArray<object>} */
export const MANIFEST = Object.freeze([
  // --- headless: no GPU --------------------------------------------------------------------------------------------------------
  { name: 'unity_build_readonly', script: 'unity_build/unity_build.mjs', args: ['--only-readonly'], class: 'headless', expect: { passed: 4, total: 4 }, timeoutMs: 20 * MIN },
  { name: 'unity_build', script: 'unity_build/unity_build.mjs', args: [], class: 'headless', expect: { passed: 11, total: 11 }, timeoutMs: 40 * MIN, needs: TOOLCHAIN },
  { name: 'probe_timeout', script: 'editor_probes/probe_timeout.mjs', args: [], class: 'headless', expect: { passed: 7, total: 7 }, timeoutMs: 20 * MIN },
  { name: 'rp_validate', script: 'rendering_probes/rp_validate.mjs', args: [], class: 'headless', expect: { passed: 3, total: 3 }, timeoutMs: 15 * MIN },
  { name: 'rp_viewport_extras', script: 'rendering_probes/rp_viewport.mjs', args: [], class: 'headless', expect: { passed: 3, total: 3 }, timeoutMs: 15 * MIN },
  { name: 'nts_validate', script: 'niagara_toolsets/nts_validate.mjs', args: [], class: 'headless', expect: { passed: 25, total: 25 }, timeoutMs: 30 * MIN },
  { name: 'nts_validate_author', script: 'niagara_toolsets/nts_validate.mjs', args: ['--only', 'author'], class: 'headless', expect: { note: 'one phase runs and its checks are not judged (they need every group)' }, timeoutMs: 20 * MIN },
  { name: 'nts_probe_renderers', script: 'niagara_toolsets/nts_probe.mjs', args: ['--only', 'renderers'], class: 'headless', expect: { passed: 6, total: 6 }, timeoutMs: 20 * MIN },
  { name: 'nts_probe_gradient', script: 'niagara_toolsets/nts_probe.mjs', args: ['--only', 'gradient'], class: 'headless', expect: { passed: 3, total: 3 }, timeoutMs: 20 * MIN },
  { name: 'automation_reference', script: 'automation_test/automation_reference.mjs', args: [], class: 'headless', expect: { passed: 7, total: 7 }, timeoutMs: 30 * MIN, needs: TOOLCHAIN },
  { name: 'automation_test', script: 'automation_test/automation_test.mjs', args: [], class: 'headless', expect: { passed: 9, total: 9 }, timeoutMs: 40 * MIN, needs: TOOLCHAIN },
  { name: 'insights_stats', script: 'insights_capture/insights_stats.mjs', args: [], class: 'headless', expect: { passed: 8, total: 8 }, timeoutMs: 20 * MIN },
  { name: 'headless_routes', script: 'automation_test/headless_routes.mjs', args: [], class: 'headless', expect: { note: 'prints the headless routes; it has no checks' }, timeoutMs: 5 * MIN },
  { name: 'anim_runtime', script: 'anim_bridge/anim_runtime.mjs', args: [], class: 'headless', expect: { passed: 13, total: 13 }, timeoutMs: 30 * MIN, needs: TOOLCHAIN },
  { name: 'anim_bridge', script: 'anim_bridge/anim_bridge.mjs', args: [], class: 'headless', expect: { passed: 22, total: 22 }, timeoutMs: 40 * MIN, needs: TOOLCHAIN },
  { name: 'chaos_break', script: 'chaos_break/chaos_break.mjs', args: [], class: 'headless', expect: { passed: 11, total: 11 }, timeoutMs: 40 * MIN, needs: TOOLCHAIN },
  { name: 'gameplay_cameras', script: 'gameplay_cameras/gameplay_cameras.mjs', args: [], class: 'headless', expect: { passed: 34, total: 34 }, timeoutMs: 30 * MIN, needs: TOOLCHAIN },
  { name: 'skeletal_materials', script: 'skeletal_materials/skeletal_materials.mjs', args: [], class: 'headless', expect: { passed: 15, total: 15 }, timeoutMs: 30 * MIN, needs: TOOLCHAIN },
  { name: 'statetree_bridge', script: 'statetree_bridge/statetree_bridge.mjs', args: [], class: 'headless', expect: { passed: 21, total: 21 }, timeoutMs: 40 * MIN, needs: TOOLCHAIN },
  { name: 'gas_native', script: 'gas_native/gas_native.mjs', args: [], class: 'headless', expect: { passed: 24, total: 24 }, timeoutMs: 30 * MIN, needs: TOOLCHAIN },
  { name: 'gas_rep', script: 'gas_native/gas_rep.mjs', args: [], class: 'headless', expect: { passed: 10, total: 10 }, timeoutMs: 30 * MIN, needs: TOOLCHAIN },
  { name: 'gas_rep_pie_readback', script: 'gas_native/gas_rep.mjs', args: ['--pie-readback'], class: 'headless', expect: { passed: 11, total: 11 }, timeoutMs: 40 * MIN, needs: TOOLCHAIN },
  { name: 'landscape_bridge', script: 'landscape_bridge/landscape_bridge.mjs', args: [], class: 'headless', expect: { passed: 19, total: 19 }, timeoutMs: 40 * MIN, needs: TOOLCHAIN },
  {
    name: 'landscape_world', script: 'landscape_bridge/landscape_world.mjs', args: [], class: 'headless', expect: { passed: 16, total: 18 }, timeoutMs: 40 * MIN, needs: TOOLCHAIN,
    knownFailures: ['pcg control: the non-partitioned volume generates points', 'pcg partitioned: points are generated across the grid actors'],
  },
  { name: 'epf_validate', script: 'editor_python_friction/epf_validate.mjs', args: [], class: 'headless', expect: { passed: 8, total: 8 }, timeoutMs: 20 * MIN },
  { name: 'constructor_locks', script: 'constructor_locks/constructor_locks.mjs', args: [], class: 'headless', expect: { passed: 11, total: 11 }, timeoutMs: 40 * MIN, needs: TOOLCHAIN },

  // --- render: a rendering editor or game -------------------------------------------------------------------------------------------
  { name: 'nts_probe_emit', script: 'niagara_toolsets/nts_probe.mjs', args: ['--only', 'emit'], class: 'render', expect: { passed: 8, total: 8 }, timeoutMs: 30 * MIN, needs: GPU },
  {
    name: 'nts_probe_frame', script: 'niagara_toolsets/nts_probe.mjs', args: ['--only', 'frame'], class: 'render', expect: { passed: 3, total: 5 }, timeoutMs: 30 * MIN, needs: GPU,
    knownFailures: ['the sprite SubImageIndex follows the user parameter', 'screenshots at the two values show different cells'],
  },
  {
    name: 'nts_probe_wire', script: 'niagara_toolsets/nts_probe.mjs', args: ['--only', 'wire', '--glb', 'builtin', '--atlas-png', '{atlasPng}', '--atlas-json', '{atlasJson}'], class: 'render', expect: { passed: 7, total: 8 }, timeoutMs: 30 * MIN, needs: GPU,
    knownFailures: ['a Static Mesh user parameter is added and the runtime override call runs'],
  },
  { name: 'rp_rt_validate', script: 'rendering_probes/rp_rt_validate.mjs', args: ['--offscreen'], class: 'render', expect: { passed: 8, total: 8 }, timeoutMs: 40 * MIN, needs: GPU },
  {
    name: 'rp_viewport_offscreen', script: 'rendering_probes/rp_viewport.mjs', args: ['--offscreen', '--keep'], class: 'render', timeoutMs: 40 * MIN, needs: GPU,
    expect: { note: 'saves eight screenshots and exits 0; the checks need an agent to read the images into observations.json and run rp_viewport.mjs --judge' },
  },
  { name: 'chaos_break_render', script: 'chaos_break/chaos_break.mjs', args: ['--material', 'project', '--render'], class: 'render', expect: { passed: 11, total: 11 }, timeoutMs: 40 * MIN, needs: `${GPU} and ${TOOLCHAIN}` },
  { name: 'skeletal_materials_rendering', script: 'skeletal_materials/skeletal_materials.mjs', args: ['--rendering'], class: 'render', expect: { passed: 15, total: 15 }, timeoutMs: 40 * MIN, needs: `${GPU} and ${TOOLCHAIN}` },
  { name: 'landscape_world_rendering', script: 'landscape_bridge/landscape_world.mjs', args: ['--rendering'], class: 'render', expect: { passed: 18, total: 18 }, timeoutMs: 60 * MIN, needs: `${GPU} and ${TOOLCHAIN}` },
  { name: 'ep_validate', script: 'editor_python/ep_validate.mjs', args: [], class: 'render', expect: { passed: 21, total: 21 }, timeoutMs: 40 * MIN, needs: GPU },
  { name: 'niagara_validate', script: 'niagara_validate.mjs', args: [], class: 'render', expect: { passed: 15, total: 15 }, timeoutMs: 40 * MIN, needs: GPU },
  { name: 'pcg_validate', script: 'pcg_game/pcg_validate.mjs', args: [], class: 'render', expect: { passed: 18, total: 18 }, timeoutMs: 60 * MIN, needs: GPU },
  { name: 'stylized_validate', script: 'stylized/stylized_validate.mjs', args: [], class: 'render', expect: { passed: 17, total: 17 }, timeoutMs: 60 * MIN, needs: GPU },
  { name: 'world_validate', script: 'world/world_validate.mjs', args: [], class: 'render', expect: { passed: 30, total: 30 }, timeoutMs: 90 * MIN, needs: GPU },

  // --- package: builds, cooks and packages a game, then runs it ---------------------------------------------------------------------
  { name: 'compare_gpu_run', script: 'compare-scene/compare_gpu_run.mjs', args: [], class: 'package', expect: { passed: 11, total: 11 }, timeoutMs: 60 * MIN, needs: `${GPU} and ${TOOLCHAIN}` },
  { name: 'pcg_packaged', script: 'pcg_packaged/pcg_packaged.mjs', args: [], class: 'package', expect: { passed: 63, total: 63 }, timeoutMs: 90 * MIN, needs: `${GPU} and ${TOOLCHAIN}` },

  // --- owner: needs a person --------------------------------------------------------------------------------------------------------
  {
    name: 'rp_rt_toggle_prepare', script: 'rendering_probes/rp_rt_validate.mjs', args: ['--phase', 'toggle-prepare'], class: 'owner', timeoutMs: 20 * MIN, needs: 'a person to flip the ray tracing setting in Project Settings',
    expect: { note: 'makes a project and saves the settings before the toggle; a person flips the setting, then rp_rt_toggle_judge runs' },
  },
  {
    name: 'rp_rt_toggle_judge', script: 'rendering_probes/rp_rt_validate.mjs', args: ['--phase', 'toggle-judge', '--project', '<the folder rp_rt_toggle_prepare printed>'], class: 'owner', timeoutMs: 10 * MIN, needs: 'the project folder from rp_rt_toggle_prepare, after the toggle',
    expect: { note: 'judges the settings file after the toggle' },
  },
  {
    name: 'rp_viewport_interactive', script: 'rendering_probes/rp_viewport.mjs', args: ['--interactive'], class: 'owner', timeoutMs: 30 * MIN, needs: 'a person watching the editor viewport',
    expect: { note: 'a person notes whether the renderer message is on screen in each phase, then runs rp_viewport.mjs --judge' },
  },
]);
