// node --test examples/unreal/niagara-showcase/showcase-validate.test.mjs  (no Unreal, no dependencies)
// The logs below have the shape showcase_explore.py and showcase_build.py write (read from the scripts; no engine has run the validator yet).
// Each test changes one fact and expects the matching check to fail, so the judge cannot pass by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize, parseSelftest, STATION_IDS, VORTEX_MODULES, EXPECTED_CHECKS } from './showcase-validate-checks.mjs';

const P = '[2026.10.26-12.00.00:000][  5]LogPython: [showcase_explore]';
const motion = [
  `full stick forward moves 700 per second along the heading (1.00 s: x=698 y=0)`,
  `strafe right moves 700 per second to the right (1.00 s: dy=699)`,
  `right stick turns 110 deg/s and the pitch stops at -85 (1.00 s: yaw=110.0 pitch=-85.0)`,
  `boost multiplies the speed by 3 (1.00 s: dx=2098)`,
];
const stationText = (i) => `station ${i + 1} (${STATION_IDS[i]}) is the nearest and running; 2 running (${STATION_IDS[i]}, ${STATION_IDS[(i + 1) % 8]}); camera yaw=10.0 pitch=-3.0 actor=P=-3.0 Y=10.0 R=0.0`;
const stations = STATION_IDS.map((_, i) => stationText(i));
const okLine = (text) => `${P} selftest ok:   ${text}`;
const failLine = (text) => `${P} selftest FAIL: ${text}`;
const passLog = (extra = []) => [
  'LogInit: Display: Game Engine Initialized.',
  `${P} tick callback registered`,
  `${P} ready: 8 stations, selftest=True`,
  ...motion.map(okLine),
  ...stations.flatMap((s, i) => [`${P} on  Station_0${i + 1}_${STATION_IDS[i]}`, okLine(s)]),
  `${P} selftest PASS`,
  ...extra,
].join('\r\n');

const makeBuild = () => ({
  exit: 0, timedOut: false, log: `LogPython: [showcase_build] wrote C:/Temp/niagara-showcase-build.json\r\nLogInit: Display: Exiting`,
  report: { engine: '5.8', steps: [{ step: 'vortex', template: 'RadialBurst', emitter: 'E', added: [...VORTEX_MODULES], saved: true }, ...STATION_IDS.map((id) => ({ step: 'station', id, system: `/x/${id}`, loaded: true })), { step: 'save_map', ok: true }] },
});
const makeGood = () => ({ build: makeBuild(), play: { exit: 0, timedOut: false, seconds: 600, log: passLog() } });
const good = () => makeGood();
const failing = (mutate) => { const g = good(); mutate(g); return evaluate(g).filter((c) => !c.pass && !c.observe).map((c) => c.name); };

test('a clean run passes every check', () => {
  const checks = evaluate(good());
  assert.deepEqual(checks.filter((c) => !c.pass), []);
  const sum = summarize(checks);
  assert.equal(sum.passed, sum.total);
  assert.equal(sum.total, 19);
  assert.equal(sum.observed, 1);
  assert.equal(EXPECTED_CHECKS, 12);
});

test('parseSelftest reads the check lines, the verdict and the ready line', () => {
  const t = parseSelftest(passLog());
  assert.equal(t.ok.length, 12);
  assert.equal(t.pass, 1);
  assert.equal(t.ready, 8);
  assert.equal(t.stations.length, 8);
  assert.deepEqual(t.failed, []);
  assert.deepEqual(parseSelftest(undefined).ok, []);
});

test('a FAIL verdict fails the PASS line check and the check that failed, and only those', () => {
  const failed = failing((g) => {
    g.play.log = passLog().replace(okLine(motion[1]), failLine(motion[1])).replace(`${P} selftest PASS`, `${P} selftest FAIL ${motion[1]}`);
  });
  assert.deepEqual(failed, ['self-test: PASS line', 'motion: strafe', 'self-test: twelve checks reported']);
});

test('a station that fails its rule fails by name', () => {
  const failed = failing((g) => {
    g.play.log = passLog().replace(okLine(stations[4]), failLine(stations[4])).replace(`${P} selftest PASS`, `${P} selftest FAIL ${stations[4]}`);
  });
  assert.deepEqual(failed, ['self-test: PASS line', 'station 5 sand', 'self-test: twelve checks reported']);
});

test('a missing PASS line fails the verdict check, not the individual checks', () => {
  const failed = failing((g) => { g.play.log = passLog().replace(`${P} selftest PASS`, ''); });
  assert.deepEqual(failed, ['self-test: the run finished and found the stations', 'self-test: PASS line']);
});

test('a duplicated PASS line is not accepted', () => {
  assert.deepEqual(failing((g) => { g.play.log = passLog([`${P} selftest PASS`]); }), ['self-test: PASS line']);
});

test('a timeout partway through names the station it reached', () => {
  const lines = passLog().split('\r\n');
  const cut = lines.findIndex((l) => l.includes('selftest ok:') && l.includes('station 3 '));
  const g = good();
  g.play = { exit: null, timedOut: true, seconds: 2400, log: lines.slice(0, cut + 1).join('\r\n') };
  const checks = evaluate(g);
  const failed = checks.filter((c) => !c.pass && !c.observe).map((c) => c.name);
  assert.deepEqual(failed, ['self-test: the run finished and found the stations', 'self-test: PASS line', 'station 4 hose',
    'station 5 sand', 'station 6 trails', 'station 7 burst', 'station 8 vortex', 'self-test: twelve checks reported']);
  assert.match(checks.find((c) => c.name === 'self-test: the run finished and found the stations').detail, /timed out after 2400 s.*reached station 3 of 8/);
});

test('a run that never gets ready fails with the ready line missing', () => {
  const g = good();
  g.play = { exit: null, timedOut: true, seconds: 2400, log: 'LogInit: Display: starting\r\n' };
  const checks = evaluate(g);
  assert.equal(checks.filter((c) => !c.pass && !c.observe).length, 15);   // all 15 self-test checks fail; the two build checks and the two log scans pass
  assert.match(checks[2].detail, /ready line missing/);
  assert.equal(checks.find((c) => c.name === 'no fatal error in the logs').pass, true);
});

test('fewer than twelve checks fails the count even when the verdict is PASS', () => {
  const failed = failing((g) => { g.play.log = passLog().replace(okLine(motion[3]), ''); });
  assert.deepEqual(failed, ['motion: boost', 'self-test: twelve checks reported']);
});

test('an unrecognised extra check line fails the count', () => {
  assert.deepEqual(failing((g) => { g.play.log = passLog([okLine('something new')]); }), ['self-test: twelve checks reported']);
});

test('a station reported with the wrong id or order fails that station', () => {
  const failed = failing((g) => { g.play.log = passLog().replace(stations[2], stations[2].replace('(explosion)', '(hose)')); });
  assert.deepEqual(failed, ['station 3 explosion']);
});

test('a station with more than three running fails that station', () => {
  const failed = failing((g) => { g.play.log = passLog().replace(stations[0], stations[0].replace('2 running', '4 running')); });
  assert.deepEqual(failed, ['station 1 fire2d']);
});

test('a fatal error in either log fails', () => {
  assert.deepEqual(failing((g) => { g.play.log = passLog(['LogWindows: Error: appError called: Assertion failed: x']); }), ['no fatal error in the logs']);
  assert.deepEqual(failing((g) => { g.build.log += '\r\nFatal error: [File:Foo.cpp] [Line: 1]'; }), ['no fatal error in the logs']);
  assert.equal(failing((g) => { g.play.log = ''; }).includes('no fatal error in the logs'), true);   // a missing log is not a clean log
});

test('a script exception fails even when the verdict passes', () => {
  assert.deepEqual(failing((g) => { g.play.log = passLog([`LogPython: Error: [showcase_explore] AttributeError('x')`]); }), ['no script exception']);
});

test('Niagara warnings are recorded, never judged', () => {
  const g = good();
  g.play.log = passLog(['LogNiagara: Warning: Failed to compile a thing', 'LogNiagara: Error: another']);
  const checks = evaluate(g);
  assert.deepEqual(checks.filter((c) => !c.pass), []);
  assert.match(checks.find((c) => c.observe).detail, /2 lines; first: LogNiagara: Warning/);
});

test('a failed or incomplete build fails the build checks', () => {
  assert.deepEqual(failing((g) => { g.build.exit = 1; }), ['build: the level is built and saved']);
  assert.deepEqual(failing((g) => { g.build.timedOut = true; }), ['build: the level is built and saved']);
  assert.deepEqual(failing((g) => { g.build.report.steps.push({ step: 'error', traceback: 'Traceback ... boom' }); }), ['build: the level is built and saved']);
  assert.deepEqual(failing((g) => { g.build.report.steps.find((s) => s.id === 'sand').loaded = false; }), ['build: the level is built and saved']);
  assert.deepEqual(failing((g) => { g.build.report.steps = g.build.report.steps.filter((s) => s.step !== 'save_map'); }), ['build: the level is built and saved']);
  assert.deepEqual(failing((g) => { g.build.report = undefined; }), ['build: the level is built and saved', 'build: the authored system gets its three modules']);
});

test('the authored system needs its three modules unless it was reused', () => {
  assert.deepEqual(failing((g) => { g.build.report.steps[0].added[1] = 'Update/Forces/CurlNoiseForce: boom'; }), ['build: the authored system gets its three modules']);
  assert.deepEqual(failing((g) => { g.build.report.steps[0].saved = false; }), ['build: the authored system gets its three modules']);
  assert.deepEqual(failing((g) => { g.build.report.steps[0] = { step: 'vortex', note: 'exists, reused' }; }), []);
  assert.deepEqual(failing((g) => { g.build.report.steps = g.build.report.steps.filter((s) => s.step !== 'vortex'); }), ['build: the authored system gets its three modules']);
});
