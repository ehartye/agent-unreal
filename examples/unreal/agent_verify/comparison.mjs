import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readArtifact, collectSourceFiles, safeRelativePath } from '../../../scripts/agent-verify/artifacts.mjs';
import { sha256, validateReceipt, verifySourceFiles } from '../../../scripts/agent-verify/contracts.mjs';
import { verifyLifecycle, verifyIdentity } from '../../../scripts/lib/unreal-run/contracts.mjs';
import { verifyArtifactFiles } from '../../../scripts/lib/unreal-run/identity.mjs';

/** Narrow retained legacy receipt comparison: key transitions and speed checks.
 * This consumes actual old receipts/CSV, never reimplements the old runner.
 * Other legacy formats require their own explicitly reviewed adapter.
 */
export function verifyComparison(manifestFile) {
  const errors = [];
  try {
    const base = dirname(manifestFile), manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    const require = (condition, message) => { if (!condition) throw new Error(message); };
    require(manifest.schema_version === 1 && /^[a-f0-9]{40}$/.test(manifest.baseline_revision), 'Comparison baseline/version missing');
    const bytes = (binding) => {
      require(binding && typeof binding.path === 'string', 'Missing comparison artifact binding');
      const value = readArtifact(base, binding.path);
      require(value.length === binding.bytes && sha256(value) === binding.sha256, `Comparison artifact mismatch: ${binding.path}`);
      return value;
    };
    const json = (binding) => JSON.parse(bytes(binding).toString('utf8').replace(/^\uFEFF/, ''));
    const before = json(manifest.old.source), after = json(manifest.new.source);
    require(before.commit === manifest.baseline_revision && !before.dirty && !after.dirty, 'Comparison requires exact clean source revisions');
    const delta = bytes(manifest.adapter_delta).toString('utf8');
    require(delta.includes('diff --git ') && manifest.adapter_parent_revision === manifest.baseline_revision && manifest.adapter_revision === after.commit, 'Adapter delta/revision binding missing');
    for (const side of [manifest.old, manifest.new]) {
      const configuration = json(side.config), normalize = (path) => String(path).replaceAll('\\', '/').toLowerCase();
      const launchRequestBytes = bytes(side.launch_request), launchRequest = JSON.parse(launchRequestBytes), lifecycle = json(side.lifecycle);
      require(verifyLifecycle(lifecycle, { requestId: launchRequest.id, requestHash: sha256(launchRequestBytes) }).valid, 'Comparison game lifecycle invalid');
      const buildRequestBytes = bytes(side.build_request), buildRequest = JSON.parse(buildRequestBytes), buildLifecycle = json(side.build_lifecycle), identity = json(side.build_identity);
      require(launchRequest.operation === 'game' && buildRequest.operation === 'build' && launchRequest.arguments.some((argument) => normalize(argument) === normalize(configuration.project)) && buildRequest.arguments.some((argument) => normalize(argument) === normalize(`-Project=${configuration.project}`)) && normalize(launchRequest.cwd) === normalize(configuration.sourceRoot) && normalize(buildRequest.cwd) === normalize(configuration.sourceRoot), 'Game/build requests do not bind the same configured project/source root');
      require(typeof side.request_argument === 'string' && launchRequest.arguments.includes(side.request_argument) && sha256(readFileSync(side.request_argument.slice(side.request_argument.indexOf('=') + 1))) === sha256(bytes(side.request)), 'Compared request is not the request supplied to the game');
      require(verifyLifecycle(buildLifecycle, { requestId: buildRequest.id, requestHash: sha256(buildRequestBytes) }).valid, 'Comparison build lifecycle invalid');
      require(verifyIdentity(identity, buildLifecycle, { source: side === manifest.old ? before : after, operation: 'build' }).valid && verifyArtifactFiles(identity).valid, 'Comparison build source/products invalid');
    }
    const oldRequest = json(manifest.old.request), oldReceipt = json(manifest.old.receipt), newRequestBytes = bytes(manifest.new.request), newRequest = JSON.parse(newRequestBytes), newReceipt = json(manifest.new.receipt);
    require(JSON.stringify(oldRequest.phases.map((phase) => phase.name)) === JSON.stringify(newRequest.phases.map((phase) => phase.name)) && JSON.stringify(oldReceipt.phases.map((phase) => phase.name)) === JSON.stringify(oldRequest.phases.map((phase) => phase.name)) && newReceipt.execution.phases_completed === newRequest.phases.length, 'Complete phase inventories differ');
    require(safeRelativePath(manifest.new.plugin_source), 'Unsafe plugin source path');
    readArtifact(base, `${manifest.new.plugin_source}/source-version.json`);
    const sourceRoot = join(base, manifest.new.plugin_source);
    const sourceBytes = readArtifact(sourceRoot, 'source-version.json'), sourceManifest = JSON.parse(sourceBytes), sourceState = verifySourceFiles(sourceManifest, collectSourceFiles(sourceRoot, sourceManifest));
    const artifactMap = Object.fromEntries((manifest.new.artifacts ?? []).map((entry) => [entry.receipt_path, bytes(entry)]));
    const checked = validateReceipt(newReceipt, newRequest, { requestSha256: sha256(newRequestBytes), expectedSource: { plugin_version: sourceManifest.plugin_version, manifest_sha256: sha256(sourceBytes), state: sourceState.state, modified_files: sourceState.modified_files }, artifacts: artifactMap });
    require(checked.valid && checked.outcome === 'passed', 'New comparison observation did not independently pass');
    require(oldReceipt.success === true && oldReceipt.checks_failed === 0 && oldReceipt.validation_errors?.length === 0 && oldReceipt.save_root_validated === true, 'Old comparison did not pass its checks/save isolation');
    require(oldReceipt.engine === newReceipt.environment.engine && oldReceipt.configuration === newReceipt.environment.configuration && oldReceipt.map === newReceipt.environment.map && oldReceipt.rhi === newReceipt.environment.rhi && oldReceipt.gpu === newReceipt.environment.gpu, 'Old/new environment differs');
    require(oldReceipt.width === newReceipt.environment.resolution.width && oldReceipt.height === newReceipt.environment.resolution.height, 'Old/new resolution differs');
    const placement = json(manifest.new.initialization);
    require(JSON.stringify(placement.requested_start) === JSON.stringify(oldRequest.start) && placement.ground_hit === true && placement.teleports === 1, 'Initial placement is not matched');
    const csv = bytes(manifest.old.trace).toString('utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/), headings = csv.shift().split(',');
    const rows = csv.map((line) => Object.fromEntries(line.split(',').map((value, i) => [headings[i], headings[i] === 'phase' ? value : Number(value)])));
    require(rows.length > 0 && rows.every((row) => Number.isFinite(row.speed)), 'Old raw trace empty or nonfinite');
    const transitions = []; let held = [];
    for (const phase of oldRequest.phases) {
      require(!phase.axes && !phase.deltas && !phase.taps && !phase.console && !phase.shot, 'Comparison format only supports key-transition scenarios');
      const keys = phase.keys ?? [];
      for (const key of held) if (!keys.includes(key)) transitions.push({ phase: phase.name, key, down: false });
      for (const key of keys) if (!held.includes(key)) transitions.push({ phase: phase.name, key, down: true });
      held = keys;
    }
    require(held.length === 0, 'Comparison scenario must explicitly finish released');
    const newTransitions = newRequest.phases.flatMap((phase) => phase.actions.map((action) => {
      require(action.type === 'key' && action.at === 0, 'New comparison actions must be corresponding phase-start key transitions');
      return { phase: phase.name, key: action.key, down: action.down };
    }));
    require(JSON.stringify(transitions) === JSON.stringify(newTransitions), 'Scenario input transitions differ');
    require(oldReceipt.replay_actions === transitions.length + 1 && newReceipt.execution.actions_executed === transitions.length, 'Raw action counters do not match their declared units');
    require(Array.isArray(manifest.checks) && manifest.checks.length > 0 && oldReceipt.checks_run === manifest.checks.length && newReceipt.execution.checks_observed === manifest.checks.length, 'Missing or mismatched actual check counts');
    const oldKeys = oldRequest.phases.flatMap((phase) => Object.keys(phase.expect).map((metric) => `${phase.name}/${metric}`)).sort(), newKeys = newRequest.phases.flatMap((phase) => phase.checks.map((check) => `${phase.name}/${check.id}`)).sort();
    require(JSON.stringify(oldKeys) === JSON.stringify(manifest.checks.map((check) => `${check.phase}/${check.old_metric}`).sort()) && JSON.stringify(newKeys) === JSON.stringify(manifest.checks.map((check) => `${check.phase}/${check.new_check}`).sort()) && oldReceipt.phases.reduce((count, phase) => count + phase.checks.length, 0) === oldKeys.length && newReceipt.checks.length === newKeys.length, 'Comparison mapping omits or duplicates requested/observed checks');
    for (const mapping of manifest.checks) {
      require(['max_speed', 'end_speed'].includes(mapping.old_metric) && mapping.new_metric === 'speed', 'Unsupported measurement mapping');
      const oldPhase = oldRequest.phases.find((phase) => phase.name === mapping.phase), newPhase = newRequest.phases.find((phase) => phase.name === mapping.phase);
      require(oldPhase && newPhase && oldPhase.seconds === newPhase.seconds, 'Phase duration differs');
      const bounds = oldPhase.expect[mapping.old_metric], newCheck = newPhase.checks.find((check) => check.id === mapping.new_check);
      require(newCheck && newCheck.metric === 'speed' && newCheck.aggregation === (mapping.old_metric === 'max_speed' ? 'max' : 'last') && newCheck.min === bounds[0] && newCheck.max === bounds[1], 'Check semantics differ');
      const samples = rows.filter((row) => row.phase === mapping.phase).map((row) => row.speed);
      require(samples.length > 0, 'Old phase has no actual samples');
      const observed = mapping.old_metric === 'max_speed' ? Math.max(...samples) : samples.at(-1);
      const record = oldReceipt.phases.find((phase) => phase.name === mapping.phase)?.checks.find((check) => check.metric === mapping.old_metric);
      require(record?.pass === true && Number.isFinite(record.value) && Math.abs(record.value - observed) <= .051 && record.value >= bounds[0] && record.value <= bounds[1], 'Old check cannot be recomputed from rounded raw CSV');
      require(newReceipt.checks.find((check) => check.id === mapping.new_check)?.passed === true, 'New corresponding check failed');
    }
    return { passed: true, errors, baseline_revision: manifest.baseline_revision, adapter_revision: after.commit, checks: manifest.checks.length, matched_input_transitions: transitions.length, raw_actions: { old: oldReceipt.replay_actions, new: newReceipt.execution.actions_executed, explanation: 'Old counter includes one initialization teleport; both execute the same phase-start input transitions. New cleanup release records are separate.' }, allowed_differences: ['generic identifiers and version fields', 'nearest-rank percentiles', 'explicit measurement eligibility metadata'], limitation: 'Functional speed/input comparison; no timing-budget or physical-controller claim' };
  } catch (error) { errors.push(error.message); return { passed: false, errors }; }
}
