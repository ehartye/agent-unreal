// Pure checks for stylized_validate.mjs: turn the JSON reports, log excerpts and image measurements of the stylized scene runs into
// pass or fail results, one per claim in the Substrate and Niagara references. No Unreal, no files: stylized-validate.test.mjs feeds
// it canned results, and stylized_validate.mjs feeds it real ones.

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
