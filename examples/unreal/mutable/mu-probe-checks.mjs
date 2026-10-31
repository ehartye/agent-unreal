// Pure options and checks of the Mutable probe (mu_probe.mjs). Prepared 2026-10-30. No Unreal, no files: mu-probe.test.mjs feeds it canned
// reports and mu_probe.mjs feeds it real ones. The report shapes below are the ones the mu_probe_*.py scripts and the runner write.
// The original five groups and the scale/material experiments:
//   bridge    Does the editor module MutableBridge (which depends on the Mutable plugin's editor module) build, load, and show up in Python?
//   build     Do agent-meshes parts import and does a bare Customizable Object compile? (Python alone cannot author its graph: that gap is pinned.)
//   graph     Does the bridge add a node and link a pin (and refuse an invalid pin), and does a graph with swappable parts compile with its parameter?
//   variants  Can an Instance be set to each option in turn, with a captured frame of each variant, and do the frames differ?
//   headless  Does the same compile finish under UnrealEditor-Cmd -run=pythonscript -nullrhi within the timeout, or does it need the editor?
// Every check returns { group, pass, name, claim, detail }.
import { changedPixels } from '../niagara_toolsets/nts-probe-assets.mjs';

export const PROBE_GROUPS = ['bridge', 'build', 'graph', 'variants', 'headless', 'skeleton', 'scale', 'material', 'components'];
/** What a group reads from the groups before it (the module must be built before any editor run; the graph is built on the imported parts). */
export const GROUP_NEEDS = { graph: ['bridge', 'build'], variants: ['graph'], headless: ['graph'], skeleton: ['bridge', 'build'], scale: ['bridge', 'build'], material: ['bridge', 'build'], components: ['bridge', 'build'] };
/** Wall-clock limit of the Unreal Build Tool run that builds the module, in seconds. */
export const MODULE_BUILD_TIMEOUT_S = 1200;
/** The functions of unreal.MutableBridgeLibrary the probe expects (mu_probe_bridge.py lists the same names; a test pins that). */
export const BRIDGE_FUNCTIONS = ['add_node', 'set_node_property', 'get_node_property', 'reconstruct_node', 'get_node_pins', 'link_pins', 'get_graph_nodes', 'get_graph_links', 'get_pin_categories'];
export const OBJECT_PATH = '/Game/Mu/CO_Person';
export const SWAP_PATH = '/Game/Mu/CO_Swap';
export const NODE_CLASSES = { mesh: 'CustomizableObjectNodeSkeletalMesh', section: 'CONodeSkeletalMeshSection', object: 'CustomizableObjectNodeObject' };
/** Wall-clock limit of one compile, in seconds. The scripts read it from MU_COMPILE_TIMEOUT_S; the runner adds a margin for the process. */
export const DEFAULT_COMPILE_TIMEOUT_S = 240;
/**
 * The engine phases of each group, in order. `editor` starts UnrealEditor with a Python script run by -ExecCmds (a rendering editor, offscreen);
 * `commandlet` runs UnrealEditor-Cmd with -run=pythonscript and -nullrhi. `extraS` is the margin added to the compile timeout for the
 * whole process (engine start, import, shader work, shutdown).
 */
export const PROBE_PHASES = {
  // mode "build" runs Unreal Build Tool on the Editor target of the throwaway code project; the editor phase after it loads the module
  bridge: [{ name: 'module', mode: 'build' }, { name: 'bridge', mode: 'editor', script: 'mu_probe_bridge.py', extraS: 300 }],
  build: [{ name: 'build', mode: 'editor', script: 'mu_probe_build.py', extraS: 480, co: OBJECT_PATH }],
  graph: [{ name: 'graph', mode: 'editor', script: 'mu_probe_graph.py', extraS: 600, co: SWAP_PATH }],
  variants: [{ name: 'variants', mode: 'editor', script: 'mu_probe_variants.py', extraS: 420, prefix: 'mu', co: SWAP_PATH }],
  headless: [{ name: 'headless', mode: 'commandlet', script: 'mu_probe_headless.py', extraS: 300, co: SWAP_PATH }],
  skeleton: [{ name: 'skeleton', mode: 'editor', script: 'mu_probe_extended.py', extraS: 720 }],
  scale: [{ name: 'scale', mode: 'editor', script: 'mu_probe_extended.py', extraS: 600 }],
  material: [{ name: 'material', mode: 'editor', script: 'mu_probe_extended.py', extraS: 600 }],
  components: [{ name: 'components', mode: 'editor', script: 'mu_probe_extended.py', extraS: 600 }],
};
export const USAGE = 'usage: node mu_probe.mjs --engine <UE_5.8 folder> --parts <folder of .glb files> [--only <group>[,<group>...]] [--keep] [--plan] [--compile-timeout <seconds>] [--compiler <x.y.z>] [--sdk <10.0.n.n>]'
  + `   groups: ${PROBE_GROUPS.join(', ')}   (no --only: every group; graph needs bridge and build, variants and headless need graph, because they read what those save)`;

/**
 * @param {string[]} argv  process.argv without node and the script
 * @param {Record<string, string|undefined>} [env]  UE_ROOT supplies the engine folder; AGENT_UNREAL_MUTABLE_PARTS the parts folder
 * @returns {{ error?: string, engine?: string, keep?: boolean, plan?: boolean, groups?: string[], named?: boolean, parts?: string, compileTimeoutS?: number, compiler?: string, sdk?: string }}
 */
export function parseProbeOptions(argv, env = {}) {
  const values = {}, valued = { '--engine': 'engine', '--only': 'only', '--parts': 'parts', '--compile-timeout': 'compileTimeout', '--compiler': 'compiler', '--sdk': 'sdk' };
  let keep = false, plan = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--keep') keep = true;
    else if (arg === '--plan') plan = true;
    else if (valued[arg]) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value` };
      if (values[valued[arg]] !== undefined) return { error: `${arg} given twice` };
      values[valued[arg]] = value;
      i++;
    } else return { error: `unknown option ${arg}` };
  }
  const engine = values.engine || env.UE_ROOT;
  if (!engine) return { error: 'no engine folder: pass --engine or set UE_ROOT' };
  let compileTimeoutS = DEFAULT_COMPILE_TIMEOUT_S;
  if (values.compileTimeout !== undefined) {
    compileTimeoutS = Number(values.compileTimeout);
    if (!Number.isInteger(compileTimeoutS) || compileTimeoutS < 10 || compileTimeoutS > 3600) return { error: '--compile-timeout needs a whole number of seconds from 10 to 3600' };
  }
  let groups = PROBE_GROUPS;
  const named = values.only !== undefined;
  if (named) {
    const asked = values.only.split(',').map((g) => g.trim()).filter(Boolean);
    const unknown = asked.filter((g) => !PROBE_GROUPS.includes(g));
    if (asked.length === 0) return { error: '--only needs at least one group' };
    if (unknown.length) return { error: `unknown group ${unknown.join(', ')}; the groups are ${PROBE_GROUPS.join(', ')}` };
    groups = PROBE_GROUPS.filter((g) => asked.includes(g));
    for (const group of groups) {
      const missing = (GROUP_NEEDS[group] || []).filter((need) => !groups.includes(need));
      if (missing.length) return { error: `${group} needs ${missing.join(' and ')} in the same list (it reads what ${missing.length > 1 ? 'they save' : 'that group saves'})` };
    }
  }
  return { engine, keep, plan, groups, named, parts: values.parts || env.AGENT_UNREAL_MUTABLE_PARTS || undefined, compileTimeoutS, compiler: values.compiler, sdk: values.sdk };
}

/**
 * The GLB parts in a folder: every `.glb` file, sorted by name, as { id, file }. At least two are needed for a swap.
 * @param {string[]} names  the file names in the folder
 */
export function listParts(names) {
  const parts = names.filter((n) => /\.glb$/i.test(n)).sort().map((file) => ({ id: file.replace(/\.glb$/i, '').replace(/[^A-Za-z0-9_]/g, '_'), file }));
  if (parts.length < 2) return { error: `the parts folder needs at least two .glb files (found ${parts.length})` };
  return { parts };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Report access

const steps = (report) => (report && Array.isArray(report.steps) ? report.steps : []);
const step = (report, name) => steps(report).find((s) => s.step === name) || {};
const list = (x) => (Array.isArray(x) ? x : []);
const clip = (text, n = 140) => String(text ?? '').replace(/\s+/g, ' ').slice(0, n);
/** The report a group's reports entry holds; reports[group] is { report, process, images }. */
const images0 = (entry) => (entry && entry.images) || {};
const reportOf = (entry) => (entry && entry.report) || undefined;
const processNote = (entry) => {
  const p = (entry && entry.process) || {};
  return p.timed_out ? `process killed after ${p.seconds} s` : p.exit === undefined ? 'process not started' : `process exit ${p.exit}${p.seconds !== undefined ? ` in ${p.seconds} s` : ''}`;
};

/** Names of the screenshots a variants report asks for. */
export function shotNames(report) {
  return steps(report).filter((s) => (s.step === 'variant' || s.step === 'control') && s.shot).map((s) => s.shot);
}

const compileOk = (c) => Boolean(c.started) && Boolean(c.finished) && !c.timed_out && c.compiled === true && !c.request_failed && list(c.errors).length === 0;
const compileText = (c) => (c.started
  ? `${c.mode || '?'} compile ${c.timed_out ? `timed out after ${c.deadline_s} s` : c.finished ? `finished in ${c.seconds} s` : 'did not report'}; compiled ${c.compiled}; request_failed ${c.request_failed}; ${list(c.errors).length} errors${list(c.errors)[0] ? ` (${clip(list(c.errors)[0], 100)})` : ''}; ${list(c.warnings).length} warnings${c.error ? `; ${clip(c.error)}` : ''}`
  : `compile not started${c.error ? `: ${clip(c.error)}` : ''}`);

/** The fixed camera's central character region, excluding borders and HUD corners. */
export function materialRegion(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return { changed: -1, red: 0, blue: 0 };
  const result = { changed: 0, red: 0, blue: 0 };
  for (let y = Math.floor(a.height * 0.1); y < Math.ceil(a.height * 0.95); y++) {
    for (let x = Math.floor(a.width * 0.25); x < Math.ceil(a.width * 0.75); x++) {
      const offset = (y * a.width + x) * 4;
      const av = a.rgba.subarray(offset, offset + 3), bv = b.rgba.subarray(offset, offset + 3);
      if (Math.max(...av.map((v, i) => Math.abs(v - bv[i]))) > 12) result.changed++;
      if (av[0] > av[1] * 1.5 && av[0] > av[2] * 1.5 && av[0] > 40) result.red++;
      if (bv[2] > bv[0] * 1.5 && bv[2] > bv[1] * 1.5 && bv[2] > 40) result.blue++;
    }
  }
  return result;
}

function buildChecks(entry, check) {
  const report = reportOf(entry);
  const note = processNote(entry);
  if (!report) {
    check('build', 'the build script wrote a report', 'The build editor run wrote its report file', false, `no report (${note})`);
    return;
  }
  const imported = step(report, 'import'), created = step(report, 'create'), graph = step(report, 'graph'), compile = step(report, 'compile'), readback = step(report, 'readback');
  const parts = list(imported.parts);
  check('build', 'the agent-meshes parts import as skeletal meshes',
    'Each GLB part (a fixed body and its accessory pieces) imports through Interchange into at least one skeletal mesh, with no error',
    parts.length >= 2 && parts.every((p) => !p.error && p.skeletal >= 1),
    parts.map((p) => `${p.id}: ${p.error ? clip(p.error, 60) : `${p.skeletal} skeletal, ${p.static || 0} static, skeleton ${p.skeleton || '?'}`}`).join('; ') || (imported.error ? clip(imported.error) : 'no import step'));
  check('build', 'new_customizable_object creates a Customizable Object that is not compiled yet',
    'CustomizableObjectEditorFunctionLibrary.new_customizable_object returns an asset and IsCompiled is false before any compile',
    created.created === true && created.compiled_before === false,
    created.created ? `${created.path}; compiled before ${created.compiled_before}` : `not created${created.error ? `: ${clip(created.error)}` : ''}`);
  const reach = graph.graph_found === true && graph.node_created === true && graph.node_property_set === true && (graph.link_call_ok === true || list(graph.pin_api).length > 0);
  const attempts = Object.entries(graph.attempts || {}).map(([k, v]) => `${k} -> ${v === 'ok' ? 'ok' : clip(v, 60)}`).join('; ') || 'none';
  // The premise of the bridge: Python alone finds the graph and can create a node, but has no call that adds it to the graph or links a pin.
  // The check passes while that stays true; if a later engine reflects those calls it fails, and the bridge is no longer needed for them.
  check('build', 'Python alone cannot add a node to the graph or link a pin (the gap the bridge fills)',
    'A script can find the object\'s graph and create a node, but no call that adds the node to the graph or links its pins is reachable (none succeeds)',
    graph.graph_found === true && graph.node_created === true && !reach,
    `graph found ${graph.graph_found}${graph.graph_class ? ` (${graph.graph_class})` : ''}; node created ${graph.node_created}; mesh property set and read back ${graph.node_property_set}${graph.node_property_read ? ` (${clip(graph.node_property_read, 50)})` : ''}; members listed beyond EdGraphNode ${graph.node_extra_members}; pin or link members ${list(graph.pin_api).length}; link call ok ${graph.link_call_ok}; attempts: ${attempts}${graph.error ? `; ${clip(graph.error)}` : ''}`);
  check('build', 'the compile finishes under its timeout without error',
    `CompileParams with a wall-clock limit: the compile reports back before the limit with compiled true, no failed request and no errors`,
    compileOk(compile), `${compileText(compile)}; ${note}`);
  check('build', 'the object reads back as compiled',
    'IsCompiled is true on the object after the compile reported back',
    readback.is_compiled === true && compile.is_compiled_after === true, `readback ${readback.is_compiled}; right after the compile ${compile.is_compiled_after}`);
}

function variantChecks(entry, check) {
  const report = reportOf(entry);
  const note = processNote(entry);
  if (!report) {
    check('variants', 'the variants script wrote a report', 'The variants editor run wrote its report file', false, `no report (${note})`);
    return;
  }
  const object = step(report, 'object'), actor = step(report, 'actor');
  const variants = steps(report).filter((s) => s.step === 'variant' && s.option !== null && s.option !== undefined);
  const params = list(object.parameters);
  check('variants', 'an Instance is made from the compiled object and its parameters are listed',
    'create_instance returns an Instance and the object lists at least one parameter to set',
    object.instance_created === true && params.length >= 1,
    `instance ${object.instance_created}; compiled ${object.is_compiled}; ${params.length} parameters${params.length ? ` (${params.map((p) => p.name).join(', ')})` : ''}${object.error ? `; ${clip(object.error)}` : ''}`);
  check('variants', 'an actor shows the Instance',
    'A Customizable Skeletal Mesh actor in the running level takes the Instance on its component',
    actor.found === true && actor.component_found === true && actor.instance_set === true,
    `actor ${actor.found}; component ${actor.component_found}; instance set ${actor.instance_set}${actor.error ? `; ${clip(actor.error)}` : ''}`);
  const controlStep = step(report, 'control'), controlImage = images0(entry)[controlStep.shot];
  const lit = controlImage ? changedPixels(controlImage, { width: controlImage.width, height: controlImage.height, rgba: Buffer.alloc(controlImage.width * controlImage.height * 4) }) : -1;
  check('variants', 'the capture path shows a plain imported skeletal mesh (control)',
    'A frame of the imported body mesh on a plain skeletal mesh actor is not black (more than 500 lit pixels), so a black variant frame means the Instance drew nothing',
    lit > 500, controlImage ? `${lit} lit pixels in ${controlStep.shot}` : `no control frame${controlStep.shot ? ` (${controlStep.shot} not found)` : ''}`);
  check('variants', 'each option is set and reads back',
    'Setting the parameter to each option in turn is read back as that option, with at least two options',
    variants.length >= 2 && variants.every((v) => !v.error && v.selected_after === v.option),
    variants.map((v) => `${v.option}: ${v.error ? clip(v.error, 50) : `read back ${v.selected_after}`}`).join('; ') || 'no option was set (no parameter with options)');
  const images = (entry && entry.images) || {};
  check('variants', 'a frame is captured for each variant',
    'A screenshot exists for every variant that asked for one',
    variants.length >= 2 && variants.every((v) => v.shot && images[v.shot]),
    variants.length ? variants.map((v) => `${v.option}: ${images[v.shot] ? 'frame' : 'no frame'}`).join(', ') : 'no variant');
  let worst = Infinity, pairs = 0;
  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      const n = changedPixels(images[variants[i].shot], images[variants[j].shot]);
      pairs++;
      worst = Math.min(worst, n);
    }
  }
  check('variants', 'the frames of the variants differ',
    'Every pair of variant frames differs in more than 200 pixels (the chosen part is drawn)',
    pairs >= 1 && worst > 200, pairs ? `${pairs} pairs; the closest pair differs in ${worst} pixels` : 'fewer than two frames to compare');
  check('variants', 'the Instance builds a skeletal mesh for each variant',
    'After UpdateSkeletalMeshAsync each variant reports a generated skeletal mesh',
    variants.length >= 2 && variants.every((v) => v.has_skeletal_mesh === true),
    variants.map((v) => `${v.option}: ${v.has_skeletal_mesh}`).join(', ') || 'no variant');
}

function headlessChecks(entry, check) {
  const report = reportOf(entry);
  const note = processNote(entry);
  const p = (entry && entry.process) || {};
  check('headless', 'the headless run reaches its compile and writes a report',
    'UnrealEditor-Cmd -run=pythonscript -nullrhi starts, loads the saved object and writes its report (a missing report means the compile needs the editor)',
    Boolean(report) && step(report, 'compile').started === true, report ? `${compileText(step(report, 'compile'))}; ${note}` : `no report (${note}); the headless compile did not run: ${p.timed_out ? 'it hung' : 'it needs the editor'}`);
  if (!report) return;
  const compile = step(report, 'compile'), readback = step(report, 'readback');
  check('headless', 'the headless compile completes within the timeout',
    'The compile reports back before the wall-clock limit with compiled true and no errors',
    compileOk(compile), `${compileText(compile)}; ${note}`);
  check('headless', 'the object reads back as compiled after the headless compile',
    'IsCompiled is true after the headless compile reported back',
    readback.is_compiled === true, `readback ${readback.is_compiled}${readback.error ? `; ${clip(readback.error)}` : ''}`);
  const load = step(report, 'load');
  const withOptions = list(readback.parameters).filter((p) => list(p.options).length >= 2);
  check('headless', 'the headless compile is of the real graph (the saved nodes reload and the parameter is there)',
    'The commandlet loads the saved object with its graph nodes (read through the bridge) and, after the compile, the object reports a parameter with at least two options',
    load.bridge_present === true && load.graph_nodes_on_load >= 8 && withOptions.length > 0,
    `bridge in the commandlet ${load.bridge_present}; graph nodes on load ${load.graph_nodes_on_load}; ${list(readback.parameters).length} parameters after the compile${withOptions.length ? ` (${withOptions.map((p) => `${p.name}: ${list(p.options).join('|')}`).join('; ')})` : ''}`);
}

/**
 * The compiler and linker messages of an Unreal Build Tool log: the error lines word for word (first twelve), the counts and the result line.
 * @param {string} text  the build log
 */
export function summarizeBuildLog(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const errorLine = /\b(?:fatal )?error\s+(?:C|LNK|MSB|CS|U)\d+|\):\s*error\b|\berror:|^ERROR:|:\s*error\s/i;
  const errorLines = lines.filter((l) => errorLine.test(l)).map((l) => l.trim());
  const warningCount = lines.filter((l) => /\bwarning\s+(?:C|LNK|MSB|CS)\d+/i.test(l)).length;
  const result = lines.map((l) => /Result:\s*(.+)/.exec(l)).filter(Boolean).map((m) => m[1].trim()).pop();
  return { errorCount: errorLines.length, errorLines: errorLines.slice(0, 12), warningCount, result };
}

function bridgeChecks(entry, check) {
  const mod = (entry && entry.module) || {};
  const log = mod.log || {};
  const built = mod.exit === 0 && !mod.timedOut;
  check('bridge', 'the MutableBridge module builds against the Mutable editor module',
    'Unreal Build Tool builds the Editor target of a throwaway code project whose module MutableBridge depends on the Mutable plugin\'s editor module, and exits 0; otherwise the compiler or linker message that stopped it is the result',
    built,
    mod.exit === undefined && !mod.timedOut
      ? 'the build did not start'
      : `Build.bat ${mod.timedOut ? `killed at the limit after ${mod.seconds} s` : `exit ${mod.exit} in ${mod.seconds} s`}${log.result ? `; ${clip(log.result, 80)}` : ''}; ${log.errorCount ?? '?'} error lines, ${log.warningCount ?? '?'} warnings${built ? '' : `: ${list(log.errorLines).slice(0, 3).map((l) => clip(l, 300)).join(' | ')}`}`);
  const report = reportOf(entry);
  const note = processNote(entry);
  if (!report) {
    check('bridge', 'the editor starts with the module loaded and writes a report', 'The editor run after the build wrote its report file', false, `no report (${note})`);
    return;
  }
  const lib = step(report, 'library'), cats = step(report, 'categories');
  const structs = Object.entries(lib.structs || {});
  check('bridge', 'unreal.MutableBridgeLibrary is visible from Python with its functions',
    `The library class and its ${BRIDGE_FUNCTIONS.length} functions and the result structs are in the unreal module after the editor starts`,
    lib.present === true && BRIDGE_FUNCTIONS.every((f) => list(lib.functions).includes(f)) && structs.length > 0 && structs.every(([, v]) => v === true),
    `library ${lib.present}; ${list(lib.functions).length} of ${BRIDGE_FUNCTIONS.length} functions${list(lib.missing).length ? ` (missing ${list(lib.missing).join(', ')})` : ''}; structs ${structs.filter(([, v]) => v).length} of ${structs.length}; Mutable's own editor library ${lib.editor_library_present}${lib.error ? `; ${clip(lib.error)}` : ''}; ${note}`);
  const names = list(cats.categories);
  check('bridge', 'a call reaches the editor module\'s exported symbols',
    'get_pin_categories returns the schema\'s pin categories, which are constants exported by the Mutable editor module',
    ['mesh', 'material', 'enum', 'component', 'object'].every((n) => names.includes(n)),
    names.length ? `categories: ${names.join(', ')}` : `no categories${cats.error ? `: ${clip(cats.error)}` : ''}`);
}

const countBy = (state, key) => (state && typeof state[key] === 'number' ? state[key] : NaN);
const hasClass = (state, name) => list(state && state.classes).includes(name);
const linkText = (l) => `${l.from} -> ${l.to}`;

function graphChecks(entry, check) {
  const report = reportOf(entry);
  const note = processNote(entry);
  if (!report) {
    check('graph', 'the graph script wrote a report', 'The graph editor run wrote its report file', false, `no report (${note})`);
    return;
  }
  const surface = step(report, 'surface'), test = step(report, 'link_test'), swap = step(report, 'swap'), compile = step(report, 'compile'), readback = step(report, 'readback'), save = step(report, 'save');
  const before = test.before || {}, afterAdd = test.after_add || {}, afterLink = test.after_link || {};
  check('graph', 'a node is added to a Customizable Object\'s graph and the graph reads back with it',
    'On an object made with new_customizable_object (base object node present), add_node adds a skeletal-mesh node and a mesh-section node with their pins, and get_graph_nodes lists both',
    test.created === true && test.base_node_present === true && test.added_ok === true
      && countBy(afterAdd, 'node_count') === countBy(before, 'node_count') + 2 && hasClass(afterAdd, NODE_CLASSES.mesh) && hasClass(afterAdd, NODE_CLASSES.section)
      && list(test.mesh_pins).some((p) => p.direction === 'Output' && p.category === 'mesh'),
    `created ${test.created}; base node present ${test.base_node_present}; nodes ${before.node_count ?? '?'} -> ${afterAdd.node_count ?? '?'} (${list(afterAdd.classes).join(', ')}); mesh node pins ${list(test.mesh_pins).map((p) => `${p.direction[0]}:${p.name}(${p.category})`).join(', ') || 'none'}${test.error ? `; ${clip(test.error, 200)}` : ''}${surface.library_present === false ? '; the bridge library is missing' : ''}`);
  check('graph', 'a pin is linked and the link reads back',
    'link_pins links the mesh node\'s mesh pin to the section node\'s mesh input, and get_graph_links lists that link',
    countBy(afterLink, 'link_count') === countBy(afterAdd, 'link_count') + 1
      && list(afterLink.links).some((l) => l.from.startsWith(`${NODE_CLASSES.mesh}.`) && l.to.startsWith(`${NODE_CLASSES.section}.`)),
    `links ${afterAdd.link_count ?? '?'} -> ${afterLink.link_count ?? '?'}; ${list(afterLink.links).map(linkText).join('; ') || 'none'}`);
  const refusals = list(test.refusals);
  const refusedAll = refusals.length >= 8 && refusals.every((r) => r.ok === false && !r.raised && String(r.message || '').length > 0);
  check('graph', 'an invalid pin, node or class is refused cleanly',
    'Each invalid request (unknown pin, pins of different kinds, null node, unknown or abstract or non-node class, a property the node lacks, an object that is not a Customizable Object) returns ok false with a reason, raises nothing, and leaves the graph unchanged',
    refusedAll && test.unchanged_by_refusals === true,
    `${refusals.filter((r) => r.ok === false && !r.raised).length} of ${refusals.length} refused cleanly; graph unchanged ${test.unchanged_by_refusals}${refusals.length ? `; ${refusals.slice(0, 4).map((r) => `${r.case}: ${r.raised ? `RAISED ${clip(r.raised, 60)}` : clip(r.message, 70)}`).join(' | ')}` : ''}`);
  const parts = list(swap.options).length;
  // the script counts what its plan adds (a mesh node per part, a section node per mesh section, the parameter, a switch per section slot, make, object make, component)
  const wantNodes = swap.expected_nodes, wantLinks = swap.expected_links;
  const gained = (key) => countBy(swap.after, key) - countBy(swap.before, key);
  const sections = Object.entries(swap.sections || {});
  check('graph', 'the swappable-parts graph is built through the bridge',
    `One mesh node per part and one mesh-section node per mesh section, an enum parameter, a switch over mesh sections per section slot, and the make, object-make and component nodes are added and linked to the base object node, with every operation accepted, the node and link counts as planned and the parameter name read back`,
    swap.created === true && swap.ops_ok === true && parts >= 2 && sections.length === parts + 1 && Number.isInteger(wantNodes) && Number.isInteger(wantLinks) && wantNodes >= 11 && wantLinks >= 11
      && gained('node_count') === wantNodes && gained('link_count') === wantLinks && (swap.parameter_read_back || {}).ParameterName === 'Hat',
    `${list(swap.ops).filter((o) => o.ok).length} of ${list(swap.ops).length} operations accepted; nodes +${Number.isNaN(gained('node_count')) ? '?' : gained('node_count')} (planned ${wantNodes}); links +${Number.isNaN(gained('link_count')) ? '?' : gained('link_count')} (planned ${wantLinks}); sections per part ${sections.map(([k, v]) => `${k} ${v}`).join(', ') || '?'}; options ${list(swap.options).join('|') || 'none'}${swap.error ? `; ${clip(swap.error, 300)}` : ''}${list(swap.ops).find((o) => !o.ok) ? `; refused: ${clip(list(swap.ops).find((o) => !o.ok).message, 200)}` : ''}`);
  check('graph', 'the compile of the graph finishes under its timeout without error',
    'CompileParams with a wall-clock limit: the compile of the built graph reports back before the limit with compiled true, no failed request and no errors',
    compileOk(compile), `${compileText(compile)}; ${note}`);
  const params = list(readback.parameters);
  const named = params.find((p) => p.name === 'Hat');
  check('graph', 'the compiled object reports the parameter with its options',
    'After the compile the object lists the parameter Hat with exactly the accessory parts as its options',
    Boolean(named) && list(swap.options).length >= 2 && [...list(named.options)].sort().join('|') === [...list(swap.options)].sort().join('|'),
    `${readback.parameter_count ?? '?'} parameters, ${readback.component_count ?? '?'} components${params.length ? `; ${params.map((p) => `${p.name} (${p.type}): ${list(p.options).join('|')}`).join('; ')}` : ''}; expected ${list(swap.options).join('|')}${readback.error ? `; ${clip(readback.error)}` : ''}`);
  check('graph', 'the object reads back as compiled and is saved',
    'IsCompiled is true after the compile and the asset was saved with its graph',
    readback.is_compiled === true && compile.is_compiled_after === true && save.saved === true,
    `readback ${readback.is_compiled}; right after the compile ${compile.is_compiled_after}; saved ${save.saved}`);
}

function extendedChecks(group, entry, check) {
  const report = reportOf(entry), rows = steps(report);
  const add = (name, pass, detail) => check(group, name, name, pass, detail);
  const exception = rows.find((s) => ['experiment_error', 'driver', 'layout_error'].includes(s.step));
  add('the experiment writes a report without an unhandled error', Boolean(report) && !exception,
    exception?.error || processNote(entry));
  const compiles = rows.filter((s) => s.step === 'compile');
  const labels = group === 'skeleton' ? ['separate', 'shared'] : group === 'scale' ? ['NONE', 'MAXIMUM'] : [group];
  for (const label of labels) {
    const compiled = compiles.find((s) => s.label === label) || {};
    add(`${label} compile completes without errors within its limit`, compileOk(compiled), compileText(compiled));
  }
  if (group === 'scale') {
    const graph = step(report, 'graph');
    add('the graph has four enum parameters with six options and 25 parts', graph.part_count === 25 && list(graph.groups).length === 4 && graph.groups.every((g) => list(g.options).length === 6), JSON.stringify(graph.groups || []));
    for (const label of labels) {
      const memory = rows.find((s) => s.step === 'memory' && s.label === label) || {};
      const readback = rows.find((s) => s.step === 'readback' && s.label === label) || {};
      add(`${label} records nonempty working-set samples from the editor PID`, memory.interval_s === 1 && Number.isInteger(memory.pid) && list(memory.samples).length >= 2 && memory.samples.every((s) => s.pid === memory.pid && Number.isFinite(s.working_set_bytes) && s.working_set_bytes > 0) && memory.peak_sampled_working_set_bytes === Math.max(...list(memory.samples).map((s) => s.working_set_bytes)), `${list(memory.samples).length} samples; peak ${memory.peak_sampled_working_set_bytes} bytes; lifetime process peak ${memory.process_peak_working_set_bytes} bytes`);
      const choices = list(readback.parameters).filter((p) => /^Choice[0-3]$/.test(p.name) && list(p.options).length === 6 && new Set(p.options).size === 6);
      add(`${label} reads back the four six-option parameters`, choices.length === 4 && new Set(choices.map((p) => p.name)).size === 4, JSON.stringify(readback.parameters || []));
    }
  }
  if (group === 'skeleton') {
    const imports = rows.filter((s) => s.step === 'shared_import');
    add('all three shared imports use the same skeleton', imports.length === 3 && imports.every((s) => s.returned && s.matches && s.skeleton === imports[0].skeleton), JSON.stringify(imports));
    const separate = rows.find((s) => s.step === 'skeletons' && s.label === 'separate');
    add('the separate layout has three distinct skeleton assets', new Set(list(separate?.paths)).size === 3, JSON.stringify(separate?.paths || []));
  }
  if (group === 'skeleton' || group === 'material') {
    for (const label of group === 'skeleton' ? labels : ['material']) {
      const variants = rows.filter((s) => s.step === 'variant' && s.label === label);
      const images = images0(entry);
      const control = rows.find((s) => s.step === 'control' && s.label === label);
      const controlImage = images[control?.shot];
      const lit = controlImage ? changedPixels(controlImage, { ...controlImage, rgba: Buffer.alloc(controlImage.width * controlImage.height * 4) }) : 0;
      add(`${label} has a visible control and two generated variant frames`, lit > 500 && variants.length === 2 && variants.every((v) => v.has_skeletal_mesh && images[v.shot]), `${lit} control pixels; ${variants.length} variants`);
      const difference = variants.length === 2 ? changedPixels(images[variants[0].shot], images[variants[1].shot]) : -1;
      add(`${label} variant frames differ`, difference > 200, `${difference} changed pixels`);
      if (group === 'skeleton') add(`${label} options read back`, variants.length === 2 && variants.every((v) => v.selected === v.option), JSON.stringify(variants.map(({ option, selected }) => ({ option, selected }))));
    }
    if (group === 'material') {
      const parameters = rows.find((s) => s.step === 'readback' && s.label === 'material')?.parameters;
      const route = step(report, 'parameter_route').kind;
      add('the compiled object lists the selected material or texture parameter', ['material', 'texture'].includes(route) && list(parameters).some((p) => p.name === 'Finish' && p.type.toLowerCase().includes(route)), JSON.stringify(parameters || []));
      const variants = rows.filter((s) => s.step === 'variant' && s.label === 'material');
      const region = materialRegion(images0(entry)[variants[0]?.shot], images0(entry)[variants[1]?.shot]);
      add('the part region changes from the red value to the blue value', region.changed > 200 && region.red > 200 && region.blue > 200, JSON.stringify(region));
      add('both parameter assets read back after being set', variants.length === 2 && variants.every((v) => v.expected_asset && v.selected === v.expected_asset), JSON.stringify(variants.map(({ selected, expected_asset }) => ({ selected, expected_asset }))));
    }
  }
  if (group === 'components') {
    const readback = step(report, 'readback'), callback = step(report, 'callback');
    add('the compiled object reports two distinct components', readback.component_count === 2 && new Set(list(readback.names)).size === 2, JSON.stringify(readback));
    add('the Python update callback runs and the instance builds a mesh', callback.bound && list(callback.callbacks).length > 0 && callback.has_skeletal_mesh, JSON.stringify(callback));
  }
}

/**
 * @param {{ groups: string[], reports: Record<string, { report?: any, process?: { exit?: number, timed_out?: boolean, seconds?: number }, images?: Record<string, any> }> }} input
 * @returns {{ group: string, pass: boolean, name: string, claim: string, detail: string }[]}
 */
export function evaluateProbes({ groups, reports }) {
  const out = [];
  const make = () => (group, name, claim, pass, detail) => out.push({ group, pass: Boolean(pass), name, claim, detail });
  for (const group of PROBE_GROUPS) {
    if (!groups.includes(group)) continue;
    const entry = (reports || {})[group];
    if (group === 'bridge') bridgeChecks(entry, make());
    else if (group === 'build') buildChecks(entry, make());
    else if (group === 'graph') graphChecks(entry, make());
    else if (group === 'variants') variantChecks(entry, make());
    else if (group === 'headless') headlessChecks(entry, make());
    else extendedChecks(group, entry, make());
  }
  return out;
}

/** @returns {{ passed: number, total: number }} */
export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}
