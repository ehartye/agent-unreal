import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../../scripts/lib/unreal-remote/contracts.mjs';
import { git } from '../../../scripts/lib/unreal-remote/source.mjs';
import { write, json, inventory, now, digest } from '../../../scripts/lib/unreal-remote/files.mjs';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../../../scripts/unreal-remote.mjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Explicit native driver. No engine, network or Windows requirement is added to the merge lane.
export async function acceptance({ config: file, evidence, manifest = 'remote-manifest.json', suite = 'small', cancel_suite = 'cancel' }) {
  const config = loadConfig(file), root = resolve(evidence); mkdirSync(root);
  const report = { version: 1, kind: 'unreal-remote/acceptance', started: now(), passed: false, R4: false, steps: [], errors: [] };
  let index = 0;
  async function call(action, job, extra = []) {
    const dir = join(root, `${String(index++).padStart(3, '0')}-${action}`); mkdirSync(dir);
    const args = [cli, action, '--config', resolve(file), '--job', job, ...extra]; write(join(dir, 'command.json'), { executable: process.execPath, arguments: args, shell: false });
    const out = openSync(join(dir, 'stdout.json'), 'wx'), err = openSync(join(dir, 'stderr.log'), 'wx');
    const code = await new Promise((done, fail) => {
      const child = spawn(process.execPath, args, { stdio: ['ignore', out, err], windowsHide: true });
      const timer = setTimeout(() => child.kill(), (config.remote.timeouts.transport_seconds * 9 + config.remote.timeouts.startup_seconds + 30) * 1000);
      child.once('error', error => { clearTimeout(timer); fail(error); }); child.once('close', value => { clearTimeout(timer); done(value); });
    }); closeSync(out); closeSync(err);
    report.steps.push({ action, job, directory: dir, exit_code: code, observed: now() });
    if (code !== 0) throw Error(`${action} failed; preserve ${dir}`);
    return json(join(dir, 'stdout.json'));
  }
  async function until(job, predicate, bound) {
    const deadline = Date.now() + bound * 1000;
    while (Date.now() < deadline) {
      const status = await call('status', job);
      if (!status.found || status.state.phase === 'unknown' || status.state.phase === 'failed') throw Error(`Unexpected ${job} state ${status.state?.phase}`);
      if (predicate(status)) return status;
      process.stderr.write(`${now()} acceptance ${job}: ${status.state.phase}\n`); await sleep(2000);
    }
    throw Error(`Bounded acceptance wait expired: ${job}`);
  }
  try {
    const commit = git(config.source_root, ['rev-parse', 'HEAD']).toString().trim(), prefix = `accept-${randomUUID().slice(0, 8)}`;
    report.commit = commit; report.jobs = { completed: `${prefix}-complete`, cancelled: `${prefix}-cancel` };
    report.start = await call('start', report.jobs.completed, ['--commit', commit, '--manifest', manifest, '--suite', suite]);
    // CLI return closes its launching SSH process. Subsequent invocations are independent SSH sessions.
    report.disconnect = { launching_client_returned: true, observed: now(), worker: report.start.state?.worker };
    report.completed = await until(report.jobs.completed, s => s.state.phase === 'succeeded', config.remote.timeouts.workload_seconds + 60);
    if (!report.disconnect.worker || digest(report.disconnect.worker) !== digest(report.completed.state.worker)) throw Error('Detached worker creation identity differs across disconnected sessions');
    report.fetch = await call('fetch', report.jobs.completed, ['--output', join(config.state_directory, `${prefix}-complete-output`)]);
    if (!report.fetch.transfer_valid || !report.fetch.qualified) throw Error('Completed suite did not transfer and qualify');
    report.cancel_start = await call('start', report.jobs.cancelled, ['--commit', commit, '--manifest', manifest, '--suite', cancel_suite]);
    report.before_cancel = await until(report.jobs.cancelled, s => s.dispatches.some(d => /-wait\/launcher$/.test(d.path) && d.workload_permit && !d.lifecycle), config.remote.timeouts.workload_seconds + 60);
    report.cancel = await call('cancel', report.jobs.cancelled);
    report.cancelled = await until(report.jobs.cancelled, s => s.state.phase === 'cancelled', 180);
    report.cancel_fetch = await call('fetch', report.jobs.cancelled, ['--output', join(config.state_directory, `${prefix}-cancel-output`)]);
    if (!report.cancel_fetch.transfer_valid || report.cancel_fetch.qualified || !report.cancelled.state.drained) throw Error('Cancelled job did not retain verified unqualified drained diagnostics');
    report.R4 = report.passed = true;
  } catch (error) { report.errors.push(error.message); }
  report.finished = now(); write(join(root, 'acceptance.json'), report); write(join(root, 'inventory.json'), inventory(root)); return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) { const key = process.argv[i].slice(2).replaceAll('-', '_'); if (!['config', 'evidence', 'manifest', 'suite', 'cancel_suite'].includes(key) || options[key] || !process.argv[i + 1]) throw Error('Expected --config ignored-config --evidence fresh-directory [--manifest tracked-manifest --suite name --cancel-suite name]'); options[key] = process.argv[i + 1]; }
  acceptance(options).then(report => { console.log(JSON.stringify(report, null, 2)); process.exitCode = report.passed ? 0 : 1; }).catch(error => { console.error(error.stack); process.exitCode = 2; });
}
