// Pure checks and options of the MetaHuman probe (mh_probe.mjs). Prepared 2026-10-29; four engine runs the same day (README.md) produced the report shapes of every stage and
// the captured frames. No Unreal, no files: mh-probe.test.mjs feeds it canned reports, and mh_probe.mjs feeds it the real ones that mh_probe_editor.py writes. The names mode
// (evaluateNames) was run headless on 2026-10-29. Still an assumption: the failure shapes no run produced (a timed-out repeat launch, the `Shot` console fallback, the Cine pipeline succeeding).

export const GROUPS = ['create', 'assemble', 'drive', 'repeat'];
export const PHASES = ['run', 'prepare', 'judge'];
export const USAGE = 'usage: node mh_probe.mjs --engine <UE_5.8 folder> [--phase run|prepare|judge] [--only create,assemble,drive,repeat] [--keep] [--plan] [--names]\n'
  + '       [--project <folder>] [--out <folder>] [--preset <name>] [--camera-flip] [--timeout-minutes <n>] [--skip-core-data-check]\n'
  + `   groups: ${GROUPS.join(', ')}   (no --only: every group)   judge needs only --project`;

/** The face pose targets: control curve names from the MetaHuman rig (the curves of the installed face control board and ARKit mapping assets), written at time 0 of one sequence per pose. */
export const POSES = [
  { name: 'neutral', curves: { CTRL_expressions_jawOpen: 0.0 } },
  { name: 'jaw_open', curves: { CTRL_expressions_jawOpen: 1.0 } },
  { name: 'smile', curves: { CTRL_expressions_mouthCornerPullL: 1.0, CTRL_expressions_mouthCornerPullR: 1.0, CTRL_expressions_mouthCornerUpL: 0.5, CTRL_expressions_mouthCornerUpR: 0.5 } },
];
/** The part of the frame the camera frames on the face, as fractions of width and height. */
export const FACE_REGION = { x: 0.3, y: 0.1, w: 0.4, h: 0.8 };
/** The build attempts, in order. The first build attempt failed with the Control Rig "Cannot break link" error in three runs (run 2 Cinematic after 250 s, run 3 Optimized after 126 s, run 4 Optimized after 110.7 s)
 *  and a retry built in the two runs where one was made (run 2 Optimized after Cinematic, 108 s; run 4 Optimized after Optimized, 64.5 s). Why is not established. So: attempt 1 is optimized, attempt 2 is
 *  optimized again but only after that error, attempt 3 is the Cine pipeline. A success stops the sequence. */
export const RETRY_ERROR = 'Cannot break link';
export const PIPELINES = [
  { pipeline: 'OPTIMIZED', quality: 'MEDIUM' },
  { pipeline: 'OPTIMIZED', quality: 'MEDIUM', retry_after: RETRY_ERROR },
  { pipeline: 'CINEMATIC', quality: 'CINEMATIC' },
];
export const PIPELINE_ORDER_REASON = 'optimized first (in run 2 the Cine pipeline lost 250 s to a Control Rig "Cannot break link" error and the optimized pipeline built in 108 s after it); optimized again after that error (in runs 3 and 4 an optimized first attempt failed the same way, and in run 4 the second attempt built); the Cine pipeline last';
/** The project settings Epic lists for MetaHumans (Requirements and Configuration Settings page); they need an editor restart, so the runner writes them before the first launch. */
export const PROJECT_SETTINGS = [
  { section: '/Script/Engine.RendererSettings', entries: [['r.GPUSkin.Support16BitBoneIndex', 'True'], ['r.GPUSkin.UnlimitedBoneInfluences', 'True'], ['r.SkinCache.CompileShaders', 'True'], ['r.SkinCache.DefaultBehavior', '0']] },
  { section: 'ConsoleVariables', entries: [['SkeletalMesh.UseExperimentalChunking', '1'], ['fx.Niagara.ForceLastTickGroup', '1']] },
];
/** Default launch timeouts in minutes: the first launch (create, assemble, drive) and the repeat launch. */
export const TIMEOUT_MINUTES = { main: 90, repeat: 40 };
/** Seconds the editor script leaves before the runner would stop the editor: it ends the flow and writes a final report with this much room left. */
export const BUDGET_MARGIN_SECONDS = 180;
export const ROUTES = ['anim_sequence_curves'];
/** Smaller changes than these are not a difference: the share of the face region that changed against the empty frame, between two poses, and the noise floor of two neutral frames. */
export const THRESHOLDS = { visibleFace: 0.05, flatDeviation: 6, pose: 0.005, noiseFactor: 4, noiseFloor: 0.0005 };

/**
 * @param {string[]} argv  process.argv without node and the script
 * @param {Record<string, string|undefined>} [env]  UE_ROOT supplies the engine folder
 */
export function parseOptions(argv, env = {}) {
  const values = {}, valued = { '--engine': 'engine', '--only': 'only', '--phase': 'phase', '--project': 'project', '--out': 'out', '--preset': 'preset', '--timeout-minutes': 'timeout' };
  const flags = { '--keep': 'keep', '--plan': 'plan', '--names': 'names', '--camera-flip': 'cameraFlip', '--skip-core-data-check': 'skipCoreDataCheck' };
  const on = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (flags[arg]) on[flags[arg]] = true;
    else if (valued[arg]) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value` };
      if (values[valued[arg]] !== undefined) return { error: `${arg} given twice` };
      values[valued[arg]] = value;
      i++;
    } else return { error: `unknown option ${arg}` };
  }
  const phase = values.phase || 'run';
  if (!PHASES.includes(phase)) return { error: `unknown phase ${phase}; the phases are ${PHASES.join(', ')}` };
  const engine = values.engine || env.UE_ROOT;
  if (phase === 'judge') {
    if (!values.project) return { error: 'judge needs --project <the folder prepare printed>' };
  } else if (!engine) return { error: 'no engine folder: pass --engine or set UE_ROOT' };
  let groups = GROUPS;
  if (values.only !== undefined) {
    const asked = values.only.split(',').map((g) => g.trim()).filter(Boolean);
    const unknown = asked.filter((g) => !GROUPS.includes(g));
    if (asked.length === 0) return { error: '--only needs at least one group' };
    if (unknown.length) return { error: `unknown group ${unknown.join(', ')}; the groups are ${GROUPS.join(', ')}` };
    groups = GROUPS.filter((g) => asked.includes(g));
  }
  const timeout = values.timeout === undefined ? undefined : Number(values.timeout);
  if (timeout !== undefined && !(timeout > 0)) return { error: '--timeout-minutes needs a positive number' };
  return { engine, phase, groups, keep: Boolean(on.keep), plan: Boolean(on.plan), names: Boolean(on.names), cameraFlip: Boolean(on.cameraFlip), skipCoreDataCheck: Boolean(on.skipCoreDataCheck),
    project: values.project, out: values.out, preset: values.preset, timeoutMinutes: timeout };
}

/** The editor launches of a run, in order: create, assemble and drive share one session (one sign-in), repeat is its own launch in a reopened editor. */
export function launchesFor(groups) {
  const first = ['create', 'assemble', 'drive'].filter((g) => groups.includes(g));
  return [...(first.length ? [first] : []), ...(groups.includes('repeat') ? [['repeat']] : [])];
}

/** The minutes the runner gives a launch before it stops the editor. */
export function launchMinutes(stages, override) {
  return override ?? ((stages || []).includes('repeat') ? TIMEOUT_MINUTES.repeat : TIMEOUT_MINUTES.main);
}

/** The text of the project's Config/DefaultEngine.ini: the start-up script (when the editor runs the probe by itself) and the MetaHuman project settings. */
export function engineIni({ script, startup = true } = {}) {
  const blocks = [];
  if (startup && script) blocks.push(`[/Script/PythonScriptPlugin.PythonScriptPluginSettings]\n+StartupScripts=${script}`);
  for (const { section, entries } of PROJECT_SETTINGS) blocks.push(`[${section}]\n${entries.map(([key, value]) => `${key}=${value}`).join('\n')}`);
  return `${blocks.join('\n\n')}\n`;
}

/** Whether the repeat launch runs after the first one: yes when the first wrote a report that says done (with or without errors), or was stopped after its create stage passed
 *  (a sign-in exists then). Only a first launch with no report and no passing create stage leaves the question not run. */
export function repeatMayRun(first) {
  const report = obj(obj(first).report);
  if (report.done === true) return true;
  return obj(obj(obj(report.stages).create).readback).can_build === true;
}

/** One line of what a launch is doing now, from its report, for the runner to print while the editor works. */
export function progressLine(report, elapsedSeconds) {
  const r = obj(report);
  const at = Number.isFinite(elapsedSeconds) ? `${Math.round(elapsedSeconds)} s: ` : '';
  if (!Object.keys(r).length) return `${at}no report yet (the editor is starting, or inside one long cloud or build call)`;
  return `${at}${r.done ? 'finished' : r.progress || 'working'}${list(r.errors).length ? `; ${list(r.errors).length} error(s) recorded` : ''}`;
}

/** The plan file the editor script reads (Saved/mh-plan.json). timeoutMinutes replaces the launch timeouts the editor's own time budgets are taken from. */
export function buildPlan({ groups = GROUPS, preset, cameraFlip = false, timeoutMinutes } = {}) {
  const launches = launchesFor(groups);
  return {
    groups, launches, character: 'MhProbeChar', preset: preset || null, rig_type: 'JOINTS_ONLY', pipelines: PIPELINES, pipeline_order_reason: PIPELINE_ORDER_REASON,
    build_path: '/Game/MetaHumans', build_wait_seconds: 600,
    level: '/Game/Maps/MhProbe', settle_seconds: 20, shader_wait_seconds: 90, pie_wait_seconds: 120, capture_budget_seconds: 600, pose_budget_seconds: 60, shot_wait_seconds: 20,
    launch_budget_seconds: launches.map((stages) => Math.max(60, launchMinutes(stages, timeoutMinutes) * 60 - BUDGET_MARGIN_SECONDS)),
    camera_distance: 80, camera_fov: 45, camera_flip: cameraFlip, resolution: [1280, 720],
    poses: POSES, face_region: FACE_REGION,
  };
}

/** The numbered steps the owner is asked to do. Never asks for a password or a token: the sign-in happens in the editor. */
export function ownerSteps({ uproject, root, launches, interactive }) {
  const steps = [];
  const first = launches[0] && launches[0].join(', ');
  const hasRepeat = launches.some((l) => l.includes('repeat'));
  if (interactive) steps.push(`Open ${uproject} in UnrealEditor (a rendering editor, not -nullrhi) when you are ready; its start-up script runs the probe by itself.`);
  else steps.push('A rendering editor window opens by itself. Keep it in front and stay at the screen.');
  steps.push('Do not click in the editor while it works and do not close it: a stage can be quiet for minutes (shaders, the character build), every wait has a time limit, and when one runs out the editor closes itself and the report says why. The runner prints a progress line every 30 seconds.');
  steps.push('When Epic\'s sign-in prompt appears (the first auto-rigging request raises it), sign in to your Epic account in the editor yourself.');
  if (launches.length && !launches[0].includes('repeat')) steps.push(`The editor closes itself when launch 1 (${first}) is done; a first run compiles shaders and downloads from the cloud, so it takes a while.`);
  if (hasRepeat) steps.push(interactive ? 'Open the project again and step away from the editor: launch 2 (repeat) runs the create stage once more and closes itself. If a sign-in prompt appears again, that is the result; leave it and close the editor.'
    : 'Step away from the editor when launch 2 (repeat) starts: it runs the create stage once more in a reopened editor. If a sign-in prompt appears again, leave it; the launch times out and that is recorded.');
  if (interactive) steps.push(`node examples/unreal/metahuman/mh_probe.mjs --phase judge --project ${root}`);
  return steps;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Report access

const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const list = (x) => (Array.isArray(x) ? x : []);
const stageOf = (launch, name) => obj(obj(obj(launch).report).stages)[name];
const reportOf = (launch) => obj(obj(launch).report);
const pct = (x) => `${(x * 100).toFixed(2)}%`;

/** The launch (an entry of `launches`) whose plan lists this stage. */
function launchFor(plan, launches, stage) {
  const index = list(plan && plan.launches).findIndex((l) => list(l).includes(stage));
  return index >= 0 ? list(launches)[index] : undefined;
}

/** The share of pixels in `region` (fractions of the image) that differ by more than `tolerance` in any channel; -1 when an image is missing or the sizes differ. */
export function regionChange(a, b, region = FACE_REGION, tolerance = 12) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return -1;
  const x0 = Math.floor(region.x * a.width), y0 = Math.floor(region.y * a.height), x1 = Math.min(a.width, x0 + Math.ceil(region.w * a.width)), y1 = Math.min(a.height, y0 + Math.ceil(region.h * a.height));
  let changed = 0, total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * a.width + x) * 4;
      total++;
      if (Math.max(Math.abs(a.rgba[o] - b.rgba[o]), Math.abs(a.rgba[o + 1] - b.rgba[o + 1]), Math.abs(a.rgba[o + 2] - b.rgba[o + 2])) > tolerance) changed++;
    }
  }
  return total ? changed / total : -1;
}

/** The standard deviation of the luminance in `region`: near 0 for a flat or blank frame. -1 when there is no image. */
export function regionDeviation(image, region = FACE_REGION) {
  if (!image || !image.rgba) return -1;
  const x0 = Math.floor(region.x * image.width), y0 = Math.floor(region.y * image.height), x1 = Math.min(image.width, x0 + Math.ceil(region.w * image.width)), y1 = Math.min(image.height, y0 + Math.ceil(region.h * image.height));
  let sum = 0, sum2 = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * image.width + x) * 4, l = 0.2126 * image.rgba[o] + 0.7152 * image.rgba[o + 1] + 0.0722 * image.rgba[o + 2];
      sum += l; sum2 += l * l; n++;
    }
  }
  if (!n) return -1;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sum2 / n - mean * mean));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Checks

function createChecks(stage, label, check, group) {
  const s = obj(stage), rig = obj(s.rig_request), tex = obj(s.texture_request), read = obj(s.readback), edit = obj(s.edit);
  const errors = list(s.errors);
  const tail = errors.length ? `; ${String(errors[0]).split('\n').slice(-1)[0].slice(0, 140)}` : '';
  check(group, `${label}: a MetaHuman Character asset is created from a preset`,
    'A script duplicates an installed preset character asset into the project (the editor\'s own preset call is not exposed to Python), or, when no preset is installed, creates one with the asset factory; only the preset counts for this claim',
    s.created === true && Boolean(s.asset) && s.source === 'preset',
    `source ${s.source || 'none'}${s.preset ? ` (${s.preset})` : ''}, presets found ${s.presets_found ?? 'not read'}, core data folder ${s.optional_content === undefined ? 'not read' : s.optional_content ? 'present' : 'missing'}${tail}`);
  check(group, `${label}: the character registers for editing, takes an edit, commits and is removed`,
    'try_add_object_to_edit returns True, a landmark edit runs without error, commit_face_state and commit_body_state return, and remove_object_to_edit leaves the character not added for editing',
    s.add_for_edit === true && s.committed === true && s.removed === true && edit.error === '' && Object.keys(edit).length > 0,
    `added ${s.add_for_edit ?? 'not run'}, committed ${s.committed ?? 'not run'}, removed ${s.removed ?? 'not run'}, landmarks edited ${edit.landmarks ?? 'not run'}${edit.error ? `, edit error ${String(edit.error).split('\n').slice(-1)[0].slice(0, 120)}` : ''}`);
  check(group, `${label}: auto-rigging and textures are requested with blocking=True and return`,
    'request_auto_rigging and request_texture_sources run with blocking set and report_progress off, and neither raises',
    rig.blocking === true && rig.report_progress === false && rig.error === '' && tex.blocking === true && tex.report_progress === false && tex.error === '',
    `rig ${rig.error === undefined ? 'not run' : rig.error ? String(rig.error).split('\n').slice(-1)[0].slice(0, 140) : `${rig.seconds} s`}; textures ${tex.error === undefined ? 'not run' : tex.error ? String(tex.error).split('\n').slice(-1)[0].slice(0, 140) : `${tex.seconds} s`}`);
  check(group, `${label}: the character reads back rigged with its textures fetched`,
    'After both requests, has_high_resolution_textures is True and can_build_meta_human is True (Epic\'s own test shows it False before the rig and the textures; Python has no rigging-state getter)',
    read.has_high_resolution_textures === true && read.can_build === true,
    `high-resolution textures ${read.has_high_resolution_textures ?? 'not read'}, can build ${read.can_build ?? 'not read'}, face texture infos ${read.face_texture_infos ?? 'n/a'}, body texture infos ${read.body_texture_infos ?? 'n/a'}`);
}

function assembleChecks(stage, images, plan, check) {
  const s = obj(stage), assets = obj(s.assets), by = obj(assets.by_class), spawned = obj(s.spawned), frames = obj(s.frames);
  const attempts = list(s.attempts);
  const attemptText = attempts.map((a) => `${a.pipeline}/${a.quality}: ${a.skipped ? `skipped (${String(a.skipped).slice(0, 80)})` : a.error ? String(a.error).split('\n').filter(Boolean).slice(-1)[0].slice(0, 100) : a.blueprint ? 'Blueprint made' : 'no Blueprint after waiting'}`).join('; ') || 'no attempt recorded';
  check('assemble', 'build_meta_human leaves a Blueprint and skeletal meshes in the project',
    'build_meta_human with a pipeline (the optimized one first, the Cine one if that leaves no Blueprint) writes at least one Blueprint and one Skeletal Mesh under the build folder',
    Boolean(s.blueprint) && (by.Blueprint || 0) >= 1 && (by.SkeletalMesh || 0) >= 1,
    `pipeline used ${s.pipeline || 'none'}; ${assets.total ?? 0} assets (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}); ${attemptText}`);
  check('assemble', 'the assembled Blueprint spawns in a level with a Face component',
    'EditorActorSubsystem spawns the Blueprint class in a new level, and the actor holds a Skeletal Mesh Component named Face',
    Boolean(s.level) && Boolean(spawned.class) && Boolean(spawned.face_component),
    `level ${s.level || 'not made'}, actor ${spawned.class || 'not spawned'}, components ${list(spawned.components).map((c) => c.name).join(', ') || 'none'}`);
  const region = obj(plan).face_region || FACE_REGION;
  const empty = obj(images)[frames.control], shown = obj(images)[frames.assembled];
  const changed = regionChange(empty, shown, region), deviation = regionDeviation(shown, region);
  check('assemble', 'a captured frame shows the character with a visible face',
    `A frame with the actor hidden and a frame with it shown, from the same camera, differ in the face region by more than ${pct(THRESHOLDS.visibleFace)} of its pixels, and the shown frame is not flat (luminance deviation above ${THRESHOLDS.flatDeviation}); a person still reads the saved image`,
    changed > THRESHOLDS.visibleFace && deviation > THRESHOLDS.flatDeviation,
    !empty || !shown ? `frames not found (${frames.control || 'no control frame'}, ${frames.assembled || 'no assembled frame'})` : changed < 0 ? 'the two frames differ in size' : `region changed ${pct(changed)}, deviation ${deviation.toFixed(1)}`);
}

function driveChecks(stage, images, plan, check) {
  const s = obj(stage), poses = list(s.poses);
  const region = obj(plan).face_region || FACE_REGION;
  const worked = poses.length > 0 && poses.every((p) => p.created === true && p.applied === true && !p.error);
  check('drive', 'each pose writes its control curves into an animation sequence and plays on the Face component',
    'For neutral, jaw open and smile, an animation sequence on the face skeleton gets float curves named as the MetaHuman control curves, and Face.play_animation takes it without error',
    worked && s.route === 'anim_sequence_curves',
    `route ${s.route || 'none'}; ${poses.map((p) => `${p.name}: ${p.error ? String(p.error).split('\n').slice(-1)[0].slice(0, 100) : p.applied ? 'played' : p.created ? 'made, not played' : 'not made'}`).join('; ') || 'no pose recorded'}${list(s.errors).length ? `; ${String(list(s.errors)[0]).slice(0, 120)}` : ''}`);
  const misses = [];
  let seen = 0;
  for (const p of poses) {
    for (const [curve, want] of Object.entries(obj(p.curves))) {
      const got = obj(p.readback)[curve];
      if (typeof got === 'number') { seen++; if (Math.abs(got - want) > 0.05) misses.push(`${p.name} ${curve} ${got} (wanted ${want})`); } else misses.push(`${p.name} ${curve} not read`);
    }
  }
  check('drive', 'the Face component reads the written curve values back',
    'After a pose plays, SkeletalMeshComponent.get_curve_value returns each written value (within 0.05), so the curves reach the animation instance',
    poses.length > 0 && misses.length === 0,
    misses.length ? misses.slice(0, 4).join('; ') : `${seen} curve values read back`);
  const by = (name) => obj(images)[`mh_${name}`];
  const neutral = by('neutral'), jaw = by('jaw_open'), smile = by('smile'), again = obj(images)[s.control_frame || 'mh_neutral_again'];
  const noise = Math.max(regionChange(neutral, again, region), 0);
  const floor = Math.max(THRESHOLDS.pose, noise * THRESHOLDS.noiseFactor);
  const pairs = [['jaw_open vs neutral', regionChange(neutral, jaw, region)], ['smile vs neutral', regionChange(neutral, smile, region)], ['jaw_open vs smile', regionChange(jaw, smile, region)]];
  check('drive', 'the neutral, jaw-open and smile frames differ from one another in the face region',
    `Each pair of the three frames differs in the face region by more than ${pct(THRESHOLDS.pose)} of its pixels and by more than ${THRESHOLDS.noiseFactor} times what two neutral frames differ by (the noise control)`,
    Boolean(neutral && jaw && smile && again) && pairs.every(([, v]) => v > floor),
    !(neutral && jaw && smile && again) ? `frames missing (${['neutral', 'jaw_open', 'smile', 'neutral_again'].filter((n) => !(n === 'neutral_again' ? again : by(n))).join(', ')})` : `${pairs.map(([n, v]) => `${n} ${v < 0 ? 'size differs' : pct(v)}`).join('; ')}; noise ${pct(noise)}; bound ${pct(floor)}`);
  check('drive', 'the route that moved the face is recorded, and the routes not run are listed',
    'The report names one route from the probe\'s list and lists the routes it did not try (ARKit through a pose asset, a Live Link pose, Sequencer with a Control Rig, morph targets)',
    ROUTES.includes(s.route) && list(s.routes_not_run).length > 0,
    `route ${s.route || 'none'}; not run: ${list(s.routes_not_run).join(', ') || 'none listed'}`);
}

function repeatChecks(launch, check) {
  const report = reportOf(launch), s = obj(obj(report.stages).repeat), read = obj(s.readback);
  const timedOut = obj(launch).timedOut === true;
  check('repeat', 'the same create stage completes in a reopened editor',
    'In an editor closed and reopened, the create stage runs again on a second character: auto-rigging and textures return, the character reads back rigged with textures, and the launch finishes by itself',
    report.done === true && !timedOut && s.created === true && s.rig_request && s.rig_request.error === '' && s.texture_request && s.texture_request.error === '' && read.has_high_resolution_textures === true && read.can_build === true,
    `${timedOut ? 'timed out (a sign-in prompt waiting for a person would look like this)' : report.done ? 'finished' : 'did not finish'}; rig ${obj(s.rig_request).seconds ?? 'not run'} s, textures ${obj(s.texture_request).seconds ?? 'not run'} s, can build ${read.can_build ?? 'not read'}`);
  const rigged = s.created === true && obj(s.rig_request).error === '' && obj(s.texture_request).error === '' && read.can_build === true;
  const verdict = timedOut ? 'the launch timed out, which is what a prompt waiting for a person looks like'
    : report.done !== true ? 'the launch did not finish'
    : rigged ? 'the repeat launch finished by itself with nobody at the editor and the rig and textures returned, so no prompt blocked it' : 'the launch finished but the create stage did not return rigged';
  check('repeat', 'no sign-in flow appears in the reopened editor',
    'The launch finished by itself with nobody at the editor, so no prompt blocked it: the report is done, its end_reason is completed, it did not time out, and the create stage returned its rig and textures with can_build_meta_human true (a prompt waiting for a person would block the editor and time the launch out); the editor log is not read',
    report.done === true && report.end_reason === 'completed' && !timedOut && rigged,
    verdict);
}

/**
 * @param {{ groups: string[], plan?: any, launches: { report?: any, timedOut?: boolean, exit?: number|null }[], images?: Record<string, { width: number, height: number, rgba: Uint8Array }> }} input
 *   launches follow plan.launches; images maps a screenshot name (mh_empty, mh_assembled, mh_neutral, mh_jaw_open, mh_smile, mh_neutral_again) to a decoded image
 * @returns {{ group: string, name: string, claim: string, pass: boolean, detail: string }[]}
 */
export function evaluateProbes({ groups, plan, launches, images }) {
  const out = [];
  const check = (group, name, claim, pass, detail = '') => out.push({ group, name, claim, pass: Boolean(pass), detail: String(detail) });
  const p = plan || buildPlan({ groups });
  for (const group of groups || []) {
    if (group === 'create') createChecks(stageOf(launchFor(p, launches, 'create'), 'create'), 'create', check, 'create');
    else if (group === 'assemble') assembleChecks(stageOf(launchFor(p, launches, 'assemble'), 'assemble'), images, p, check);
    else if (group === 'drive') driveChecks(stageOf(launchFor(p, launches, 'drive'), 'drive'), images, p, check);
    else if (group === 'repeat') repeatChecks(launchFor(p, launches, 'repeat'), check);
  }
  return out;
}

/** The checks of the headless names mode (mh_probe.mjs --names): the names the editor script uses exist in the install, and the pose sequences write and read back. */
export function evaluateNames(report, poses = POSES) {
  const out = [];
  const check = (name, claim, pass, detail = '') => out.push({ group: 'names', name, claim, pass: Boolean(pass), detail: String(detail) });
  const r = obj(report), missing = obj(r.missing);
  const none = (key) => Array.isArray(missing[key]) && missing[key].length === 0;
  const shown = (key) => (Object.keys(missing).length === 0 ? 'no report' : list(missing[key]).join(', ') || 'none missing');
  check('the classes the probe uses exist', 'Every unreal.<Class> the editor script names is present (MetaHuman Character, the request and build parameter structs, the anim and level classes)', none('classes'), `missing: ${shown('classes')}`);
  check('the subsystem, library and component methods exist', 'try_add_object_to_edit, the commit, rig, texture and build calls, the animation and level calls and the screenshot call are present on their classes', none('methods'), `missing: ${shown('methods')}`);
  check('the request, build and character fields exist', 'blocking, report_progress, rig_type, the build parameters and the character\'s read-back properties are present', none('fields'), `missing: ${shown('fields')}`);
  check('the enum members and module functions exist', 'The rig types, the Cinematic and Optimized pipelines, the quality levels and the Slate tick functions are present', none('enums') && none('functions'), `missing: ${shown('enums')}${list(missing.functions).length ? `; functions ${shown('functions')}` : ''}`);
  const sequences = obj(r.pose_sequences);
  const bad = poses.filter((pose) => !Object.entries(pose.curves).every(([curve, value]) => {
    const keys = list(obj(obj(sequences[pose.name]).keys)[curve]);
    return keys.length > 0 && Math.abs(keys[0] - value) < 1e-3;
  }));
  check('the pose sequences write and read back on the face skeleton', 'An animation sequence on the MetaHuman face skeleton takes each pose\'s control curves through AnimationLibrary and returns the written key', Object.keys(sequences).length > 0 && bad.length === 0 && list(r.errors).length === 0,
    bad.length ? `not read back: ${bad.map((b) => b.name).join(', ')}${list(r.errors).length ? `; ${String(r.errors[0]).split('\n').slice(-1)[0].slice(0, 160)}` : ''}` : Object.keys(sequences).length ? `${Object.keys(sequences).length} sequences, play length ${obj(sequences[poses[0].name]).play_length}${obj(sequences[poses[0].name]).note ? ` (${obj(sequences[poses[0].name]).note})` : ''}` : 'no sequence made');
  check('the MetaHuman Creator core data (presets, texture synthesis model) is installed', 'The plugin\'s Optional content folder exists and holds at least one preset character asset; the editor itself warns that features are limited without it',
    r.optional_content === true && list(r.preset_assets).length > 0, `optional folder ${r.optional_content === undefined ? 'not read' : r.optional_content ? 'present' : 'missing'}; ${list(r.preset_assets).length} preset assets`);
  return out;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}

/** The screenshot names a run asks for, to look up under Saved/Screenshots. */
export function shotNames(groups) {
  const names = [];
  if (groups.includes('assemble')) names.push('mh_empty', 'mh_assembled');
  if (groups.includes('drive')) names.push(...POSES.map((p) => `mh_${p.name}`), 'mh_neutral_again');
  return names;
}
