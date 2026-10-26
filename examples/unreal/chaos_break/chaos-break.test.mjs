// node --test examples/unreal/chaos_break/chaos-break.test.mjs  (no Unreal, no dependencies)
// The reports below are built by hand from what ChaosBreakBuildCommandlet.cpp and ChaosBreakRunSubsystem.cpp write. No engine run has produced a
// report yet, so their shape is an assumption; the first run confirms it. Each test changes one fact and expects the matching check to change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReport, judgeBreakRun, linesFor, evaluate, summarize, NO_PARTICLES_LINE, DEFAULT_MAX_HEALTHY_BYTES } from './chaos-break-checks.mjs';

const MAP = 'Map.Template_Default:PersistentLevel';
const nameLine = (label, n = 24) => `LogChaos: Verbose: Geometry collection GeometryCollectionComponent ${MAP}.${label}.GeometryCollectionComponent0 tried to create ${n} particles with no geometry`;
const transformLine = (i) => `LogChaos: Verbose: GeometryCollection Transform ${i} has no geometry`;
const materialLine = 'LogMaterial: Warning: Material /Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial missing usage flag GeometryCollections! Default Material will be used in game.';

const variantRow = (name, extra = {}) => ({ name, package: `/Game/Chaos/GC_${name}`, ok: true, appended: true, geometryIndex: 25, transforms: 25, hullTransforms: 24, hullObjects: 24,
  simulationDataDirty: false, fileBytes: 372000, seconds: 1.5, steps: 'append;voronoi;valid_hulls;invalidate;simdata;save;', error: '', ...extra });
const buildReport = (rows = [variantRow('healthy'), variantRow('nohull', { hullTransforms: 0, hullObjects: 0, steps: 'append;voronoi;invalidate;simdata;save;' }), variantRow('update_hulls'), variantRow('simdata_first')]) =>
  ({ engine: '5.8.2-0+++UE5+Release-5.8', mesh: '/Engine/BasicShapes/Cube.Cube', material: 'engine', materialPackage: '', sites: 24, seed: 7, variants: rows, errors: [] });

const scenario = (label, extra = {}) => ({ label, asset: `/Game/Chaos/GC_${label.split('_')[0]}.GC_${label.split('_')[0]}`, action: 'strain', spawn: 'deferred', assetLoaded: true, spawned: true,
  hasProxyAtStrain: true, transforms: 25, breaksAfterStrain: 3, breaksFinal: 24, distinctFinal: 24, ...extra });
const gameReport = (rows) => ({ world: '/Engine/Maps/Templates/Template_Default', gravityZ: -980, runSeconds: 7.1, scenarios: rows, errors: [] });
const goodRows = () => [
  scenario('healthy_strain'),
  scenario('healthy_late'),
  scenario('healthy_idle', { action: 'none', breaksAfterStrain: 0, breaksFinal: 0, distinctFinal: 0 }),
  scenario('nohull_strain', { breaksAfterStrain: 0, breaksFinal: 0, distinctFinal: 0 }),
  scenario('noproxy_strain', { action: 'noproxy', hasProxyAtStrain: false, breaksAfterStrain: 0, breaksFinal: 0, distinctFinal: 0 }),
  scenario('update_hulls_strain'),
  scenario('simdata_first_strain', { breaksFinal: 0, distinctFinal: 0, breaksAfterStrain: 0 }),
];
const verboseLog = [transformLine(3), transformLine(4), nameLine('nohull_strain'), nameLine('simdata_first_strain'), 'LogTemp: ordinary line'].join('\n');
const run = (rows = goodRows(), log = verboseLog) => ({ exit: 0, report: gameReport(rows), log });
const goodRuns = () => ({
  verbose: run(),
  silent: run(goodRows(), 'LogTemp: ordinary line\nLogChaos: Display: solver started'),
  exec: run(goodRows(), nameLine('nohull_strain')),
});
const goodBuild = { exit: 0, log: 'Result: Succeeded\n' };
const judged = (overrides = {}) => evaluate({ build: goodBuild, buildReport: buildReport(), runs: goodRuns(), ...overrides });
const failing = (checks) => checks.filter((c) => !c.pass && !c.info).map((c) => c.name);

test('a good set of reports passes every counted check and records the observations', () => {
  const checks = judged();
  assert.deepEqual(failing(checks), []);
  const { passed, total } = summarize(checks);
  assert.equal(passed, total);
  assert.ok(total >= 10);
  assert.ok(checks.some((c) => c.info && /late SetRestCollection/.test(c.name)));
  assert.ok(checks.some((c) => c.info && /update_hulls/.test(c.name)));
});

test('parseReport tolerates a byte order mark and rejects missing or unreadable text', () => {
  assert.equal(parseReport('\uFEFF{"a":1}').a, 1);
  assert.equal(parseReport(''), undefined);
  assert.equal(parseReport(undefined), undefined);
  assert.equal(parseReport('{not json'), undefined);
});

test('linesFor attributes a log line to the component whose full name holds the label, and not to a longer label', () => {
  const log = [nameLine('nohull_strain'), nameLine('healthy_strain_extra'), transformLine(1)].join('\n');
  assert.equal(linesFor(log, 'nohull_strain').length, 1);
  assert.equal(linesFor(log, 'healthy_strain').length, 0);
  assert.equal(linesFor(log, 'healthy_strain_extra').length, 1);
});

test('judgeBreakRun passes pieces that separate and names every reason it rejects one', () => {
  assert.deepEqual(judgeBreakRun(scenario('healthy_strain'), verboseLog), { ok: true, reasons: [] });
  const none = judgeBreakRun(scenario('nohull_strain', { breaksFinal: 0 }), verboseLog);
  assert.equal(none.ok, false);
  assert.deepEqual(none.reasons, ['zero break events', 'log: tried to create particles with no geometry']);
  assert.deepEqual(judgeBreakRun(scenario('x', { spawned: false }), '').reasons.slice(0, 1), ['scenario did not spawn']);
  assert.deepEqual(judgeBreakRun(undefined, '').reasons, ['scenario missing from the report']);
  const material = judgeBreakRun(scenario('healthy_strain'), `${verboseLog}\n${materialLine}`, { checkMaterial: true });
  assert.deepEqual(material.reasons, ['log: material is missing the Geometry Collections usage flag']);
  assert.equal(judgeBreakRun(scenario('healthy_strain'), `${verboseLog}\n${materialLine}`).ok, true);
});

test('the no-geometry pattern matches the engine line and not a similar one', () => {
  assert.match(nameLine('a'), NO_PARTICLES_LINE);
  assert.doesNotMatch('Geometry collection tried to create 4 particles with no geometry', NO_PARTICLES_LINE);
});

test('a missing build, build report or game report fails the checks that need them instead of throwing', () => {
  const nothing = evaluate({ build: undefined, buildReport: undefined, runs: {} });
  assert.ok(failing(nothing).includes('project compiles'));
  assert.ok(failing(nothing).includes('assets are built in a commandlet'));
  assert.ok(failing(nothing).includes('game process wrote a report'));
  assert.ok(failing(nothing).includes('a healthy collection breaks'));
  assert.ok(failing(nothing).includes('normal verbosity prints nothing'));
});

test('each counted check turns red when its own fact is broken', () => {
  const cases = [
    ['project compiles', { build: { exit: 1, log: 'error C2065' } }],
    ['assets are built in a commandlet', { buildReport: buildReport([variantRow('healthy', { ok: false, error: 'VoronoiFracture returned INDEX_NONE' }), variantRow('nohull', { hullTransforms: 0, hullObjects: 0 })]) }],
    ['healthy asset has hulls and a small file', { buildReport: buildReport([variantRow('healthy', { fileBytes: DEFAULT_MAX_HEALTHY_BYTES + 1 }), variantRow('nohull', { hullTransforms: 0, hullObjects: 0 })]) }],
    ['healthy asset has hulls and a small file', { buildReport: buildReport([variantRow('healthy', { hullTransforms: 0 }), variantRow('nohull', { hullTransforms: 0, hullObjects: 0 })]) }],
    ['control asset has no hulls', { buildReport: buildReport([variantRow('healthy'), variantRow('nohull')]) }],
  ];
  for (const [name, input] of cases) assert.ok(failing(judged(input)).includes(name), name);
  const withRows = (mutate, runsOverride = {}) => judged({ runs: { ...goodRuns(), verbose: run(mutate(goodRows())), ...runsOverride } });
  const set = (label, extra) => (rows) => rows.map((r) => (r.label === label ? { ...r, ...extra } : r));
  assert.ok(failing(withRows(set('healthy_strain', { breaksFinal: 0 }))).includes('a healthy collection breaks'));
  assert.ok(failing(withRows(set('healthy_idle', { breaksFinal: 4 }))).includes('the control does not break'));
  assert.ok(failing(withRows(set('nohull_strain', { breaksFinal: 12 }))).includes('the no-hull control fails the check'));
  assert.ok(failing(withRows(set('noproxy_strain', { hasProxyAtStrain: true }))).includes('a component without a physics proxy is silent'));
  assert.ok(failing(withRows(set('healthy_strain', { spawned: false }))).includes('game process wrote a report'));
  assert.ok(failing(judged({ runs: { ...goodRuns(), verbose: run(goodRows(), 'LogTemp: nothing') } })).includes('-LogCmds turns the lines on at launch'));
  assert.ok(failing(judged({ runs: { ...goodRuns(), verbose: run(goodRows(), [transformLine(1), nameLine('healthy_strain')].join('\n')) } })).includes('a healthy collection breaks'));
  assert.ok(failing(judged({ runs: { ...goodRuns(), silent: run(goodRows(), nameLine('nohull_strain')) } })).includes('normal verbosity prints nothing'));
  assert.ok(failing(judged({ runs: { ...goodRuns(), silent: undefined } })).includes('normal verbosity prints nothing'));
});

test('the no-hull control fails the check only when both the zero count and the log line are there', () => {
  const noLine = judged({ runs: { ...goodRuns(), verbose: run(goodRows(), transformLine(1)) } });
  assert.ok(failing(noLine).includes('the no-hull control fails the check'));
  const material = evaluate({ build: goodBuild, buildReport: buildReport(), runs: { ...goodRuns(), verbose: run(goodRows(), `${verboseLog}\n${materialLine}`) }, options: { checkMaterial: true } });
  assert.ok(failing(material).includes('a healthy collection breaks'));
  assert.ok(material.some((c) => c.info && /material usage warning/.test(c.name) && /1 line/.test(c.detail)));
});

test('observations never fail and the summary counts only the counted checks', () => {
  const checks = judged({ runs: { ...goodRuns(), exec: undefined } });
  assert.ok(checks.every((c) => !c.info || c.pass));
  assert.equal(summarize(checks).total, checks.filter((c) => !c.info).length);
});
