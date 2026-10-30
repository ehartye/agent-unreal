// Pure checks for stylized_validate.mjs: turn the JSON reports, log excerpts and image measurements of the stylized scene runs into
// pass or fail results, one per claim in the Substrate and Niagara references. No Unreal, no files: stylized-validate.test.mjs feeds
// it canned results, and stylized_validate.mjs feeds it real ones.
import { describeCost, STATIONS as STATION_NAMES, stepped } from './stylized-ink.mjs';

const LOG_PROBLEM = /(LogMaterial|LogShaderCompilers|LogNiagara|LogToonProfile): (Error|Warning)|Failed to compile Material|default material/i;

/** Lines of an editor log that name a material, shader or Niagara error or warning. */
export const logProblems = (text = '') => text.split('\n').filter((line) => LOG_PROBLEM.test(line));

/** The value GetAll prints for a property: `... ToonProfileOverride = /Script/Engine.ToonProfile'/Game/Stylized/TP_Ink.TP_Ink'` gives the quoted path or 'None'. */
export function readGetAll(logText = '', property) {
  const line = logText.split('\n').find((l) => l.includes(`.${property} = `));
  if (!line) return undefined;
  const value = line.split(`.${property} = `)[1].trim();
  const quoted = value.match(/'([^']*)'/);
  return quoted ? quoted[1] : value;
}

const monotone = (xs) => xs.every((v, i) => i === 0 || v >= xs[i - 1]);

/**
 * @param {{ bare?: any, build?: any, render?: any, persistWrite?: any, persistRead?: any, logs?: { build?: string, render?: string, persistWrite?: string, persistRead?: string }, measures?: any }} r
 * @returns {{ name: string, claim: string, pass: boolean, detail: string }[]}
 */
export function evaluate(r) {
  const bare = r.bare || {}, build = r.build || {}, render = r.render || {}, pw = r.persistWrite || {}, pr = r.persistRead || {}, logs = r.logs || {}, m = r.measures || {};
  const out = [];
  const check = (name, claim, pass, detail = '') => out.push({ name, claim, pass: Boolean(pass), detail: String(detail) });
  const step = (name) => (build.steps || []).find((s) => s.step === name) || {};
  const ok = (...names) => names.every((n) => step(n).ok === true);

  check('a bare project has Substrate off and the Adaptive GBuffer', 'Set r.Substrate=True in DefaultEngine.ini under [/Script/Engine.RendererSettings]',
    bare['r.Substrate'] === 0 && bare['r.Substrate.ProjectGBufferFormat'] === 1 && build.substrate_cvar === 1 && build.gbuffer_format_cvar === 0,
    `bare r.Substrate=${bare['r.Substrate']}, GBuffer=${bare['r.Substrate.ProjectGBufferFormat']}; configured r.Substrate=${build.substrate_cvar}, GBuffer=${build.gbuffer_format_cvar}`);
  check('a Toon Profile, Toon materials and a Toon instance are authored and saved from Python', 'ToonProfileFactory, MaterialExpressionSubstrateToonBSDF and connect_material_property(MP_FRONT_MATERIAL) work headless',
    ok('toon_profile', 'toon_lit', 'toon_sprite_masked', 'toon_sprite_translucent', 'toon_instance') && step('toon_profile').saved === true,
    ['toon_profile', 'toon_lit', 'toon_sprite_masked', 'toon_sprite_translucent', 'toon_instance'].map((n) => `${n}=${step(n).ok}`).join(', '));
  const keys = (step('toon_profile').default_diffuse_ramp_keys || []).filter(([, v]) => v > 0).map(([, v]) => v);
  check('a new Toon Profile ships a stepped diffuse ramp', 'The default diffuse ramp holds four levels, 0.25, 0.5, 0.75 and 1',
    JSON.stringify([...new Set(keys)].sort()) === JSON.stringify([0.25, 0.5, 0.75, 1]), `ramp values ${[...new Set(keys)].join(', ') || 'none'}`);
  const inputs = step('toon_lit').toon_inputs || [];
  check('the Toon BSDF has no opacity input, so a Weight node carries the translucent coverage', 'Wire a Substrate Weight node from a mask to the Toon BSDF for a translucent sprite',
    inputs.length >= 8 && !inputs.some((n) => /opacity|coverage|alpha/i.test(n)) && m.toonMasked && m.toonTranslucent && Math.abs(m.toonMasked.pixels - m.toonTranslucent.pixels) <= 0.02 * m.toonMasked.pixels,
    `inputs ${inputs.join(', ')}; sprite pixels masked ${m.toonMasked && m.toonMasked.pixels}, translucent ${m.toonTranslucent && m.toonTranslucent.pixels}`);
  check('the Toon material steps the lighting on an opaque mesh', 'On a lit mesh the Toon BSDF draws flat bands where the plain material draws a gradient',
    m.toonSphere && m.plainSphere && m.toonSphere.bands >= 2 && m.toonSphere.flatShare >= 0.4 && m.plainSphere.bands === 0,
    m.toonSphere ? `toon ${m.toonSphere.bands} bands (flat share ${m.toonSphere.flatShare}), plain ${m.plainSphere.bands} bands` : 'no measurement');
  check('a Toon material on a masked sprite is lit and stepped', 'Substrate Toon works on a Niagara sprite with a masked blend mode',
    m.toonMasked && m.toonMasked.bands >= 2 && m.toonMasked.flatShare >= 0.6, m.toonMasked ? `${m.toonMasked.bands} bands, flat share ${m.toonMasked.flatShare}` : 'no measurement');
  check('a Toon material on a translucent sprite is lit and stepped', 'Substrate Toon works on a Niagara sprite with a translucent blend mode',
    m.toonTranslucent && m.toonTranslucent.bands >= 2 && m.toonTranslucent.flatShare >= 0.6, m.toonTranslucent ? `${m.toonTranslucent.bands} bands, flat share ${m.toonTranslucent.flatShare}` : 'no measurement');
  const problems = ['build', 'render'].flatMap((k) => logProblems(logs[k]).map((l) => `${k}: ${l.slice(0, 120)}`));
  check('the materials compile without errors or fallbacks', 'No material, shader or Niagara error or warning in the build and offscreen-run logs', Boolean(logs.build && logs.render) && problems.length === 0,
    problems.length ? problems.slice(0, 3).join(' | ') : 'no problem lines');
  const compile = render.compile && typeof render.compile === 'object' ? render.compile : {};
  const systems = Object.keys(compile);
  check('every authored Niagara system compiles', 'Poll GetSystemCompileState from the editor tick and expect UpToDate',
    systems.length >= 7 && !render.compile_timeout && systems.every((n) => compile[n].aggregateStatus === 'UpToDate' && !compile[n].bHasErrors), systems.map((n) => `${n}=${compile[n].aggregateStatus}`).join(', ') || String(render.compile));
  const series = (render.flipbook_sample || {}).sub_image_index || [];
  const body = series.slice(1);
  check('the sub-image index advances with the particle age', 'SubUV Animation in Linear mode writes Particles.SubImageIndex = normalized age x frame count',
    body.length >= 100 && monotone(body) && Math.floor(body[0]) === 0 && body[body.length - 1] > 15.5 && new Set(body.map(Math.floor)).size === 16,
    series.length ? `${series.length} samples, ${body[0]?.toFixed(2)} to ${body[body.length - 1]?.toFixed(2)}, ${new Set(body.map(Math.floor)).size} distinct frames` : 'no samples');
  const timed = m.timed || [];
  check('screenshots of the running flipbook show different frames', 'The flipbook sprite changes frame as the effect plays',
    timed.length === 8 && new Set(timed).size >= 5, `${new Set(timed).size} distinct drawn areas in ${timed.length} shots`);
  check('SubUV Direct Index shows the chosen cell', 'Set SubUV Animation Mode to Direct Index and Direct Frame Index to a frame number to show one cell',
    m.fixed && m.fixed.length === 3 && m.fixedRatioSpread <= 0.03, m.fixed ? `frames ${m.fixed.map((f) => f.frame).join(',')}: on-screen area / cell area spread ${m.fixedRatioSpread} (median ${m.fixedRatioMedian})` : 'no measurement');
  const b = m.bright, d = m.dark;
  const near = (a, c, t) => a.every((v, i) => Math.abs(v - c[i]) <= t);
  check('the flipbook sprite ignores the scene light and the backdrop', 'A self-emissive flipbook sprite is the same under a bright backdrop with a strong sun and a dark backdrop with no sun',
    b && d && near(b.center, d.center, 2) && Math.abs(b.fill - d.fill) <= 0.01 * d.fill && Math.abs(b.backdrop[0] - d.backdrop[0]) > 100,
    b && d ? `fill ${b.fill} vs ${d.fill}, centre ${b.center} vs ${d.center}, backdrop ${b.backdrop[0]} vs ${d.backdrop[0]}` : 'no measurement');
  check('a floor-quantized ramp material renders flat bands on a particle', 'A Niagara sprite with a floor-quantized light term draws stepped bands and the smooth control does not',
    m.stepped && m.smooth && m.stepped.levels <= 6 && m.smooth.levels >= 12 && m.smooth.flatShare < 0.3,
    m.stepped ? `stepped ${m.stepped.bands} bands over ${m.stepped.levels} levels, smooth ${m.smooth.bands} band and ${m.smooth.levels} levels` : 'no measurement');
  check('the Niagara Dynamic Material Parameter reaches the material', 'The DynamicMaterialParameters module value (3) replaces the material default (4) in a Dynamic Parameter node',
    m.stepped && m.stepped.bands === 3, m.stepped ? `${m.stepped.bands} bands` : 'no measurement');
  const written = pw.set_by_property_name === false && pw.override_flag_after === true && pw.saved === true;
  const override = readGetAll(logs.persistWrite, 'ToonProfileOverride'), reread = readGetAll(logs.persistRead, 'ToonProfileOverride'), flag = readGetAll(logs.persistRead, 'bOverrideToonProfile');
  check('the Python property name for the override does not exist', 'MaterialInstance.ToonProfileOverride has no Python property, only override_toon_profile',
    pw.set_by_property_name === false && /Failed to find property/.test(pw.property_name_error || ''), pw.property_name_error || 'no error recorded');
  check('a Toon Profile override survives save and an editor restart', 'Set on the instance by name, saved, read back in a new process',
    written && String(override).endsWith('TP_Ink.TP_Ink') && String(reread).endsWith('TP_Ink.TP_Ink') && flag === 'True' && pr.override_flag === true,
    `after set: ${override}; new process: ${reread}, flag ${flag}`);
  return out;
}

export const summarize = (checks) => ({ passed: checks.filter((c) => c.pass).length, total: checks.length });

/**
 * What each ink-brush method showed when the probe ran on the engine, pinned like the other checks: a check passes when the frame
 * agrees with this table, so a method that does not work is a recorded negative result and not a failing probe. Change a value only
 * when a run shows the other result. See README.md for the runs behind each value.
 */
export const INK_EXPECTED = {
  ramp: true, flange: false, stencil_sprite: true, stencil_mesh: true,
  ribbon_stepped: true, ribbon_edge: true, ribbon_stencil: true, mesh_stepped: true, mesh_stencil: true,
};

const STENCIL_MIN_CHANGED = 300;   // pixels that differ between the stencil-on and stencil-off frames when an outline is drawn

/**
 * The checks of the outline, ribbon, mesh and cost groups.
 * @param {{ groups: string[], expected?: Record<string, boolean|undefined>, build?: any, render?: any, measures?: any, cost?: any, logs?: { build?: string, render?: string } }} r
 * `cost` is the costVerdict() result; `measures` is measureInk().
 * @returns {{ name: string, claim: string, pass: boolean, detail: string }[]}
 */
export function evaluateInk(r) {
  const groups = r.groups || [], expected = r.expected || INK_EXPECTED, m = r.measures || { rings: {}, bands: {}, changed: {}, drawn: {} }, render = r.render || {}, logs = r.logs || {};
  const out = [];
  const check = (name, claim, pass, detail = '') => out.push({ name, claim, pass: Boolean(pass), detail: String(detail) });
  const on = (g) => groups.includes(g);
  const ring = (key) => m.rings?.[key];
  const describe = (x) => (x ? `ring coverage ${x.coverage}, ${x.pixels} outline pixels, hugging ${x.hugging}, boundary ${x.boundary}` : 'no frame');
  // a method check: the frame shows a ring exactly when the table says the method works
  const method = (key, label, claim, frameKey, { needChange = false } = {}) => {
    const x = ring(frameKey), changed = m.changed?.[frameKey], want = expected[key];
    const worked = Boolean(x && x.found && (!needChange || (changed ?? 0) >= STENCIL_MIN_CHANGED));
    check(`${label} ${want === false ? 'draws no ring' : 'draws a ring'}`, claim, x && want !== undefined && worked === want,
      `${describe(x)}${needChange ? `; ${changed ?? 'no'} pixels differ from the frame without the outline` : ''}; table says ${want === undefined ? 'not yet recorded' : want ? 'works' : 'does not work'}, frame ${x ? (worked ? 'works' : 'does not') : 'missing'}`);
  };
  if (on('outline')) {
    const colour = m.colour;
    check('a flat swatch shows the outline colour', 'The outline colour (linear 0.05, 0.85, 0.75) reaches the frame as a flat colour the ring check can match',
      Array.isArray(colour) && colour[1] > 150 && colour[2] > 120 && colour[0] < colour[1], colour ? `swatch centre ${colour}` : 'no swatch');
    const none = ring('o_none');
    check('the drawn flipbook with no outline method has no ring', 'The control frame holds no ring of outline-coloured pixels, so a ring in another frame comes from its method',
      none && !none.found && none.pixels < 150, describe(none));
    method('ramp', 'a coverage-ramp outline in the flipbook material', 'The flipbook material takes the largest coverage of 16 taps around each pixel and colours the ring between it and the coverage with the outline colour', 'o_ramp');
    method('flange', 'a coverage flange (second sprite renderer behind the first)', 'A second sprite renderer draws the dilated coverage in the outline colour, pushed away from the camera by world position offset', 'o_flange');
    method('stencil_sprite', 'a custom-depth stencil outline on the sprite renderer', 'A stencil value on the Niagara component and a post process that outlines pixels next to the stencil draw a ring around the sprite', 'o_stencil_sprite', { needChange: true });
    method('stencil_mesh', 'a custom-depth stencil outline on the mesh-particle renderer', 'The same stencil value and post process draw a ring around a mesh particle', 'o_stencil_mesh', { needChange: true });
  }
  if (on('ribbon')) {
    const ink = m.bands?.r_ink, smooth = m.bands?.r_smooth, want = expected.ribbon_stepped;
    const ok = stepped(ink, smooth);
    check(`the ink material on a ribbon renderer ${want === false ? 'is not' : 'is'} lit in flat bands`, 'A ribbon material with a stepped light term draws flat bands across the ribbon and the smooth control draws a gradient',
      want !== undefined && ok === want, `ink ${ink ? `${ink.bands} bands, flat share ${ink.flatShare}` : 'no frame'}; smooth ${smooth ? `${smooth.bands} bands, ${smooth.levels} levels` : 'no frame'}; table says ${want}`);
    method('ribbon_edge', 'a coverage-ramp outline on a ribbon', 'A ribbon material that colours the two long edges (coverage across the width above 0.8) with the outline colour shows a ring', 'r_edge');
    method('ribbon_stencil', 'a custom-depth stencil outline on a ribbon renderer', 'The stencil value and post process outline a ribbon', 'r_stencil', { needChange: true });
  }
  if (on('mesh')) {
    const ink = m.bands?.m_ink, smooth = m.bands?.m_smooth, want = expected.mesh_stepped;
    const ok = stepped(ink, smooth);
    check(`the ink material on a mesh-particle renderer ${want === false ? 'is not' : 'is'} lit in flat bands`, 'A mesh-particle material with a stepped light term draws flat bands on a sphere and the smooth control draws a gradient',
      want !== undefined && ok === want, `ink ${ink ? `${ink.bands} bands, flat share ${ink.flatShare}` : 'no frame'}; smooth ${smooth ? `${smooth.bands} bands, ${smooth.levels} levels` : 'no frame'}; table says ${want}`);
    method('mesh_stencil', 'a custom-depth stencil outline on a mesh particle', 'The stencil value and post process outline a mesh particle', 'm_stencil', { needChange: true });
  }
  const stations = groups.flatMap((g) => STATION_NAMES[g] || []);
  if (stations.length) {
    const counts = render.counts || {}, empty = stations.filter((s) => !(counts[s] > 0));
    check('every ink station emits particles', 'A one-step simulation cache of each station holds at least one live particle', stations.length > 0 && empty.length === 0,
      empty.length ? `no particles: ${empty.join(', ')}; counts ${JSON.stringify(counts)}` : stations.map((s) => `${s}=${counts[s]}`).join(', '));
    const compile = render.compile && typeof render.compile === 'object' ? render.compile : {}, systems = Object.keys(compile);
    check('every authored Niagara system compiles', 'Poll GetSystemCompileState from the editor tick and expect UpToDate',
      systems.length > 0 && !render.compile_timeout && systems.every((n) => compile[n].aggregateStatus === 'UpToDate' && !compile[n].bHasErrors), systems.map((n) => `${n}=${compile[n].aggregateStatus}`).join(', ') || String(render.compile));
    const problems = ['build', 'render'].flatMap((k) => logProblems(logs[k]).map((l) => `${k}: ${l.slice(0, 120)}`));
    check('the ink-brush materials compile without errors or fallbacks', 'No material, shader or Niagara error or warning in the build and offscreen-run logs', Boolean(logs.build && logs.render) && problems.length === 0,
      problems.length ? problems.slice(0, 3).join(' | ') : 'no problem lines');
  }
  if (on('cost')) {
    const counts = render.counts || {}, v = r.cost;
    check('the cost scenes hold the same particle count', 'The control, the ink look and the drawn look each hold the same number of live particles', ['c_control', 'c_ink', 'c_drawn'].every((s) => counts[s] > 0 && counts[s] === counts.c_control),
      ['c_control', 'c_ink', 'c_drawn'].map((s) => `${s}=${counts[s]}`).join(', '));
    check('the frame cost is recorded, or declined with the GPU readings', 'The ink-minus-control GPU time is recorded only when other processes used under 10 percent of the GPU and the repeated windows agree; otherwise the answer is "not measured" with the readings',
      Boolean(v) && (v.status === 'measured' || ['busy', 'unstable', 'no-readings'].includes(v.code)), v ? describeCost(v) : 'no verdict');
  }
  return out;
}
