import { documentSchema, receiptSchema, sourceSchema, validateSchema } from './schema.mjs';
import { budgetEligibility, closeNumber, summarize } from './statistics.mjs';
import { pngDimensions, readWav, rmsDb, safeRelativePath, sha256 } from './artifacts.mjs';
import { evaluateCaptureHold } from './capture.mjs';
export { budgetEligibility, summarize, sha256 };
export { evaluateCaptureHold };

const result = (issues, extra = {}) => ({ valid: issues.length === 0, issues, ...extra });
const add = (issues, code, path, message) => issues.push({ code, path, message });
const duplicate = (values) => new Set(values).size !== values.length;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A malformed request still has an exact byte identity and a deterministic refusal envelope. */
export function requestEnvelope(request, requestSha256) {
  return {
    request_id: typeof request?.request_id === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(request.request_id) ? request.request_id : `invalid-${requestSha256}`,
    kind: ['replay', 'shot', 'observation'].includes(request?.kind) ? request.kind : 'observation',
  };
}

export function validateDocument(document) {
  const issues = validateSchema(document, documentSchema);
  if (issues.length) return result(issues);
  for (const name of ['warmup', 'settle']) if (document[name].min_seconds > document[name].max_seconds) add(issues, 'document.stage_bounds', `$.${name}`, 'minimum exceeds bounded maximum');
  if (duplicate(document.phases.map((phase) => phase.name))) add(issues, 'document.duplicate_phase', '$.phases', 'phase names must be unique');
  const ids = [];
  let observationCount = 0;
  document.phases.forEach((phase, index) => {
    const path = `$.phases[${index}]`;
    let previous = -1;
    phase.actions.forEach((action, actionIndex) => {
      if (action.at < previous || action.at >= phase.seconds) add(issues, 'document.action_time', `${path}.actions[${actionIndex}]`, 'actions must be ordered and occur before the phase ends');
      previous = action.at;
    });
    for (const check of phase.checks) {
      ids.push(check.id); observationCount++;
      if (check.min > check.max) add(issues, 'document.check_range', path, 'check minimum exceeds maximum');
      if (check.metric.startsWith('frame.')) add(issues, 'document.reserved_metric', path, 'frame timing uses the budget contract, not consumer metrics');
    }
    if (phase.capture) { ids.push(phase.capture.id); observationCount++; }
    if (phase.audio) {
      ids.push(phase.audio.id); observationCount++;
      if (phase.audio.min_rms_db > phase.audio.max_rms_db) add(issues, 'document.audio_range', path, 'audio minimum exceeds maximum');
    }
  });
  if (duplicate(ids)) add(issues, 'document.duplicate_check', '$.phases', 'metric, capture and audio check IDs must be globally unique');
  if (!observationCount) add(issues, 'document.no_observations', '$.phases', 'at least one metric, capture or audio observation is required');
  if (document.kind === 'shot' && !document.phases.some((phase) => phase.capture)) add(issues, 'document.shot_missing', '$.phases', 'shot scenarios require a capture');
  if (document.budget && !document.phases.some((phase) => phase.measure)) add(issues, 'document.unmeasured_budget', '$.budget', 'budget requires a measured phase');
  if (document.budget && document.budget.cache_state !== document.cache.requested) add(issues, 'document.cache_request', '$.budget.cache_state', 'budget cache requirement differs from requested preparation');
  return result(issues);
}

export function validateSourceManifest(manifest) {
  const issues = validateSchema(manifest, sourceSchema);
  if (issues.length) return result(issues);
  if (duplicate(manifest.files.map((file) => file.path.toLowerCase()))) add(issues, 'source.duplicate', '$.files', 'source paths must be unique ignoring case');
  for (const file of manifest.files) if (!safeRelativePath(file.path) || file.path.toLowerCase() === 'source-version.json') add(issues, 'source.path', '$.files', 'source file path must be contained, relative, and not the manifest itself');
  return result(issues);
}

/** Bytes are supplied by the caller; this function never overwrites a consumer copy. */
export function verifySourceFiles(manifest, files) {
  const checked = validateSourceManifest(manifest);
  if (!checked.valid) return checked;
  const modified_files = manifest.files.filter((file) => !files?.[file.path] || sha256(files[file.path]) !== file.sha256).map((file) => file.path);
  const extra = Object.keys(files ?? {}).filter((path) => !manifest.files.some((file) => file.path === path));
  modified_files.push(...extra);
  return { valid: true, issues: [], state: modified_files.length ? 'modified' : 'pristine', modified_files: modified_files.sort() };
}

function compareSummary(issues, actual, expected, path) {
  if (expected === null) { if (actual !== null) add(issues, 'receipt.timing_unmeasured', path, 'no measured samples requires a null summary'); return; }
  if (!actual || actual.count !== expected.count || ['mean_ms', 'p95_ms', 'p99_ms', 'max_ms'].some((key) => !closeNumber(actual[key], expected[key]))) add(issues, 'receipt.trace_statistics', path, 'summary does not recompute from the measured trace');
}

function aggregate(rows, check) {
  const samples = rows.map((row) => row.metrics[check.metric]);
  if (!samples.length || samples.some((sample) => !sample?.available)) return { available: false, value: null, passed: false, reason: 'metric_unavailable' };
  const values = samples.map((sample) => sample.value);
  const value = check.aggregation === 'last' ? values.at(-1) : check.aggregation === 'min' ? values.reduce((a, b) => Math.min(a, b)) : check.aggregation === 'max' ? values.reduce((a, b) => Math.max(a, b)) : values.reduce((sum, x) => sum + x / values.length, 0);
  return { available: true, value, passed: value >= check.min && value <= check.max, reason: value >= check.min && value <= check.max ? 'passed' : 'expectation_failed' };
}

/**
 * Pure receipt validation. requestSha256 is the digest of the exact request file bytes.
 * artifacts maps relative artifact paths to bytes, never trusted existence/hash flags.
 * A valid failure receipt has outcome failed/rejected, never passed.
 */
export function validateReceipt(receipt, request, { requestSha256, expectedSource, artifacts = {} } = {}) {
  const issues = validateSchema(receipt, receiptSchema);
  if (issues.length) return result(issues, { outcome: 'invalid' });
  const complain = (code, path, message) => add(issues, code, path, message);
  if (!/^[a-f0-9]{64}$/.test(requestSha256 ?? '') || receipt.request_sha256 !== requestSha256) complain('receipt.request_digest', '$.request_sha256', 'receipt does not bind the caller-supplied exact request bytes');
  const envelope = requestEnvelope(request, requestSha256);
  if (receipt.request_id !== envelope.request_id || receipt.kind !== envelope.kind) complain('receipt.request_identity', '$.request_id', 'request identity or scenario kind differs from its exact-byte envelope');
  const source = receipt.producer.source;
  if (!expectedSource || source.plugin_version !== expectedSource.plugin_version || source.manifest_sha256 !== expectedSource.manifest_sha256 || source.state !== expectedSource.state || !same([...source.modified_files].sort(), [...(expectedSource.modified_files ?? [])].sort())) complain('receipt.source_anchor', '$.producer.source', 'source identity must match independently supplied manifest and source-copy verification');
  if (source.plugin_version !== receipt.producer.version || (source.state === 'pristine') !== (source.modified_files.length === 0)) complain('receipt.source_identity', '$.producer', 'producer version or modified source state contradicts its details');
  if (!receipt.input.released || receipt.input.keys_remaining.length || receipt.input.axes_remaining.length) complain('receipt.input_not_released', '$.input', 'all injected inputs must be released, including on failure');
  const prevalidation = ['structural_validation', 'live_validation'].includes(receipt.execution.stage);
  const requestCheck = validateDocument(request);
  if (prevalidation) {
    if (receipt.success || receipt.actions.length || receipt.trace.length || receipt.checks.length || receipt.captures.length || receipt.audio.length || receipt.artifacts.length || Object.entries(receipt.execution).some(([key, value]) => key !== 'stage' && value !== 0)) complain('receipt.validation_actions', '$.execution', 'validation refusal must precede every scenario action and observation');
    if (!receipt.validation.issues.length || receipt.validation.live || receipt.reason !== 'validation_refused') complain('receipt.validation_reason', '$.validation', 'refusal requires reasoned validation issues and an incomplete live validation');
    if (receipt.execution.stage === 'structural_validation') {
      if (requestCheck.valid || receipt.validation.structural) complain('receipt.validation_stage', '$.validation', 'structural refusal requires a structurally invalid request');
      for (const issue of requestCheck.issues) if (!receipt.validation.issues.some((record) => record.code === issue.code && record.path === issue.path)) complain('receipt.validation_issue', '$.validation.issues', 'structural issue does not match independent validation');
    } else {
      if (!requestCheck.valid || !receipt.validation.structural) complain('receipt.validation_stage', '$.validation', 'live refusal requires valid structure');
      if (receipt.validation.issues.some((issue) => !['unknown_metric', 'unknown_command', 'unknown_key', 'sandbox_unavailable'].includes(issue.code))) complain('receipt.validation_code', '$.validation.issues', 'live refusal must name an actual metric, command, key or sandbox validation failure');
    }
    if (receipt.timings.measured !== null || receipt.timings.unmeasured_frames || receipt.timings.phases.length || receipt.budget !== null) complain('receipt.validation_observations', '$.timings', 'refusal cannot carry measured observations or a budget verdict');
    return result(issues, { outcome: issues.length ? 'invalid' : 'rejected', refusal: receipt.validation.issues });
  }
  if (!requestCheck.valid) { complain('receipt.invalid_request_executed', '$.execution', 'invalid request reached execution'); return result(issues, { outcome: 'invalid' }); }
  if (!receipt.validation.structural || !receipt.validation.live || receipt.validation.issues.length) complain('receipt.validation_missing', '$.validation', 'execution requires completed structural and live validation');
  if (!receipt.environment) complain('receipt.environment_missing', '$.environment', 'execution must identify the observed environment');
  if (receipt.cache.requested !== request.cache.requested || receipt.cache.preparation !== request.cache.preparation) complain('receipt.cache_request', '$.cache', 'cache request differs from the supplied document');
  const complete = receipt.execution.stage === 'complete';
  if (!complete && receipt.success) complain('receipt.incomplete_success', '$.success', 'an incomplete run cannot succeed');
  if (receipt.execution.phases_started > request.phases.length || receipt.execution.phases_completed > receipt.execution.phases_started) complain('receipt.phase_count', '$.execution', 'phase counts are contradictory');
  if (complete && (receipt.execution.phases_started !== request.phases.length || receipt.execution.phases_completed !== request.phases.length)) complain('receipt.phase_count', '$.execution', 'completed run must finish every phase');
  for (const stage of ['warmup', 'settle']) {
    const observed = receipt.execution[`${stage}_seconds`];
    if (observed > request[stage].max_seconds + 1 || (complete && observed < request[stage].min_seconds)) complain('receipt.stage_bounds', `$.execution.${stage}_seconds`, 'observed stage is outside the requested bounds');
    if (complete && receipt.execution[`${stage}_frames`] === 0) complain('receipt.stage_frames', `$.execution.${stage}_frames`, 'completed bounded stage requires real frame observations');
  }
  const phaseRows = new Map(request.phases.map((phase) => [phase.name, []]));
  let previousFrame = -1, previousPhase = -1;
  for (const row of receipt.trace) {
    const index = request.phases.findIndex((phase) => phase.name === row.phase), rows = phaseRows.get(row.phase);
    if (!rows || row.frame <= previousFrame || index < previousPhase || (rows.length && row.elapsed_seconds <= rows.at(-1).elapsed_seconds)) complain('receipt.trace_order', '$.trace', 'frames and phase elapsed times must increase in declared phase order');
    else rows.push(row);
    previousFrame = row.frame; previousPhase = index;
  }
  if (duplicate(receipt.timings.phases.map((phase) => phase.name))) complain('receipt.duplicate_phase', '$.timings.phases', 'phase summaries must be unique');
  if (receipt.timings.phases.length !== request.phases.length) complain('receipt.phase_summaries', '$.timings.phases', 'one timing entry is required for each requested phase, including unmeasured phases');
  const measured = []; let unmeasured = 0, recomputedPass = true;
  const expectedChecks = [];
  for (const phase of request.phases) {
    const rows = phaseRows.get(phase.name), summary = receipt.timings.phases.find((entry) => entry.name === phase.name);
    if (complete && (!rows.length || rows.at(-1).elapsed_seconds + 1e-6 < phase.seconds)) complain('receipt.truncated_phase', '$.trace', `phase ${phase.name} has no complete observed duration`);
    if (phase.measure) { for (const row of rows) measured.push(row.wall_frame_ms); } else unmeasured += rows.length;
    if (!summary || summary.measured !== phase.measure) complain('receipt.phase_measure', '$.timings.phases', 'phase measurement state differs from the request');
    compareSummary(issues, summary?.summary, phase.measure && rows.length ? summarize(rows.map((row) => row.wall_frame_ms)) : null, `$.timings.phases.${phase.name}`);
    for (const check of phase.checks) {
      if (!complete && !receipt.checks.some((record) => record.id === check.id)) continue;
      const expected = { id: check.id, phase: phase.name, ...aggregate(rows, check) }; expectedChecks.push(expected);
      const actual = receipt.checks.find((record) => record.id === check.id);
      if (!actual || actual.phase !== phase.name || actual.available !== expected.available || actual.passed !== expected.passed || actual.reason !== expected.reason || (expected.value === null ? actual.value !== null : !closeNumber(actual.value, expected.value))) complain('receipt.check_disagreement', '$.checks', `check ${check.id} does not recompute from observations`);
      if (!expected.passed) recomputedPass = false;
    }
  }
  compareSummary(issues, receipt.timings.measured, measured.length ? summarize(measured) : null, '$.timings.measured');
  if (receipt.timings.unmeasured_frames !== unmeasured) complain('receipt.unmeasured_count', '$.timings.unmeasured_frames', 'unmeasured count differs from the trace');
  if (duplicate(receipt.checks.map((check) => check.id)) || receipt.checks.length !== expectedChecks.length) complain('receipt.check_count', '$.checks', 'missing, extra or duplicate metric check records');
  const expectedActions = request.phases.flatMap((phase) => phase.actions.map((action, index) => ({ phase: phase.name, index, action })));
  if (receipt.actions.length !== receipt.execution.actions_executed || duplicate(receipt.actions.map((action) => `${action.phase}:${action.index}`)) || (complete && receipt.actions.length !== expectedActions.length)) complain('receipt.action_count', '$.actions', 'executed action count differs from requested unique actions');
  for (const action of receipt.actions) {
    const expected = expectedActions.find((entry) => entry.phase === action.phase && entry.index === action.index), row = receipt.trace.find((entry) => entry.frame === action.frame && entry.phase === action.phase);
    if (!expected || !row || row.elapsed_seconds + 1e-6 < expected.action.at) complain('receipt.action_identity', '$.actions', 'action is undeclared or not bound to its observed execution frame');
  }
  const injected = expectedActions.filter((entry) => receipt.actions.some((action) => action.phase === entry.phase && action.index === entry.index)).filter((entry) => entry.action.type !== 'command');
  for (const { action } of injected) if (!receipt.input.release_events.some((event) => event.type === action.type && event.key === action.key && event.value === 0)) complain('receipt.input_release_evidence', '$.input.release_events', 'injected key or axis lacks a cleanup event');
  if (duplicate(receipt.artifacts.map((artifact) => artifact.path.toLowerCase()))) complain('receipt.artifact_duplicate', '$.artifacts', 'artifact paths must be unique ignoring case');
  const verifiedArtifacts = new Map();
  for (const artifact of receipt.artifacts) {
    if (!safeRelativePath(artifact.path)) { complain('receipt.artifact_path', '$.artifacts', 'artifact path must be contained and relative'); continue; }
    const bytes = artifacts[artifact.path];
    if (!bytes || bytes.byteLength !== artifact.bytes || sha256(bytes) !== artifact.sha256) complain('receipt.artifact_missing_or_tampered', '$.artifacts', `artifact ${artifact.path} is absent, truncated or has a different hash`);
    else verifiedArtifacts.set(artifact.path, { bytes, kind: artifact.kind });
  }
  const requestedCaptures = request.phases.filter((phase) => phase.capture), requestedAudio = request.phases.filter((phase) => phase.audio);
  for (const [kind, phases] of [['captures', requestedCaptures], ['audio', requestedAudio]]) {
    const records = receipt[kind];
    if (duplicate(records.map((entry) => entry.id)) || (complete && records.length !== phases.length) || records.some((entry) => !phases.some((phase) => phase[kind === 'captures' ? 'capture' : 'audio'].id === entry.id && phase.name === entry.phase))) complain('receipt.observation_count', `$.${kind}`, 'missing, extra or duplicate requested observations');
  }
  for (const record of receipt.captures) {
    const phase = requestedCaptures.find((entry) => entry.capture.id === record.id);
    if (!phase) continue;
    const artifact = verifiedArtifacts.get(record.artifact);
    if (!record.available) { recomputedPass = false; if (record.artifact !== null || record.reason === 'passed') complain('receipt.capture_unavailable', '$.captures', 'unavailable capture must have an explicit failure and no artifact'); continue; }
    try {
      const hold = evaluateCaptureHold(record.timeline, { minSettleSeconds: request.settle.min_seconds, waitSeconds: phase.capture.wait_seconds });
      if (!hold.complete || hold.hold_frames !== record.hold_frames || !closeNumber(hold.hold_seconds, record.hold_seconds) || hold.compile_restarts !== record.compile_restarts || hold.pending_settled !== record.pending_settled) complain('receipt.capture_timeline', '$.captures', 'hold evidence does not recompute from actual tick observations');
    } catch (error) { complain('receipt.capture_timeline', '$.captures', error.message); }
    if (!artifact || artifact.kind !== 'screenshot' || record.hold_frames < 90 || record.hold_seconds < phase.capture.wait_seconds || !record.pending_settled || record.reason !== 'passed') complain('receipt.capture_hold', '$.captures', 'capture requires a verified screenshot after 90 settled real frames and a settled pending interval');
    else try { const dimensions = pngDimensions(artifact.bytes); if (receipt.environment && !same(dimensions, receipt.environment.resolution)) complain('receipt.capture_resolution', '$.captures', 'screenshot dimensions differ from observed resolution'); } catch (error) { complain('receipt.capture_artifact', '$.captures', error.message); }
  }
  for (const record of receipt.audio) {
    const phase = requestedAudio.find((entry) => entry.audio.id === record.id);
    if (!phase) continue;
    if (!record.available) { recomputedPass = false; if (record.artifact !== null || record.rms_db !== null || record.reason === 'passed') complain('receipt.audio_unavailable', '$.audio', 'unavailable audio cannot supply a successful measurement'); continue; }
    const artifact = verifiedArtifacts.get(record.artifact);
    if (!artifact || artifact.kind !== 'audio' || record.tap !== 'master-mix') { complain('receipt.audio_tap', '$.audio', 'requested audio requires verified master-mix bytes'); continue; }
    try {
      const wav = readWav(artifact.bytes);
      if (record.start_frame !== 0 || record.frame_count !== wav.frame_count || receipt.audio.filter((entry) => entry.artifact === record.artifact).length !== 1) { complain('receipt.audio_window', '$.audio', 'each phase must provide its own entire recording, without selective or reused windows'); continue; }
      if (wav.sample_rate !== record.sample_rate || wav.channels !== record.channels || record.frame_count + 1 < phase.seconds * wav.sample_rate) { complain('receipt.audio_truncated', '$.audio', 'recording format or phase duration does not match'); continue; }
      const value = rmsDb(wav, record.start_frame, record.frame_count), passed = value >= phase.audio.min_rms_db && value <= phase.audio.max_rms_db;
      if (!closeNumber(record.rms_db, value) || record.reason !== (passed ? 'passed' : 'expectation_failed')) complain('receipt.audio_disagreement', '$.audio', 'audio result does not recompute from the actual recorded samples');
      if (!passed) recomputedPass = false;
    } catch (error) { complain('receipt.audio_invalid', '$.audio', error.message); }
  }
  if (receipt.execution.checks_observed !== receipt.checks.length + receipt.captures.length + receipt.audio.length) complain('receipt.observed_count', '$.execution.checks_observed', 'observed check count contradicts actual records');
  if (request.budget) {
    const eligibility = receipt.environment ? budgetEligibility(request.budget, receipt.environment, receipt.cache, receipt.contention) : { eligible: false, reasons: ['environment_missing'], limitation: 'hardware_targeted' };
    const stats = measured.length ? summarize(measured) : null;
    const passed = !!stats && eligibility.eligible && stats.mean_ms <= request.budget.max_mean_ms && stats.p95_ms <= request.budget.max_p95_ms && stats.p99_ms <= request.budget.max_p99_ms && stats.max_ms <= request.budget.max_ms;
    const expected = { ...eligibility, passed };
    if (!receipt.budget || receipt.budget.eligible !== expected.eligible || receipt.budget.passed !== passed || !same(receipt.budget.reasons, expected.reasons) || receipt.budget.limitation !== expected.limitation) complain('receipt.budget_disagreement', '$.budget', 'budget eligibility or verdict differs from observed cache, hardware, contention and trace');
    if (!passed) recomputedPass = false;
  } else if (receipt.budget !== null) complain('receipt.unrequested_budget', '$.budget', 'receipt has a budget the request did not declare');
  if (complete && (receipt.success !== recomputedPass || receipt.reason !== (recomputedPass ? 'passed' : 'checks_failed'))) complain('receipt.verdict_disagreement', '$.success', 'headline verdict contradicts independently recomputed checks');
  return result(issues, { outcome: issues.length ? 'invalid' : receipt.success ? 'passed' : 'failed' });
}
