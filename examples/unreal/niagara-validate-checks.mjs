// Pure checks for niagara_validate.mjs: turns the JSON reports of the Niagara scripts into pass or fail results,
// one per claim in skills/unreal-effects/references/unreal-niagara.md. No Unreal, no files: the tests in
// niagara-validate.test.mjs feed it canned reports, and niagara_validate.mjs feeds it real ones.

const STOCK_SYSTEMS = '/Niagara/DefaultAssets/Templates/Systems/';
const DOCUMENTED_STOCK_SYSTEMS = ['AttributeReaderTrails', 'DirectionalBurst', 'DirectionalBurstLightweight', 'FountainLightweight', 'MinimalLightweight', 'RadialBurst', 'SimpleExplosion'];
const FIRE_SCALARS = ['TemperatureCurve', 'DensityScale', 'TemperatureGain', 'DepthFade', 'Blackbody', 'TemperatureMaximum'];
const FIRE_VECTORS = ['Density Tint', 'Temperature Tint', 'EnvironmentColor', 'SunColor'];
const bare = (name) => String(name).replace(/^User\./, '');
const lacking = (have, want) => want.filter((n) => !(have || []).includes(n));

const AUTHORING_VERBS = /^(add|remove|create|set_emitter|set_renderer)_/;

const emitterCounts = (verify, label) => {
  const systems = (verify.samples || []).map((s) => s.systems && s.systems[label]).filter(Boolean);
  return systems.length ? systems[systems.length - 1] : undefined;
};

/**
 * @param {{ traps?: any, build?: any, author?: any, authorRerun?: any, verify?: any, templates?: any, plugins?: any[] }} r the six reports,
 *   and `plugins`: the engine's plugin descriptors as engine_plugins.mjs reads them (no Unreal process)
 * @returns {{ name: string, claim: string, pass: boolean, detail: string }[]}
 */
export function evaluate(r) {
  const traps = r.traps || {}, build = r.build || {}, author = r.author || {}, rerun = r.authorRerun || {}, verify = r.verify || {};
  const templates = r.templates || {}, plugins = Array.isArray(r.plugins) ? r.plugins : [];
  const out = [];
  const check = (name, claim, pass, detail = '') => out.push({ name, claim, pass: Boolean(pass), detail: String(detail) });

  // Python without extras
  const steps = build.steps || [];
  const dups = steps.filter((s) => s.step === 'duplicate');
  check('duplicate engine templates and save the map', 'Duplicate an engine template into /Game; save each duplicate before the map',
    dups.length >= 2 && dups.every((s) => s.ok && s.saved) && steps.some((s) => s.step === 'save_map' && s.ok) && !steps.some((s) => s.step === 'error'),
    `${dups.length} duplicates, ${steps.map((s) => s.step).join(',')}`);
  check('duplicate_asset fails before the registry scan and works after', 'Call search_all_assets(True) first in a commandlet',
    traps.duplicate_before_scan === false && traps.duplicate_after_scan === true,
    `before ${traps.duplicate_before_scan}, after ${traps.duplicate_after_scan}`);
  check('spawn_system_at_location returns None in a commandlet map', 'Spawn in a ticking editor world or Play-In-Editor instead',
    traps.spawn_in_commandlet_is_none === true, String(traps.spawn_in_commandlet_is_none));
  const api = traps.component_api || {};
  check('NiagaraComponent has typed runtime setters and getters', 'NiagaraComponent has set_variable_* and get_variable_*',
    Object.keys(api).length >= 8 && Object.values(api).every(Boolean) && traps.library_mesh_override === true,
    Object.entries(api).filter(([, v]) => !v).map(([k]) => k).join(',') || 'all present');
  check('NiagaraSystem has no authoring methods in Python', 'NiagaraSystem exposes editor properties but almost no methods',
    Array.isArray(traps.system_members) && !traps.system_members.some((n) => AUTHORING_VERBS.test(n)),
    (traps.system_members || []).join(','));

  // Epic's toolsets from Python
  check('toolset functions are not Python members', 'dir(unreal.NiagaraToolset_System) is empty',
    Array.isArray(author.python_members_of_toolset_class) && author.python_members_of_toolset_class.length === 0,
    JSON.stringify(author.python_members_of_toolset_class));
  check('the System toolset lists 46 tools', 'NiagaraToolset_System has 46 tools (Unreal 5.8.4)', author.system_tool_count === 46,
    `${author.system_tool_count} on ${author.engine}`);
  const calls = author.calls || [];
  const before = author.emitters_before || [], after = author.emitters_after || [];
  check('a system is authored through execute_tool', 'Synchronous tools complete in a commandlet (create, summary, add emitter)',
    calls.length >= 4 && calls.every((c) => c.complete && !c.error) && after.length === before.length + 1 && after.includes('ExtraBurst') && author.saved === true && author.map_saved === true,
    `${before.join(',')} -> ${after.join(',')}`);
  check('a rerun refuses instead of deleting', 'Create new names; deleting and recreating a system crashed the editor',
    typeof rerun.error === 'string' && rerun.error.includes('already exists'), (rerun.error || 'no error recorded').split('\n').filter(Boolean).pop());

  // Async tools from a ticking editor
  const compile = verify.compile && typeof verify.compile === 'object' ? verify.compile : {};
  const names = Object.keys(compile);
  check('compile state completes from the editor tick', 'Poll result.is_complete from an editor tick; expect UpToDate',
    names.length >= 3 && !verify.compile_timeout && names.every((n) => compile[n].aggregateStatus === 'UpToDate'),
    names.map((n) => `${n}=${compile[n].aggregateStatus}`).join(', ') || String(verify.compile));

  // Verification with a simulation cache
  const stateful = emitterCounts(verify, 'FxStateful');
  const statefulCounts = stateful && stateful.emitters ? Object.values(stateful.emitters) : [];
  check('a stateful template reports particles per emitter', 'Count what spawned with a sim cache; activate(True) before capturing',
    stateful && stateful.captured && stateful.valid && statefulCounts.length >= 2 && statefulCounts.every((n) => n > 0),
    stateful ? JSON.stringify(stateful.emitters) : 'no sample');
  const light = emitterCounts(verify, 'FxLightweight');
  const lightKeys = light && light.emitters ? Object.keys(light.emitters) : [];
  check('a stateless template reports one emitter named None with no positions', 'Stateless emitters keep no per-particle data',
    light && light.captured && lightKeys.length === 1 && lightKeys[0] === 'None' && light.emitters.None === 0,
    light ? JSON.stringify(light.emitters) : 'no sample');
  const authored = emitterCounts(verify, 'FxAuthored');
  const authoredNames = authored && authored.emitters ? Object.keys(authored.emitters) : [];
  const authoredCounts = authored && authored.emitters ? Object.values(authored.emitters) : [];
  const empty = authoredNames.filter((n) => authored.emitters[n] === 0);
  check('every authored emitter is in the cache, and at least one emits', 'A successful tool call is not an emitting effect; verify',
    authored && authored.captured && authoredNames.length > 0 && after.every((n) => authoredNames.includes(n)) && authoredCounts.some((n) => n > 0),
    `${JSON.stringify(authored && authored.emitters)}${empty.length ? `; zero particles: ${empty.join(',')}` : ''}`);

  // What Python cannot do
  check('the C++ authoring class is not in Python, its data structs are', 'UNiagaraExternalEditUtilities is C++ only; NiagaraExt_* structs are exposed',
    traps.external_edit_utilities_in_python === false && traps.ext_structs_in_python === true,
    `class ${traps.external_edit_utilities_in_python}, structs ${traps.ext_structs_in_python}`);
  const pyMembers = [...(traps.python_emitter_members || []), ...(traps.python_module_members || [])];
  check('NiagaraPythonEmitter and NiagaraPythonModule cannot add anything', 'They inspect emitters and set properties; they cannot author the stack',
    pyMembers.length > 0 && !pyMembers.some((n) => AUTHORING_VERBS.test(n)), pyMembers.join(','));

  // Plugin descriptors: the throwaway project enables Niagara itself, so the default is read from the engine's own .uplugin files
  const plugin = (name) => plugins.find((p) => p.name === name);
  const niagara = plugin('Niagara'), fluids = plugin('NiagaraFluids');
  check('the Niagara plugin is enabled by default', 'Niagara is enabled by default',
    Boolean(niagara) && niagara.enabledByDefault === true, niagara ? `EnabledByDefault ${niagara.enabledByDefault}` : 'Niagara.uplugin not found');
  check('the Niagara Fluids plugin is not enabled by default', 'The Niagara Fluids plugin (not enabled by default)',
    Boolean(fluids) && fluids.enabledByDefault === false, fluids ? `EnabledByDefault ${fluids.enabledByDefault}` : 'NiagaraFluids.uplugin not found');

  // What Python lacks (the traps project enables the toolsets, so absence there is the stronger fact)
  const libraries = traps.niagara_libraries, editorNames = traps.niagara_editor_utilities_names;
  check('Python has no Niagara editor library', 'There is no Niagara editor library in editor Python',
    Array.isArray(libraries) && Array.isArray(editorNames) && editorNames.length === 0 && libraries.includes('NiagaraFunctionLibrary'),
    `libraries ${(libraries || []).join(',')}; editor-named ${(editorNames || []).join(',') || 'none'}`);
  check('Python has no NiagaraMeshRendererProperties class', 'There is no NiagaraMeshRendererProperties class in editor Python',
    traps.mesh_renderer_properties_in_python === false, String(traps.mesh_renderer_properties_in_python));
  check('the system factory emitter list cannot be set from Python', "The system factory's emitter list cannot be set",
    traps.factory_emitters_attribute === false && typeof traps.factory_emitters_set_error === 'string' && traps.factory_emitters_set_error !== '',
    `attribute ${traps.factory_emitters_attribute}; set error: ${String(traps.factory_emitters_set_error).slice(0, 120)}`);

  // Stock content, from niagara_templates.py
  const keys = Object.keys(templates.templates || {});
  const stockNames = keys.filter((k) => k.startsWith(STOCK_SYSTEMS)).map((k) => k.slice(STOCK_SYSTEMS.length)).sort();
  check('the default template systems are the documented seven and none is a fire',
    'AttributeReaderTrails, DirectionalBurst, DirectionalBurstLightweight, FountainLightweight, MinimalLightweight, RadialBurst, SimpleExplosion; none is a fire',
    JSON.stringify(stockNames) === JSON.stringify([...DOCUMENTED_STOCK_SYSTEMS].sort()) && !stockNames.some((n) => /fire/i.test(n)),
    stockNames.join(',') || 'no templates report');
  const emitterTemplates = Array.isArray(templates.emitter_templates) ? templates.emitter_templates : [];
  check('the default template emitters are under /Templates/Emitters', 'emitters in /Templates/Emitters/',
    emitterTemplates.length > 0 && emitterTemplates.every((p) => p.startsWith('/Niagara/DefaultAssets/Templates/Emitters/')), `${emitterTemplates.length} emitters`);

  const stock = templates.stock && typeof templates.stock === 'object' ? templates.stock : {};
  const fountain = stock.FountainLightweight || {}, fire = stock.Grid2D_Gas_MovingFire || {};
  const fountainVars = Array.isArray(fountain.user_variables) ? fountain.user_variables : undefined;
  check('FountainLightweight exposes no user parameters', 'It exposes no user parameters',
    fountainVars !== undefined && fountainVars.length === 0 && !fountain.error && Array.isArray(fire.user_variables) && fire.user_variables.length > 0,
    fountain.error || (fountainVars ? `fountain [${fountainVars.join(',')}]; the fire template, as a control, lists [${(fire.user_variables || []).join(',')}]` : String(templates.stock || 'no stock section')));
  const fireVars = Array.isArray(fire.user_variables) ? fire.user_variables.map(bare) : undefined;
  check('the moving-fire fluid template ships and its only user parameter is User.SimRT',
    '/NiagaraFluids/Templates/Gas/2D/Systems/Grid2D_Gas_MovingFire; its only user parameter is User.SimRT',
    keys.includes('/NiagaraFluids/Templates/Gas/2D/Systems/Grid2D_Gas_MovingFire') && !fire.error && JSON.stringify(fireVars) === JSON.stringify(['SimRT']),
    fire.error || `[${(fire.user_variables || []).join(',')}]`);
  const fireEmitters = fire.emitters && typeof fire.emitters === 'object' ? fire.emitters : {};
  const source = fireEmitters.SourceParticles, grid = fireEmitters.Grid2D_Gas_SmokeFire_Emitter;
  check('the fire template has a renderer-less source emitter and one sprite emitter',
    'Two emitters: SourceParticles (no renderer) and Grid2D_Gas_SmokeFire_Emitter (one sprite renderer)',
    Object.keys(fireEmitters).length === 2 && Boolean(source) && source.renderers.length === 0 && Boolean(grid) && grid.renderers.length === 1
      && grid.renderers[0] === 'NiagaraSpriteRendererProperties',
    JSON.stringify(Object.fromEntries(Object.entries(fireEmitters).map(([n, e]) => [n, e.renderers]))));
  const materials = grid && Array.isArray(grid.materials) ? grid.materials : [];
  check('the sprite renderer draws M_2D_SmokeFire', 'one translucent unlit material, M_2D_SmokeFire', materials.includes('M_2D_SmokeFire'), materials.join(',') || 'no material names read');
  const mat = templates.fire_material || {};
  const absent = [...lacking(mat.scalar, FIRE_SCALARS), ...lacking(mat.vector, FIRE_VECTORS)];
  check('M_2D_SmokeFire is translucent and unlit with the documented parameters',
    'translucent unlit; scalar TemperatureCurve, DensityScale, TemperatureGain, DepthFade, Blackbody, TemperatureMaximum; vector Density Tint, Temperature Tint, EnvironmentColor, SunColor',
    mat.loaded === true && /TRANSLUCENT/i.test(mat.blend_mode || '') && /UNLIT/i.test(mat.shading_model || '') && absent.length === 0,
    `${mat.blend_mode}, ${mat.shading_model}${absent.length ? `; missing ${absent.join(',')}` : ''}`);
  return out;
}

export const summarize = (checks) => ({ passed: checks.filter((c) => c.pass).length, total: checks.length });
