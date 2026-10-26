// Judges what gameplay_cameras.mjs collects: the build result and, for each of three game sessions, the JSON report that the
// CameraProbe game mode writes and the engine log. Pure functions, no Unreal and no dependencies.
//
// Sessions:
//   manager   - the camera manager is AGameplayCamerasPlayerCameraManager and runs the camera system; the pawn's component only
//               supplies the evaluation context (bRunStandaloneCameraSystem false).
//   component - the pawn's component runs its own camera system and drives a child camera component; the manager is the stock one.
//   stock     - two camera actors and the stock view-target blend, in normal time and in a world held at 0.0001 of real time.
//
// Report shape (confirmed by runs on 5.8.2; see the README): every key below is a snapshot written by CameraProbeGame.cpp Snapshot():
//   { label, frame, world_time, real_time, time_dilation, eye[3], rotation[3], fov, view_target, pending_target, blend_time_to_go,
//     pawn[3], distance_to_pawn }, plus the extra fields named in the checks. A view target that is not set reads "None".

const near = (value, expected, tolerance) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value - expected) <= tolerance;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const fixed = (n, d = 1) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d) : 'n/a');

export const SPRINT_FOV = 95;
export const BASE_FOV = 78;
export const PHOTO_FOV = 30;
export const HELD_DILATION = 0.0001;

/** Fraction of the way from `from` to `to` that `value` has travelled (0 at from, 1 at to). */
export function progress(value, from, to) {
  if (![value, from, to].every((v) => typeof v === 'number' && Number.isFinite(v)) || from === to) return undefined;
  return (value - from) / (to - from);
}

/** Real seconds and world seconds that passed between two snapshots. */
export function elapsed(start, end) {
  const real = num(end?.real_time) !== undefined && num(start?.real_time) !== undefined ? end.real_time - start.real_time : undefined;
  const world = num(end?.world_time) !== undefined && num(start?.world_time) !== undefined ? end.world_time - start.world_time : undefined;
  return { real, world };
}

// An error or fatal error, or any camera-system warning except the one the camera manager's null context raises (its own check
// below counts it): see HITCH_WARNING.
const HITCH_WARNING = /LogCameraSystem: Warning: Camera rig '([^']*)' may experience a hitch because its initial result isn't valid\./g;
const BAD_LOG = /Fatal error|LogCameraSystem: Error|LogCameraSystem: Warning: (?!Camera rig '[^']*' may experience a hitch because its initial result isn't valid\.)/;
const hitchWarnings = (log) => [...(log ?? '').matchAll(HITCH_WARNING)].map((m) => m[1]);

const sessionRan = (label, s) => {
  const r = s?.report;
  const errors = r?.errors ?? [];
  const bad = BAD_LOG.exec(s?.log ?? '');
  return {
    name: `${label}: session ran`,
    claim: 'the game process started on the engine map, ran the scenario with a fixed 30 fps time step, wrote the report and the log has no camera-system error or warning',
    pass: !!r && r.finished === 'done' && errors.length === 0 && r.fixed_step === true && near(r.fixed_delta, 1 / 30, 0.001) && !bad,
    detail: !r ? 'no report was written' : `finished ${r.finished}; errors ${JSON.stringify(errors)}; fixed_step ${r.fixed_step}; fixed_delta ${fixed(r.fixed_delta, 4)}${bad ? `; log: ${bad[0]}` : ''}`,
  };
};

function rigChecks(label, s) {
  const r = s?.report;
  const setup = r?.setup ?? {};
  const rest = r?.rest;
  const first = r?.follow_first_frames ?? [];
  const trace = r?.follow_trace ?? [];
  const checks = [sessionRan(label, s)];
  const manager = label === 'manager';

  checks.push({
    name: `${label}: host`,
    claim: manager
      ? 'the player controller\'s camera manager is a GameplayCamerasPlayerCameraManager, the component runs no camera system of its own, and ActivateGameplayCamera accepts it'
      : 'with the stock camera manager the component runs its own camera system (bRunStandaloneCameraSystem true) and ActivateCameraForPlayerController creates its evaluation context',
    pass: manager
      ? setup.camera_manager_class === 'GameplayCamerasPlayerCameraManager' && setup.manager_is_gameplay_cameras === true && setup.standalone_camera_system === false && setup.has_evaluation_context === true
      : setup.camera_manager_class === 'PlayerCameraManager' && setup.standalone_camera_system === true && setup.has_evaluation_context === true,
    detail: `manager class ${setup.camera_manager_class}; standalone ${setup.standalone_camera_system}; evaluation context ${setup.has_evaluation_context}`,
  });
  const hitches = hitchWarnings(s?.log);
  const sprintHitches = hitches.filter((n) => n === 'ProbeSprintRig').length;
  checks.push({
    name: manager ? 'manager: a modifier started on the manager warns once per start' : 'component: a modifier started on the component does not warn',
    claim: manager
      ? 'StartGlobalCameraModifierRig on AGameplayCamerasPlayerCameraManager runs the rig in the manager null context, whose initial result is never marked valid (EnsureNullContext), so the blend stack logs a LogCameraSystem warning that the rig may experience a hitch because its initial result is not valid, once for each of the two starts; the view still blends (the other checks)'
      : 'StartGlobalCameraModifierRig on the component runs the rig in the component own evaluation context, whose initial result is valid, so the log has no such warning',
    pass: manager ? sprintHitches === 2 : hitches.length === 0,
    detail: `hitch warnings naming the modifier rig: ${sprintHitches}; others: ${JSON.stringify(hitches.filter((n) => n !== 'ProbeSprintRig'))}`,
  });
  checks.push({
    name: `${label}: rigs from the assembler`,
    claim: 'FCameraRigAssetAssembler builds the base rig (attach to player pawn, boom arm, collision push, field of view) and a modifier rig with hand-made enter and exit transitions; both report a clean build status, and the pawn was possessed before the camera was activated',
    pass: setup.base_rig_clean === true && setup.sprint_rig_clean === true && setup.base_has_root === true && setup.sprint_enter_transitions === 1 && setup.sprint_exit_transitions === 1 && setup.pawn_possessed === true && setup.component_found === true,
    detail: `base clean ${setup.base_rig_clean}; sprint clean ${setup.sprint_rig_clean}; enter ${setup.sprint_enter_transitions}; exit ${setup.sprint_exit_transitions}; possessed ${setup.pawn_possessed}`,
  });
  checks.push({
    name: `${label}: eye at rest`,
    claim: 'after three seconds the camera manager\'s cached view puts the eye where the rig\'s numbers say (the pawn plus the control rotation applied to the boom offset, within 5 cm) and the field of view is the base rig\'s (within 1 degree)',
    pass: !!rest && near(rest.eye_error_cm, 0, 5) && near(rest.distance_to_pawn, rest.expected_distance, 5) && near(rest.fov, BASE_FOV, 1),
    detail: rest ? `eye error ${fixed(rest.eye_error_cm)} cm; distance ${fixed(rest.distance_to_pawn)} of ${fixed(rest.expected_distance)} cm; fov ${fixed(rest.fov)}` : 'no rest snapshot',
  });

  const firstMax = Math.max(...first.map((f) => f.distance_to_pawn).filter((v) => typeof v === 'number'));
  const settled = trace.length ? trace[trace.length - 1].distance_to_pawn : undefined;
  const traceDist = trace.map((t) => t.distance_to_pawn);
  checks.push({
    name: `${label}: boom lag after a move`,
    claim: 'after the pawn moves 1000 cm in one frame with a plain move (ETeleportType::None) the eye reads far from the pawn in the first frames (more than 100 cm beyond the boom length) while the boom\'s lag catches up, and it is back within 10 cm of the boom length after ten seconds',
    pass: !!rest && first.length === 12 && Number.isFinite(firstMax) && firstMax > rest.expected_distance + 100 && trace.length === 10 && near(settled, rest.expected_distance, 10),
    detail: `largest distance in 12 frames ${fixed(firstMax)} cm; after ten seconds ${fixed(settled)} cm; per second ${traceDist.map((d) => fixed(d, 0)).join(' ')}`,
  });

  const tele = r?.teleport_frames ?? [];
  const teleMax = Math.max(...tele.map((f) => f.distance_to_pawn).filter((v) => typeof v === 'number'));
  checks.push({
    name: `${label}: a teleport is a camera cut`,
    claim: 'the same 1000 cm move as a teleport (ETeleportType::TeleportPhysics) shows no boom lag: UGameplayCameraComponentBase::OnUpdateTransform marks the next frame a camera cut, the boom arm re-uses its pull on a cut, so the eye is within 5 cm of the boom length in each of the next three frames',
    pass: !!rest && tele.length === 3 && Number.isFinite(teleMax) && tele.every((f) => near(f.distance_to_pawn, rest.expected_distance, 5)),
    detail: `distance in the three frames after the teleport (largest) ${fixed(teleMax)} of ${fixed(rest?.expected_distance)} cm; plain move peaked at ${fixed(firstMax)} cm`,
  });

  const on = r?.mode_on, mid = r?.mode_on_mid, start = r?.mode_on_start;
  const restDist = settled;
  const expectedDelta = on && rest ? on.expected_distance - rest.expected_distance : undefined;
  checks.push({
    name: `${label}: modifier rig starts and blends in`,
    claim: 'StartGlobalCameraModifierRig returns a valid instance id; halfway through the enter blend the field of view is between the base and the modifier\'s, and after the blend it is the modifier\'s (within 1.5 degrees) with the eye pulled out by the modifier\'s offset (within 20 percent)',
    pass: start?.id_valid === true && !!mid && !!on && !!rest && mid.fov > rest.fov + 1 && mid.fov < SPRINT_FOV - 1 && near(on.fov, SPRINT_FOV, 1.5)
      && typeof restDist === 'number' && near(on.distance_to_pawn - restDist, expectedDelta, Math.abs(expectedDelta) * 0.2),
    detail: `id ${start?.id_valid}; fov ${fixed(rest?.fov)} -> mid ${fixed(mid?.fov)} -> ${fixed(on?.fov)}; eye pulled out ${fixed(on && typeof restDist === 'number' ? on.distance_to_pawn - restDist : undefined)} of ${fixed(expectedDelta)} cm`,
  });
  const offMid = r?.mode_off_mid, off = r?.mode_off;
  checks.push({
    name: `${label}: modifier rig stops and blends out`,
    claim: 'StopCameraModifierRig with the exit blend: halfway through the field of view is between the modifier\'s and the base, and afterwards it is the base\'s again (within 1 degree) with the eye back at its rest distance (within 8 cm)',
    pass: !!offMid && !!off && !!rest && offMid.fov < SPRINT_FOV - 1 && offMid.fov > rest.fov + 1 && near(off.fov, rest.fov, 1) && typeof restDist === 'number' && near(off.distance_to_pawn, restDist, 8),
    detail: `fov mid ${fixed(offMid?.fov)}; after ${fixed(off?.fov)}; distance ${fixed(off?.distance_to_pawn)} cm`,
  });

  const ds = r?.dilated_start, de = r?.dilated_end, da = r?.dilated_after_stop;
  const { real, world } = elapsed(ds, de);
  const prog = progress(de?.fov, rest?.fov, SPRINT_FOV);
  checks.push({
    name: `${label}: enter blend at a time dilation of 0.0001`,
    claim: 'with the world held at 0.0001 of real time, two seconds of real time pass less than a thousandth of a second of world time and the modifier\'s enter blend has progressed less than 10 percent (the blend takes its time from the world\'s). A failure here is a finding, not a probe fault: the Gameplay Cameras evaluator then blends on time the dilation does not touch',
    pass: !!ds && !!de && r?.dilated_id?.id_valid === true && near(ds.time_dilation, HELD_DILATION, 1e-6) && typeof real === 'number' && real >= 1.5 && typeof world === 'number' && world < 0.001 && typeof prog === 'number' && prog < 0.1,
    detail: `dilation ${ds?.time_dilation}; ${fixed(real, 2)} s real, ${fixed(world, 6)} s world; fov ${fixed(rest?.fov)} -> ${fixed(de?.fov)} (progress ${fixed(prog, 3)} of the blend)`,
  });
  checks.push({
    name: `${label}: immediate stop in a held world`,
    claim: 'StopCameraModifierRig with bImmediately true leaves the view at the base field of view (within 1 degree) a few frames later, in the same held world',
    pass: !!da && !!rest && near(da.fov, rest.fov, 1), detail: `fov after stop ${fixed(da?.fov)} against ${fixed(rest?.fov)}`,
  });
  checks.push({
    name: `${label}: time restored`,
    claim: 'the probe returns the time dilation to 1 before it exits',
    pass: near(r?.restored?.time_dilation, 1, 1e-6), detail: `time dilation ${r?.restored?.time_dilation}`,
  });
  return checks;
}

function stockChecks(s) {
  const r = s?.report;
  const b = r?.base, done = r?.control_done, back = r?.control_back, st0 = r?.stalled_start, st = r?.stalled, sameFrame = r?.same_frame, cutPending = r?.cut_to_pending, cutAbort = r?.cut_abort, cut = r?.cut, cutBack = r?.cut_back;
  const checks = [sessionRan('stock', s)];
  checks.push({
    name: 'stock: starts on the base camera',
    claim: 'with the stock camera manager and a camera actor as view target, the cached view shows that actor\'s eye and field of view (78 degrees)',
    pass: !!b && near(b.fov, BASE_FOV, 0.5) && near(b.eye_to_base_camera_cm, 0, 5) && b.pending_target === 'None', detail: b ? `fov ${fixed(b.fov)}; eye ${fixed(b.eye_to_base_camera_cm)} cm from the base camera` : 'no snapshot',
  });
  checks.push({
    name: 'stock: a view blend finishes in normal time',
    claim: 'a 0.35 s view-target blend to the photo camera has finished after about 0.7 s: the view target is the photo camera, nothing is pending, and the view shows its field of view (30 degrees); a cut back restores the base view',
    pass: !!done && !!back && near(done.fov, PHOTO_FOV, 0.5) && near(done.eye_to_photo_camera_cm, 0, 5) && done.pending_target === 'None' && near(back.fov, BASE_FOV, 0.5),
    detail: done ? `fov ${fixed(done.fov)}; pending ${done.pending_target}; after the cut back ${fixed(back?.fov)}` : 'no snapshot',
  });
  const { real, world } = elapsed(st0, st);
  checks.push({
    name: 'stock: the same blend never finishes in a held world',
    claim: 'with the world held at 0.0001 of real time, two seconds of real time pass less than a thousandth of a second of world time, the photo camera is still pending, about 0.35 s of the blend remains, and the view still shows the base camera\'s field of view',
    pass: !!st0 && !!st && near(st0.time_dilation, HELD_DILATION, 1e-6) && typeof real === 'number' && real >= 1.5 && typeof world === 'number' && world < 0.001
      && st.pending_target !== 'None' && st.blend_time_to_go > 0.3 && near(st.fov, BASE_FOV, 0.5),
    detail: st ? `${fixed(real, 2)} s real, ${fixed(world, 6)} s world; pending ${st.pending_target}; blend time to go ${fixed(st.blend_time_to_go, 4)}; view fov ${fixed(st.fov)}` : 'no snapshot',
  });
  checks.push({
    name: 'stock: reading the photo camera would have passed',
    claim: 'in the stalled state the photo camera\'s own lens says 30 degrees and the view says 78: a check that reads the object it set up passes over a view that never changed, and the distance between the view\'s eye and the photo camera (more than 1000 cm) is what shows it',
    pass: !!st && near(st.photo_camera_fov, PHOTO_FOV, 0.01) && near(st.fov, BASE_FOV, 0.5) && st.eye_to_photo_camera_cm > 1000,
    detail: st ? `photo camera lens ${fixed(st.photo_camera_fov)}; view ${fixed(st.fov)}; eye ${fixed(st.eye_to_photo_camera_cm, 0)} cm from the photo camera` : 'no snapshot',
  });
  checks.push({
    name: 'stock: a blend started in the frame that sets the dilation gets one frame',
    claim: 'a 0.35 s blend started in the same frame that sets the world to 0.0001 of real time is not stalled from the first frame: the frame that sets the dilation passes its undilated delta (1/30 s) to the blend, so after two seconds of real time about 0.3167 s of the blend remains and the view has moved off the base field of view',
    pass: !!sameFrame && sameFrame.pending_target !== 'None' && near(sameFrame.blend_time_to_go, 0.35 - 1 / 30, 0.005) && sameFrame.fov < BASE_FOV - 1 && sameFrame.fov > PHOTO_FOV,
    detail: sameFrame ? `pending ${sameFrame.pending_target}; blend time to go ${fixed(sameFrame.blend_time_to_go, 4)}; view fov ${fixed(sameFrame.fov)}` : 'no snapshot',
  });
  checks.push({
    name: 'stock: a cut to the pending target does nothing',
    claim: 'in the stalled state, a cut (blend time 0) to the photo camera, which the blend is already heading for, is ignored (APlayerCameraManager::SetViewTarget returns early when the new target is the pending one): three frames later the photo camera is still pending and the view still shows the base camera field of view',
    pass: !!cutPending && cutPending.pending_target !== 'None' && near(cutPending.fov, BASE_FOV, 0.5) && cutPending.eye_to_photo_camera_cm > 1000,
    detail: cutPending ? `pending ${cutPending.pending_target}; view fov ${fixed(cutPending.fov)}; eye ${fixed(cutPending.eye_to_photo_camera_cm, 0)} cm from the photo camera` : 'no snapshot',
  });
  checks.push({
    name: 'stock: a cut back to the base camera aborts the blend',
    claim: 'a cut to the base camera, the current view target, aborts the stalled blend in a held world: nothing is pending and the view shows the base camera (78 degrees, eye at the base camera) within three frames',
    pass: !!cutAbort && cutAbort.pending_target === 'None' && near(cutAbort.fov, BASE_FOV, 0.5) && near(cutAbort.eye_to_base_camera_cm, 0, 5),
    detail: cutAbort ? `pending ${cutAbort.pending_target}; view fov ${fixed(cutAbort.fov)}; eye ${fixed(cutAbort.eye_to_base_camera_cm)} cm from the base camera` : 'no snapshot',
  });
  checks.push({
    name: 'stock: a cut works in a held world',
    claim: 'once the blend is aborted, a cut (blend time 0) to the photo camera and back takes effect within three frames although the world is held: the view shows 30 degrees at the photo camera with nothing pending, then 78 again',
    pass: !!cut && !!cutBack && near(cut.fov, PHOTO_FOV, 0.5) && near(cut.eye_to_photo_camera_cm, 0, 5) && cut.pending_target === 'None' && near(cutBack.fov, BASE_FOV, 0.5),
    detail: cut ? `cut fov ${fixed(cut.fov)}; eye ${fixed(cut.eye_to_photo_camera_cm)} cm from the photo camera; pending ${cut.pending_target}; back ${fixed(cutBack?.fov)}` : 'no snapshot',
  });
  return checks;
}

/** `sessions` maps a session name (manager, component, stock) to { report, log }; a session left out is not judged. */
export function evaluate({ build, sessions = {} }) {
  const checks = [{
    name: 'module compiles', claim: 'UBT builds the editor target with the CameraProbe module, the GameplayCameras plugin module in its dependencies and the assembler code in it (the first run is also the first compile)',
    pass: build?.exit === 0 && /Result: Succeeded/.test(build?.log ?? ''), detail: `exit ${build?.exit}`,
  }];
  for (const label of ['manager', 'component']) if (label in sessions) checks.push(...rigChecks(label, sessions[label]));
  if ('stock' in sessions) checks.push(...stockChecks(sessions.stock));
  return checks;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}
