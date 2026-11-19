// Deliberately separate from node --test and the Linux merge gate. INERT children only.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runContainedProcess, readJson, writeJson } from './controller.mjs';
import { verifyLifecycle, hash, recoveryDecision } from './contracts.mjs';
import { corruptRecoveryCases } from './fixtures/recovery-cases.mjs';
if (process.platform !== 'win32') throw Error('Native acceptance requires Windows; a skip is not acceptance');
const here = dirname(fileURLToPath(import.meta.url));
const caseIds = ['normal', 'nonzero', 'timeout', 'cancel', 'containment', 'owner-death', 'accounting', 'helper-death', 'overlap', 'recovery', 'rapid-exit', 'observation'];
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
    assert.equal(r.lifecycle.drain.requestHash, r.requestHash); assert.equal(r.lifecycle.id, r.request.id);
    assert.equal(existsSync(join(o.evidence, 'owner.json')), false);
  });
  await check('failed containment refuses before workload and releases proved empty ownership', async () => {
    const o = options('containment'); o.fixtureIsolation.fault = 'containment'; const r = await run(o);
    assert.equal(r.exitCode, 74); assert.equal(r.lifecycle.permitIssued, false); assert.equal(r.lifecycle.drain.proved, true);
    assert.equal(existsSync(join(root, 'containment-workload.json')), false); assert.equal(existsSync(join(o.evidence, 'owner.json')), false);
  });
  await check('controller death drains owned descendants', async () => {
    const o = options('owner-death', 'long'); const config = join(root, 'owner-death-options.json'); writeJson(config, o);
    const owner = spawn(process.execPath, [join(here, 'fixtures/controller.mjs'), config], { windowsHide: true, stdio: 'ignore' });
    try { await until(() => existsSync(join(o.evidence, 'workload-started.json'))); owner.kill(); await until(() => existsSync(join(o.evidence, 'lifecycle.json'))); }
    finally { if (owner.exitCode === null) owner.kill(); }
    const receipt = readJson(join(o.evidence, 'lifecycle.json')); assert.equal(receipt.cancelled, true); assert.equal(receipt.drain.proved, true);
    assert.equal(verifyLifecycle(receipt, { purpose: 'fixture', requireSuccess: false }).valid, true);
    assert.match(receipt.errors.join('\n'), /Controller process identity is no longer live/);
    assert.equal(existsSync(join(o.evidence, 'owner.json')), false);
    return { receipt: join(o.evidence, 'lifecycle.json') };
  });
  await check('ambiguous accounting retains the request-local journal', async () => {
    const o = options('accounting', 'long'); o.fixtureIsolation.fault = 'accounting'; const r = await run(o);
    assert.equal(r.exitCode, 74); assert.equal(r.lifecycle.drain.proved, false); assert.equal(existsSync(join(o.evidence, 'owner.json')), true);
    assert.equal(readJson(join(o.evidence, 'owner.json')).requestHash, r.requestHash);
  });
  await check('helper death leaves unknown journal and cannot turn handle-close into drain proof', async () => {
    const o = options('helper-death', 'long');
    const promise = run(o);
    await until(() => existsSync(join(o.evidence, 'workload-started.json')));
    const ownedHelper = readJson(join(o.evidence, 'owner.json')).helper;
    execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', join(here, 'fixtures/kill-identity.ps1'), '-ProcessId', String(ownedHelper.pid), '-Created', ownedHelper.created], { windowsHide: true, timeout: 10000 });
    const r = await promise;
    assert.notEqual(r.exitCode, 0); assert.equal(r.lifecycle, null);
    const journal = readJson(join(o.evidence, 'owner.json')); assert.equal(journal.permitIssued, true); assert.equal(journal.drain, null);
    const next = await run(options('helper-death-next', 'normal', o.fixtureIsolation));
    assert.equal(next.exitCode, 0); assert.deepEqual(readJson(join(o.evidence, 'owner.json')), journal);
  });
  await check('independent requests overlap despite an unresolved legacy journal', async () => {
    const shared = isolation(); mkdirSync(shared.state);
    const legacy = Buffer.from('old unresolved journal');
    writeFileSync(join(shared.state, 'owner.json'), legacy);
    const first = options('consumer-a', 'long', shared);
    const abort = new AbortController();
    const a = run({ ...first, signal: abort.signal, timeoutMs: 30000 });
    let b;
    try {
      await until(() => existsSync(join(first.evidence, 'workload-started.json')));
      b = await run(options('consumer-b', 'normal', shared));
    } finally { abort.abort(); }
    const cancelled = await a;
    assert.equal(b.exitCode, 0);
    assert.equal(cancelled.lifecycle.cancelled, true);
    for (const r of [b, cancelled]) {
      assert.equal(verifyLifecycle(r.lifecycle, { purpose: 'fixture', requireSuccess: false, requestId: r.request.id, requestHash: r.requestHash }).valid, true);
    }
    assert.notEqual(b.requestHash, cancelled.requestHash);
    assert.deepEqual(readFileSync(join(shared.state, 'owner.json')), legacy);
  });
  await check('clear-stale refuses absent corrupt live reused and ambiguous; accepts both proven cases', async () => {
    // Seeded recovery records are explicit fixture data, never production receipts.
    const cases = [['absent'], ['corrupt'], ['live'], ['reused'], ['ambiguous'], ['pre-permit'], ['drained'], ...corruptRecoveryCases, ['wrong-lock', r => { r.lock = isolation().lock; }], ['wrong-purpose', r => { r.purpose = 'production'; }]];
    const records = [];
    for (const [scenario, mutate] of cases) {
      const shared = isolation(); mkdirSync(shared.state, { recursive: true });
      const gone = normal.lifecycle.gate;
      let owner = { version: 1, kind: 'unreal-run/owner', id: randomUUID(), started: normal.lifecycle.started, purpose: 'fixture', lock: shared.lock, requestHash: normal.requestHash, permitIssued: scenario !== 'pre-permit', phase: scenario === 'pre-permit' ? 'pre-permit' : 'unknown-after-permit', processes: [{ ...gone }], drain: null };
      if (scenario === 'live') owner.processes = [normal.lifecycle.controller];
      if (scenario === 'reused') owner.processes = [{ ...normal.lifecycle.controller, created: '111111111111111111' }];
      if (scenario === 'drained' || mutate) owner.drain = structuredClone(normal.lifecycle.drain);
      mutate?.(owner);
      if (scenario === 'corrupt') writeFileSync(join(shared.state, 'owner.json'), '{corrupt');
      else if (scenario !== 'absent') writeJson(join(shared.state, 'owner.json'), owner);
      const ownerPath = join(shared.state, 'owner.json');
      const original = existsSync(ownerPath) ? readFileSync(ownerPath) : null;
      const r = await run({ ...options(`recovery-${scenario}`, 'normal', shared), action: 'clear-stale' });
      const allowed = ['pre-permit', 'drained'].includes(scenario);
      assert.equal(r.exitCode === 0, allowed, scenario);
      assert.equal(readJson(join(r.evidence, 'recovery.json')).allowed, allowed, scenario);
      assert.equal(existsSync(ownerPath), original !== null && !allowed, scenario);
      if (original && !allowed) assert.deepEqual(readFileSync(ownerPath), original, `${scenario}: owner bytes preserved`);
      const observations = owner.processes.map(p => ({ pid: p.pid, expectedCreated: p.created, state: scenario === 'live' ? 'live' : scenario === 'reused' ? 'reused' : 'gone' }));
      const pure = recoveryDecision(['absent', 'corrupt'].includes(scenario) ? null : owner, observations, { lock: shared.lock, purpose: 'fixture' });
      assert.equal(pure.allowed, allowed, `${scenario}: shared policy agrees`);
      assert.equal(existsSync(join(r.evidence, 'workload-permit.json')), false);
      assert.equal(existsSync(join(r.evidence, 'workload-started.json')), false);
      records.push({ scenario, allowed, pure, evidence: r.evidence, ownerPreserved: original !== null && !allowed });
    }
    const shared = isolation(); mkdirSync(shared.state);
    const ownerPath = join(shared.state, 'owner.json');
    const oldRequest = { ...normal.request, id: randomUUID(), lock: shared.lock, state: shared.state };
    const oldPath = join(root, 'legacy-request.json'); writeJson(oldPath, oldRequest);
    const original = { version: 1, kind: 'unreal-run/owner', id: oldRequest.id, started: normal.lifecycle.started, purpose: 'fixture', lock: shared.lock, requestHash: hash(readFileSync(oldPath)), permitIssued: true, phase: 'running', controller: normal.lifecycle.gate, helper: normal.lifecycle.helper, processes: [normal.lifecycle.gate, normal.lifecycle.helper], drain: null };
    writeJson(ownerPath, original);
    writeJson(join(shared.state, 'last.json'), normal.lifecycle);
    const bytes = readFileSync(ownerPath);
    const recover = (name, path) => run({ ...options(name, 'normal', shared), action: 'clear-stale', archiveRequest: path });
    const mismatch = await recover('archive-mismatch', join(normal.evidence, 'request.json'));
    assert.notEqual(mismatch.exitCode, 0); assert.deepEqual(readFileSync(ownerPath), bytes);
    const archived = await recover('archive-exact', oldPath);
    assert.equal(archived.exitCode, 0, archived.output);
    const receipt = readJson(join(archived.evidence, 'recovery.json'));
    assert.equal(receipt.disposition, 'archived-unwitnessed'); assert.equal(receipt.owner.drain, null);
    assert.deepEqual(readFileSync(receipt.archivePath), bytes); assert.equal(existsSync(ownerPath), false);
    assert.equal(existsSync(join(archived.evidence, 'lifecycle.json')), false);
    // Break only disposable policy copies: the real helper must preserve owner
    // bytes when its policy process fails or emits malformed/coerced output.
    for (const [scenario, source] of [['policy-exit', 'process.exit(9);'], ['policy-json', 'console.log("{bad");'], ['policy-shape', 'console.log(JSON.stringify({allowed:"true"}));'], ['policy-binding-types', 'console.log(JSON.stringify({allowed:true,reason:"invalid binding types",ownerHash:[],lock:[]}));']]) {
      const library = join(root, scenario, 'library'); cpSync(here, library, { recursive: true });
      writeFileSync(join(library, 'recovery.mjs'), source);
      const copied = await import(pathToFileURL(join(library, 'controller.mjs')).href);
      const shared = isolation(); mkdirSync(shared.state, { recursive: true });
      const ownerPath = join(shared.state, 'owner.json');
      writeJson(ownerPath, { version: 1, kind: 'unreal-run/owner', id: randomUUID(), started: normal.lifecycle.started, purpose: 'fixture', lock: shared.lock, requestHash: normal.requestHash, permitIssued: true, phase: 'unknown-after-permit', processes: [normal.lifecycle.gate], drain: normal.lifecycle.drain });
      const original = readFileSync(ownerPath);
      const r = await copied.runContainedProcess({ ...options(`${scenario}-recovery`, 'normal', shared), action: 'clear-stale' });
      assert.equal(r.exitCode, 74, scenario); assert.equal(readJson(join(r.evidence, 'recovery.json')).allowed, false);
      assert.deepEqual(readFileSync(ownerPath), original);
      assert.equal(existsSync(join(r.evidence, 'workload-permit.json')), false);
      assert.equal(existsSync(join(r.evidence, 'workload-started.json')), false);
      records.push({ scenario, allowed: false, evidence: r.evidence, ownerPreserved: true });
    }
    writeJson(join(root, 'recovery-cases.json'), records);
    return { cases: records.length, evidence: join(root, 'recovery-cases.json') };
  });
  await check('rapid child and grandchild exits reconcile membership snapshots before strict drain', async () => {
    execFileSync('pwsh',['-NoProfile','-NonInteractive','-File',join(here,'fixtures/pinned-exit.ps1'),'-Node',process.execPath],{windowsHide:true,timeout:15000});
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
