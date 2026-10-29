// node --test examples/unreal/mutable/mu-probe.test.mjs  (no Unreal, no dependencies)
// The canned reports below follow the shapes the mu_probe_*.py scripts write. Each mutation changes one fact and expects the matching check to fail,
// so the probe cannot pass by accident. The "as run" report is the shape of the build report when the object's graph cannot be reached from Python.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateProbes, summarize, parseProbeOptions, listParts, shotNames, PROBE_GROUPS, PROBE_PHASES, DEFAULT_COMPILE_TIMEOUT_S } from './mu-probe-checks.mjs';

const here = import.meta.dirname;
const read = (name) => readFileSync(join(here, name), 'utf8');
const solid = (width, height, rgb = [0, 0, 0]) => { const rgba = Buffer.alloc(width * height * 4); for (let i = 0; i < width * height; i++) rgba.set([...rgb, 255], i * 4); return { width, height, rgba }; };
const withSquare = (image, size, rgb) => { const copy = { ...image, rgba: Buffer.from(image.rgba) }; for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) copy.rgba.set([...rgb, 255], (y * image.width + x) * 4); return copy; };

const okCompile = { mode: 'async', deadline_s: 240, started: true, finished: true, timed_out: false, seconds: 8.2, compiled: true, request_failed: false, skipped: false, errors: [], warnings: [], is_compiled_after: true };
const buildReport = (over = {}) => ({
  probe: 'build', steps: [
    { step: 'import', parts: [{ id: 'person_body', skeletal: 1, static: 0, skeleton: 'person_body_Skeleton' }, { id: 'hat_cap', skeletal: 1, static: 0, skeleton: 'hat_cap_Skeleton' }, { id: 'hat_tall', skeletal: 1, static: 0, skeleton: 'hat_tall_Skeleton' }] },
    { step: 'create', created: true, path: '/Game/Mu/CO_Person', compiled_before: false },
    { step: 'graph', graph_found: true, graph_class: 'EdGraph', node_created: true, node_property_set: true, node_extra_members: 6, pin_api: ['make_link_to'], link_call_ok: true, attempts: { 'node.skeletal_mesh set': 'ok' } },
    { step: 'compile', ...okCompile },
    { step: 'readback', is_compiled: true, parameter_count: 1, component_count: 1, state_count: 1, parameters: [{ name: 'Hat', type: 'Int', options: ['Cap', 'Tall'] }] },
  ].map((s) => (over[s.step] ? { ...s, ...over[s.step] } : s)),
});
// what the engine run showed in the build report when the graph is out of reach: nodes expose nothing, the compile of the bare object still reports
const asRunBuild = () => buildReport({
  graph: { graph_found: true, node_created: true, node_property_set: false, node_extra_members: 0, pin_api: [], link_call_ok: false, attempts: { 'co.source read': 'protected and cannot be read', 'graph.call_method AddNode': 'no function' } },
  readback: { parameter_count: 0, component_count: 0, parameters: [] },
});
const entry = (report, extra = {}) => ({ report, process: { exit: 0, seconds: 100 }, images: {}, ...extra });
const variantsReport = () => ({
  probe: 'variants', steps: [
    { step: 'object', instance_created: true, is_compiled: true, parameters: [{ name: 'Hat', type: 'Int', options: ['Cap', 'Tall'] }] },
    { step: 'actor', found: true, component_found: true, instance_set: true },
    { step: 'control', shot: 'mu_control.png' },
    { step: 'variant', option: null, parameter: 'Hat', shot: 'mu_default.png', has_skeletal_mesh: true },
    { step: 'variant', option: 'Cap', parameter: 'Hat', selected_after: 'Cap', shot: 'mu_Cap.png', has_skeletal_mesh: true },
    { step: 'variant', option: 'Tall', parameter: 'Hat', selected_after: 'Tall', shot: 'mu_Tall.png', has_skeletal_mesh: true },
  ],
});
const variantImages = () => { const base = solid(64, 64, [5, 5, 5]); return { 'mu_control.png': withSquare(base, 50, [120, 200, 120]), 'mu_default.png': base, 'mu_Cap.png': withSquare(base, 30, [200, 0, 0]), 'mu_Tall.png': withSquare(base, 40, [0, 0, 220]) }; };
const headlessReport = (over = {}) => ({
  probe: 'headless', steps: [
    { step: 'load', loaded: true, is_compiled_on_load: true },
    { step: 'compile', ...okCompile, mode: 'sync' },
    { step: 'readback', is_compiled: true },
  ].map((s) => (over[s.step] ? { ...s, ...over[s.step] } : s)),
});
const judge = (reports, groups = Object.keys(reports)) => evaluateProbes({ groups, reports });
const byName = (checks, part) => checks.find((c) => c.name.includes(part));
const failing = (checks) => checks.filter((c) => !c.pass).map((c) => c.name);
const all = () => ({ build: entry(buildReport()), variants: entry(variantsReport(), { images: variantImages() }), headless: entry(headlessReport()) });

test('a report in which every claim holds passes every check', () => {
  const checks = judge(all());
  assert.deepEqual(failing(checks), []);
  assert.equal(summarize(checks).passed, summarize(checks).total);
  assert.equal(summarize(checks).total, 6 + 7 + 3);
});

test('as run: a graph whose nodes cannot be linked fails the graph and options checks and nothing else in the build group', () => {
  const checks = judge({ build: entry(asRunBuild()) });
  assert.deepEqual(failing(checks), ['the graph, its nodes and their links can be built from Python', 'the compiled object offers the parts as options of a parameter']);
  assert.match(byName(checks, 'graph, its nodes').detail, /mesh property set and read back false.*graph.call_method AddNode -> no function/);
});

test('build: each fact has its own check', () => {
  const cases = [
    ['import', { parts: [{ id: 'a', skeletal: 0, static: 1 }, { id: 'b', skeletal: 1 }] }, 'import as skeletal'],
    ['import', { parts: [{ id: 'a', skeletal: 1, error: 'boom' }, { id: 'b', skeletal: 1 }] }, 'import as skeletal'],
    ['create', { created: false, error: 'None' }, 'creates a Customizable Object'],
    ['create', { compiled_before: true }, 'creates a Customizable Object'],
    ['graph', { node_property_set: false }, 'graph, its nodes'],
    ['graph', { pin_api: [], link_call_ok: false }, 'graph, its nodes'],
    ['graph', { graph_found: false }, 'graph, its nodes'],
    ['readback', { parameters: [{ name: 'Hat', type: 'Int', options: ['Cap'] }] }, 'offers the parts'],
    ['compile', { timed_out: true, finished: false, compiled: null }, 'compile finishes'],
    ['compile', { compiled: false }, 'compile finishes'],
    ['compile', { errors: ['bad node'] }, 'compile finishes'],
    ['compile', { request_failed: true }, 'compile finishes'],
    ['compile', { started: false }, 'compile finishes'],
    ['readback', { is_compiled: false }, 'reads back as compiled'],
    ['compile', { is_compiled_after: false }, 'reads back as compiled'],
  ];
  for (const [stepName, over, name] of cases) {
    const checks = judge({ build: entry(buildReport({ [stepName]: over })) });
    assert.equal(byName(checks, name).pass, false, `${stepName} ${JSON.stringify(over)} should fail "${name}"`);
  }
});

test('build: a missing report fails once and names the process', () => {
  const checks = judge({ build: { process: { timed_out: true, seconds: 700 } } });
  assert.equal(checks.length, 1);
  assert.match(checks[0].detail, /killed after 700 s/);
});

test('variants: the frames must differ, exist and match the options read back', () => {
  const run = (mutate) => { const images = variantImages(); const report = variantsReport(); mutate(images, report); return judge({ variants: entry(report, { images }) }, ['variants']); };
  assert.equal(byName(run((i) => { i['mu_Tall.png'] = i['mu_Cap.png']; }), 'frames of the variants differ').pass, false);
  assert.equal(byName(run((i) => { delete i['mu_Tall.png']; }), 'frame is captured').pass, false);
  assert.equal(byName(run((i, r) => { r.steps[5].selected_after = 'Cap'; }), 'each option is set').pass, false);
  assert.equal(byName(run((i, r) => { r.steps[4].has_skeletal_mesh = false; }), 'builds a skeletal mesh').pass, false);
  assert.equal(byName(run((i, r) => { r.steps[1].found = false; }), 'actor shows').pass, false);
  assert.equal(byName(run((i) => { i['mu_control.png'] = i['mu_default.png']; }), 'plain imported skeletal mesh').pass, false);
  assert.equal(byName(run((i) => { delete i['mu_control.png']; }), 'plain imported skeletal mesh').pass, false);
  assert.equal(byName(run((i, r) => { r.steps[0].parameters = []; r.steps = r.steps.filter((s) => s.step !== 'variant' || s.option === null); }), 'Instance is made').pass, false);
  const none = run((i, r) => { r.steps = r.steps.filter((s) => s.step !== 'variant' || s.option === null); });
  assert.equal(byName(none, 'each option is set').pass, false);
  assert.match(byName(none, 'each option is set').detail, /no option was set/);
});

test('variants: shotNames lists the frames the report asks for, the default one included', () => {
  assert.deepEqual(shotNames(variantsReport()), ['mu_control.png', 'mu_default.png', 'mu_Cap.png', 'mu_Tall.png']);
  assert.deepEqual(shotNames(undefined), []);
});

test('headless: a hang or a crash is recorded as needing the editor, not as an error of the probe', () => {
  const noReport = judge({ headless: { process: { timed_out: true, seconds: 540 } } });
  assert.equal(noReport.length, 1);
  assert.equal(noReport[0].pass, false);
  assert.match(noReport[0].detail, /it hung/);
  const crashed = judge({ headless: { process: { exit: 3, seconds: 20 } } });
  assert.match(crashed[0].detail, /needs the editor/);
  const started = judge({ headless: entry(headlessReport({ compile: { finished: false, timed_out: false, compiled: undefined } })) });
  assert.equal(byName(started, 'completes within the timeout').pass, false);
  assert.equal(byName(judge({ headless: entry(headlessReport({ readback: { is_compiled: false } })) }), 'reads back as compiled').pass, false);
  assert.equal(byName(judge({ headless: entry(headlessReport({ compile: { errors: ['x'] } })) }), 'completes within the timeout').pass, false);
});

test('options: groups, the engine, the parts folder and the compile timeout', () => {
  assert.match(parseProbeOptions([]).error, /no engine folder/);
  const ok = parseProbeOptions(['--engine', 'E', '--parts', 'P'], {});
  assert.deepEqual([ok.engine, ok.groups, ok.parts, ok.compileTimeoutS, ok.named], ['E', PROBE_GROUPS, 'P', DEFAULT_COMPILE_TIMEOUT_S, false]);
  assert.equal(parseProbeOptions([], { UE_ROOT: 'E2', AGENT_UNREAL_MUTABLE_PARTS: 'P2' }).parts, 'P2');
  assert.deepEqual(parseProbeOptions(['--engine', 'E', '--only', 'headless,build']).groups, ['build', 'headless']);
  assert.match(parseProbeOptions(['--engine', 'E', '--only', 'variants']).error, /name build too/);
  assert.match(parseProbeOptions(['--engine', 'E', '--only', 'nope']).error, /unknown group nope/);
  assert.match(parseProbeOptions(['--engine', 'E', '--compile-timeout', '5']).error, /10 to 3600/);
  assert.equal(parseProbeOptions(['--engine', 'E', '--compile-timeout', '90']).compileTimeoutS, 90);
  assert.match(parseProbeOptions(['--engine', 'E', '--engine', 'F']).error, /given twice/);
  assert.match(parseProbeOptions(['--engine']).error, /needs a value/);
  assert.match(parseProbeOptions(['--engine', 'E', '--wat']).error, /unknown option/);
});

test('listParts takes the glb files by name and refuses fewer than two', () => {
  assert.deepEqual(listParts(['hat_tall.glb', 'notes.txt', 'person-body.GLB', 'hat_cap.glb']).parts.map((p) => p.id), ['hat_cap', 'hat_tall', 'person_body']);
  assert.match(listParts(['one.glb']).error, /at least two/);
});

test('every phase names a script that exists', () => {
  const files = new Set(readdirSync(here));
  for (const group of PROBE_GROUPS) for (const phase of PROBE_PHASES[group]) assert.ok(files.has(phase.script), `${phase.script} is missing`);
  assert.equal(PROBE_PHASES.headless[0].mode, 'commandlet');
  assert.equal(PROBE_PHASES.build[0].mode, 'editor');
});

test('no compile call lacks a wall-clock timeout', () => {
  // Python: the only compile call is in run_compile, which measures COMPILE_TIMEOUT_S around it; the deprecated blocking call is never used.
  const scripts = readdirSync(here).filter((f) => f.endsWith('.py'));
  const calls = scripts.flatMap((f) => read(f).split('\n').map((line, i) => ({ f, i, line })).filter((x) => /\.compile\(|compile_customizable_object_synchronously/.test(x.line) && !/^\s*(#|""")/.test(x.line)));
  assert.deepEqual(calls.map((x) => x.f), ['mu_probe_common.py']);
  assert.match(calls[0].line, /co\.compile\(params\)/);
  const common = read('mu_probe_common.py');
  const fn = common.slice(common.indexOf('def run_compile'), common.indexOf('def read_parameters'));
  assert.match(fn, /deadline_s=COMPILE_TIMEOUT_S/);
  assert.match(fn, /time\.monotonic\(\) - started < COMPILE_TIMEOUT_S/);
  assert.ok(fn.indexOf('deadline_s=COMPILE_TIMEOUT_S') < fn.indexOf('co.compile(params)'));
  for (const f of scripts.filter((s) => s !== 'mu_probe_common.py')) assert.doesNotMatch(read(f), /\.compile\(/, `${f} compiles outside run_compile`);
  // Node: every engine or shell process the runner starts carries a timeout.
  const runner = read('mu_probe.mjs');
  const spawns = [...runner.matchAll(/spawnSync\([\s\S]*?\);/g)].map((m) => m[0]);
  assert.ok(spawns.length >= 2);
  for (const call of spawns) assert.match(call, /timeout:/, `spawnSync without a timeout: ${call.slice(0, 80)}`);
  // and the phase limit is built from the compile timeout
  assert.match(runner, /const limits = \(phase\) => \(compileTimeoutS \+ phase\.extraS\) \* 1000/);
  assert.ok(PROBE_GROUPS.every((g) => PROBE_PHASES[g].every((p) => p.extraS > 0)));
});

test('plugin content stays free of machine, GPU and home-path language', () => {
  for (const f of readdirSync(here)) {
    if (f.endsWith('.test.mjs')) continue;
    const text = read(f);
    // the words are assembled so that this file does not contain them itself
    const banned = [['hal', '9000'], ['R', 'TX'], ['Ge', 'Force'], ['/Us', 'ers/'], ['C:\\', 'Users'], ['eh', 'art']].map((p) => p.join('').replace(/[\\/]/g, '\\$&'));
    assert.doesNotMatch(text, new RegExp(banned.join('|'), 'i'), f);
  }
});
