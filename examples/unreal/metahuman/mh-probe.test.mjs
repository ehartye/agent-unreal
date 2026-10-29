// node --test examples/unreal/metahuman/mh-probe.test.mjs  (no Unreal, no dependencies)
// Prepared 2026-10-29. The canned reports below follow the real reports of engine run 4 (mh-launch-1.json and mh-launch-2.json): the field names of the create, assemble, drive and repeat stages match. Their values are
// invented (preset count, seconds, asset counts, 100 x 100 synthetic frames) and the cases no run produced are still assumptions: a timed-out repeat launch, the `Shot` fallback, a successful Cine build.
// The names mode report was produced by a headless run on 2026-10-29. A field the real report spells differently makes the matching check fail, and the check or the script is fixed then. Each mutation changes one fact and expects the matching check to fail, so the probe cannot
// pass by accident, and an empty or partial input fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodePng } from '../niagara_toolsets/nts-probe-assets.mjs';
import {
  FACE_REGION, GROUPS, POSES, PROJECT_SETTINGS, buildPlan, engineIni, evaluateNames, evaluateProbes, launchMinutes, launchesFor, ownerSteps, parseOptions, progressLine, regionChange, regionDeviation,
  repeatMayRun, shotNames, summarize,
} from './mh-probe-checks.mjs';

const here = import.meta.dirname;
const runner = join(here, 'mh_probe.mjs');

// ---- images: 100 x 100, the face region is x 30..70, y 10..90
const solid = (rgb = [20, 20, 20]) => { const rgba = Buffer.alloc(100 * 100 * 4); for (let i = 0; i < 10000; i++) rgba.set([...rgb, 255], i * 4); return { width: 100, height: 100, rgba }; };
const withRect = (image, [x0, y0, x1, y1], rgb) => { const copy = { ...image, rgba: Buffer.from(image.rgba) }; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) copy.rgba.set([...rgb, 255], (y * 100 + x) * 4); return copy; };
const BASE = solid();
const head = withRect(BASE, [35, 15, 65, 85], [200, 150, 130]);                    // a head: about 44 percent of the face region
const images = () => ({
  mh_empty: BASE,
  mh_assembled: head,
  mh_neutral: head,
  mh_jaw_open: withRect(head, [45, 60, 55, 80], [60, 20, 20]),                    // a mouth opening: 5 percent of the region
  mh_smile: withRect(head, [38, 62, 62, 66], [230, 180, 170]),                    // wider lips: 3 percent of the region
  mh_neutral_again: head,
});

// ---- canned reports
const createStage = () => ({
  created: true, asset: '/Game/MhProbe/MhProbeChar.MhProbeChar', source: 'preset', preset: 'Ada', presets_found: 12, optional_content: true, add_for_edit: true,
  edit: { landmarks: 60, error: '' }, committed: true,
  rig_request: { blocking: true, report_progress: false, rig_type: 'JOINTS_ONLY', seconds: 41.2, error: '' }, texture_request: { blocking: true, report_progress: false, seconds: 63.5, error: '' },
  readback: { has_high_resolution_textures: true, can_build: true, face_texture_infos: 4, body_texture_infos: 3 }, removed: true, saved: true, errors: [],
});
const assembleStage = () => ({
  attempts: [{ pipeline: 'CINEMATIC', quality: 'CINEMATIC', error: '', seconds: 80.1, blueprint: '/Game/MetaHumans/MhProbeChar/BP_MhProbeChar', waited_seconds: 0, can_build: true }],
  pipeline: 'CINEMATIC', blueprint: '/Game/MetaHumans/MhProbeChar/BP_MhProbeChar', assets: { total: 41, by_class: { Blueprint: 1, SkeletalMesh: 3, Material: 20, Texture2D: 17 }, sample: [] },
  level: '/Game/Maps/MhProbe', spawned: { class: 'BP_MhProbeChar_C', components: [{ name: 'Face', mesh: 'Face_mesh' }, { name: 'Body', mesh: 'Body_mesh' }], face_component: 'Face' },
  frames: { control: 'mh_empty', assembled: 'mh_assembled' }, errors: [],
});
const pose = (p, value) => ({ name: p.name, curves: p.curves, frame: `mh_${p.name}`, created: true, applied: true, readback: Object.fromEntries(Object.keys(p.curves).map((c) => [c, value ?? p.curves[c]])), error: '' });
const driveStage = () => ({ route: 'anim_sequence_curves', routes_not_run: ['arkit_pose_asset', 'live_link_pose', 'sequencer_control_rig', 'morph_targets'], poses: POSES.map((p) => pose(p)), control_frame: 'mh_neutral_again', errors: [] });
const launchOne = () => ({ report: { launch: 1, done: true, end_reason: 'completed', signin_lines: ['LogMetaHuman: sign in required', 'LogMetaHuman: signed in', 'LogHttp: login callback'], stages: { create: createStage(), assemble: assembleStage(), drive: driveStage() } } });
const launchTwo = () => ({ report: { launch: 2, done: true, end_reason: 'completed', stages: { repeat: { ...createStage(), asset: '/Game/MhProbe/MhProbeCharRepeat.MhProbeCharRepeat' } } } });
const canned = () => [launchOne(), launchTwo()];
const evaluate = (launches = canned(), imgs = images(), groups = GROUPS) => evaluateProbes({ groups, plan: buildPlan({ groups }), launches, images: imgs });
const failing = (...args) => evaluate(...args).filter((c) => !c.pass).map((c) => c.name);
const names = (fn) => { const l = canned(), i = images(); fn(l, i); return failing(l, i); };
const has = (list, text) => list.some((n) => n.includes(text));

test('the canned reports pass every check, in the four groups', () => {
  const checks = evaluate();
  assert.deepEqual(failing(), []);
  assert.deepEqual(summarize(checks), { passed: 13, total: 13 });
  assert.deepEqual([...new Set(checks.map((c) => c.group))], GROUPS);
  for (const c of checks) assert.ok(c.name && c.claim && typeof c.detail === 'string', `${c.name} carries a name, a claim and a detail`);
});

test('create: a copy of a preset is required, an asset from the factory fails the claim', () => {
  assert.ok(has(names((l) => { l[0].report.stages.create.source = 'factory'; l[0].report.stages.create.preset = null; }), 'created from a preset'));
  assert.ok(has(names((l) => { l[0].report.stages.create.created = false; }), 'created from a preset'));
});

test('create: registering, editing, committing and removing are each required', () => {
  for (const [key, value] of [['add_for_edit', false], ['committed', false], ['removed', false]]) {
    assert.ok(has(names((l) => { l[0].report.stages.create[key] = value; }), 'registers for editing'), key);
  }
  assert.ok(has(names((l) => { l[0].report.stages.create.edit.error = 'Traceback: boom'; }), 'registers for editing'));
});

test('create: the cloud requests must run with blocking set and without an error', () => {
  assert.ok(has(names((l) => { l[0].report.stages.create.rig_request.blocking = false; }), 'blocking=True'));
  assert.ok(has(names((l) => { l[0].report.stages.create.texture_request.report_progress = true; }), 'blocking=True'));
  assert.ok(has(names((l) => { l[0].report.stages.create.rig_request.error = 'Traceback: not signed in'; }), 'blocking=True'));
  assert.ok(has(names((l) => { delete l[0].report.stages.create.texture_request; }), 'blocking=True'));
});

test('create: the read-back needs the high-resolution textures and a character that can build', () => {
  assert.ok(has(names((l) => { l[0].report.stages.create.readback.has_high_resolution_textures = false; }), 'reads back rigged'));
  assert.ok(has(names((l) => { l[0].report.stages.create.readback.can_build = false; }), 'reads back rigged'));
  assert.ok(has(names((l) => { delete l[0].report.stages.create.readback; }), 'reads back rigged'));
});

test('assemble: a Blueprint and a skeletal mesh must exist, the actor must spawn with a Face component', () => {
  assert.ok(has(names((l) => { l[0].report.stages.assemble.blueprint = null; }), 'leaves a Blueprint'));
  assert.ok(has(names((l) => { l[0].report.stages.assemble.assets.by_class.SkeletalMesh = 0; }), 'leaves a Blueprint'));
  assert.ok(has(names((l) => { l[0].report.stages.assemble.spawned.face_component = null; }), 'spawns in a level'));
  assert.ok(has(names((l) => { delete l[0].report.stages.assemble.level; }), 'spawns in a level'));
});

test('assemble: the shown frame must differ from the control frame in the face region and not be flat', () => {
  assert.ok(has(names((l, i) => { i.mh_assembled = BASE; }), 'visible face'), 'identical to the empty frame');
  assert.ok(has(names((l, i) => { delete i.mh_assembled; }), 'visible face'), 'no frame');
  assert.ok(has(names((l, i) => { i.mh_assembled = solid([90, 90, 90]); }), 'visible face'), 'a flat frame of another colour differs but is not a face');
  assert.ok(has(names((l, i) => { i.mh_empty = { ...BASE, width: 50 }; }), 'visible face'), 'sizes differ');
  assert.ok(has(names((l) => { delete l[0].report.stages.assemble.frames; }), 'visible face'));
});

test('drive: every pose must be made and played, and the route must be one the probe knows', () => {
  assert.ok(has(names((l) => { l[0].report.stages.drive.poses[1].applied = false; }), 'plays on the Face component'));
  assert.ok(has(names((l) => { l[0].report.stages.drive.poses[2].error = 'Traceback: play_animation'; }), 'plays on the Face component'));
  assert.ok(has(names((l) => { l[0].report.stages.drive.route = null; }), 'plays on the Face component'));
  assert.ok(has(names((l) => { l[0].report.stages.drive.route = 'telepathy'; }), 'route that moved the face'));
  assert.ok(has(names((l) => { l[0].report.stages.drive.routes_not_run = []; }), 'route that moved the face'));
});

test('drive: written curve values must read back from the Face component', () => {
  assert.ok(has(names((l) => { l[0].report.stages.drive.poses[1].readback.CTRL_expressions_jawOpen = 0; }), 'reads the written curve values back'));
  assert.ok(has(names((l) => { l[0].report.stages.drive.poses[2].readback.CTRL_expressions_mouthCornerPullL = null; }), 'reads the written curve values back'));
  assert.ok(has(names((l) => { l[0].report.stages.drive.poses[0].readback = {}; }), 'reads the written curve values back'));
});

test('drive: the three frames must differ from one another by more than the noise of two neutral frames', () => {
  assert.ok(has(names((l, i) => { i.mh_jaw_open = i.mh_neutral; }), 'differ from one another'), 'jaw open looks like neutral');
  assert.ok(has(names((l, i) => { i.mh_smile = i.mh_jaw_open; }), 'differ from one another'), 'smile looks like jaw open');
  assert.ok(has(names((l, i) => { delete i.mh_neutral_again; }), 'differ from one another'), 'no noise control');
  assert.ok(has(names((l, i) => { i.mh_neutral_again = withRect(head, [35, 15, 65, 45], [0, 0, 0]); }), 'differ from one another'), 'the neutral frame itself moves more than the poses do');
  assert.ok(has(names((l, i) => { delete i.mh_smile; }), 'differ from one another'));
});

test('repeat: the second launch must finish by itself, with the same stage passing', () => {
  assert.ok(has(names((l) => { l[1].timedOut = true; }), 'completes in a reopened editor'), 'a timeout is the sign-in waiting');
  assert.ok(has(names((l) => { l[1].report.done = false; }), 'completes in a reopened editor'));
  assert.ok(has(names((l) => { l[1].report.stages.repeat.readback.can_build = false; }), 'completes in a reopened editor'));
  assert.ok(has(names((l) => { l[1] = {}; }), 'completes in a reopened editor'), 'repeat skipped');
});

test('repeat: no sign-in flow is judged by behaviour only: the launch finished by itself with the create stage returned', () => {
  const sign = (launches) => evaluate(launches).find((c) => c.name.includes('no sign-in flow'));
  assert.equal(sign(canned()).pass, true);
  assert.match(sign(canned()).detail, /finished by itself with nobody at the editor/);
  assert.ok(has(names((l) => { l[1].timedOut = true; }), 'no sign-in flow'), 'a timeout is the prompt blocking the editor');
  assert.match(sign((() => { const l = canned(); l[1].timedOut = true; return l; })()).detail, /timed out, which is what a prompt/);
  assert.ok(has(names((l) => { l[1].report.done = false; }), 'no sign-in flow'), 'no final report');
  assert.ok(has(names((l) => { l[1].report.end_reason = 'launch budget exceeded'; }), 'no sign-in flow'), 'the budget ended it');
  assert.ok(has(names((l) => { l[1].report.stages.repeat.readback.can_build = false; }), 'no sign-in flow'), 'finished without a rigged character');
  assert.ok(has(names((l) => { l[1] = {}; }), 'no sign-in flow'), 'repeat skipped');
  // a saved report may still carry the old log-line field: it is ignored, whatever it holds
  assert.equal(sign((() => { const l = canned(); l[1].report.signin_lines = ['LogHttp: Warning: Please sign in to your Epic account', 'LogHttp: login callback']; return l; })()).pass, true);
});

test('an empty report, no reports and a missing stage fail every check without throwing', () => {
  const none = evaluate([{}, {}], {});
  assert.equal(none.length, 13);
  assert.equal(none.filter((c) => c.pass).length, 0);
  assert.equal(evaluate([], {}).filter((c) => c.pass).length, 0);
  assert.equal(evaluateProbes({ groups: GROUPS }).filter((c) => c.pass).length, 0);
  assert.equal(evaluate([{ report: {} }, { report: { stages: {} } }], {}).filter((c) => c.pass).length, 0);
  assert.equal(evaluateProbes({ groups: GROUPS, launches: [{ report: { stages: { create: 'x', assemble: 5, drive: [] } } }, { report: null }], images: null }).filter((c) => c.pass).length, 0);
});

test('only the named groups are judged, each against its own launch', () => {
  assert.deepEqual(evaluate(canned(), images(), ['repeat']).map((c) => c.group), ['repeat', 'repeat']);
  const alone = evaluateProbes({ groups: ['drive'], plan: buildPlan({ groups: ['drive'] }), launches: [launchOne()], images: images() });
  assert.deepEqual(alone.map((c) => c.pass), [true, true, true, true]);
  assert.deepEqual(evaluateProbes({ groups: [], launches: [], images: {} }), []);
});

test('regionChange and regionDeviation read only the face region', () => {
  assert.equal(regionChange(BASE, BASE), 0);
  assert.equal(regionChange(BASE, withRect(BASE, [0, 0, 20, 100], [255, 255, 255])), 0, 'a change outside the region is ignored');
  const inside = regionChange(BASE, withRect(BASE, [30, 10, 70, 50], [255, 255, 255]));
  assert.ok(Math.abs(inside - 0.5) < 0.01, `half the region changed, got ${inside}`);
  assert.equal(regionChange(BASE, { ...BASE, width: 99 }), -1);
  assert.equal(regionChange(undefined, BASE), -1);
  assert.ok(regionDeviation(BASE) < 1e-3);
  assert.ok(regionDeviation(head) > 20);
  assert.equal(regionDeviation(undefined), -1);
  assert.deepEqual(FACE_REGION, buildPlan().face_region);
});

test('options: groups, phases and the usual errors', () => {
  assert.deepEqual(parseOptions(['--engine', 'E'], {}).groups, GROUPS);
  assert.deepEqual(parseOptions(['--engine', 'E', '--only', 'drive,create'], {}).groups, ['create', 'drive']);
  assert.equal(parseOptions([], { UE_ROOT: 'E' }).engine, 'E');
  assert.equal(parseOptions(['--engine', 'E', '--keep', '--plan', '--names'], {}).keep, true);
  assert.equal(parseOptions(['--engine', 'E'], {}).phase, 'run');
  assert.equal(parseOptions(['--phase', 'judge', '--project', 'P'], {}).phase, 'judge');
  for (const argv of [[], ['--engine', 'E', '--only', 'nope'], ['--engine', 'E', '--only', ''], ['--engine'], ['--engine', 'E', '--wat'], ['--engine', 'E', '--engine', 'F'], ['--phase', 'judge'],
    ['--engine', 'E', '--phase', 'later'], ['--engine', 'E', '--timeout-minutes', '0']]) {
    assert.ok(parseOptions(argv, {}).error, `${argv.join(' ')} is an error`);
  }
});

test('launches: create, assemble and drive share one editor session, repeat is its own', () => {
  assert.deepEqual(launchesFor(GROUPS), [['create', 'assemble', 'drive'], ['repeat']]);
  assert.deepEqual(launchesFor(['assemble', 'drive']), [['assemble', 'drive']]);
  assert.deepEqual(launchesFor(['repeat']), [['repeat']]);
  assert.deepEqual(launchesFor([]), []);
  assert.deepEqual(buildPlan({ groups: ['create'] }).launches, [['create']]);
});

test('the plan holds the pipelines (optimized, optimized again after the Control Rig error, Cine last), and the poses with control curve names', () => {
  const plan = buildPlan({ preset: 'Ada', cameraFlip: true });
  assert.deepEqual(plan.pipelines.map((p) => p.pipeline), ['OPTIMIZED', 'OPTIMIZED', 'CINEMATIC']);
  assert.deepEqual(plan.pipelines.map((p) => p.retry_after), [undefined, 'Cannot break link', undefined], 'the second optimized attempt is a retry after that error only');
  assert.match(plan.pipeline_order_reason, /Cannot break link/);
  assert.equal(plan.skip_after_errors, undefined, 'no pipeline is skipped after the error: the retry is the evidence-based fix');
  assert.equal(plan.preset, 'Ada');
  assert.equal(plan.camera_flip, true);
  assert.deepEqual(plan.poses.map((p) => p.name), ['neutral', 'jaw_open', 'smile']);
  for (const p of plan.poses) for (const curve of Object.keys(p.curves)) assert.match(curve, /^CTRL_expressions_\w+$/);
  assert.equal(plan.signin_pattern, undefined, 'the plan carries no log-line pattern');
  assert.equal(plan.signin_exclude, undefined);
});

test('the screenshots a run asks for follow its groups', () => {
  assert.deepEqual(shotNames(['create']), []);
  assert.deepEqual(shotNames(['assemble']), ['mh_empty', 'mh_assembled']);
  assert.deepEqual(shotNames(GROUPS), ['mh_empty', 'mh_assembled', 'mh_neutral', 'mh_jaw_open', 'mh_smile', 'mh_neutral_again']);
});

test('owner steps ask for the sign-in in the editor and never for credentials', () => {
  for (const interactive of [true, false]) {
    const steps = ownerSteps({ uproject: 'P/MhProbe.uproject', root: 'P', launches: launchesFor(GROUPS), interactive });
    const text = steps.join('\n');
    assert.match(text, /sign in to your Epic account in the editor yourself/i);
    assert.match(text, /launch 2 \(repeat\)/);
    assert.doesNotMatch(text, /password|token|credential|e-?mail/i);
  }
  const prepared = ownerSteps({ uproject: 'P/MhProbe.uproject', root: 'P', launches: launchesFor(GROUPS), interactive: true });
  assert.match(prepared[0], /Open P\/MhProbe\.uproject/);
  assert.match(prepared.at(-1), /--phase judge --project P$/);
  assert.equal(ownerSteps({ uproject: 'u', root: 'r', launches: launchesFor(['create']), interactive: false }).some((s) => /repeat/.test(s)), false);
});

// ---- names mode
const namesReport = () => ({
  mode: 'names', engine: '5.8', missing: { classes: [], methods: [], fields: [], enums: [], functions: [] }, errors: [], optional_content: true, preset_assets: ['/MetaHumanCharacter/Optional/Presets/Ada'],
  pose_sequences: Object.fromEntries(POSES.map((p) => [p.name, { path: `/Game/MhNames/AS_${p.name}`, keys: Object.fromEntries(Object.entries(p.curves).map(([c, v]) => [c, [v]])), play_length: 1, note: '' }])),
});
const namesFailing = (report) => evaluateNames(report).filter((c) => !c.pass).map((c) => c.name);

test('names: a complete report passes, each kind of missing name fails its own check', () => {
  assert.deepEqual(namesFailing(namesReport()), []);
  assert.equal(evaluateNames(namesReport()).length, 6);
  for (const [key, text] of [['classes', 'classes'], ['methods', 'methods exist'], ['fields', 'fields exist'], ['enums', 'enum members'], ['functions', 'enum members']]) {
    const r = namesReport(); r.missing[key] = ['unreal.Nope'];
    assert.deepEqual(namesFailing(r).length, 1, key);
    assert.ok(has(namesFailing(r), text), key);
    assert.match(evaluateNames(r).find((c) => !c.pass).detail, /Nope/);
  }
});

test('names: a pose sequence that does not read back, no sequences and missing core data fail', () => {
  const wrong = namesReport(); wrong.pose_sequences.jaw_open.keys.CTRL_expressions_jawOpen = [0];
  assert.ok(has(namesFailing(wrong), 'pose sequences'));
  const none = namesReport(); none.pose_sequences = {};
  assert.ok(has(namesFailing(none), 'pose sequences'));
  const raised = namesReport(); raised.errors = ['Traceback: create_asset'];
  assert.ok(has(namesFailing(raised), 'pose sequences'));
  const nodata = namesReport(); nodata.optional_content = false; nodata.preset_assets = [];
  assert.deepEqual(namesFailing(nodata), ['the MetaHuman Creator core data (presets, texture synthesis model) is installed']);
});

test('names: an empty report, a report without the missing block and a partial one fail', () => {
  assert.equal(namesFailing({}).length, 6);
  assert.equal(namesFailing(undefined).length, 6);
  const partial = namesReport(); delete partial.missing.enums;
  assert.ok(has(namesFailing(partial), 'enum members'));
});

// ---- the runner at its boundaries
const run = (args, env = {}) => spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

test('the runner prints its plan without starting an engine, and refuses bad options with exit 2', () => {
  const fake = mkdtempSync(join(tmpdir(), 'mh-test-engine-'));
  try {
    const plan = run(['--engine', fake, '--plan']);
    assert.equal(plan.status, 0, plan.stderr);
    assert.match(plan.stdout, /launch 1 \(create, assemble, drive\)/);
    assert.match(plan.stdout, /launch 2 \(repeat\)/);
    assert.match(plan.stdout, /core data folder: .*MISSING/);
    assert.match(plan.stdout, /windowed/);
    assert.equal(run(['--engine', fake, '--only', 'nope']).status, 2);
    assert.equal(run(['--engine', fake]).status, 2, 'an engine folder with no editor');
    assert.equal(run(['--phase', 'judge']).status, 2);
    assert.equal(run(['--phase', 'judge', '--project', join(fake, 'missing')]).status, 2);
  } finally { rmSync(fake, { recursive: true, force: true }); }
});

function fixtureProject({ tamper } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mh-test-project-'));
  const shots = join(root, 'Saved', 'Screenshots', 'WindowsEditor');
  mkdirSync(shots, { recursive: true });
  const plan = buildPlan({ groups: GROUPS });
  writeFileSync(join(root, 'Saved', 'mh-plan.json'), JSON.stringify(plan));
  const [one, two] = canned();
  if (tamper) tamper(one.report, two.report);
  writeFileSync(join(root, 'Saved', 'mh-launch-1.json'), JSON.stringify(one.report));
  writeFileSync(join(root, 'Saved', 'mh-launch-2.json'), JSON.stringify(two.report));
  for (const [name, image] of Object.entries(images())) writeFileSync(join(shots, `${name}00000.png`), encodePng(image));
  return root;
}

test('judge reads the saved reports and screenshots, and deletes the project on a clean run', () => {
  const root = fixtureProject();
  try {
    const result = run(['--phase', 'judge', '--project', root]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /13 of 13 probe checks passed/);
    assert.equal(existsSync(root), false, 'the throwaway project is deleted');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('judge keeps the project and exits 1 when a check fails, and --keep keeps a clean one', () => {
  const failed = fixtureProject({ tamper: (one) => { one.stages.create.readback.can_build = false; } });
  const kept = fixtureProject();
  try {
    const result = run(['--phase', 'judge', '--project', failed]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /12 of 13 probe checks passed/);
    assert.match(result.stdout, /FAIL  \[create\] create: the character reads back rigged/);
    assert.equal(existsSync(failed), true);
    assert.equal(run(['--phase', 'judge', '--project', kept, '--keep']).status, 0);
    assert.equal(existsSync(kept), true);
  } finally { rmSync(failed, { recursive: true, force: true }); rmSync(kept, { recursive: true, force: true }); }
});

test('judge finds a screenshot by its name and number, and not a longer name that starts the same', () => {
  const root = fixtureProject();
  const shots = join(root, 'Saved', 'Screenshots', 'WindowsEditor');
  try {
    rmSync(join(shots, 'mh_neutral00000.png'));   // only mh_neutral_again00000.png is left, which must not stand in for mh_neutral
    const result = run(['--phase', 'judge', '--project', root, '--keep']);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /screenshot mh_neutral not found/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('judge with no report at all fails every check and keeps the project', () => {
  const root = mkdtempSync(join(tmpdir(), 'mh-test-project-'));
  try {
    mkdirSync(join(root, 'Saved'), { recursive: true });
    writeFileSync(join(root, 'Saved', 'mh-plan.json'), JSON.stringify(buildPlan({ groups: GROUPS })));
    const result = run(['--phase', 'judge', '--project', root]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /0 of 13 probe checks passed/);
    assert.match(result.stdout, /no report was written; kept/);
    assert.equal(existsSync(root), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the probe folder holds no MetaHuman asset file and no editor Python that writes outside a project', () => {
  const files = readdirSync(here);
  assert.deepEqual(files.filter((f) => /\.(uasset|umap|fbx|dna|png|jpg|zip)$/i.test(f)), []);
  const python = readFileSync(join(here, 'mh_probe_editor.py'), 'utf8');
  assert.doesNotMatch(python, /export_dcc|export_dna|export_geometry|export_materials/, 'the probe does not export MetaHuman files');
  assert.match(python, /blocking = True/, 'the cloud requests run with blocking=True');
});

test('the editor tick guards against re-entry while a blocking cloud request ticks Slate', () => {
  // Found in the first engine run: request_auto_rigging(blocking=True) ticks Slate, the tick callback re-entered the flow generator ("generator already executing") and the assemble and drive stages never ran.
  const python = readFileSync(join(here, 'mh_probe_editor.py'), 'utf8');
  const tick = python.slice(python.indexOf('def tick(delta_seconds):'));
  assert.match(tick, /if clock\.get\("busy"\):\s*\n\s*return/, 'the tick returns at once when it is already running');
  assert.match(tick, /clock\["busy"\] = True/);
  assert.match(tick, /finally:\s*\n\s*clock\["busy"\] = False/, 'the guard is released in a finally block');
});

// ---- the project settings, the launch budgets and the repeat launch (the fixes after the second engine run)
const SIX = ['r.GPUSkin.Support16BitBoneIndex=True', 'r.GPUSkin.UnlimitedBoneInfluences=True', 'r.SkinCache.CompileShaders=True', 'r.SkinCache.DefaultBehavior=0', 'SkeletalMesh.UseExperimentalChunking=1', 'fx.Niagara.ForceLastTickGroup=1'];
const sectionLines = (ini, section) => {
  const lines = ini.split('\n'), start = lines.indexOf(`[${section}]`);
  if (start < 0) return [];
  const rest = lines.slice(start + 1), end = rest.findIndex((l) => l.startsWith('['));
  return (end < 0 ? rest : rest.slice(0, end)).filter(Boolean);
};

test('the project settings Epic lists for MetaHumans go into the ini, the renderer ones under RendererSettings and the other two under ConsoleVariables', () => {
  assert.equal(PROJECT_SETTINGS.flatMap((s) => s.entries).length, 6);
  for (const startup of [true, false]) {
    const ini = engineIni({ script: 'C:/x/mh_probe_editor.py', startup });
    assert.deepEqual(sectionLines(ini, '/Script/Engine.RendererSettings'), SIX.slice(0, 4));
    assert.deepEqual(sectionLines(ini, 'ConsoleVariables'), SIX.slice(4));
    assert.equal(ini.includes('+StartupScripts=C:/x/mh_probe_editor.py'), startup);
  }
});

function fakeEngine() {
  const engine = mkdtempSync(join(tmpdir(), 'mh-test-engine-'));
  const bin = join(engine, 'Engine', 'Binaries', 'Win64');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'UnrealEditor.exe'), '');
  writeFileSync(join(bin, 'UnrealEditor-Cmd.exe'), '');
  return engine;
}

test('the runner writes the six settings, the start-up script and the plan with its time budgets into the project before any launch', () => {
  const engine = fakeEngine(), parent = mkdtempSync(join(tmpdir(), 'mh-test-prep-')), project = join(parent, 'proj');
  try {
    const result = run(['--engine', engine, '--phase', 'prepare', '--project', project, '--skip-core-data-check', '--timeout-minutes', '30']);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const ini = readFileSync(join(project, 'Config', 'DefaultEngine.ini'), 'utf8');
    for (const line of SIX) assert.ok(ini.split('\n').includes(line), `${line} is written`);
    assert.match(ini, /\+StartupScripts=.*mh_probe_editor\.py/);
    const plan = JSON.parse(readFileSync(join(project, 'Saved', 'mh-plan.json'), 'utf8'));
    assert.deepEqual(plan.launch_budget_seconds, [1620, 1620], 'a launch budget is the launch timeout less a margin, so the editor ends the flow before the runner stops it');
  } finally { rmSync(engine, { recursive: true, force: true }); rmSync(parent, { recursive: true, force: true }); }
});

test('launch budgets follow the launch timeouts, the default ones and an override', () => {
  assert.deepEqual(buildPlan({ groups: GROUPS }).launch_budget_seconds, [90 * 60 - 180, 40 * 60 - 180]);
  assert.deepEqual(buildPlan({ groups: ['repeat'] }).launch_budget_seconds, [40 * 60 - 180]);
  assert.deepEqual(buildPlan({ groups: ['create'], timeoutMinutes: 10 }).launch_budget_seconds, [420]);
  assert.equal(launchMinutes(['repeat']), 40);
  assert.equal(launchMinutes(['create', 'drive']), 90);
  assert.equal(launchMinutes(['repeat'], 5), 5);
  const plan = buildPlan({ groups: GROUPS });
  for (const key of ['shader_wait_seconds', 'pie_wait_seconds', 'capture_budget_seconds', 'shot_wait_seconds', 'build_wait_seconds']) assert.ok(plan[key] > 0 && plan[key] <= 600, `${key} is a bounded wait`);
});

test('the repeat launch runs after a first launch that finished with errors or was closed after its create stage passed, and not after one that left nothing', () => {
  const withErrors = launchOne(); withErrors.report.errors = ['assemble/drive: boom']; withErrors.report.stages.drive.errors = ['x'];
  assert.equal(repeatMayRun(withErrors), true, 'done with errors is finished');
  const closed = launchOne(); closed.report.done = false;
  assert.equal(repeatMayRun(closed), true, 'closed by hand after create passed');
  const closedEarly = launchOne(); closedEarly.report.done = false; closedEarly.report.stages.create.readback.can_build = false;
  assert.equal(repeatMayRun(closedEarly), false);
  assert.equal(repeatMayRun({}), false);
  assert.equal(repeatMayRun(undefined), false);
  // and it is still judged: the first launch's errors fail its own checks while the repeat launch is read against its own report
  const launches = canned();
  launches[0].report.stages.drive.errors = ['Play-In-Editor did not start'];
  launches[0].report.stages.drive.poses.forEach((p) => { p.applied = false; });
  const failed = failing(launches);
  assert.ok(has(failed, 'plays on the Face component'));
  assert.ok(!has(failed, 'reopened editor'), 'the repeat checks still pass on their own report');
});

test('progress lines say what the editor is doing, and that a quiet editor has no report yet', () => {
  assert.match(progressLine({ progress: '312 s: waiting for shaders to compile (40 of 90 s)' }, 330), /^330 s: 312 s: waiting for shaders/);
  assert.match(progressLine({ done: true, errors: ['a'] }), /^finished; 1 error\(s\)/);
  assert.match(progressLine(undefined, 10), /no report yet/);
});

// ---- the editor script run against a stub of the unreal module: the bounded waits, the final report and the pipeline skip
const EDITOR = join(here, 'mh_probe_editor.py');
const HARNESS = `
import sys, os, json, time, runpy
from unittest.mock import MagicMock
cfg = json.loads(sys.argv[1])
project, script = cfg["project"], cfg["script"]
os.environ.update({"MH_REPORT": project + "/Saved/mh-launch-1.json", "MH_LAUNCH": "1"})
now = [1000.0]
time.time = lambda: now[0]
unreal = MagicMock()
sys.modules["unreal"] = unreal
unreal.SystemLibrary.get_project_directory.return_value = project
unreal.SystemLibrary.get_engine_version.return_value = "5.8"
levels, ues, eas, subsystem, registry = MagicMock(), MagicMock(), MagicMock(), MagicMock(), MagicMock()
subs = {unreal.LevelEditorSubsystem: levels, unreal.UnrealEditorSubsystem: ues, unreal.EditorActorSubsystem: eas, unreal.MetaHumanCharacterEditorSubsystem: subsystem}
unreal.get_editor_subsystem.side_effect = lambda cls: subs[cls]
unreal.AssetRegistryHelpers.get_asset_registry.return_value = registry
asset = MagicMock()
asset.package_name = "/Game/MetaHumans/MhProbeChar/BP_MhProbeChar"
asset.asset_class_path.asset_name = "Blueprint"
registry.get_assets_by_path.return_value = [asset] if cfg.get("blueprint", True) else []
unreal.AnimationLibrary.get_float_keys.return_value = ([0.0], [1.0])
def component(name):
    c = MagicMock()
    c.get_name.return_value = name
    return c
def actor_with(label):
    a = MagicMock()
    a.get_actor_label.return_value = label
    a.get_components_by_class.return_value = [component("Face")]
    return a
eas.spawn_actor_from_class.return_value = actor_with("spawned")
unreal.GameplayStatics.get_all_actors_of_class.return_value = [actor_with("MhProbeActor"), actor_with("MhProbeCamera")]
ues.get_game_world.return_value = MagicMock() if cfg.get("world") else None
if cfg.get("build_error"):
    subsystem.build_meta_human.side_effect = RuntimeError(cfg["build_error"])
if cfg.get("build_errors") is not None:
    subsystem.build_meta_human.side_effect = [RuntimeError(e) if e else None for e in cfg["build_errors"]]
ticks = []
unreal.register_slate_post_tick_callback.side_effect = lambda fn: ticks.append(fn) or "handle"
runpy.run_path(script)
report_path = project + "/Saved/mh-launch-1.json"
count = 0
while count < 20000 and ticks:
    count += 1
    now[0] += 1.0
    ticks[0](1.0)
    if os.path.exists(report_path) and json.load(open(report_path)).get("done"):
        break
print(json.dumps({"report": json.load(open(report_path)), "elapsed": now[0] - 1000.0,
  "build_calls": subsystem.build_meta_human.call_count, "end_play_calls": levels.editor_request_end_play.call_count, "quit_calls": unreal.SystemLibrary.quit_editor.call_count}))
`;

/** Runs mh_probe_editor.py against a stub unreal module for a plan; null when python is not on the PATH (the tests that need it then do nothing). */
function runEditorStub(planChanges, cfg = {}) {
  const project = mkdtempSync(join(tmpdir(), 'mh-test-stub-'));
  mkdirSync(join(project, 'Saved'), { recursive: true });
  const plan = { ...buildPlan({ groups: ['assemble', 'drive'] }), settle_seconds: 0, ...planChanges };
  writeFileSync(join(project, 'Saved', 'mh-plan.json'), JSON.stringify(plan));
  try {
    const result = spawnSync('python', ['-I', '-B', '-c', HARNESS, JSON.stringify({ project: project.replaceAll('\\', '/'), script: EDITOR, ...cfg })], { encoding: 'utf8' });
    if (result.error && result.error.code === 'ENOENT') return null;
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim().split('\n').at(-1));
  } finally { rmSync(project, { recursive: true, force: true }); }
}

test('editor script: a Play-In-Editor that never starts ends the launch by itself, with the reason in the report', () => {
  const r = runEditorStub({ pie_wait_seconds: 10 });
  if (!r) return;
  assert.equal(r.report.done, true);
  assert.equal(r.report.end_reason, 'completed');
  assert.match(r.report.errors.join('\n'), /Play-In-Editor did not start within 10 s/);
  assert.ok(r.report.stages.assemble.errors.some((e) => /did not start/.test(e)));
  assert.ok(r.elapsed < 120, `ended after ${r.elapsed} fake seconds`);
  assert.ok(r.quit_calls >= 1, 'the editor is asked to quit');
});

test('editor script: frames that never reach disk are waited for with a limit, tried with both methods and recorded; the poses are still applied', () => {
  const r = runEditorStub({ shot_wait_seconds: 4, shader_wait_seconds: 5 }, { world: true });
  if (!r) return;
  assert.equal(r.report.done, true);
  const shots = r.report.shots;
  assert.deepEqual(shots.map((s) => s.name), ['mh_empty', 'mh_assembled', 'mh_neutral', 'mh_jaw_open', 'mh_smile', 'mh_neutral_again']);
  for (const shot of shots) {
    assert.equal(shot.found, false);
    assert.deepEqual(shot.tried, ['take_high_res_screenshot', 'Shot showui']);
    assert.ok(shot.seconds >= 8 && shot.seconds < 20, `${shot.name} waited ${shot.seconds} s`);
  }
  assert.match(r.report.stages.assemble.errors.join('\n'), /frame mh_empty was not saved within 4 s/);
  const poses = r.report.stages.drive.poses;
  assert.deepEqual(poses.map((p) => p.applied), [true, true, true]);
  assert.ok(poses.every((p) => /not saved within 4 s/.test(p.shot_error)));
  assert.equal(r.report.stages.drive.route, 'anim_sequence_curves');
  assert.ok(r.end_play_calls >= 1, 'Play-In-Editor is ended');
  assert.ok(r.elapsed < 600, `ended after ${r.elapsed} fake seconds`);
});

test('editor script: a flow still waiting when the launch budget runs out is closed, and the final report says so', () => {
  const r = runEditorStub({ shader_wait_seconds: 100000, launch_budget_seconds: [300] }, { world: true });
  if (!r) return;
  assert.equal(r.report.done, true);
  assert.equal(r.report.end_reason, 'launch budget exceeded');
  assert.match(r.report.errors.join('\n'), /launch budget of 300 s ran out; the flow was at: .*waiting for shaders to compile/);
  assert.ok(r.end_play_calls >= 1, 'Play-In-Editor is ended when the flow is closed');
  assert.ok(r.quit_calls >= 1);
  assert.ok(r.elapsed < 400, `ended after ${r.elapsed} fake seconds`);
  assert.ok(r.report.trace.length > 0 && r.report.trace.length <= 150, 'the report keeps a bounded trace of what the flow did');
});

test('editor script: the capture budget ends the capture stage even when every step is inside its own limit', () => {
  const r = runEditorStub({ capture_budget_seconds: 100, shader_wait_seconds: 90, shot_wait_seconds: 30 }, { world: true });
  if (!r) return;
  assert.equal(r.report.done, true);
  assert.match(r.report.errors.join('\n'), /capture budget of 100 s ran out before/);
});

const CBL = "MetaHumanCharacterEditorSubsystem: /Game/MetaHumans/Common/Face/Face_ControlBoard_CtrlRig : Cannot break link A -> B";
const summary = (r) => r.report.stages.assemble.attempts.map((x) => [x.pipeline, x.skipped ? 'skipped' : x.error ? 'failed' : 'built']);

test('editor script: after Cannot break link errors the attempts are OPTIMIZED, OPTIMIZED, CINEMATIC, each recorded', () => {
  const r = runEditorStub({}, { blueprint: false, build_errors: [CBL, CBL, CBL] });
  if (!r) return;
  assert.deepEqual(summary(r), [['OPTIMIZED', 'failed'], ['OPTIMIZED', 'failed'], ['CINEMATIC', 'failed']]);
  assert.equal(r.build_calls, 3);
  const attempts = r.report.stages.assemble.attempts;
  assert.deepEqual(attempts.map((x) => x.attempt), [1, 2, 3]);
  assert.ok(attempts.every((x) => /Cannot break link/.test(x.error) && typeof x.seconds === 'number'));
  assert.match(r.report.stages.assemble.order_reason, /optimized again after that error/);
  assert.equal(r.report.done, true);
});

test('editor script: a build that succeeds on attempt 2 stops there, and the Cine pipeline is never tried', () => {
  const r = runEditorStub({ pie_wait_seconds: 5 }, { build_errors: [CBL, null, null] });
  if (!r) return;
  assert.deepEqual(summary(r), [['OPTIMIZED', 'failed'], ['OPTIMIZED', 'built']]);
  assert.equal(r.build_calls, 2);
  assert.equal(r.report.stages.assemble.pipeline, 'OPTIMIZED');
  assert.ok(r.report.stages.assemble.blueprint);
});

test('editor script: an error that is not the Control Rig one skips the optimized retry and goes to the Cine pipeline', () => {
  const r = runEditorStub({ pie_wait_seconds: 5 }, { build_errors: ['RuntimeError: something else', null] });
  if (!r) return;
  assert.deepEqual(summary(r), [['OPTIMIZED', 'failed'], ['OPTIMIZED', 'skipped'], ['CINEMATIC', 'built']]);
  assert.match(r.report.stages.assemble.attempts[1].skipped, /retry only after 'Cannot break link'/);
  assert.equal(r.build_calls, 2);
});

test('the launch budget covers three build attempts, the Blueprint wait after each, and the capture', () => {
  const plan = buildPlan({ groups: GROUPS });
  const worstBuild = plan.pipelines.length * (300 + plan.build_wait_seconds);
  assert.ok(plan.launch_budget_seconds[0] > worstBuild + plan.capture_budget_seconds + 600, `${plan.launch_budget_seconds[0]} s covers ${worstBuild} s of builds`);
});

test('editor script: a start-up failure, an exception and an expired budget each end with a final report', () => {
  const python = readFileSync(EDITOR, 'utf8');
  assert.match(python, /"end_reason": "start-up failure"/);
  assert.match(python, /finish\("exception"\)/);
  assert.match(python, /finish\("launch budget exceeded"\)/);
});
