// node --test examples/unreal/mutable/mu-probe.test.mjs  (no Unreal, no dependencies)
// The canned reports below follow the shapes the mu_probe_*.py scripts and the runner write. Each mutation changes one fact and expects the matching check to fail,
// so the probe cannot pass by accident. The "as run" build report is the shape of the build report when Python alone cannot reach the object's graph.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateProbes, summarize, parseProbeOptions, listParts, shotNames, summarizeBuildLog,
  PROBE_GROUPS, PROBE_PHASES, GROUP_NEEDS, DEFAULT_COMPILE_TIMEOUT_S, MODULE_BUILD_TIMEOUT_S, BRIDGE_FUNCTIONS, NODE_CLASSES,
} from './mu-probe-checks.mjs';

const here = import.meta.dirname;
const read = (name) => readFileSync(join(here, name), 'utf8');
const solid = (width, height, rgb = [0, 0, 0]) => { const rgba = Buffer.alloc(width * height * 4); for (let i = 0; i < width * height; i++) rgba.set([...rgb, 255], i * 4); return { width, height, rgba }; };
const withSquare = (image, size, rgb) => { const copy = { ...image, rgba: Buffer.from(image.rgba) }; for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) copy.rgba.set([...rgb, 255], (y * image.width + x) * 4); return copy; };
const filesUnder = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? filesUnder(join(dir, f)).map((x) => join(f, x)) : [f]));

const okCompile = { mode: 'async', deadline_s: 240, started: true, finished: true, timed_out: false, seconds: 8.2, compiled: true, request_failed: false, skipped: false, errors: [], warnings: [], is_compiled_after: true };
const entry = (report, extra = {}) => ({ report, process: { exit: 0, seconds: 100 }, images: {}, ...extra });

// bridge ------------------------------------------------------------------------------------------------------------------
const bridgeReport = (over = {}) => ({
  probe: 'bridge', steps: [
    { step: 'library', present: true, editor_library_present: true, functions: [...BRIDGE_FUNCTIONS], missing: [], structs: { MutableBridgeResult: true, MutableBridgePin: true } },
    { step: 'categories', categories: ['object', 'component', 'material', 'modifier', 'mesh', 'skeletalMesh', 'passThroughSkeletalMesh', 'enum', 'string', 'materialAsset'] },
  ].map((s) => (over[s.step] ? { ...s, ...over[s.step] } : s)),
});
const builtModule = { exit: 0, seconds: 61, timedOut: false, log: { errorCount: 0, errorLines: [], warningCount: 2, result: 'Succeeded' } };
const bridgeEntry = (over = {}, moduleOver = {}) => entry(bridgeReport(over), { module: { ...builtModule, ...moduleOver } });

// build -------------------------------------------------------------------------------------------------------------------
// what the engine run showed in the build report: Python finds the graph, can create a node, and has no call that adds it or links a pin
const buildReport = (over = {}) => ({
  probe: 'build', steps: [
    { step: 'import', parts: [{ id: 'person_body', skeletal: 1, static: 0, skeleton: 'person_body_Skeleton' }, { id: 'hat_cap', skeletal: 1, static: 0, skeleton: 'hat_cap_Skeleton' }, { id: 'hat_tall', skeletal: 1, static: 0, skeleton: 'hat_tall_Skeleton' }] },
    { step: 'create', created: true, path: '/Game/Mu/CO_Person', compiled_before: false },
    { step: 'graph', graph_found: true, graph_class: 'CustomizableObjectGraph', node_created: true, node_property_set: true, node_extra_members: 0, pin_api: [], link_call_ok: false, attempts: { 'co.source read': 'protected and cannot be read', 'graph.call_method AddNode': 'no function' } },
    { step: 'compile', ...okCompile },
    { step: 'readback', is_compiled: true, parameter_count: 0, component_count: 0, parameters: [] },
  ].map((s) => (over[s.step] ? { ...s, ...over[s.step] } : s)),
});

// graph -------------------------------------------------------------------------------------------------------------------
const meshOut = 'CustomizableObjectNodeSkeletalMesh.LOD 0 - Section 0 - Mesh';
const refusal = (caseName) => ({ case: caseName, ok: false, message: `refused: ${caseName}` });
const graphReport = (over = {}) => ({
  probe: 'graph', steps: [
    { step: 'surface', library_present: true, functions: ['add_node', 'link_pins'] },
    { step: 'parts', parts: [{ id: 'hat_cap', option: 'Cap' }, { id: 'hat_tall', option: 'Tall' }, { id: 'person_body', option: 'Body' }] },
    {
      step: 'link_test', co: '/Game/Mu/CO_Link', created: true, base_node_present: true, added_ok: true,
      before: { node_count: 1, classes: [NODE_CLASSES.object], link_count: 0, links: [] },
      mesh_pins: [{ name: 'LOD 0 - Section 0 - Mesh', direction: 'Output', category: 'mesh', array: false, links: 0 }],
      after_add: { node_count: 3, classes: [NODE_CLASSES.mesh, NODE_CLASSES.object, NODE_CLASSES.section], link_count: 0, links: [] },
      after_link: { node_count: 3, classes: [NODE_CLASSES.mesh, NODE_CLASSES.object, NODE_CLASSES.section], link_count: 1, links: [{ from: meshOut, to: `${NODE_CLASSES.section}.Mesh_Input_Pin` }] },
      refusals: ['unknown input pin', 'unknown output pin', 'pins of different kinds', 'a null output node', 'an input pin as the output', 'a class that does not exist', 'a class that is not a node', 'an abstract node class', 'a null object'].map(refusal),
      unchanged_by_refusals: true,
    },
    {
      step: 'swap', created: true, co: '/Game/Mu/CO_Swap', body: 'person_body', options: ['Cap', 'Tall'], ops_ok: true,
      sections: { person_body: 1, hat_cap: 1, hat_tall: 1 }, expected_nodes: 11, expected_links: 11,
      ops: [{ op: 'add mesh_person_body', ok: true, message: 'added' }, { op: 'link x', ok: true, message: 'linked' }],
      before: { node_count: 1, link_count: 0 }, after: { node_count: 12, link_count: 11 }, parameter_read_back: { ParameterName: 'Hat', Values: '((Name="Cap"),(Name="Tall"))' },
    },
    { step: 'compile', ...okCompile },
    { step: 'readback', is_compiled: true, parameter_count: 1, component_count: 1, state_count: 1, parameters: [{ name: 'Hat', type: 'Int', options: ['Cap', 'Tall'] }] },
    { step: 'save', saved: true },
  ].map((s) => (over[s.step] ? { ...s, ...over[s.step] } : s)),
});

// variants and headless ---------------------------------------------------------------------------------------------------
const variantsReport = () => ({
  probe: 'variants', steps: [
    { step: 'object', instance_created: true, is_compiled: true, graph_nodes_on_load: 12, parameters: [{ name: 'Hat', type: 'Int', options: ['Cap', 'Tall'] }] },
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
    { step: 'load', loaded: true, is_compiled_on_load: false, bridge_present: true, graph_nodes_on_load: 12 },
    { step: 'compile', ...okCompile, mode: 'sync' },
    { step: 'readback', is_compiled: true, parameters: [{ name: 'Hat', type: 'Int', options: ['Cap', 'Tall'] }] },
  ].map((s) => (over[s.step] ? { ...s, ...over[s.step] } : s)),
});

const judge = (reports, groups = Object.keys(reports)) => evaluateProbes({ groups, reports });
const byName = (checks, part) => checks.find((c) => c.name.includes(part));
const failing = (checks) => checks.filter((c) => !c.pass).map((c) => c.name);
const all = () => ({ bridge: bridgeEntry(), build: entry(buildReport()), graph: entry(graphReport()), variants: entry(variantsReport(), { images: variantImages() }), headless: entry(headlessReport()) });

test('a report in which every claim holds passes every check', () => {
  const checks = judge(all());
  assert.deepEqual(failing(checks), []);
  assert.equal(summarize(checks).passed, summarize(checks).total);
  assert.equal(summarize(checks).total, 3 + 5 + 7 + 7 + 4);
});

test('bridge: the module build, the editor report and each fact have their own check', () => {
  const failed = judge({ bridge: bridgeEntry({}, { exit: 1, log: { errorCount: 2, errorLines: ['C:\\x\\MutableBridgeLibrary.cpp(40): error C2039: \'Foo\': is not a member of \'UEdGraph\'', 'second'], warningCount: 0, result: 'Failed (OtherCompilationError)' } }) });
  assert.equal(byName(failed, 'module builds').pass, false);
  assert.match(byName(failed, 'module builds').detail, /exit 1 in 61 s.*Failed \(OtherCompilationError\).*error C2039/);
  assert.equal(byName(judge({ bridge: bridgeEntry({}, { exit: undefined, timedOut: true, seconds: 1200 }) }), 'module builds').detail.includes('killed at the limit after 1200 s'), true);
  assert.match(byName(judge({ bridge: entry(undefined, { module: builtModule, process: { exit: 3, seconds: 20 } }) }), 'module builds').detail, /exit 0/);
  const noEditor = judge({ bridge: { module: builtModule, process: { exit: 3, seconds: 20 }, images: {} } });
  assert.deepEqual(failing(noEditor), ['the editor starts with the module loaded and writes a report']);
  const cases = [
    ['library', { present: false }, 'visible from Python'],
    ['library', { functions: BRIDGE_FUNCTIONS.slice(1), missing: [BRIDGE_FUNCTIONS[0]] }, 'visible from Python'],
    ['library', { structs: { MutableBridgeResult: false } }, 'visible from Python'],
    ['categories', { categories: [] }, 'exported symbols'],
    ['categories', { categories: ['mesh'] }, 'exported symbols'],
  ];
  for (const [stepName, over, name] of cases) {
    assert.equal(byName(judge({ bridge: bridgeEntry({ [stepName]: over }) }), name).pass, false, `${stepName} ${JSON.stringify(over)} should fail "${name}"`);
  }
});

test('summarizeBuildLog keeps the compiler and linker messages word for word and counts them', () => {
  const log = [
    'Building MuProbeEditor...',
    'C:\\p\\Source\\MutableBridge\\MutableBridgeLibrary.cpp(12): warning C4996: \'Foo\': deprecated',
    'C:\\p\\Source\\MutableBridge\\MutableBridgeLibrary.cpp(40): error C2039: \'Nodes\': is not a member of \'UEdGraph\'',
    'MutableBridgeLibrary.cpp.obj : error LNK2019: unresolved external symbol "public: void __cdecl X::Y(void)" referenced in function "Z"',
    'fatal error C1083: Cannot open include file: \'MuCO/CustomizableObjectPrivate.h\': No such file or directory',
    'ERROR: UnrealBuildTool failed',
    'Result: Failed (OtherCompilationError)',
  ].join('\n');
  const summary = summarizeBuildLog(log);
  assert.equal(summary.errorCount, 4);
  assert.equal(summary.warningCount, 1);
  assert.equal(summary.result, 'Failed (OtherCompilationError)');
  assert.ok(summary.errorLines[0].endsWith("error C2039: 'Nodes': is not a member of 'UEdGraph'"));
  assert.match(summary.errorLines[1], /error LNK2019: unresolved external symbol/);
  const ok = summarizeBuildLog('Total execution time: 40 seconds\nResult: Succeeded');
  assert.deepEqual([ok.errorCount, ok.result], [0, 'Succeeded']);
  assert.deepEqual(summarizeBuildLog(undefined).errorLines, []);
  assert.equal(summarizeBuildLog(Array.from({ length: 30 }, () => 'x.cpp(1): error C2065: y').join('\n')).errorLines.length, 12);
});

test('build: Python alone cannot author the graph (the gap the bridge fills) and the rest of the build group holds', () => {
  const checks = judge({ build: entry(buildReport()) });
  assert.deepEqual(failing(checks), []);
  assert.match(byName(checks, 'Python alone').detail, /node created true.*members listed beyond EdGraphNode 0.*graph.call_method AddNode -> no function/);
  // if a later engine lets Python add a node and link a pin, the premise fails and says so
  const reachable = judge({ build: entry(buildReport({ graph: { link_call_ok: true } })) });
  assert.deepEqual(failing(reachable), ['Python alone cannot add a node to the graph or link a pin (the gap the bridge fills)']);
});

test('build: each fact has its own check', () => {
  const cases = [
    ['import', { parts: [{ id: 'a', skeletal: 0, static: 1 }, { id: 'b', skeletal: 1 }] }, 'import as skeletal'],
    ['import', { parts: [{ id: 'a', skeletal: 1, error: 'boom' }, { id: 'b', skeletal: 1 }] }, 'import as skeletal'],
    ['create', { created: false, error: 'None' }, 'creates a Customizable Object'],
    ['create', { compiled_before: true }, 'creates a Customizable Object'],
    ['graph', { graph_found: false }, 'Python alone'],
    ['graph', { node_created: false }, 'Python alone'],
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

test('build and graph: a missing report fails once and names the process', () => {
  for (const group of ['build', 'graph']) {
    const checks = judge({ [group]: { process: { timed_out: true, seconds: 700 } } });
    assert.equal(checks.length, 1);
    assert.match(checks[0].detail, /killed after 700 s/);
  }
});

test('graph: node, link, refusals, graph build, compile, parameter and save each have their own check', () => {
  const mutate = (stepName, fn) => { const report = graphReport(); const s = report.steps.find((x) => x.step === stepName); fn(s); return judge({ graph: entry(report) }); };
  assert.equal(byName(mutate('link_test', (s) => { s.after_add.node_count = 2; }), 'node is added').pass, false);
  assert.equal(byName(mutate('link_test', (s) => { s.base_node_present = false; }), 'node is added').pass, false);
  assert.equal(byName(mutate('link_test', (s) => { s.after_add.classes = [NODE_CLASSES.object]; }), 'node is added').pass, false);
  assert.equal(byName(mutate('link_test', (s) => { s.mesh_pins = []; }), 'node is added').pass, false);
  assert.equal(byName(mutate('link_test', (s) => { s.created = false; }), 'node is added').pass, false);
  assert.equal(byName(mutate('link_test', (s) => { s.after_link.link_count = 0; }), 'pin is linked').pass, false);
  assert.equal(byName(mutate('link_test', (s) => { s.after_link.links = []; }), 'pin is linked').pass, false);
  assert.equal(byName(mutate('link_test', (s) => { s.refusals[2].ok = true; }), 'refused cleanly').pass, false);
  assert.equal(byName(mutate('link_test', (s) => { s.refusals[0] = { case: 'x', raised: 'RuntimeError: boom' }; }), 'refused cleanly').pass, false);
  assert.equal(byName(mutate('link_test', (s) => { s.refusals[0].message = ''; }), 'refused cleanly').pass, false);
  assert.equal(byName(mutate('link_test', (s) => { s.refusals = s.refusals.slice(0, 3); }), 'refused cleanly').pass, false);
  assert.equal(byName(mutate('link_test', (s) => { s.unchanged_by_refusals = false; }), 'refused cleanly').pass, false);
  assert.equal(byName(mutate('swap', (s) => { s.ops_ok = false; }), 'graph is built').pass, false);
  assert.equal(byName(mutate('swap', (s) => { s.after.node_count = 5; }), 'graph is built').pass, false);
  assert.equal(byName(mutate('swap', (s) => { s.after.link_count = 4; }), 'graph is built').pass, false);
  assert.equal(byName(mutate('swap', (s) => { s.after.node_count = 13; }), 'graph is built').pass, false);
  assert.equal(byName(mutate('swap', (s) => { delete s.expected_nodes; }), 'graph is built').pass, false);
  assert.equal(byName(mutate('swap', (s) => { s.sections = { person_body: 1 }; }), 'graph is built').pass, false);
  // every section of every part is wired: a body of 6 sections and two hats of 2 give 6 + 2 + 2 section nodes, 2 switches (one per section slot)
  const wired = mutate('swap', (s) => { s.sections = { person_body: 6, hat_cap: 2, hat_tall: 2 }; s.expected_nodes = 3 + 10 + 1 + 2 + 3; s.expected_links = 10 + 2 + 4 + 6 + 2 + 3; s.after.node_count = 20; s.after.link_count = 27; });
  assert.equal(byName(wired, 'graph is built').pass, true);
  assert.match(byName(wired, 'graph is built').detail, /sections per part person_body 6, hat_cap 2, hat_tall 2/);
  assert.equal(byName(mutate('swap', (s) => { s.options = ['Cap']; }), 'graph is built').pass, false);
  assert.equal(byName(mutate('swap', (s) => { s.parameter_read_back.ParameterName = 'Default Name'; }), 'graph is built').pass, false);
  assert.equal(byName(mutate('compile', (s) => { s.errors = ['Missing reference Skeletal Mesh']; }), 'compile of the graph').pass, false);
  assert.equal(byName(mutate('compile', (s) => { s.timed_out = true; s.finished = false; s.compiled = null; }), 'compile of the graph').pass, false);
  assert.equal(byName(mutate('readback', (s) => { s.parameters = []; }), 'reports the parameter').pass, false);
  assert.equal(byName(mutate('readback', (s) => { s.parameters = [{ name: 'Hat', type: 'Int', options: ['Cap'] }]; }), 'reports the parameter').pass, false);
  assert.equal(byName(mutate('readback', (s) => { s.parameters = [{ name: 'Other', type: 'Int', options: ['Cap', 'Tall'] }]; }), 'reports the parameter').pass, false);
  assert.equal(byName(mutate('readback', (s) => { s.is_compiled = false; }), 'compiled and is saved').pass, false);
  assert.equal(byName(mutate('save', (s) => { s.saved = false; }), 'compiled and is saved').pass, false);
  const detail = byName(mutate('swap', (s) => { s.ops.push({ op: 'link y', ok: false, message: 'no input pin CONodeSwitch.Cap' }); s.ops_ok = false; }), 'graph is built').detail;
  assert.match(detail, /refused: no input pin CONodeSwitch\.Cap/);
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

test('headless: a hang or a crash is recorded as needing the editor, and an empty object does not count as the real graph', () => {
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
  assert.equal(byName(judge({ headless: entry(headlessReport({ load: { graph_nodes_on_load: 1 } })) }), 'real graph').pass, false);
  assert.equal(byName(judge({ headless: entry(headlessReport({ load: { bridge_present: false } })) }), 'real graph').pass, false);
  assert.equal(byName(judge({ headless: entry(headlessReport({ readback: { parameters: [] } })) }), 'real graph').pass, false);
});

test('options: groups and what they need, the engine, the parts folder, the compile timeout and the toolchain', () => {
  assert.match(parseProbeOptions([]).error, /no engine folder/);
  const ok = parseProbeOptions(['--engine', 'E', '--parts', 'P'], {});
  assert.deepEqual([ok.engine, ok.groups, ok.parts, ok.compileTimeoutS, ok.named], ['E', PROBE_GROUPS, 'P', DEFAULT_COMPILE_TIMEOUT_S, false]);
  assert.equal(parseProbeOptions([], { UE_ROOT: 'E2', AGENT_UNREAL_MUTABLE_PARTS: 'P2' }).parts, 'P2');
  assert.deepEqual(parseProbeOptions(['--engine', 'E', '--only', 'headless,graph,build,bridge']).groups, ['bridge', 'build', 'graph', 'headless']);
  assert.deepEqual(parseProbeOptions(['--engine', 'E', '--only', 'build']).groups, ['build']);
  assert.deepEqual(parseProbeOptions(['--engine', 'E', '--only', 'bridge']).groups, ['bridge']);
  assert.match(parseProbeOptions(['--engine', 'E', '--only', 'variants']).error, /variants needs graph in the same list/);
  assert.match(parseProbeOptions(['--engine', 'E', '--only', 'graph']).error, /graph needs bridge and build/);
  assert.match(parseProbeOptions(['--engine', 'E', '--only', 'graph,build']).error, /graph needs bridge in the same list/);
  assert.match(parseProbeOptions(['--engine', 'E', '--only', 'nope']).error, /unknown group nope/);
  assert.match(parseProbeOptions(['--engine', 'E', '--compile-timeout', '5']).error, /10 to 3600/);
  assert.equal(parseProbeOptions(['--engine', 'E', '--compile-timeout', '90']).compileTimeoutS, 90);
  assert.deepEqual([parseProbeOptions(['--engine', 'E', '--compiler', '14.44.1', '--sdk', '10.0.26100.0']).compiler, parseProbeOptions(['--engine', 'E', '--sdk', '10.0.1.0']).sdk], ['14.44.1', '10.0.1.0']);
  assert.match(parseProbeOptions(['--engine', 'E', '--engine', 'F']).error, /given twice/);
  assert.match(parseProbeOptions(['--engine']).error, /needs a value/);
  assert.match(parseProbeOptions(['--engine', 'E', '--wat']).error, /unknown option/);
  for (const [group, needs] of Object.entries(GROUP_NEEDS)) assert.ok(needs.every((n) => PROBE_GROUPS.indexOf(n) < PROBE_GROUPS.indexOf(group)), `${group} reads a group that runs after it`);
});

test('listParts takes the glb files by name and refuses fewer than two', () => {
  assert.deepEqual(listParts(['hat_tall.glb', 'notes.txt', 'person-body.GLB', 'hat_cap.glb']).parts.map((p) => p.id), ['hat_cap', 'hat_tall', 'person_body']);
  assert.match(listParts(['one.glb']).error, /at least two/);
});

test('every phase names a script that exists, and the module build runs first', () => {
  const files = new Set(readdirSync(here));
  for (const group of PROBE_GROUPS) for (const phase of PROBE_PHASES[group]) if (phase.script) assert.ok(files.has(phase.script), `${phase.script} is missing`);
  assert.equal(PROBE_PHASES.headless[0].mode, 'commandlet');
  assert.equal(PROBE_PHASES.build[0].mode, 'editor');
  assert.deepEqual(PROBE_PHASES.bridge.map((p) => p.mode), ['build', 'editor']);
  assert.equal(PROBE_GROUPS[0], 'bridge');
  for (const group of ['graph', 'variants', 'headless']) assert.equal(PROBE_PHASES[group][0].co, '/Game/Mu/CO_Swap');
});

test('no compile call lacks a wall-clock timeout, and the module build has one', () => {
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
  assert.ok(PROBE_GROUPS.every((g) => PROBE_PHASES[g].every((p) => p.mode === 'build' || p.extraS > 0)));
  // the Unreal Build Tool run is given its limit explicitly, and the limit is a sane number of seconds
  assert.match(runner, /buildEditor\(\{[^}]*timeoutMs: MODULE_BUILD_TIMEOUT_S \* 1000/);
  assert.ok(Number.isInteger(MODULE_BUILD_TIMEOUT_S) && MODULE_BUILD_TIMEOUT_S >= 300 && MODULE_BUILD_TIMEOUT_S <= 3600);
});

test('the module source: the files, the dependency on the Mutable editor module, and the library names the probe expects', () => {
  const dir = join(here, 'module', 'MutableBridge');
  for (const f of ['MutableBridge.Build.cs', 'MutableBridgeModule.cpp', 'MutableBridgeLibrary.h', 'MutableBridgeLibrary.cpp']) assert.ok(existsSync(join(dir, f)), `${f} is missing`);
  const rules = readFileSync(join(dir, 'MutableBridge.Build.cs'), 'utf8');
  assert.match(rules, /class MutableBridge : ModuleRules/);
  assert.match(rules, /"CustomizableObjectEditor"/);
  assert.match(readFileSync(join(dir, 'MutableBridgeModule.cpp'), 'utf8'), /IMPLEMENT_MODULE\(FMutableBridgeModule, MutableBridge\)/);
  // every BlueprintCallable static of the library is a name the probe expects, and the other way round (Python sees CamelCase as snake_case)
  const header = readFileSync(join(dir, 'MutableBridgeLibrary.h'), 'utf8');
  const exposed = [...header.matchAll(/UFUNCTION\(BlueprintCallable[^)]*\)\s*static [^(]*?\b(\w+)\(/g)].map((m) => m[1].replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase());
  assert.deepEqual([...exposed].sort(), [...BRIDGE_FUNCTIONS].sort());
  const script = read('mu_probe_bridge.py');
  const listed = [...script.slice(script.indexOf('EXPECTED = ('), script.indexOf(')', script.indexOf('EXPECTED = (')))].join('').match(/"(\w+)"/g).map((s) => s.replace(/"/g, ''));
  assert.deepEqual([...listed].sort(), [...BRIDGE_FUNCTIONS].sort());
  // the node class names the checks look for are the ones the graph script adds
  const graph = read('mu_probe_graph.py');
  for (const name of Object.values(NODE_CLASSES)) assert.ok(graph.includes(`"${name}"`), `${name} is not used by mu_probe_graph.py`);
  // the module names no engine source change: it includes only the schema header of the Mutable editor module
  const cpp = readFileSync(join(dir, 'MutableBridgeLibrary.cpp'), 'utf8');
  assert.deepEqual([...cpp.matchAll(/#include "(MuCOE?\/[^"]+)"/g)].map((m) => m[1]), ['MuCOE/EdGraphSchema_CustomizableObject.h']);
});

test('plugin content stays free of machine, GPU and home-path language', () => {
  for (const f of filesUnder(here)) {
    if (f.endsWith('.test.mjs')) continue;
    const text = readFileSync(join(here, f), 'utf8');
    // the words are assembled so that this file does not contain them itself
    const banned = [['hal', '9000'], ['R', 'TX'], ['Ge', 'Force'], ['/Us', 'ers/'], ['C:\\', 'Users'], ['eh', 'art']].map((p) => p.join('').replace(/[\\/]/g, '\\$&'));
    assert.doesNotMatch(text, new RegExp(banned.join('|'), 'i'), f);
  }
});

test('no built binary, generated project or asset sits in the probe folder', () => {
  const bad = filesUnder(here).filter((f) => /\.(dll|lib|pdb|uasset|umap|obj|exp)$/i.test(f) || /(^|[\\/])(Intermediate|Binaries|Saved)([\\/]|$)/.test(f));
  assert.deepEqual(bad, []);
});
