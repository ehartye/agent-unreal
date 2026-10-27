// Pure checks and options of the opt-in Niagara probes (nts_probe.mjs). Prepared 2026-10-26; not yet run on an engine, except the emit group,
// which ran on 5.8.2 on 2026-10-26 and again on 5.8.4 with the same result. A first run tests a probe before it tests the engine. No Unreal, no files: nts-probe.test.mjs feeds it
// canned reports, and nts_probe.mjs feeds it real ones. None of this changes what nts_validate.mjs does. The report shapes below are the ones
// the nts_probe_*.py scripts write; they follow the shapes of nts_author.py. Only the emit shapes have been confirmed by a run.
import { changedPixels } from './nts-probe-assets.mjs';

export const PROBE_GROUPS = ['renderers', 'emit', 'frame', 'wire', 'gradient'];
/** The engine phases of each group, in order. `commandlet` runs UnrealEditor-Cmd with -run=pythonscript; `editor` plays the map offscreen and quits itself. */
export const PROBE_PHASES = {
  renderers: [{ name: 'renderers', mode: 'commandlet', script: 'nts_probe_renderers.py' }],
  emit: [{ name: 'emit-build', mode: 'commandlet', script: 'nts_probe_emit_build.py' }, { name: 'emit-sim', mode: 'editor', script: 'nts_probe_sim.py', map: '/Game/Maps/NtsProbeEmit', prefix: 'nts_emit' }],
  frame: [{ name: 'frame-build', mode: 'commandlet', script: 'nts_probe_frame_build.py' }, { name: 'frame-sim', mode: 'editor', script: 'nts_probe_sim.py', map: '/Game/Maps/NtsProbeFrame', prefix: 'nts_frame' }],
  wire: [{ name: 'wire-build', mode: 'commandlet', script: 'nts_probe_wire_build.py' }, { name: 'wire-sim', mode: 'editor', script: 'nts_probe_sim.py', map: '/Game/Maps/NtsProbeWire', prefix: 'nts_wire' }],
  gradient: [{ name: 'gradient', mode: 'commandlet', script: 'nts_probe_gradient.py' }],
};
export const USAGE = 'usage: node nts_probe.mjs --engine <UE_5.8 folder> [--only <group>[,<group>...]] [--keep] [--plan] [--scenes <folder>] [--glb <file|builtin>] [--atlas-png <file>] [--atlas-json <file>]'
  + `   groups: ${PROBE_GROUPS.join(', ')}   (no --only: every group; wire joins only when its assets resolve)`;

/**
 * @param {string[]} argv  process.argv without node and the script
 * @param {Record<string, string|undefined>} [env]  UE_ROOT supplies the engine folder; AGENT_UNREAL_SCENES the scenes workspace
 * @returns {{ error?: string, engine?: string, keep?: boolean, plan?: boolean, groups?: string[], named?: boolean, scenes?: string, glb?: string, atlasPng?: string, atlasJson?: string }}
 */
export function parseProbeOptions(argv, env = {}) {
  const values = {}, valued = { '--engine': 'engine', '--only': 'only', '--scenes': 'scenes', '--glb': 'glb', '--atlas-png': 'atlasPng', '--atlas-json': 'atlasJson' };
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
  let groups = PROBE_GROUPS;
  const named = values.only !== undefined;
  if (named) {
    const asked = values.only.split(',').map((g) => g.trim()).filter(Boolean);
    const unknown = asked.filter((g) => !PROBE_GROUPS.includes(g));
    if (asked.length === 0) return { error: '--only needs at least one group' };
    if (unknown.length) return { error: `unknown group ${unknown.join(', ')}; the groups are ${PROBE_GROUPS.join(', ')}` };
    groups = PROBE_GROUPS.filter((g) => asked.includes(g));
  }
  return { engine, keep, plan, groups, named, scenes: values.scenes || env.AGENT_UNREAL_SCENES || undefined, glb: values.glb, atlasPng: values.atlasPng, atlasJson: values.atlasJson };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Report access

const steps = (report) => (report && Array.isArray(report.steps) ? report.steps : []);
const step = (report, name) => steps(report).find((s) => s.step === name) || {};
const ok = (s) => Boolean(s) && Boolean(s.step) && !s.error;   // a step that is missing is {} and does not count
const list = (x) => (Array.isArray(x) ? x : []);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const short = (name) => String(name || '').replace(/^Niagara/, '').replace(/RendererProperties$/, '');
const SPRITE = 'NiagaraSpriteRendererProperties', LIGHT = 'NiagaraLightRendererProperties', RIBBON = 'NiagaraRibbonRendererProperties', MESH = 'NiagaraMeshRendererProperties';

/**
 * The renderer order after AddRenderer, from the engine source (NiagaraExternalSystemEditorUtilities.cpp AddRenderer, NiagaraEmitter.cpp MoveRenderer):
 * appended, then moved to `sent` when sent is not -1 and is a valid index of the list that already holds the new renderer (0 to before.length).
 * @param {string[]} before  @param {string} added  @param {number|string|undefined} sent  the location's rendererIndex, or 'omitted'
 */
export function expectedRendererOrder(before, added, sent) {
  const appended = [...before, added];
  if (sent === undefined || sent === 'omitted' || sent === -1) return appended;
  if (Number.isInteger(sent) && sent >= 0 && sent <= before.length) { const out = [...before]; out.splice(sent, 0, added); return out; }
  return appended;
}

const rendererFrames = (reports) => (reports || {}).renderers || {};

function rendererChecks(report, check) {
  const setup = step(report, 'setup'), insert = step(report, 'insert'), classes = step(report, 'classes'), duplicate = step(report, 'duplicate'), templates = step(report, 'templates');
  const variants = insert.variants || {};
  const BASE = [SPRITE, LIGHT];
  const placed = (name, sent) => {
    const v = variants[name] || {};
    const expected = expectedRendererOrder(BASE, RIBBON, sent);
    return !v.setup_error && v.error === '' && same(v.before, BASE) && same(v.after, expected) && v.returned_index === sent && v.returned_class === RIBBON
      && v.ref_in_range === true && v.ref_class === RIBBON && v.read_error === '';
  };
  const order = (name) => ((variants[name] || {}).after || []).map(short).join(' ') || (variants[name] || {}).setup_error || 'no result';
  check('renderers', 'AddRenderer inserts into a list of renderers at an index between them',
    'On an emitter holding [Sprite, Light], a Ribbon renderer added with rendererIndex 1 lands between them (Sprite Ribbon Light), with 0 at the front, and with 2 (the old count) at the end; the returned ref is in range, names the new renderer, and GetRendererData accepts it',
    ok(setup) && ok(insert) && placed('Mid', 1) && placed('Front', 0) && placed('AtCount', 2),
    `index 1: ${order('Mid')}; index 0: ${order('Front')}; index 2: ${order('AtCount')}${insert.error ? `; ${insert.error}` : ''}`);
  const past = variants.PastCount || {}, minus = variants.MinusTwo || {};
  const appendedOnly = (v) => !v.setup_error && v.error === '' && same(v.after, [SPRITE, LIGHT, RIBBON]) && v.ref_in_range === (v.returned_index === 2);
  check('renderers', 'an index past the new end appends, and the returned ref is not good',
    'With rendererIndex 3 (old count + 1) or -2 the renderer is appended and the ref still says 3 or -2 (MoveRenderer ignores an invalid index); GetRendererData refuses 3 as out of bounds',
    ok(insert) && appendedOnly(past) && past.returned_index === 3 && past.ref_in_range === false && /out of bounds/i.test(past.read_error || '')
      && appendedOnly(minus) && minus.returned_index === -2 && minus.ref_in_range === false,
    `index 3: ${order('PastCount')}, ref ${past.returned_index}, read error "${String(past.read_error || '').slice(0, 80)}"; index -2: ${order('MinusTwo')}, ref ${minus.returned_index}, read error "${String(minus.read_error || '').slice(0, 60)}"`);
  const made = classes.classes || {};
  const appendedClass = (name) => { const v = made[name] || {}; return v.error === '' && v.after && v.after.length === 2 && v.after[1] === name && v.returned_index === 1 && v.ref_in_range === true && v.ref_class === name && v.read_error === ''; };
  const outcome = (name) => (appendedClass(name) ? 'ok' : (made[name] || {}).error || 'not as expected');
  check('renderers', 'renderer classes other than Light are added the same way',
    'AddRenderer appends a Ribbon and a Mesh renderer to a sprite emitter (ref 1, order Sprite then the new class); the other classes (Light, Component, Decal, Volume) are recorded, not required',
    ok(classes) && appendedClass(RIBBON) && appendedClass(MESH),
    Object.keys(made).map((n) => `${short(n)}: ${outcome(n)}`).join('; ') || (classes.error || 'no classes step'));
  const keys = list((made[LIGHT] || {}).property_keys);
  check('renderers', 'GetRendererData lists the properties of a new Light renderer, MegaLights switches among them',
    'The property names of a Light renderer include bAllowMegaLights and bMegaLightsCastShadows; the list is what a reader should call GetRendererData for',
    keys.includes('bAllowMegaLights') && keys.includes('bMegaLightsCastShadows'), `${keys.length} properties: ${keys.slice(0, 14).join(', ')}${keys.length > 14 ? ', ...' : ''}`);
  const dup = duplicate.record || {};
  check('renderers', 'two renderers of one class: renderers[] shows both, rendererClasses[] shows the class once',
    'A second Sprite renderer on a sprite emitter gives renderers [Sprite, Sprite] and rendererClasses [Sprite] in GetEmitterTopology (the list is de-duplicated)',
    ok(duplicate) && dup.error === '' && same(dup.after, [SPRITE, SPRITE]) && same(dup.renderer_classes, [SPRITE]) && duplicate.topology_renderer_count === 2 && duplicate.topology_class_count === 1,
    `renderers ${list(dup.after).map(short).join(' ')}; rendererClasses ${list(dup.renderer_classes).map(short).join(' ')}; topology counts ${duplicate.topology_renderer_count}/${duplicate.topology_class_count}`);
  const names = Object.keys(templates.made || {});
  const consistent = names.filter((n) => { const t = templates.made[n]; return t.renderers.length > 0 && same([...new Set(t.renderers)].sort(), [...t.renderer_classes].sort()) && new Set(t.renderer_classes).size === t.renderer_classes.length; });
  const multi = names.filter((n) => templates.made[n].renderers.length > 1).map((n) => `${n}:${templates.made[n].renderers.length}`);
  check('renderers', 'the topology of each template emitter lists its renderers, so the template step can record all of them',
    'AddEmitter returns renderers[] and rendererClasses[] for each of the 14 template emitters, and the class set of renderers[] equals rendererClasses[]',
    ok(templates) && names.length === 14 && consistent.length === 14,
    `${consistent.length} of ${names.length} templates consistent; more than one renderer: ${multi.join(', ') || 'none'}${templates.error ? `; ${templates.error}` : ''}`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Sim-cache reports (emit, frame, wire)

const stepOf = (sim, id, name) => (((((sim || {}).samples || {})[id] || {}).steps || {})[name]) || undefined;
const sampled = (s) => Boolean(s) && !s.error && s.captured === true && s.valid === true && s.num_frames > 0;
const metric = (s) => (sampled(s) && Number.isFinite(s.metric_max) ? s.metric_max : undefined);
const attribute = (s, emitter, name) => { const a = ((s || {}).attributes || {}); const e = a[emitter] || a[Object.keys(a)[0]] || {}; const v = e[name]; return Array.isArray(v) ? v[0] : undefined; };

const EMIT_IDS = ['CtlTemplate', 'FactoryFountain', 'FactoryBurst', 'KeepUntouched', 'Keep90', 'Keep60', 'Keep30', 'Keep15', 'Keep0',
  'SwapFountain', 'SwapBurst', 'SwapFountainModules', 'SwapSameValue', 'SwapEnum', 'SwapBool', 'SwapToggle', 'SwapWriteFirst',
  'SwapRateTouched', 'SwapDurationTouched', 'SwapBurstTouched', 'LateAdded', 'LateTouched', 'TouchedThenRemoved'];

/**
 * Which authoring step leaves an emitter that does not emit (5.8.4). A cache that holds frames but reads 0 particles for the Probe emitter is
 * "dead"; a cache the engine refuses to capture (the system had completed: "System already completed its simulation") is "completed at once".
 */
function emitChecks({ build, sim }, check) {
  const run = (id) => stepOf(sim, id, 'run');
  const m = (id) => metric(run(id));
  const built = (id) => ok(step(build, `variant_${id}`));
  const completed = (id) => { const r = run(id); return built(id) && Boolean(r) && !r.error && r.captured === false && r.valid === false && r.num_frames === 0 && r.refused_frames > 0; };
  const dead = (id) => { const r = run(id); return built(id) && sampled(r) && r.metric_emitter === 'Probe' && m(id) === 0; };
  const emits = (id) => built(id) && m(id) > 0;
  const by = (id, emitter) => { const r = run(id); return sampled(r) && r.max_by_emitter ? r.max_by_emitter[emitter] : undefined; };
  const count = (id) => {
    if (m(id) !== undefined) return m(id);
    if (!built(id)) return 'not built';
    return completed(id) ? 'completed at once' : 'not sampled';
  };
  const show = (ids) => ids.map((id) => `${id}: ${count(id)}`).join('; ');
  check('emit', 'the sim-cache count reads a system that must emit',
    'A system created from a template system and left alone has more than 0 particles in a valid simulation cache after 40 frames',
    emits('CtlTemplate'), `CtlTemplate: ${count('CtlTemplate')}`);
  check('emit', 'a system from the factory emits with its emitter untouched',
    'NiagaraSystemFactoryNew with AddEmitter Fountain, or SimpleSpriteBurst, and no stack input written, has more than 0 particles in the sim cache',
    emits('FactoryFountain') && emits('FactoryBurst'), show(['FactoryFountain', 'FactoryBurst']));
  const zero = run('Keep0');
  check('emit', 'a spawn rate of 0 counts 0 particles in a valid cache (negative control)',
    'With SpawnRate set to 0 through SetStackInputData the cache is valid, holds frames, and the Probe emitter reads 0 particles (the read succeeded and returned an empty list), so a count of 0 means nothing spawned, not that the capture or the read failed',
    built('Keep0') && sampled(zero) && zero.metric_emitter === 'Probe' && m('Keep0') === 0,
    `Keep0: ${count('Keep0')} (valid ${zero && zero.valid}, frames ${zero && zero.num_frames}, emitter read ${zero && zero.metric_emitter}${zero && list(zero.read_errors).length ? `, read errors: ${zero.read_errors.join('; ')}` : ''})`);
  check('emit', 'a stack input changes the sim-cache count',
    'Fountain emitters added to a template system, whose SpawnRate was set through SetStackInputData to 60, 30, 15 and 0, count more particles at 60 than at 30, more at 30 than at 15 and more at 15 than at 0',
    ['Keep60', 'Keep30', 'Keep15', 'Keep0'].every(built) && m('Keep60') > m('Keep30') && m('Keep30') > m('Keep15') && m('Keep15') > m('Keep0'),
    `rate 60: ${count('Keep60')}; 30: ${count('Keep30')}; 15: ${count('Keep15')}; 0: ${count('Keep0')}`);
  check('emit', 'an emitter added to a template system does not emit until a stack input value is changed',
    'CreateNiagaraSystem from a template system, then AddEmitter Fountain: the cache is valid and the Probe emitter reads 0 (template emitters kept; also when SpawnRate is written with the value it already holds, 90); with the template emitters removed the system completes at once and the engine refuses the capture, also with three modules added, and with SimpleSpriteBurst',
    dead('KeepUntouched') && dead('Keep90') && ['SwapFountain', 'SwapBurst', 'SwapFountainModules'].every(completed),
    show(['KeepUntouched', 'Keep90', 'SwapFountain', 'SwapBurst', 'SwapFountainModules']));
  check('emit', 'a float or int stack input changed after the last AddEmitter makes the added emitters emit',
    'In a system whose template emitters were removed, a SpawnRate written to 91 and back to 90 (the default again), the system SystemState Loop Duration written to 5, or a burst Spawn Count written to 5 gives particles in the cache (5 for the burst); a Late emitter added and then given a SpawnRate emits together with the untouched Probe emitter; removing the template emitters (RemoveEmitter) after the write leaves the added emitter emitting',
    emits('SwapRateTouched') && emits('SwapDurationTouched') && m('SwapBurstTouched') === 5 && by('LateTouched', 'Probe') > 0 && by('LateTouched', 'Late') > 0 && emits('TouchedThenRemoved'),
    `${show(['SwapRateTouched', 'SwapDurationTouched', 'SwapBurstTouched', 'TouchedThenRemoved'])}; LateTouched: Probe ${by('LateTouched', 'Probe')}, Late ${by('LateTouched', 'Late')}`);
  check('emit', 'a write before the last AddEmitter, a same-value write, and an enum, bool or module-toggle edit do not make it emit',
    'The system completes at once (the capture is refused) after: Loop Duration written before the add, Loop Duration written with the value it holds (1), Loop Behavior set to Infinite, a bool input set, SpawnRate disabled and enabled again, and a second emitter added after the first one was given a value',
    ['SwapWriteFirst', 'SwapSameValue', 'SwapEnum', 'SwapBool', 'SwapToggle', 'LateAdded'].every(completed),
    show(['SwapWriteFirst', 'SwapSameValue', 'SwapEnum', 'SwapBool', 'SwapToggle', 'LateAdded']));
  const compile = (sim || {}).compile && typeof sim.compile === 'object' ? sim.compile : {};
  const errors = Object.entries(compile).filter(([, v]) => !v || v.error || !v.value || /Error/.test(String((v.value || {}).aggregateStatus)));
  const missing = EMIT_IDS.filter((id) => !run(id) || run(id).error);
  check('emit', 'every authoring route was sampled, and the cause matrix is recorded',
    `All ${EMIT_IDS.length} variants have a sim-cache result (a refused capture of a completed system is a result), and the systems compile with no error; a compile status of UpToDate does not show that the system emits`,
    missing.length === 0 && errors.length === 0,
    `${EMIT_IDS.map((id) => `${id}=${count(id)}`).join(', ')}${errors.length ? `; compile problems: ${errors.map(([k, v]) => `${k} ${(v && (v.error || (v.value || {}).aggregateStatus)) || 'no result'}`).join(', ')}` : ''}${missing.length ? `; no result: ${missing.join(', ')}` : ''}`);
}

const close = (a, b, tolerance = 0.05) => Number.isFinite(a) && Math.abs(a - b) <= tolerance;
const shotOf = (sim, id, name) => (stepOf(sim, id, name) || {}).shot;

function frameChecks({ build, sim, images }, check) {
  const variable = step(build, 'user_variable'), system = step(build, 'system'), link = step(build, 'link');
  check('frame', 'a float user parameter is added and listed',
    'AddUserVariables takes {name, type: {classStructOrEnum}, defaultValue: {struct, value}, description}; GetUserVariables then lists it',
    ok(variable) && variable.add_error === '' && variable.list_error === '' && variable.present === true, `${variable.error || variable.add_error || ''} listed: ${list(variable.names).join(', ') || 'none'}`);
  check('frame', 'SubUV Animation Mode is set to Direct Index',
    'SetStackInputData with the enum shape of stylized_build.py sets the mode without an error',
    ok(system) && system.direct_mode_error === '', system.error || system.direct_mode_error || 'no error');
  const attempts = list(link.attempts);
  check('frame', 'Direct Frame Index reads back as linked to the user parameter',
    'SetStackInputData with a Linked value ({linkedVariable: {name, type}}) leaves GetStackInputData returning NiagaraExt_StackInputData_Linked with the parameter name',
    ok(link) && link.linked === true,
    attempts.map((a) => `${a.type_source}/${a.name}: ${a.skipped || a.set_error || `${a.kind_after} ${a.link_after}`}`).join('; ') || link.error || 'no attempts');
  const v2 = attribute(stepOf(sim, 'Flip', 'v2'), 'Sprite', 'SubImageIndex'), v9 = attribute(stepOf(sim, 'Flip', 'v9'), 'Sprite', 'SubImageIndex');
  check('frame', 'the sprite SubImageIndex follows the user parameter',
    'After the parameter is set from Python to 2 and to 9, Particles.SubImageIndex in a simulation cache reads 2 and 9 (within 0.05), not an age-driven value',
    close(v2, 2) && close(v9, 9), `set 2 -> ${v2}; set 9 -> ${v9}`);
  const base = (images || {})[shotOf(sim, 'Flip', 'base')], a = (images || {})[shotOf(sim, 'Flip', 'v2')], b = (images || {})[shotOf(sim, 'Flip', 'v9')];
  const n2 = changedPixels(base, a), n9 = changedPixels(base, b);
  check('frame', 'screenshots at the two values show different cells',
    'Against a baseline with the actor hidden, the frame-2 shot changes some pixels and the frame-9 shot changes at least twice as many (the cell discs grow with the frame number)',
    n2 > 500 && n9 >= 2 * n2, `changed pixels: frame 2 ${n2}, frame 9 ${n9}${n2 < 0 || n9 < 0 ? ' (a screenshot is missing or has another size)' : ''}`);
}

function wireChecks({ build, sim, images }, check) {
  const meshSteps = steps(build).filter((s) => s.step.startsWith('mesh_'));
  const sample = meshSteps.find((s) => s.step === 'mesh_sample');
  check('wire', 'the sample model import is recorded',
    'Interchange imports the sample GLB; the report counts static and skeletal meshes (a rigged model gives skeletal meshes, which a mesh renderer cannot take)',
    steps(build).length > 0 && (!sample || (typeof sample.returned === 'boolean' && (list(sample.static_meshes).length + (sample.skeletal_meshes || 0)) > 0)),
    sample ? `${list(sample.static_meshes).length} static, ${sample.skeletal_meshes || 0} skeletal${sample.error ? `; ${String(sample.error).split('\n')[0]}` : ''}` : 'no sample model given');
  const chain = meshSteps.find((s) => list(s.static_meshes).length > 0 && s.set_error === '' && typeof s.mesh_after === 'string' && String(s.mesh_path).endsWith(String(s.mesh_after).split('.').pop()) && !s.error);
  const id = chain ? chain.step.slice('mesh_'.length) : undefined;
  check('wire', 'an imported static mesh is held by the mesh renderer',
    'A GLB imported through Interchange gives a StaticMesh; SetRendererData with Meshes[0].Mesh stores it and GetRendererData reads the same asset back',
    Boolean(chain), chain ? `${id}: ${chain.mesh_path} -> ${chain.mesh_after}` : meshSteps.map((s) => `${s.step}: ${String(s.error || s.set_error || 'no static mesh').split('\n')[0].slice(0, 100)}`).join('; ') || 'no mesh step');
  const on = id ? stepOf(sim, `Mesh_${id}`, 'on') : undefined;
  check('wire', 'the mesh system emits particles',
    'A sim cache of the system shows more than 0 particles for the mesh emitter', metric(on) > 0, id ? `Mesh_${id}: ${metric(on) === undefined ? 'not sampled' : metric(on)}` : 'no mesh chain');
  const meshBase = id ? (images || {})[shotOf(sim, `Mesh_${id}`, 'base')] : undefined, meshOn = id ? (images || {})[shotOf(sim, `Mesh_${id}`, 'on')] : undefined;
  const meshDiff = changedPixels(meshBase, meshOn), meshTotal = meshOn ? meshOn.width * meshOn.height : 0;
  check('wire', 'the mesh is visible in a screenshot',
    'Against a baseline with the actor hidden, the shot with the system running changes at least 0.1 percent of the pixels',
    meshDiff > 0.001 * meshTotal && meshTotal > 0, `changed pixels ${meshDiff} of ${meshTotal}`);
  const atlas = step(build, 'atlas');
  check('wire', 'the atlas image becomes a flipbook with the atlas grid as Sub Image Size',
    'The atlas PNG imports as a texture; the sprite renderer takes the unlit SubUV material and a Sub Image Size equal to the columns and rows computed from the atlas JSON',
    ok(atlas) && typeof atlas.texture === 'string' && atlas.set_error === '' && Boolean(atlas.sub_image_size) && atlas.sub_image_size.x === (atlas.grid || [])[0] && atlas.sub_image_size.y === (atlas.grid || [])[1],
    atlas.error ? String(atlas.error).split('\n')[0] : `grid ${JSON.stringify(atlas.grid)}, stored ${JSON.stringify(atlas.sub_image_size)}`);
  const early = attribute(stepOf(sim, 'Atlas', 'early'), 'Sprite', 'SubImageIndex'), late = attribute(stepOf(sim, 'Atlas', 'late'), 'Sprite', 'SubImageIndex'), lateStep = stepOf(sim, 'Atlas', 'late');
  check('wire', 'the flipbook emits and its frame index advances',
    'A sim cache shows more than 0 particles, and Particles.SubImageIndex is larger after 60 frames than after 10',
    metric(lateStep) > 0 && Number.isFinite(early) && Number.isFinite(late) && late > early, `particles ${metric(lateStep)}; SubImageIndex after 10 frames ${early}, after 60 ${late}`);
  const flipBase = (images || {})[shotOf(sim, 'Atlas', 'base')], flipOn = (images || {})[shotOf(sim, 'Atlas', 'late')];
  const flipDiff = changedPixels(flipBase, flipOn), flipTotal = flipOn ? flipOn.width * flipOn.height : 0;
  check('wire', 'the flipbook is visible in a screenshot',
    'Against a baseline with the actor hidden, the shot with the system running changes at least 0.1 percent of the pixels',
    flipDiff > 0.001 * flipTotal && flipTotal > 0, `changed pixels ${flipDiff} of ${flipTotal}`);
  const user = step(build, 'user_variable'), override = stepOf(sim, 'MeshUser', 'override');
  check('wire', 'a Static Mesh user parameter is added from the toolsets (as an object parameter) and the runtime override call runs',
    'AddUserVariables with type StaticMesh and a NiagaraExt_VariableValue_Object default lists User.MeshObj on a copy of the mesh system; the data-interface shapes (class only, and an instance) are recorded and are not expected to list; override_system_user_variable_static_mesh runs on the component without an error and the system still emits. The renderer is not bound to the parameter (MeshesBinding takes a renderable-mesh-array data interface), so this does not show the override on screen',
    ok(user) && user.add_error === '' && list(user.names).includes('User.MeshObj') && Boolean(override) && !override.error && metric(override) > 0,
    user.error ? String(user.error).split('\n').slice(-2).join(' ').slice(0, 160) : `listed ${list(user.names).join(', ') || 'none'}; shapes ${(user.variants || []).map((v) => `${v.variant}=${v.listed ? 'listed' : 'not listed'}`).join(', ') || 'not recorded'}; override step ${override ? override.error || `particles ${metric(override)}` : 'not run'}`);
}

function gradientChecks(report, check) {
  const surface = step(report, 'surface'), inventory = step(report, 'inventory'), attempt = step(report, 'attempt');
  check('gradient', 'the System toolset registers and its tool list is recorded',
    'is_toolset_registered is True and the schema lists the System tools; the list is what an engine version is compared on (46 tools and 7 skills on 5.8.2)',
    ok(surface) && surface.registered === true && surface.tool_count > 0,
    `${report && report.engine}: ${surface.tool_count} tools, ${list(surface.niagara_skills).length} skills`);
  check('gradient', 'a data-interface input that mentions a curve or gradient exists on a template emitter',
    'Reading every stack input of the 14 template emitters (or the ScaleColor module added to a scratch emitter) finds one with a curve or gradient data interface',
    ok(inventory) && list(inventory.candidates).length > 0,
    `${inventory.scanned_inputs} inputs scanned; kinds ${JSON.stringify(inventory.kinds || {})}; candidates ${list(inventory.candidates).map((c) => `${c.emitter}/${c.module}/${c.input}`).slice(0, 4).join(', ') || 'none'}`);
  check('gradient', 'a gradient or curve input written as a whole reads back changed',
    'SetStackInputData with the data-interface value whose property JSON has one number changed stores it: no error, the input is still a data interface with the same keys, and the number reads back',
    ok(attempt) && attempt.set_error === '' && String(attempt.kind_after).endsWith('DataInterface') && attempt.stored === true && attempt.same_keys === true,
    attempt.error ? String(attempt.error).split('\n')[0] : `${(attempt.target || {}).input}: ${JSON.stringify(attempt.path)} ${attempt.old} -> ${attempt.new}, read back ${attempt.value_after}, ${attempt.set_error || attempt.kind_after}`);
}

/**
 * @param {{ groups: string[], reports: Record<string, any> }} input  reports.renderers, reports.gradient: one report; reports.emit, reports.frame, reports.wire: { build, sim, images? }
 *   images maps a screenshot file name to { width, height, rgba }
 * @returns {{ group: string, name: string, claim: string, pass: boolean, detail: string }[]}
 */
export function evaluateProbes({ groups, reports }) {
  const out = [];
  const check = (group, name, claim, pass, detail = '') => out.push({ group, name, claim, pass: Boolean(pass), detail: String(detail) });
  const r = reports || {};
  for (const group of groups) {
    if (group === 'renderers') rendererChecks(r.renderers, check);
    else if (group === 'emit') emitChecks(r.emit || {}, check);
    else if (group === 'frame') frameChecks(r.frame || {}, check);
    else if (group === 'wire') wireChecks(r.wire || {}, check);
    else if (group === 'gradient') gradientChecks(r.gradient, check);
  }
  return out;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}

/**
 * The screenshot file names a sim report asks for (to look up under Saved/Screenshots), with the sample and step that took each.
 * @param {any} sim
 */
export function shotNames(sim) {
  return list((sim || {}).shots).map((s) => s.name).filter(Boolean);
}
