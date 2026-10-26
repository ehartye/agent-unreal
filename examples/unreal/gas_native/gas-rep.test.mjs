// node --test examples/unreal/gas_native/gas-rep.test.mjs  (no Unreal, no dependencies)
// The receipts below have the shape the replicated-play scenario writes (module/GasNative/GasNativeRep.cpp). They were written by hand
// from the source, not by an engine run: they pin the judge, and each test changes one fact and expects the matching check to fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize, serverArguments, clientArguments, observationRows, OBSERVATIONS, MAP, GAME_MODE } from './gas-rep-checks.mjs';

const snapshot = (over) => ({
  net_mode: 'DedicatedServer', local_role: 'Authority', remote_role: 'SimulatedProxy', has_authority: true, has_player_controller: true, is_local_controller: false,
  asc_replicates: true, replication_mode: 'Mixed', asc_owner_is_player_state: true, asc_avatar_is_player_state: true,
  ability_count: 1, abilities: ['GasNativeRepAbility'], rep_ability_present: true, effect_count: 1, buff_tag: true,
  attribute_set_found: true, energy_current: 105, energy_base: 100, activations_authority: 0, activations_predicted: 0, ...over,
});
const good = () => ({
  build: { exit: 0, log: 'Result: Succeeded' },
  serverExit: 0,
  clientExit: 0,
  serverLog: 'LogGasNativeRep: Display: GasNativeRep: server ready',
  clientLog: 'LogGasNativeRep: Display: GasNativeRep: client activation called',
  server: {
    role: 'server', net_mode: 'DedicatedServer', client_joined: true, player_count: 1,
    phases: {
      joined: snapshot({}),
      after: snapshot({ energy_current: 95, energy_base: 90, activations_authority: 1 }),
    },
  },
  client: {
    role: 'client', net_mode: 'Client',
    phases: {
      before: snapshot({ net_mode: 'Client', local_role: 'SimulatedProxy', remote_role: 'Authority', has_authority: false, is_local_controller: true }),
      after: snapshot({ net_mode: 'Client', local_role: 'SimulatedProxy', remote_role: 'Authority', has_authority: false, is_local_controller: true, energy_current: 95, energy_base: 90, activations_predicted: 1 }),
    },
    activation: { had_spec: true, try_activate_returned: true, predicted_count_right_after_call: 1 },
  },
  pieRequested: false,
});
const failing = (input) => evaluate(input).filter((c) => !c.pass).map((c) => c.name);
const withPhase = (side, phaseName, over) => { const g = good(); g[side].phases[phaseName] = { ...g[side].phases[phaseName], ...over }; return g; };

test('a good run passes every check', () => {
  const checks = evaluate(good());
  assert.deepEqual(failing(good()), []);
  assert.deepEqual(summarize(checks), { passed: 10, total: 10 });
});

test('the launch arguments carry the flags the design depends on', () => {
  const server = serverArguments({ uproject: 'C:/p/P.uproject', port: 40123, receipt: 'C:/r/s.json', log: 'C:/r/s.log' });
  assert.equal(server[0], 'C:/p/P.uproject');
  assert.equal(server[1], `${MAP}?game=${GAME_MODE}`);
  for (const flag of ['-server', '-game', '-Port=40123', '-nullrhi', '-RepReceipt=C:/r/s.json', '-abslog=C:/r/s.log', '-unattended']) assert.ok(server.includes(flag), flag);
  const client = clientArguments({ uproject: 'C:/p/P.uproject', port: 40123, receipt: 'C:/r/c.json', log: 'C:/r/c.log' });
  assert.equal(client[1], '127.0.0.1:40123');
  assert.ok(client.includes('-game') && client.includes('-nullrhi') && !client.includes('-server'));
  const rendered = clientArguments({ uproject: 'C:/p/P.uproject', port: 40123, receipt: 'r', log: 'l', render: true });
  assert.ok(rendered.includes('-RenderOffScreen') && !rendered.includes('-nullrhi'));
});

test('a failed build fails the build check', () => {
  const g = good(); g.build = { exit: 1, log: 'error C2065' };
  assert.deepEqual(failing(g), ['module compiles']);
});

test('a missing receipt fails the run check and the checks that read it', () => {
  const g = good(); g.client = undefined; g.clientExit = undefined;
  const names = failing(g);
  assert.ok(names.includes('both processes ran'));
  assert.ok(names.includes('granted ability replicates to the owning client'));
  assert.ok(names.includes('client and server agree after the activation'));
});

test('a fatal error in either log fails the run check only', () => {
  const g = good(); g.clientLog = 'LogWindows: Fatal error: [File:Unknown] [Line: 1]';
  assert.deepEqual(failing(g), ['both processes ran']);
  const h = good(); h.serverLog = 'Fatal error: Assertion failed';
  assert.deepEqual(failing(h), ['both processes ran']);
});

test('exit codes are reported, not judged', () => {
  const g = good(); g.serverExit = undefined; g.clientExit = 3;
  assert.deepEqual(failing(g), []);
  const detail = evaluate(g).find((c) => c.name === 'both processes ran').detail;
  assert.match(detail, /server exit killed or running/);
  assert.match(detail, /client exit 3/);
});

test('a server that is not dedicated, or a client that never joined, fails the join check', () => {
  const a = good(); a.server.net_mode = 'ListenServer';
  assert.deepEqual(failing(a), ['server is a dedicated server and the client joined']);
  const b = good(); b.server.client_joined = false; b.server.player_count = 0;
  assert.deepEqual(failing(b), ['server is a dedicated server and the client joined']);
});

test('a server that did not grant or buff fails the server check', () => {
  assert.deepEqual(failing(withPhase('server', 'joined', { ability_count: 0, rep_ability_present: false })), ['server grants and applies']);
  assert.deepEqual(failing(withPhase('server', 'joined', { energy_current: 100 })), ['server grants and applies']);
  assert.deepEqual(failing(withPhase('server', 'joined', { replication_mode: 'Full' })), ['server grants and applies']);
});

test('a client in another replication mode fails the Mixed check', () => {
  assert.deepEqual(failing(withPhase('client', 'before', { replication_mode: 'Full' })), ['Mixed mode on the client']);
});

test('an ability that did not reach the client fails the ability check only', () => {
  assert.deepEqual(failing(withPhase('client', 'before', { rep_ability_present: false, ability_count: 0 })), ['granted ability replicates to the owning client']);
});

test('an effect that did not reach the client fails the effect check only', () => {
  assert.deepEqual(failing(withPhase('client', 'before', { effect_count: 0, buff_tag: false })), ['active effect replicates to the owning client']);
});

test('an attribute that did not reach the client fails the attribute check only', () => {
  assert.deepEqual(failing(withPhase('client', 'before', { energy_current: 100 })), ['attribute value replicates to the client']);
  assert.deepEqual(failing(withPhase('client', 'before', { attribute_set_found: false, energy_current: undefined, energy_base: undefined })), ['attribute value replicates to the client']);
});

test('a client that disagrees with the server after the activation fails the agreement check', () => {
  assert.deepEqual(failing(withPhase('client', 'after', { energy_current: 105, energy_base: 100 })), ['client and server agree after the activation']);
});

test('observed activation readings never fail a check, whatever they say', () => {
  const g = good(); g.client.activation = { had_spec: false, try_activate_returned: false, predicted_count_right_after_call: 0 };
  g.client.phases.after.activations_predicted = 0; g.server.phases.after.activations_authority = 0;
  assert.deepEqual(failing(g), []);
  const rows = observationRows(g);
  assert.ok(rows.some((r) => r.matches === false), 'the table shows the readings that differ');
});

test('a missing reading fails the recorded check only', () => {
  const g = good(); delete g.client.activation;
  assert.deepEqual(failing(g), ['client activation recorded (observe)']);
});

test('the observation table is well formed', () => {
  for (const o of OBSERVATIONS) {
    assert.ok(Array.isArray(o.path) && o.path.length > 0, o.name);
    assert.ok(['server', 'client'].includes(o.side), o.name);
    if (o.expect !== undefined) {
      assert.ok(o.source && o.why, `${o.name} cites a source and a reason`);
      assert.match(o.source, /^(Engine\/|module\/)/, `${o.name} cites an install-relative or module path`);
    }
  }
});

test('the PIE read-back is judged only when requested, and only for its shape', () => {
  assert.deepEqual(failing({ ...good(), pieRequested: true }), ['PIE settings read back (observe)']);
  const withReport = { ...good(), pieRequested: true, pie: { class_found: false, reads: {} } };
  assert.deepEqual(failing(withReport), []);
  assert.equal(evaluate(withReport).length, 11);
});
