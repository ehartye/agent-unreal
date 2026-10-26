// node --test examples/unreal/gameplay_cameras/gameplay-cameras.test.mjs  (no Unreal, no dependencies)
// ASSUMED SHAPE: no run of this probe exists yet. The reports below follow what CameraProbeGame.cpp Snapshot() and the two scenario
// builders write, with values the rigs' numbers predict (boom offset -400, 0, 100 cm; modifier 95 degrees and 120 cm back; base 78
// degrees). A first engine run confirms the shape and the values. Each test changes one fact and expects the matching check to fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize, progress, elapsed } from './gameplay-cameras-checks.mjs';

const snap = (label, over = {}) => ({
  label, frame: 100, world_time: 10, real_time: 10, time_dilation: 1, eye: [0, 0, 0], rotation: [0, 0, 0], fov: 78,
  view_target: 'CameraProbePawn_0', pending_target: 'None', blend_time_to_go: 0, pawn: [0, 0, 1000], distance_to_pawn: 412.3, ...over,
});

function rigSession(host) {
  const manager = host === 'manager';
  const trace = [];
  for (let i = 0; i < 10; i++) trace.push(snap(`follow_second_${i + 1}`, { distance_to_pawn: 412.3 + 600 * Math.exp(-(i + 1) * 0.9) }));
  trace[9].distance_to_pawn = 412.5;
  return {
    log: 'LogCameraProbe: Display: CameraProbe report written (done)',
    report: {
      host, engine_version: '5.8.2-0+++UE5+Release-5.8', fixed_step: true, fixed_delta: 1 / 30, finished: 'done', frames: 640, errors: [],
      setup: {
        camera_manager_class: manager ? 'GameplayCamerasPlayerCameraManager' : 'PlayerCameraManager', pawn_class: 'CameraProbePawn', pawn_possessed: true,
        component_found: true, standalone_camera_system: !manager, base_rig_clean: true, sprint_rig_clean: true, sprint_enter_transitions: 1,
        sprint_exit_transitions: 1, base_has_root: true, ...(manager ? { manager_is_gameplay_cameras: true } : {}), has_evaluation_context: true,
      },
      rest: snap('rest', { expected_eye: [-300, -250, 930], expected_distance: 412.3, expected_fov: 78, eye_error_cm: 0.4 }),
      follow_first_frames: Array.from({ length: 12 }, (_, i) => snap(`follow_frame_${i}`, { distance_to_pawn: 1100 - i * 30 })),
      follow_trace: trace,
      mode_on_start: { id_valid: true },
      mode_on_mid: snap('mode_on_mid', { fov: 86.4 }),
      mode_on: snap('mode_on', { fov: 95, distance_to_pawn: 529.6, expected_distance: 529.5, expected_fov: 95 }),
      mode_off_mid: snap('mode_off_mid', { fov: 86.5 }),
      mode_off: snap('mode_off', { fov: 78, distance_to_pawn: 412.4 }),
      dilated_start: snap('dilated_start', { time_dilation: 0.0001, real_time: 20, world_time: 18 }),
      dilated_id: { id_valid: true },
      dilated_end: snap('dilated_end', { time_dilation: 0.0001, real_time: 22.03, world_time: 18.0002, fov: 78.01 }),
      dilated_after_stop: snap('dilated_after_stop', { time_dilation: 0.0001, fov: 78 }),
      restored: snap('restored', { time_dilation: 1 }),
    },
  };
}

function stockSession() {
  const cams = (over) => ({ photo_camera_fov: 30, base_camera_fov: 78, eye_to_photo_camera_cm: 2236, eye_to_base_camera_cm: 0.1, ...over });
  return {
    log: 'LogCameraProbe: Display: CameraProbe report written (done)',
    report: {
      host: 'stock', engine_version: '5.8.2-0+++UE5+Release-5.8', fixed_step: true, fixed_delta: 1 / 30, finished: 'done', frames: 230, errors: [],
      setup: { camera_manager_class: 'PlayerCameraManager', cameras_spawned: true },
      base: snap('base', { ...cams({}), view_target: 'CameraActor_0' }),
      control_done: snap('control_done', { ...cams({ eye_to_photo_camera_cm: 0.2, eye_to_base_camera_cm: 2236 }), fov: 30, view_target: 'CameraActor_1' }),
      control_back: snap('control_back', { ...cams({}), fov: 78 }),
      stalled_start: snap('stalled_start', { ...cams({}), time_dilation: 0.0001, real_time: 40, world_time: 30, pending_target: 'None' }),
      stalled: snap('stalled', { ...cams({}), time_dilation: 0.0001, real_time: 42.03, world_time: 30.0002, pending_target: 'CameraActor_1', blend_time_to_go: 0.3499, fov: 78 }),
      cut: snap('cut', { ...cams({ eye_to_photo_camera_cm: 0.1, eye_to_base_camera_cm: 2236 }), time_dilation: 0.0001, fov: 30 }),
      cut_back: snap('cut_back', { ...cams({}), time_dilation: 0.0001, fov: 78 }),
    },
  };
}

const good = () => ({
  build: { exit: 0, log: 'Result: Succeeded' },
  sessions: { manager: rigSession('manager'), component: rigSession('component'), stock: stockSession() },
});
const failing = (input) => evaluate(input).filter((c) => !c.pass).map((c) => c.name);
const mutate = (fn) => { const g = good(); fn(g); return g; };

test('every check passes on the predicted reports', () => {
  assert.deepEqual(failing(good()), []);
  assert.deepEqual(summarize(evaluate(good())), { passed: 1 + 2 * 10 + 6, total: 1 + 2 * 10 + 6 });
});

test('progress and elapsed are plain arithmetic and tolerate missing values', () => {
  assert.equal(progress(86.5, 78, 95), 0.5);
  assert.equal(progress(undefined, 78, 95), undefined);
  assert.equal(progress(80, 80, 80), undefined);
  assert.deepEqual(elapsed({ real_time: 1, world_time: 2 }, { real_time: 3, world_time: 2.5 }), { real: 2, world: 0.5 });
  assert.deepEqual(elapsed(undefined, {}), { real: undefined, world: undefined });
});

test('a failed build fails the build check', () => {
  assert.ok(failing(mutate((g) => { g.build = { exit: 1, log: 'error C2065' }; })).includes('module compiles'));
});

test('a session left out is not judged, and a missing report fails its checks without throwing', () => {
  const only = good(); delete only.sessions.component; delete only.sessions.stock;
  assert.deepEqual(failing(only), []);
  assert.equal(evaluate(only).length, 1 + 10);
  const none = mutate((g) => { g.sessions.manager = { report: undefined, log: '' }; });
  assert.ok(failing(none).includes('manager: session ran'));
  assert.ok(failing(none).includes('manager: eye at rest'));
  assert.ok(!failing(none).some((n) => n.startsWith('component:')));
});

test('a camera-system error or a fatal error in the log fails the session check', () => {
  assert.deepEqual(failing(mutate((g) => { g.sessions.manager.log = 'LogCameraSystem: Error: Can\'t run AttatchToPlayerPawn camera node because the player controller has no pawn.'; })), ['manager: session ran']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.stock.log = 'Fatal error: [File:Unknown] [Line: 1]'; })), ['stock: session ran']);
});

test('a free-running time step fails the session check', () => {
  assert.deepEqual(failing(mutate((g) => { g.sessions.component.report.fixed_step = false; })), ['component: session ran']);
});

test('each rig check fails when its fact changes', () => {
  assert.deepEqual(failing(mutate((g) => { g.sessions.manager.report.setup.camera_manager_class = 'PlayerCameraManager'; })), ['manager: host']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.component.report.setup.standalone_camera_system = false; })), ['component: host']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.manager.report.setup.sprint_exit_transitions = 0; })), ['manager: rigs from the assembler']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.manager.report.setup.pawn_possessed = false; })), ['manager: rigs from the assembler']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.manager.report.rest.eye_error_cm = 40; })), ['manager: eye at rest']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.manager.report.rest.fov = 90; })).slice(0, 1), ['manager: eye at rest']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.component.report.follow_first_frames.forEach((f) => { f.distance_to_pawn = 413; }); })), ['component: boom lag after a move']);
  // the settled distance is the reference for the two modifier checks, so an unsettled boom fails them as well
  assert.deepEqual(failing(mutate((g) => { g.sessions.component.report.follow_trace[9].distance_to_pawn = 700; })).slice(0, 1), ['component: boom lag after a move']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.manager.report.mode_on_start.id_valid = false; })), ['manager: modifier rig starts and blends in']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.manager.report.mode_on_mid.fov = 95; })), ['manager: modifier rig starts and blends in']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.manager.report.mode_on.distance_to_pawn = 412.5; })), ['manager: modifier rig starts and blends in']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.manager.report.mode_off.fov = 95; })), ['manager: modifier rig stops and blends out']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.component.report.mode_off_mid.fov = 78; })), ['component: modifier rig stops and blends out']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.manager.report.restored.time_dilation = 0.5; })), ['manager: time restored']);
});

test('the dilation checks fail when the blend progresses or no real time passed', () => {
  assert.deepEqual(failing(mutate((g) => { g.sessions.manager.report.dilated_end.fov = 95; })), ['manager: enter blend at a time dilation of 0.0001']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.manager.report.dilated_end.real_time = 20.5; })), ['manager: enter blend at a time dilation of 0.0001']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.component.report.dilated_start.time_dilation = 1; })), ['component: enter blend at a time dilation of 0.0001']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.manager.report.dilated_after_stop.fov = 90; })), ['manager: immediate stop in a held world']);
});

test('each stock check fails when its fact changes', () => {
  assert.deepEqual(failing(mutate((g) => { g.sessions.stock.report.base.fov = 90; })), ['stock: starts on the base camera']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.stock.report.control_done.pending_target = 'CameraActor_1'; })), ['stock: a view blend finishes in normal time']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.stock.report.stalled.pending_target = 'None'; g.sessions.stock.report.stalled.fov = 30; })).includes('stock: the same blend never finishes in a held world'), true);
  assert.deepEqual(failing(mutate((g) => { g.sessions.stock.report.stalled.photo_camera_fov = 78; })), ['stock: reading the photo camera would have passed']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.stock.report.cut.fov = 78; })), ['stock: a cut works in a held world']);
  assert.deepEqual(failing(mutate((g) => { g.sessions.stock.report.stalled.world_time = 31; })), ['stock: the same blend never finishes in a held world']);
});
