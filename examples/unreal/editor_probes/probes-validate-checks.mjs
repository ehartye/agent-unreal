// Judges the runs that probes_validate.mjs collects: the three read-back probes (doc, system, asset) run against a small fixture, plus the launcher
// run against a probe script that cannot parse. Pure functions, no Unreal, no files and no dependencies; the node test feeds them reports shaped
// like the ones probe.mjs reads. The expectations are the values the README section "What a run showed" records. Not yet run on an engine.
//   A run is { exit, stdout, stderr, seconds, report } as the validator measures it from a child `node probe.mjs ...` (report: the parsed JSON, or undefined).
//   fixture = the report of probes_fixture.py: { steps: [{ step, ok, error? }], error? }.
// A check with observe: true records a value and never fails on it; it passes when the value was recorded.

/** The fixture assets. probes_fixture.py builds the same paths; probes-validate.test.mjs keeps the two in step. */
export const PATHS = {
  system: '/Game/Probe/NS_Probe',
  gone: '/Game/Probe/NS_Gone',
  cube: '/Game/Probe/SM_Cube',
  cubeNanite: '/Game/Probe/SM_CubeNanite',
  material: '/Game/Probe/M_Probe',
  instance: '/Game/Probe/MI_Probe',
};
export const FIXTURE_STEPS = ['cube', 'cube_nanite', 'material', 'instance', 'system_create', 'add_emitters', 'lifetime_min', 'renderer_material', 'system'];
export const SAVE_ASSET = 'EditorAssetLibrary.save_asset';
export const CLASS_NAME = 'EditorAssetLibrary';
export const MISSING_CALLABLE = 'EditorAssetLibrary.save_assets';
export const MISSING_MODULE = 'Dust:Nothing';
export const DOC_NAMES = [SAVE_ASSET, CLASS_NAME, MISSING_CALLABLE];
export const SYSTEM_NAMES = [PATHS.system, PATHS.gone, PATHS.material];
export const MODULE_NAMES = ['InitializeParticle', MISSING_MODULE];
export const ASSET_NAMES = [PATHS.cube, PATHS.cubeNanite, PATHS.material, PATHS.instance, PATHS.system];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sameSet = (a, b) => Array.isArray(a) && a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
const first = (text) => String(text ?? '').split('\n')[0];
const kindOf = (item) => String(item?.value?.struct?.refPath ?? '').split('.').pop();

/** The launcher succeeded: it exited 0 and the report has an entry for every requested name. */
function launcherOk(run, names) {
  const report = run?.report;
  return run?.exit === 0 && isObject(report) && names.every((n) => Object.prototype.hasOwnProperty.call(report, n));
}
const launcherDetail = (run) => `exit ${run?.exit}; ${run?.report ? `${Object.keys(run.report).length} entries` : 'no report'}${run?.exit === 0 ? '' : `; ${first(run?.stderr)}`}`;

/** The InitializeParticle module of one emitter in a system entry: { key, inputs } or undefined (the stack name is not assumed). */
function initializeParticle(entry, emitter) {
  const key = Object.keys(entry?.modules ?? {}).find((k) => k.startsWith(`${emitter}:`) && k.endsWith(':InitializeParticle'));
  const found = key && entry.modules[key];
  return found?.status === 'found' ? { key, inputs: Array.isArray(found.inputs) ? found.inputs : [] } : undefined;
}
const inputNamed = (module, name) => module?.inputs.find((i) => i?.name === name);
const numberOf = (item) => item?.value?.value?.value;

export function evaluate({ fixture, doc, system, asset, broken } = {}) {
  const checks = [];
  const add = (name, claim, pass, detail, observe = false) => checks.push({ name, claim, pass: Boolean(pass), detail: String(detail), ...(observe ? { observe: true } : {}) });

  // ---- the fixture ----------------------------------------------------------------------------------------------------------------------
  const steps = Array.isArray(fixture?.steps) ? fixture.steps : [];
  const stepOf = (name) => steps.find((s) => s.step === name);
  const failedSteps = steps.filter((s) => !s.ok).map((s) => `${s.step}: ${first(s.error)}`);
  add('fixture built', 'the editor Python step makes the cube copies, the material and its instance, and the Niagara system with its two emitters, and saves them, with no step failing',
    Boolean(fixture) && !fixture.error && FIXTURE_STEPS.every((n) => stepOf(n)?.ok === true) && failedSteps.length === 0,
    !fixture ? 'no fixture report' : fixture.error ? first(fixture.error) : failedSteps.length ? failedSteps.join('; ') : `steps ${steps.map((s) => s.step).join(', ')}`);

  // ---- doc ------------------------------------------------------------------------------------------------------------------------------
  const d = doc?.report ?? {};
  add('doc: the run reports every requested name', 'probe.mjs --probe doc exits 0 and the report has an entry for a callable, a class and a name that does not exist',
    launcherOk(doc, DOC_NAMES), launcherDetail(doc));
  const save = d[SAVE_ASSET];
  add('doc: a callable begins with its signature', 'the docstring of EditorAssetLibrary.save_asset begins "X.save_asset(asset_to_save, only_if_is_dirty=True) -> bool" and the entry is a found callable',
    save?.status === 'found' && save.kind === 'callable' && first(save.doc).startsWith('X.save_asset(asset_to_save, only_if_is_dirty=True) -> bool'),
    save ? `${save.status}/${save.kind}: ${first(save.doc)}` : 'no entry');
  const cls = d[CLASS_NAME];
  add('doc: a class docstring has no signature', 'the class docstring of EditorAssetLibrary is a found class whose text is a description and does not begin with a "X.name(...) -> type" signature',
    cls?.status === 'found' && cls.kind === 'class' && String(cls.doc ?? '').trim().length > 0 && !/^X\.\w+\(.*\) ->/.test(first(cls.doc)),
    cls ? `${cls.status}/${cls.kind}: ${first(cls.doc)}` : 'no entry');
  const gone = d[MISSING_CALLABLE];
  add('doc: a name that does not exist is missing and points at the real one', 'EditorAssetLibrary.save_assets is missing and its nearby names include save_asset',
    gone?.status === 'missing' && Array.isArray(gone.nearby) && gone.nearby.includes('save_asset'), gone ? `${gone.status}; nearby ${JSON.stringify(gone.nearby)}` : 'no entry');

  // ---- system ---------------------------------------------------------------------------------------------------------------------------
  const s = system?.report ?? {};
  const ns = s[PATHS.system];
  add('system: the run reports every requested name', 'probe.mjs --probe system exits 0 and the report has an entry for the system, a path with no asset and a material path',
    launcherOk(system, SYSTEM_NAMES), launcherDetail(system));
  const emitterNames = (ns?.summary?.emitters ?? []).map((e) => e?.emitterName);
  add('system: a toolset-made system reads back with its two emitters', 'the system is found and its summary and "emitters" hold Dust and Motes',
    ns?.status === 'found' && sameSet(emitterNames, ['Dust', 'Motes']) && sameSet(Object.keys(ns.emitters ?? {}), ['Dust', 'Motes']),
    ns ? `${ns.status}; summary ${JSON.stringify(emitterNames)}; emitters ${JSON.stringify(Object.keys(ns.emitters ?? {}))}` : 'no entry');
  const stackNames = (e) => (isObject(ns?.emitters?.[e]?.modules) ? Object.keys(ns.emitters[e].modules) : []);
  const hasInit = (e) => Object.values(isObject(ns?.emitters?.[e]?.modules) ? ns.emitters[e].modules : {}).some((list) => Array.isArray(list) && list.includes('InitializeParticle'));
  add('system: module names per script stack', 'each emitter lists the module names of its script stacks, and InitializeParticle is among them',
    stackNames('Dust').length > 0 && stackNames('Motes').length > 0 && hasInit('Dust') && hasInit('Motes'),
    `Dust stacks ${JSON.stringify(stackNames('Dust'))}; Motes stacks ${JSON.stringify(stackNames('Motes'))}`);
  const renderers = Array.isArray(ns?.emitters?.Motes?.renderers) ? ns.emitters.Motes.renderers : [];
  const material = renderers.map((r) => r?.Material).find((m) => JSON.stringify(m ?? null).includes(PATHS.material));
  add("system: the sprite renderer's Material reads back", `a renderer of Motes has the Material ${PATHS.material}`, Boolean(material),
    `${renderers.length} renderers; Material ${JSON.stringify(renderers.map((r) => r?.Material))}`);
  const dustInit = initializeParticle(ns, 'Dust');
  const motesInit = initializeParticle(ns, 'Motes');
  add('system: Lifetime Min in Motes', 'InitializeParticle in Motes reads back a Lifetime Min of 2.5, the value the fixture wrote',
    numberOf(inputNamed(motesInit, 'Lifetime Min')) === 2.5, motesInit ? `${motesInit.key}: ${numberOf(inputNamed(motesInit, 'Lifetime Min'))}` : 'no InitializeParticle module found');
  add('system: Lifetime Min in Dust', 'InitializeParticle in Dust reads back a Lifetime Min of 15, the template emitter\'s own value',
    numberOf(inputNamed(dustInit, 'Lifetime Min')) === 15, dustInit ? `${dustInit.key}: ${numberOf(inputNamed(dustInit, 'Lifetime Min'))}` : 'no InitializeParticle module found');
  const nothing = ns?.modules?.[MISSING_MODULE];
  add('system: a module that no emitter has is missing', `${MISSING_MODULE} is a "missing" module entry with a reason`, nothing?.status === 'missing' && Boolean(nothing.reason),
    nothing ? `${nothing.status}: ${nothing.reason}` : 'no entry');
  add('system: a path with no asset is missing', `${PATHS.gone} is missing`, s[PATHS.gone]?.status === 'missing', s[PATHS.gone] ? `${s[PATHS.gone].status}: ${s[PATHS.gone].reason}` : 'no entry');
  const mat = s[PATHS.material];
  add('system: a Material path is unavailable', `${PATHS.material} is unavailable and the reason says it is not a NiagaraSystem`,
    mat?.status === 'unavailable' && /NiagaraSystem/.test(mat.reason ?? ''), mat ? `${mat.status}: ${mat.reason}` : 'no entry');

  // ---- asset ----------------------------------------------------------------------------------------------------------------------------
  const a = asset?.report ?? {};
  add('asset: the run reports every requested name', 'probe.mjs --probe asset exits 0 and the report has an entry for each fixture asset', launcherOk(asset, ASSET_NAMES), launcherDetail(asset));
  const cube = a[PATHS.cube];
  const extent = cube?.bounds?.box_extent;
  add('asset: the engine cube copy', 'a copy of the engine cube reads back with one slot (WorldGridMaterial), box extent 50, 50, 50 and nanite_enabled false',
    cube?.status === 'found' && cube.class === 'StaticMesh' && Array.isArray(cube.material_slots) && cube.material_slots.length === 1
      && String(cube.material_slots[0]?.material ?? '').includes('WorldGridMaterial') && extent?.x === 50 && extent?.y === 50 && extent?.z === 50 && cube.nanite_enabled === false,
    cube ? `${cube.class}; slots ${JSON.stringify(cube.material_slots)}; extent ${JSON.stringify(extent)}; nanite ${JSON.stringify(cube.nanite_enabled)}` : 'no entry');
  const nanite = a[PATHS.cubeNanite];
  add('asset: Nanite saved on a copy reads back true', 'the copy whose Nanite setting was saved reads nanite_enabled true',
    nanite?.status === 'found' && nanite.class === 'StaticMesh' && nanite.nanite_enabled === true, nanite ? `${nanite.class}; nanite ${JSON.stringify(nanite.nanite_enabled)}` : 'no entry');
  const m = a[PATHS.material];
  add('asset: a masked, two-sided material with the sprite flag', 'the material reads BLEND_MASKED, MSM_DEFAULT_LIT, two_sided true, used_with_niagara_sprites true, and used_with_nanite and used_with_niagara_ribbons false',
    m?.status === 'found' && m.class === 'Material' && m.blend_mode === 'BLEND_MASKED' && m.shading_model === 'MSM_DEFAULT_LIT' && m.two_sided === true
      && m.used_with_niagara_sprites === true && m.used_with_nanite === false && m.used_with_niagara_ribbons === false,
    m ? `${m.blend_mode}; ${m.shading_model}; two_sided ${m.two_sided}; sprites ${m.used_with_niagara_sprites}; nanite ${m.used_with_nanite}; ribbons ${m.used_with_niagara_ribbons}` : 'no entry');
  const mi = a[PATHS.instance];
  add('asset: an instance reads its parent and parameter', 'the instance reads its parent path (the material) and Opacity 0.5',
    mi?.status === 'found' && mi.class === 'MaterialInstanceConstant' && String(mi.parent ?? '').includes(PATHS.material) && mi.scalar_parameters?.Opacity === 0.5,
    mi ? `parent ${mi.parent}; scalars ${JSON.stringify(mi.scalar_parameters)}` : 'no entry');
  const sys = a[PATHS.system];
  add('asset: a Niagara system path is unavailable', 'a Niagara system path is unavailable for this probe (it describes meshes, materials and instances only)',
    sys?.status === 'unavailable', sys ? `${sys.status}: ${sys.reason}` : 'no entry');

  // ---- the launcher with a script that does not parse ------------------------------------------------------------------------------------
  const message = String(broken?.stderr ?? '');
  add('launcher: a script that cannot parse leaves no report and a clear message', 'the launcher exits 1 with "wrote no report", the editor "exited with code 0" and the editor log path, and no report file exists',
    broken?.exit === 1 && broken.report === undefined && /wrote no report/.test(message) && /exited with code 0/.test(message) && /Editor log: \S/.test(message),
    `exit ${broken?.exit}; report ${broken?.report === undefined ? 'absent' : 'present'}; ${first(message) || 'stderr is empty'}`);

  // ---- observations: recorded, never judged ---------------------------------------------------------------------------------------------
  const lifetimes = ['Dust', 'Motes'].map((e) => ({ e, item: inputNamed(initializeParticle(ns, e), 'Lifetime') })).filter((x) => x.item);
  add('observe: the template Lifetime input', 'the kind and value of the input named Lifetime in InitializeParticle (an earlier run saw NiagaraExt_StackInputData_Unsupported with an empty value)',
    lifetimes.length > 0, lifetimes.length ? lifetimes.map(({ e, item }) => `${e}: ${kindOf(item)} ${JSON.stringify(item.value?.value ?? null)}`).join('; ') : 'no input named Lifetime found', true);
  add('observe: script stacks per emitter', 'the script stack names the topology returns for each emitter', stackNames('Dust').length > 0 && stackNames('Motes').length > 0,
    `Dust ${JSON.stringify(stackNames('Dust'))}; Motes ${JSON.stringify(stackNames('Motes'))}`, true);
  add('observe: problems the system read lists', 'the errors behind any "unavailable" part of the system entry (an earlier run listed none for a clean system)', Array.isArray(ns?.problems),
    Array.isArray(ns?.problems) ? `${ns.problems.length}: ${JSON.stringify(ns.problems).slice(0, 300)}` : 'no problems array', true);
  add('observe: nearby names of the missing callable', 'the nearby names listed for EditorAssetLibrary.save_assets', Array.isArray(gone?.nearby), JSON.stringify(gone?.nearby ?? null), true);
  const secs = [['doc', doc], ['system', system], ['asset', asset], ['broken', broken]].map(([n, r]) => `${n} ${r?.seconds ?? '?'} s`);
  add('observe: launcher seconds', 'seconds each launcher run took (an earlier run took 14 to 18 s once the editor had started once, the first about 60 to 80 s)',
    [doc, system, asset].every((r) => Number.isFinite(r?.seconds)), secs.join('; '), true);
  return checks;
}

export function summarize(checks) {
  const asserted = checks.filter((c) => !c.observe);
  const observed = checks.filter((c) => c.observe);
  return { passed: asserted.filter((c) => c.pass).length, total: asserted.length, observed: observed.length, observedRecorded: observed.filter((c) => c.pass).length };
}
