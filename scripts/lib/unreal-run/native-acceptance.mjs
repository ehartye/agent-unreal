// Deliberately separate from node --test and the Linux merge gate. INERT children only.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runContainedProcess, readJson, writeJson } from './controller.mjs';
import { verifyLifecycle, hash } from './contracts.mjs';
if (process.platform !== 'win32') throw Error('Native acceptance requires Windows; a skip is not acceptance');
const here = dirname(fileURLToPath(import.meta.url));
const caseIds = ['normal', 'nonzero', 'timeout', 'cancel', 'containment', 'owner-death', 'accounting', 'helper-death', 'exclusion', 'recovery', 'rapid-exit', 'observation'];
const argv = process.argv.slice(2);
const output = argv[0] && !argv[0].startsWith('--') ? argv.shift() : null;
let selected = caseIds;
if (argv.length) {
  if (argv.length !== 2 || argv[0] !== '--only') throw Error('Usage: native-acceptance.mjs [output] [--only case-id,...]');
  selected = argv[1].split(',');
  if (!selected.length || new Set(selected).size !== selected.length || selected.some(id => !caseIds.includes(id))) throw Error('Unknown or duplicate native acceptance case');
  if (selected.includes('recovery') && !selected.includes('normal')) throw Error('Recovery fixtures require the normal case creation identities');
}
const root = output ? resolve(output) : mkdtempSync(join(tmpdir(), 'unreal-run-native-'));
mkdirSync(root, { recursive: true });
if (existsSync(join(root, 'acceptance.json'))) throw Error('Acceptance evidence already exists');
const results = [];
const isolation = () => ({ lock: `Global\\agent-unreal-fixture-${randomUUID()}`, state: join(root, `state-${randomUUID()}`) });
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
async function until(fn, limit = 30000) { const end = Date.now() + limit; while (Date.now() < end) { if (fn()) return; await sleep(50); } throw Error('Bounded fixture observation expired'); }
const options = (name, mode = 'normal', fixtureIsolation = isolation()) => ({ executable: process.execPath, arguments: [join(here, 'fixtures/workload.mjs'), mode, join(root, `${name}-workload.json`), '', 'a b', 'quote"value', 'trailing\\'], cwd: root, evidence: join(root, name), timeoutMs: 10000, waitMs: 20000, fixtureIsolation });
const run = o => runContainedProcess({ ...o, onDiagnostic: text => process.stderr.write(text) });
const sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
await new Promise((resolveSpawn, reject) => { sentinel.once('spawn', resolveSpawn); sentinel.once('error', reject); });
function survived() { assert.equal(sentinel.exitCode, null); process.kill(sentinel.pid, 0); }
let caseIndex = 0;
async function check(name, fn) {
  const id = caseIds[caseIndex++];
  if (!selected.includes(id)) return;
  const started = new Date().toISOString();
  try { const details = await fn(); survived(); results.push({ id, name, passed: true, started, finished: new Date().toISOString(), ...details }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ id, name, passed: false, started, finished: new Date().toISOString(), error: error.stack }); throw error; }
}
let normal;
try {
  await check('normal exact argv and child-grandchild drain', async () => {
    normal = await run(options('normal')); assert.equal(normal.exitCode, 0, JSON.stringify(normal));
    assert.equal(verifyLifecycle(normal.lifecycle, { purpose: 'fixture' }).valid, true);
    assert.deepEqual(readJson(join(root, 'normal-workload.json')).args, ['', 'a b', 'quote"value', 'trailing\\']);
    return { receipt: join(normal.evidence, 'lifecycle.json') };
  });
  await check('nonzero exit propagation', async () => { const r = await run(options('nonzero', 'exit')); assert.equal(r.exitCode, 7); assert.equal(r.lifecycle.exitCode, 7); assert.equal(r.lifecycle.drain.proved, true); });
  await check('timeout drains owned descendants', async () => { const r = await run({ ...options('timeout', 'long'), timeoutMs: 700 }); assert.equal(r.exitCode, 74); assert.equal(r.lifecycle.timedOut, true); assert.equal(r.lifecycle.drain.proved, true); });
  await check('cancellation drains owned descendants', async () => {
    const o = options('cancel', 'long'); const abort = new AbortController(); const promise = run({ ...o, signal: abort.signal });
    await until(() => existsSync(join(o.evidence, 'workload-started.json'))); abort.abort();
    const r = await promise; assert.equal(r.lifecycle.cancelled, true); assert.equal(r.lifecycle.drain.proved, true);
  });
  await check('failed containment refuses before workload and releases proved empty ownership', async () => {
    const o = options('containment'); o.fixtureIsolation.fault = 'containment'; const r = await run(o);
    assert.equal(r.exitCode, 74); assert.equal(r.lifecycle.permitIssued, false); assert.equal(r.lifecycle.drain.proved, true);
    assert.equal(existsSync(join(root, 'containment-workload.json')), false); assert.equal(existsSync(join(o.fixtureIsolation.state, 'owner.json')), false);
  });
  await check('controller death drains owned descendants', async () => {
    const o = options('owner-death', 'long'); const config = join(root, 'owner-death-options.json'); writeJson(config, o);
    const owner = spawn(process.execPath, [join(here, 'fixtures/controller.mjs'), config], { windowsHide: true, stdio: 'ignore' });
    try { await until(() => existsSync(join(o.evidence, 'workload-started.json'))); owner.kill(); await until(() => existsSync(join(o.evidence, 'lifecycle.json'))); }
    finally { if (owner.exitCode === null) owner.kill(); }
    const receipt = readJson(join(o.evidence, 'lifecycle.json')); assert.equal(receipt.cancelled, true); assert.equal(receipt.drain.proved, true);
    assert.equal(verifyLifecycle(receipt, { purpose: 'fixture', requireSuccess: false }).valid, true);
    assert.match(receipt.errors.join('\n'), /Controller process identity is no longer live/);
    assert.equal(existsSync(join(o.fixtureIsolation.state, 'owner.json')), false);
    return { receipt: join(o.evidence, 'lifecycle.json') };
  });
  await check('ambiguous accounting quarantines and refuses recovery', async () => {
    const o = options('accounting', 'long'); o.fixtureIsolation.fault = 'accounting'; const r = await run(o);
    assert.equal(r.exitCode, 74); assert.equal(r.lifecycle.drain.proved, false); assert.equal(existsSync(join(o.fixtureIsolation.state, 'owner.json')), true);
    const recovery = await run({ ...options('accounting-recovery', 'normal', { lock: o.fixtureIsolation.lock, state: o.fixtureIsolation.state }), action: 'clear-stale' });
    assert.notEqual(recovery.exitCode, 0); assert.equal(existsSync(join(o.fixtureIsolation.state, 'owner.json')), true);
  });
  await check('helper death leaves unknown journal and cannot turn handle-close into drain proof', async () => {
    const o = options('helper-death', 'long');
    const promise = run(o);
    await until(() => existsSync(join(o.evidence, 'workload-started.json')));
    const ownedHelper = readJson(join(o.fixtureIsolation.state, 'owner.json')).helper;
    execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', join(here, 'fixtures/kill-identity.ps1'), '-ProcessId', String(ownedHelper.pid), '-Created', ownedHelper.created], { windowsHide: true, timeout: 10000 });
    const r = await promise;
    assert.notEqual(r.exitCode, 0); assert.equal(r.lifecycle, null);
    const journal = readJson(join(o.fixtureIsolation.state, 'owner.json')); assert.equal(journal.permitIssued, true); assert.equal(journal.drain, null);
    const refused = await run({ ...options('helper-death-next', 'normal', o.fixtureIsolation) });
    assert.notEqual(refused.exitCode, 0); assert.equal(existsSync(join(root, 'helper-death-next-workload.json')), false);
  });
  await check('two independent consumers never overlap and waiter reports holder', async () => {
    const shared = isolation(); const first = options('consumer-a', 'exclusion', shared); const second = options('consumer-b', 'normal', shared);
    const configA = join(root, 'consumer-a-options.json'); const configB = join(root, 'consumer-b-options.json'); writeJson(configA, first); writeJson(configB, second);
    const a = spawn(process.execPath, [join(here, 'fixtures/controller.mjs'), configA], { windowsHide: true, stdio: 'ignore' });
    await until(() => existsSync(join(first.evidence, 'workload-permit.json')));
    const status = await run({ ...options('consumer-status', 'normal', shared), action: 'status', operation: 'status' });
    assert.equal(status.exitCode, 0);
    const observedStatus = JSON.parse(status.output); assert.equal(observedStatus.lock, shared.lock); assert.equal(observedStatus.owner.id, readJson(join(first.evidence, 'request.json')).id);
    assert.ok(observedStatus.owner.command.length > 0 && observedStatus.owner.started && observedStatus.elapsedSeconds >= 0);
    const refused = await run({ ...options('consumer-wait-timeout', 'normal', shared), waitMs: 250 });
    assert.notEqual(refused.exitCode, 0); assert.match(refused.lifecycle.errors.join('\n'), /Bounded lock wait expired/);
    assert.equal(existsSync(join(root, 'consumer-wait-timeout-workload.json')), false);
    const b = spawn(process.execPath, [join(here, 'fixtures/controller.mjs'), configB], { windowsHide: true, stdio: 'ignore' });
    const done = p => new Promise(resolveExit => { if (p.exitCode !== null) resolveExit(p.exitCode); else p.once('exit', resolveExit); });
    const codes = await Promise.all([done(a), done(b)]); assert.deepEqual(codes, [0, 0]);
    const aResult = readJson(join(first.evidence, 'workload-result.json')); const bResult = readJson(join(second.evidence, 'workload-result.json'));
    assert.ok(Date.parse(aResult.finished) <= Date.parse(bResult.started));
    assert.equal(readJson(join(first.evidence, 'lifecycle.json')).lock, readJson(join(second.evidence, 'lifecycle.json')).lock);
    assert.match(readFileSync(join(second.evidence, 'helper.stderr.log'), 'utf8'), /Waiting for.*holder:/);
  });
  await check('clear-stale refuses absent corrupt live reused and ambiguous; accepts both proven cases', async () => {
    // Seeded recovery records are explicit fixture data, never production receipts.
    for (const scenario of ['absent', 'corrupt', 'live', 'reused', 'ambiguous', 'pre-permit', 'drained']) {
      const shared = isolation(); mkdirSync(shared.state, { recursive: true });
      const gone = normal.lifecycle.gate;
      let owner = { version: 1, kind: 'unreal-run/owner', id: randomUUID(), started: new Date().toISOString(), purpose: 'fixture', lock: shared.lock, requestHash: normal.requestHash, permitIssued: scenario !== 'pre-permit', phase: scenario === 'pre-permit' ? 'pre-permit' : 'unknown-after-permit', processes: [gone], drain: null };
      if (scenario === 'live') owner.processes = [normal.lifecycle.controller];
      if (scenario === 'reused') owner.processes = [{ ...normal.lifecycle.controller, created: '111111111111111111' }];
      if (scenario === 'drained') owner.drain = normal.lifecycle.drain;
      if (scenario === 'corrupt') writeFileSync(join(shared.state, 'owner.json'), '{corrupt');
      else if (scenario !== 'absent') writeJson(join(shared.state, 'owner.json'), owner);
      const r = await run({ ...options(`recovery-${scenario}`, 'normal', shared), action: 'clear-stale' });
      const allowed = ['pre-permit', 'drained'].includes(scenario);
      assert.equal(r.exitCode === 0, allowed, scenario);
      assert.equal(readJson(join(r.evidence, 'recovery.json')).allowed, allowed, scenario);
    }
  });
  await check('rapid child and grandchild exits reconcile membership snapshots before strict drain', async () => {
    const r = await run({ ...options('rapid-exit', 'rapid'), timeoutMs: 30000 });
    assert.equal(r.exitCode, 0, JSON.stringify(r.lifecycle?.errors));
    assert.equal(verifyLifecycle(r.lifecycle, { purpose: 'fixture' }).valid, true);
    return { receipt: join(r.evidence, 'lifecycle.json') };
  });
  await check('persistent member observation failure stays a bounded refusal with original diagnostics', async () => {
    const transient = options('observation-once', 'normal'); transient.fixtureIsolation.fault = 'observation-once';
    const recovered = await run(transient);
    assert.equal(recovered.exitCode, 0); assert.equal(verifyLifecycle(recovered.lifecycle, { purpose: 'fixture' }).valid, true);
    const recoveredObservations = readFileSync(join(transient.evidence, 'member-observations.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.ok(recoveredObservations.some(v => v.outcome === 'retry') && recoveredObservations.some(v => v.outcome === 'identity-observed' && v.identity.pid === v.pid));
    const o = options('observation', 'long'); o.fixtureIsolation.fault = 'observation';
    const r = await run(o);
    assert.equal(r.exitCode, 74); assert.equal(r.lifecycle.permitIssued, true);
    assert.equal(verifyLifecycle(r.lifecycle, { purpose: 'fixture' }).valid, false);
    assert.equal(verifyLifecycle(r.lifecycle, { purpose: 'fixture', requireSuccess: false }).valid, true);
    assert.match(r.lifecycle.errors.join('\n'), /Unobservable live Job member PID \d+.*Injected process observation query failure/s);
    const observations = readFileSync(join(o.evidence, 'member-observations.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.ok(observations.length > 1 && observations.every(v => v.pid > 0 && v.error.detail.includes('Injected process observation query failure')));
    assert.equal(observations.at(-1).outcome, 'unresolved');
    assert.ok(observations.at(-1).elapsedMs >= 1000 && observations.at(-1).elapsedMs < 3000);
    return { receipt: join(r.evidence, 'lifecycle.json') };
  });
} finally {
  const sentinelSurvived = sentinel.exitCode === null;
  const report = { version: 1, kind: 'unreal-run/native-fixture-acceptance', purpose: 'fixture', root, completed: new Date().toISOString(), selected, fullSuite: selected.length === caseIds.length, sentinel: { pid: sentinel.pid, survived: sentinelSurvived }, passed: results.length === selected.length && results.every(r => r.passed) && sentinelSurvived, results };
  writeJson(join(root, 'acceptance.json'), report);
  console.log(JSON.stringify({ root, passed: report.passed, sha256: hash(readFileSync(join(root, 'acceptance.json'))) }));
  sentinel.kill();
}
