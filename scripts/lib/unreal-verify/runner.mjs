import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runContainedProcess } from '../unreal-run/controller.mjs';
import { collectIdentity } from '../unreal-run/identity.mjs';
import { readArtifact } from '../../agent-verify/artifacts.mjs';
import { prepare, assertUnchanged, json, same, OBSERVATIONS } from './manifest.mjs';
import { commandFor, qualifyStep, inventory } from './qualification.mjs';

const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const now = () => new Date().toISOString();
export async function productionLaunch(command, prepared, signal) {
  const result = await runContainedProcess({ ...command, signal, onDiagnostic: text => process.stderr.write(text) });
  if (['build', 'package'].includes(command.operation)) write(join(command.evidence, 'identity.json'), collectIdentity(prepared.config, prepared.source, result));
  return result;
}
export function suiteOutcome(rows) {
  if (rows.some(r => r.status === 'unknown')) return 'unknown';
  if (rows.some(r => r.status === 'cancelled')) return 'cancelled';
  if (rows.some(r => r.status === 'timed_out')) return 'timed_out';
  return rows.length && rows.filter(r => r.required).length && rows.every(r => !r.required || r.status === 'passed') ? 'passed' : 'failed';
}
// The adapter seam is internal to engine-free boundary tests. The CLI has no adapter option.
export async function execute(prepared, output, { launch = productionLaunch, signal, command = commandFor, unchanged = assertUnchanged } = {}) {
  prepared = structuredClone(prepared);
  const directory = resolve(output); mkdirSync(directory); // Exclusive fresh output; never overwrite retained evidence.
  const aggregate = { schema_version: 1, kind: 'unreal-verify/suite', run_id: randomUUID(), output: directory, started: now(), finished: null, prepared, steps: [], outcome: 'failed', qualified: false, errors: [] };
  let halt = null;
  try {
    for (let index = 0; index < prepared.plan.length; index++) {
      const step = prepared.plan[index], row = { id: step.id, kind: step.kind, required: step.required, directory: `${String(index).padStart(3, '0')}-${step.id}`, started: null, finished: null, status: 'not_run', errors: [], checks_run: 0, outcome: 'not_run', evidence: [] };
      aggregate.steps.push(row);
      if (signal?.aborted) halt = 'cancelled';
      if (halt) { row.errors = [`Dispatch halted: ${halt}`]; if (halt === 'cancelled') row.status = row.outcome = 'cancelled'; continue; }
      const blocked = step.depends_on.filter(id => aggregate.steps.find(r => r.id === id)?.status !== 'passed');
      if (blocked.length) { row.status = row.outcome = 'blocked_dependency'; row.errors = [`Failed dependencies: ${blocked.join(', ')}`]; continue; }
      try { unchanged(prepared); } catch (error) { row.status = row.outcome = 'failed'; row.errors = [error.message]; halt = 'inputs_changed'; continue; }
      const child = join(directory, row.directory); mkdirSync(child); row.started = now();
      try {
        if (OBSERVATIONS.includes(step.kind)) writeFileSync(join(child, 'input.json'), readFileSync(prepared.inputs[step.id].path), { flag: 'wx' });
        const expected = command(step, prepared, child); write(join(child, 'command.json'), expected);
        await launch(expected, prepared, signal);
        row.finished = now();
        Object.assign(row, qualifyStep(step, prepared, child, row, expected));
      } catch (error) { row.status = row.outcome = 'unknown'; row.errors = [error.message]; }
      row.finished ??= now();
      try { row.evidence = inventory(child); } catch (error) { row.status = row.outcome = 'unknown'; row.errors.push(error.message); }
      if (['unknown', 'cancelled'].includes(row.status)) halt = row.status;
    }
    try { unchanged(prepared); } catch (error) { aggregate.errors.push(error.message); }
  } finally {
    aggregate.finished = now(); aggregate.outcome = suiteOutcome(aggregate.steps);
    aggregate.qualified = aggregate.outcome === 'passed' && !aggregate.errors.length;
    if (!aggregate.qualified && aggregate.outcome === 'passed') aggregate.outcome = 'failed';
    write(join(directory, 'regression.json'), aggregate);
  }
  return aggregate;
}
export function verifyReceipt(file) {
  const errors = [], aggregate = json(readFileSync(file)), directory = dirname(resolve(file));
  if (aggregate.schema_version !== 1 || aggregate.kind !== 'unreal-verify/suite' || !/^[a-f0-9-]{36}$/.test(aggregate.run_id ?? '') || aggregate.output !== directory) throw Error('Unsupported or moved aggregate receipt');
  if (typeof aggregate.started !== 'string' || typeof aggregate.finished !== 'string' || !Number.isFinite(Date.parse(aggregate.started)) || !Number.isFinite(Date.parse(aggregate.finished)) || Date.parse(aggregate.finished) < Date.parse(aggregate.started)) throw Error('Invalid suite interval');
  const messages = value => Array.isArray(value) && value.every(message => typeof message === 'string' && message.length > 0);
  if (!messages(aggregate.errors) || typeof aggregate.qualified !== 'boolean' || !['passed', 'failed', 'unknown', 'cancelled', 'timed_out'].includes(aggregate.outcome)) throw Error('Invalid aggregate outcome or errors');
  const p = aggregate.prepared;
  const current = prepare({ project: p.project.path, manifest: p.manifest.path, suite: p.suite });
  if (!same(p, current)) errors.push('Planned inputs, source, configuration or plan changed');
  if (!Array.isArray(aggregate.steps) || aggregate.steps.length !== current.plan.length) throw Error('Missing or extra planned step');
  let halted = false, previousFinished = Date.parse(aggregate.started);
  for (let index = 0; index < current.plan.length; index++) {
    const step = current.plan[index], row = aggregate.steps[index], expectedDirectory = `${String(index).padStart(3, '0')}-${step.id}`;
    if (!row || typeof row !== 'object' || !messages(row.errors) || !Array.isArray(row.evidence) || !Number.isSafeInteger(row.checks_run) || row.checks_run < 0 || !['passed', 'failed', 'unknown', 'cancelled', 'timed_out', 'blocked_dependency', 'not_run'].includes(row.status)) throw Error(`Invalid step result: ${step.id}`);
    if (row.id !== step.id || row.kind !== step.kind || row.required !== step.required || row.directory !== expectedDirectory) { errors.push(`Planned step identity changed: ${step.id}`); continue; }
    const blocked = step.depends_on.filter(id => aggregate.steps.find(r => r.id === id)?.status !== 'passed');
    if (row.started !== null) {
      if (typeof row.started !== 'string' || typeof row.finished !== 'string' || !Number.isFinite(Date.parse(row.started)) || !Number.isFinite(Date.parse(row.finished)) || Date.parse(row.finished) < Date.parse(row.started)) throw Error(`Invalid step interval: ${step.id}`);
      if (Date.parse(row.started) < previousFinished) errors.push(`Overlapping or reordered serial step: ${step.id}`);
      previousFinished = Date.parse(row.finished);
      if (halted || blocked.length) errors.push(`Illicit dispatch after halt or failed dependency: ${step.id}`);
      if (Date.parse(row.started) < Date.parse(aggregate.started) || Date.parse(row.finished) > Date.parse(aggregate.finished)) errors.push(`Step outside suite interval: ${step.id}`);
      const child = join(directory, row.directory);
      if (!same(inventory(child), row.evidence)) errors.push(`Referenced evidence bytes changed: ${step.id}`);
      const checked = qualifyStep(step, current, child, row);
      for (const key of ['status', 'outcome', 'checks_run', 'errors']) if (!same(checked[key], row[key])) errors.push(`Recorded ${key} differs from verification: ${step.id}`);
      const expected = commandFor(step, current, child);
      if (!same(json(readArtifact(child, 'command.json')), expected)) errors.push(`Recorded command differs: ${step.id}`);
    } else {
      if (row.finished !== null || row.outcome !== row.status || !['not_run', 'blocked_dependency', 'failed', 'cancelled'].includes(row.status)) errors.push(`Invalid unexecuted step outcome: ${step.id}`);
      if (row.status === 'passed' || row.evidence.length || row.checks_run !== 0 || !row.errors.length) errors.push(`Unexecuted step claims evidence: ${step.id}`);
      if (row.status === 'blocked_dependency' && !blocked.length) errors.push(`Unjustified dependency block: ${step.id}`);
    }
    if (['unknown', 'cancelled'].includes(row.status)) halted = true;
  }
  const outcome = suiteOutcome(aggregate.steps), qualified = outcome === 'passed' && aggregate.errors.length === 0;
  if (aggregate.qualified !== qualified || aggregate.outcome !== (outcome === 'passed' && !qualified ? 'failed' : outcome)) errors.push('Aggregate verdict contradicts required steps');
  return { valid: errors.length === 0, qualified: errors.length === 0 && qualified, outcome: aggregate.outcome, errors, steps: aggregate.steps.map(({ id, status, checks_run, errors }) => ({ id, status, checks_run, errors })) };
}
