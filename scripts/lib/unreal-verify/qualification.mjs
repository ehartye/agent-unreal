import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { validateRequest, verifyLifecycle, verifyIdentity } from '../unreal-run/contracts.mjs';
import { verifyArtifactFiles, observeToolchain } from '../unreal-run/identity.mjs';
import { operationCommand } from '../unreal-run/controller.mjs';
import { validateReceipt, sha256 } from '../../agent-verify/contracts.mjs';
import { readArtifact } from '../../agent-verify/artifacts.mjs';
import { parseReport, verdict } from '../../../examples/unreal/automation_test/automation_report.mjs';
import { json, same, OBSERVATIONS } from './manifest.mjs';

export const operationFor = step => ['build', 'package'].includes(step.kind) ? step.kind : step.kind === 'automation' ? 'test' : 'game';
export function engineArguments(step, directory) {
  const args = [...step.arguments];
  if (step.kind === 'automation') args.push(`-ExecCmds=Automation RunTests ${step.filter}; Quit`, `-ReportExportPath=${join(directory, 'report')}`);
  if (OBSERVATIONS.includes(step.kind)) args.push(`-AVRequest=${join(directory, 'input.json')}`, `-AVOutput=${join(directory, 'observation')}`);
  return args;
}
export function commandFor(step, prepared, directory) {
  return { ...operationCommand(operationFor(step), prepared.config, engineArguments(step, directory)), cwd: dirname(prepared.config.project), operation: operationFor(step), timeoutMs: step.timeout_seconds * 1000, waitMs: 60000, evidence: join(directory, 'launcher') };
}
function readFresh(directory, name, interval) {
  const bytes = readArtifact(directory, name), observed = statSync(join(directory, name)).mtimeMs;
  if (!bytes.length || observed < Date.parse(interval.started) || observed > Date.parse(interval.finished) + 1000) throw Error(`Missing, empty or stale report: ${name}`);
  return bytes;
}
export function qualifyAutomation(report, step) {
  const checked = verdict(report, { minTests: step.expected_count });
  const errors = [...checked.reasons];
  for (const key of ['succeeded', 'succeededWithWarnings', 'failed', 'notRun', 'inProcess']) if (!Number.isSafeInteger(report[key]) || report[key] < 0) errors.push(`Invalid automation count: ${key}`);
  if (report.succeeded !== step.expected_count || report.succeededWithWarnings !== 0 || report.failed !== 0 || report.notRun !== 0 || report.inProcess !== 0) errors.push('Automation exact counts disagree');
  const names = checked.tests.map(t => t.path).sort();
  if (!same(names, [...step.expected_tests].sort()) || checked.tests.some(t => t.errors !== 0 || t.warnings !== 0)) errors.push('Automation names, row errors or warning counts disagree');
  return { valid: errors.length === 0, errors, checks_run: checked.tests.length, outcome: errors.length ? 'failed' : 'passed' };
}
export function qualifyObservation(receipt, document, step, options) {
  const checked = validateReceipt(receipt, document, options), errors = checked.issues.map(i => `${i.code} ${i.path}: ${i.message}`);
  const expected = step.kind === 'rejected_replay' ? 'rejected' : 'passed';
  if (checked.outcome !== expected) errors.push(`Expected ${expected}; observed ${checked.outcome}`);
  let count = receipt?.execution?.checks_observed ?? 0;
  if (expected === 'rejected') {
    const refusals = (checked.refusal ?? []).map(({ code, path }) => ({ code, path }));
    if (!same(refusals, step.expected_refusal)) errors.push('Exact declared refusal differs');
    count = refusals.length;
  }
  if (count !== step.expected_count) errors.push('Observation exact count differs');
  for (const [key, value] of Object.entries(step.requested)) if (!same(receipt?.environment?.[key], value)) errors.push(`Requested ${key} differs from observed environment`);
  return { valid: checked.valid && errors.length === 0, errors, checks_run: count, outcome: checked.outcome };
}
export function qualifyStep(step, prepared, directory, interval, expectedCommand) {
  let lifecycle, request;
  const failure = (status, errors, extra = {}) => ({ status, errors, checks_run: 0, outcome: status, ...extra });
  try {
    if (!Number.isFinite(Date.parse(interval.started)) || !Number.isFinite(Date.parse(interval.finished)) || Date.parse(interval.finished) < Date.parse(interval.started)) throw Error('Invalid step interval');
    const requestBytes = readArtifact(join(directory, 'launcher'), 'request.json'); request = json(requestBytes);
    lifecycle = json(readArtifact(join(directory, 'launcher'), 'lifecycle.json'));
    const errors = [...validateRequest(request), ...verifyLifecycle(lifecycle, { requestId: request.id, requestHash: sha256(requestBytes), requireSuccess: false }).errors];
    const expected = expectedCommand ?? commandFor(step, prepared, directory);
    for (const key of ['operation', 'executable', 'arguments', 'cwd', 'evidence', 'timeoutMs', 'waitMs']) if (!same(request[key], expected[key])) errors.push(`Launcher ${key} differs from planned command`);
    if (Date.parse(lifecycle.started) < Date.parse(interval.started) || Date.parse(lifecycle.finished) > Date.parse(interval.finished)) errors.push('Lifecycle is outside current step interval');
    if (lifecycle.operation !== request.operation) errors.push('Lifecycle operation differs from request');
    if (errors.length) return failure('unknown', errors);
  } catch (error) { return failure('unknown', [error.message]); }
  if (lifecycle.cancelled) return failure('cancelled', ['Launcher recorded cancellation']);
  if (lifecycle.timedOut) return failure('timed_out', ['Launcher recorded timeout']);
  const expectedExit = step.kind === 'rejected_replay' ? step.expected_exit_code : 0;
  if (!lifecycle.permitIssued || lifecycle.errors.length || lifecycle.exitCode !== expectedExit) return failure('failed', ['Launcher workload exit or error differs from expectation']);
  try {
    let checked;
    if (['build', 'package'].includes(step.kind)) {
      const identity = json(readFresh(join(directory, 'launcher'), 'identity.json', interval));
      const errors = [...verifyIdentity(identity, lifecycle, { source: prepared.source, operation: step.kind }).errors, ...verifyArtifactFiles(identity).errors];
      const toolchain = observeToolchain(readArtifact(join(directory, 'launcher'), 'stdout.log').toString('utf8') + '\n' + readArtifact(join(directory, 'launcher'), 'stderr.log').toString('utf8'));
      for (const key of ['compiler', 'sdk', 'logSha256']) if (toolchain[key] !== identity.toolchain?.[key]) errors.push(`Toolchain ${key} differs from actual log`);
      if (sha256(readFileSync(join(prepared.config.engine, 'Engine/Build/Build.version'))) !== identity.engine?.buildVersionSha256 || sha256(readFileSync(join(prepared.config.engine, 'Engine/Binaries/Win64/UnrealEditor.exe'))) !== identity.engine?.executableSha256) errors.push('Observed engine bytes changed');
      const target = step.kind === 'build' ? prepared.config.editorTarget : prepared.config.gameTarget;
      if (identity.source?.dirty !== false || identity.target?.name !== target || identity.target?.configuration !== prepared.config.configuration || identity.target?.platform !== prepared.config.platform) errors.push('Build/package target or source differs');
      checked = { valid: errors.length === 0, errors, checks_run: 1, outcome: errors.length ? 'failed' : 'passed' };
    } else if (step.kind === 'automation') checked = qualifyAutomation(parseReport(readFresh(directory, 'report/index.json', interval).toString('utf8')), step);
    else {
      const input = readArtifact(directory, 'input.json');
      if (sha256(input) !== prepared.inputs[step.id].sha256) throw Error('Dispatched input differs from planned bytes');
      const receipt = json(readFresh(directory, 'observation/receipt.json', interval));
      const artifacts = Object.fromEntries((receipt.artifacts ?? []).map(a => [a.path, readArtifact(join(directory, 'observation'), a.path)]));
      let document; try { document = json(input); } catch { document = null; }
      checked = qualifyObservation(receipt, document, step, { requestSha256: sha256(input), expectedSource: prepared.observation_source.identity, artifacts });
      if (step.kind !== 'rejected_replay' && receipt.environment?.configuration !== prepared.config.configuration) { checked.valid = false; checked.errors.push('Observed configuration differs from launcher configuration'); }
    }
    return { status: checked.valid ? 'passed' : 'failed', errors: checked.errors, checks_run: checked.checks_run, outcome: checked.outcome };
  } catch (error) { return failure('failed', [error.message]); }
}
export function inventory(directory, relative = '') {
  return readdirSync(join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw Error('Evidence symlink refused');
    if (entry.isDirectory()) return inventory(directory, name);
    const bytes = readArtifact(directory, name); return [{ path: name, bytes: bytes.length, sha256: sha256(bytes) }];
  });
}
