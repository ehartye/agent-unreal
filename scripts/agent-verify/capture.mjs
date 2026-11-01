/** Pure real-frame hold rule. Each row is one actual tick, never a duration-derived frame count. */
export function evaluateCaptureHold(timeline, { minSettleSeconds, waitSeconds }) {
  let stage = 'settling', stable = 0, frames = 0, seconds = 0, restarts = 0, invalidPending = false, complete = false, lastFrame = -1;
  for (const row of timeline) {
    if (!Number.isSafeInteger(row.frame) || row.frame < 0 || (lastFrame >= 0 && row.frame !== lastFrame + 1) || !Number.isFinite(row.wall_seconds) || row.wall_seconds <= 0 || typeof row.settled !== 'boolean' || typeof row.screenshot_complete !== 'boolean' || complete) throw new Error('capture_timeline_invalid');
    lastFrame = row.frame;
    if (stage === 'pending') {
      invalidPending ||= !row.settled;
      if (row.screenshot_complete) {
        if (!invalidPending) complete = true;
        else { stage = 'settling'; stable = 0; frames = 0; seconds = 0; restarts++; invalidPending = false; }
      }
      continue;
    }
    if (row.screenshot_complete) throw new Error('capture_completion_without_request');
    if (!row.settled) {
      if (stage === 'hold' || stable > 0) restarts++;
      stage = 'settling'; stable = 0; frames = 0; seconds = 0;
    } else if (stage === 'settling') {
      stable += row.wall_seconds;
      if (stable >= minSettleSeconds) stage = 'hold';
    } else {
      frames++; seconds += row.wall_seconds;
      if (frames >= 90 && seconds >= waitSeconds) stage = 'pending';
    }
  }
  return { complete, hold_frames: frames, hold_seconds: seconds, compile_restarts: restarts, pending_settled: !invalidPending };
}
