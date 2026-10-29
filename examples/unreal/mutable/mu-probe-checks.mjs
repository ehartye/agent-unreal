// Pure options and checks of the Mutable probe (mu_probe.mjs). Prepared 2026-10-29. No Unreal, no files: mu-probe.test.mjs feeds it canned
// reports and mu_probe.mjs feeds it real ones. The report shapes below are the ones the mu_probe_*.py scripts write.
// Three groups answer three questions:
//   build     Can a script put agent-meshes parts into a Customizable Object as swappable options and compile it under a timeout?
//   variants  Can an Instance be set to each option in turn, with a captured frame of each variant, and do the frames differ?
//   headless  Does the compile finish under UnrealEditor-Cmd -run=pythonscript -nullrhi within the timeout, or does it need the editor?
// Every check returns { group, pass, name, claim, detail }.
import { changedPixels } from '../niagara_toolsets/nts-probe-assets.mjs';

export const PROBE_GROUPS = ['build', 'variants', 'headless'];
/** Wall-clock limit of one compile, in seconds. The scripts read it from MU_COMPILE_TIMEOUT_S; the runner adds a margin for the process. */
export const DEFAULT_COMPILE_TIMEOUT_S = 240;
/**
 * The engine phases of each group, in order. `editor` starts UnrealEditor with a Python script run by -ExecCmds (a rendering editor, offscreen);
 * `commandlet` runs UnrealEditor-Cmd with -run=pythonscript and -nullrhi. `extraS` is the margin added to the compile timeout for the
 * whole process (engine start, import, shader work, shutdown).
 */
export const PROBE_PHASES = {
  build: [{ name: 'build', mode: 'editor', script: 'mu_probe_build.py', extraS: 480 }],
  variants: [{ name: 'variants', mode: 'editor', script: 'mu_probe_variants.py', extraS: 420, prefix: 'mu' }],
  headless: [{ name: 'headless', mode: 'commandlet', script: 'mu_probe_headless.py', extraS: 300 }],
};
export const USAGE = 'usage: node mu_probe.mjs --engine <UE_5.8 folder> --parts <folder of .glb files> [--only <group>[,<group>...]] [--keep] [--plan] [--compile-timeout <seconds>]'
  + `   groups: ${PROBE_GROUPS.join(', ')}   (no --only: every group; variants and headless read what build saved, so they need build in the same list)`;

/**
 * @param {string[]} argv  process.argv without node and the script
 * @param {Record<string, string|undefined>} [env]  UE_ROOT supplies the engine folder; AGENT_UNREAL_MUTABLE_PARTS the parts folder
 * @returns {{ error?: string, engine?: string, keep?: boolean, plan?: boolean, groups?: string[], named?: boolean, parts?: string, compileTimeoutS?: number }}
 */
export function parseProbeOptions(argv, env = {}) {
  const values = {}, valued = { '--engine': 'engine', '--only': 'only', '--parts': 'parts', '--compile-timeout': 'compileTimeout' };
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
    if (!groups.includes('build') && groups.length) return { error: `${groups.join(', ')} read what the build group saves, so name build too` };
  }
  return { engine, keep, plan, groups, named, parts: values.parts || env.AGENT_UNREAL_MUTABLE_PARTS || undefined, compileTimeoutS };
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
  check('build', 'the graph, its nodes and their links can be built from Python',
    'A script can reach the object\'s graph, create a mesh node, set and read back its mesh, and add the node to the graph or link its pins with a call that does not raise',
    reach,
    `graph found ${graph.graph_found}${graph.graph_class ? ` (${graph.graph_class})` : ''}; node created ${graph.node_created}; mesh property set and read back ${graph.node_property_set}${graph.node_property_read ? ` (${clip(graph.node_property_read, 50)})` : ''}; members listed beyond EdGraphNode ${graph.node_extra_members}; pin or link members ${list(graph.pin_api).length}; link call ok ${graph.link_call_ok}; attempts: ${attempts}${graph.error ? `; ${clip(graph.error)}` : ''}`);
  const params = list(readback.parameters);
  const withOptions = params.filter((p) => list(p.options).length >= 2);
  check('build', 'the compiled object offers the parts as options of a parameter',
    'After the compile the object lists a parameter with at least two options (one per swappable part)',
    withOptions.length > 0,
    `${readback.parameter_count ?? '?'} parameters, ${readback.component_count ?? '?'} components${params.length ? `; ${params.map((p) => `${p.name} (${p.type}): ${list(p.options).join('|')}`).join('; ')}` : ''}${readback.error ? `; ${clip(readback.error)}` : ''}`);
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
    if (group === 'build') buildChecks(entry, make());
    else if (group === 'variants') variantChecks(entry, make());
    else headlessChecks(entry, make());
  }
  return out;
}

/** @returns {{ passed: number, total: number }} */
export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}
