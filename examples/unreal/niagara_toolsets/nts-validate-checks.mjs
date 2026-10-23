// Pure checks for nts_validate.mjs: turn the JSON reports, progress notes, exit codes and log text of the Niagara toolset scripts into
// pass or fail results, one per claim in skills/unreal-effects/references/unreal-niagara-toolsets.md. No Unreal, no files:
// nts-validate.test.mjs feeds it canned reports, and nts_validate.mjs feeds it real ones.

const has = (text, pattern) => pattern.test(String(text || ''));
const step = (report, name) => ((report || {}).steps || []).find((s) => s.step === name) || {};
const note = (notes, name) => (notes || []).find((n) => n.note === name);
const finished = (notes) => (notes || []).some((n) => n.note === 'done');

/**
 * @param {{ author?: object, readback?: object, issues?: object, authorLog?: string, startup?: object, startupLog?: string, startupExit?: number|null,
 *           notes?: Record<string, object[]>, exits?: Record<string, number|null>, logs?: Record<string, string> }} r
 *   notes, exits and logs are keyed by phase: make, same_process, stale, rescan_only, remove_rescan
 * @returns {{ name: string, claim: string, pass: boolean, detail: string }[]}
 */
export function evaluate(r) {
  const author = r.author || {}, back = r.readback || {}, notes = r.notes || {}, exits = r.exits || {}, logs = r.logs || {};
  const out = [];
  const check = (name, claim, pass, detail = '') => out.push({ name, claim, pass: Boolean(pass), detail: String(detail) });

  // call shapes
  const create = step(author, 'create'), added = step(author, 'add_emitters'), input = step(author, 'stack_input'), renderer = step(author, 'renderer');
  check('the toolset registers and the log shows no startup traceback',
    'is_toolset_registered is True with NiagaraToolsets enabled; no AgentSkill traceback appeared at startup on 5.8.2 (not reproduced)',
    author.toolset_registered === true && author.agent_skill_class === true && !has(r.authorLog, /Traceback|AttributeError|has no attribute 'AgentSkill'/),
    `registered ${author.toolset_registered}, unreal.AgentSkill ${author.agent_skill_class}, ${author.system_tool_count} tools`);
  const registered = String(r.authorLog || '').indexOf('Registering Toolset NiagaraToolsets.NiagaraToolset_System');
  const skillScript = String(r.authorLog || '').indexOf('NiagaraToolsets/Content/Python/init_unreal.py');
  check('init_unreal.py registers seven skills, and the tools register before it runs',
    'ListSkills names seven NiagaraToolsets skills; the log shows the C++ toolset registering before the Python start-up script',
    (author.niagara_skills || []).length === 7 && (author.niagara_skills || []).includes('NiagaraFundamentalsSkill') && registered >= 0 && skillScript > registered,
    `${(author.niagara_skills || []).length} skills, registration at ${registered}, start-up script at ${skillScript}`);
  const startup = r.startup || {}, errorAt = String(r.startupLog || '').search(/LogPython: Error: AttributeError: /);
  const laterScripts = errorAt < 0 ? -1 : (String(r.startupLog).slice(errorAt).match(/Running start-up script .*init_unreal\.py\.\.\. took/g) || []).length;
  check('a start-up script that raises is logged and does not stop other Python',
    'The traceback is a LogPython error; later init_unreal.py files and the commandlet script run, the toolset registers and answers, and the exit code is 1',
    errorAt >= 0 && laterScripts >= 2 && startup.registered === true && startup.call_complete === true && startup.call_error === ''
      && JSON.stringify(startup.emitters) === JSON.stringify(['Dust', 'Motes']) && r.startupExit === 1,
    `${laterScripts} start-up scripts finished after the error, registered ${startup.registered}, exit ${r.startupExit}`);
  check('a system is created with the factory and gets two emitters from Epic templates',
    'NiagaraSystemFactoryNew makes an empty system; AddEmitter takes {"refPath"} refs and returns the emitter topology',
    create.system === true && (create.emitters || []).length === 0 && JSON.stringify(added.emitters) === JSON.stringify(['Dust', 'Motes'])
      && Object.values(added.added || {}).every((a) => a.error === '' && (a.topology_keys || []).includes('particleSpawnScript')),
    `empty: ${JSON.stringify(create.emitters)}, then ${JSON.stringify(added.emitters)}`);
  check('a stack input is read, changed and written back',
    'GetStackInputData returns {struct, value}; changing value and calling SetStackInputData stores it',
    input.get_error === '' && input.set_error === '' && JSON.stringify(input.value_keys) === JSON.stringify(['struct', 'value'])
      && input.struct && input.struct.refPath === '/Script/Niagara.NiagaraFloat' && input.before === 5 && input.after === 2.5,
    `${input.struct && input.struct.refPath}: ${input.before} -> ${input.after}`);
  check('a color input and an enum input have their own value shapes',
    'A color is {r, g, b, a} under /Script/CoreUObject.LinearColor; an enum is NiagaraExt_StackInputData_Enum with enum, enumName and displayName',
    input.color_struct && input.color_struct.refPath === '/Script/CoreUObject.LinearColor' && JSON.stringify(Object.keys(input.color_value || {})) === JSON.stringify(['r', 'g', 'b', 'a'])
      && input.enum_struct && input.enum_struct.refPath === '/Script/NiagaraEditor.NiagaraExt_StackInputData_Enum'
      && JSON.stringify(input.enum_keys) === JSON.stringify(['displayName', 'enum', 'enumName']),
    `${input.color_struct && input.color_struct.refPath}; ${input.enum_struct && input.enum_struct.refPath} ${JSON.stringify(input.enum_keys)}`);
  check('an unknown input name is reported as an error',
    'A stack-input ref with a name the module lacks returns an error string',
    input.unknown_input_complete === true && typeof input.unknown_input_error === 'string' && input.unknown_input_error.length > 0,
    String(input.unknown_input_error || ''));
  check('SetRendererData takes propertyValues as a JSON string',
    'A string sets Material and SubImageSize; an object in its place returns no error and changes nothing',
    renderer.object_error === '' && renderer.after_object && renderer.after_object.refPath === (renderer.default_material || {}).refPath
      && renderer.string_error === '' && renderer.after_string && renderer.after_string.refPath === (renderer.wanted || {}).refPath
      && renderer.sub_image_size && renderer.sub_image_size.x === 4 && renderer.sub_image_size.y === 4,
    `default ${(renderer.default_material || {}).refPath}; after object ${(renderer.after_object || {}).refPath}; after string ${(renderer.after_string || {}).refPath}`);
  check('the edits survive a save and a new process',
    'Emitters, the edited input and the renderer material are read back from disk',
    JSON.stringify(back.emitters) === JSON.stringify(['Dust', 'Motes']) && back.lifetime_min === 2.5
      && back.material && back.material.refPath === '/Game/FX/M_Worked.M_Worked' && back.sub_image_size && back.sub_image_size.x === 4,
    `${JSON.stringify(back.emitters)}, lifetime ${back.lifetime_min}, material ${(back.material || {}).refPath}`);

  // bound inputs, hidden inputs, local space, sort order, ribbon material, template emitters
  const bound = step(author, 'bound_inputs'), hidden = step(author, 'hidden_input'), local = step(author, 'local_space'), hints = step(author, 'renderer_hints');
  const templates = step(author, 'templates').made || {}, linked = back.linked || {}, audit = back.audit || {};
  const LINKED = '/Script/NiagaraEditor.NiagaraExt_StackInputData_Linked', DYNAMIC = 'NiagaraExt_StackInputData_DynamicInput';
  const floatOf = (data, value, kind = 'NiagaraFloat') => Boolean(data) && data.struct && data.struct.refPath === `/Script/Niagara.${kind}` && data.value && data.value.value === value;
  const wrote = (r, was, value) => Boolean(r) && r.ok === true && r.error === '' && r.was === was && r.kind === 'NiagaraFloat' && r.value === value;
  check('a linked input is replaced as a whole, not edited in place',
    'Adding a key to a linked value changes nothing and replacing the value empties the link (Module.None), both without an error; the type with its value stores the number',
    bound.linked_before === 'Emitter.CurrentLoopDuration' && bound.add_key_error === '' && bound.add_key_kind === 'NiagaraExt_StackInputData_Linked'
      && bound.add_key_link === 'Emitter.CurrentLoopDuration' && bound.emptied_error === '' && bound.emptied_is_empty === true && bound.emptied_link === 'Module.None'
      && wrote(bound.helper_lifetime, 'NiagaraExt_StackInputData_Linked', 3),
    `linked to ${bound.linked_before}; after a key: ${bound.add_key_link}; after a replaced value: ${bound.emptied_link}; whole: ${JSON.stringify(bound.helper_lifetime)}`);
  check('a dynamic input is replaced as a whole, not edited in place',
    'Editing the value of a dynamic input is accepted and ignored; replacing the data with the input\'s type and a value stores the value',
    bound.dynamic_error === '' && bound.dynamic_kind === DYNAMIC && wrote(bound.helper_width, DYNAMIC, 12),
    `after the in-place edit: ${bound.dynamic_kind}; whole: ${JSON.stringify(bound.helper_width)}`);
  const problem = (emitter, text) => (audit.NS_Broken || []).some((p) => p.emitter === emitter && p.module === 'InitializeParticle' && /^Lifetime/.test(p.input) && text.test(p.problem));
  check('the read-back audit flags an empty link and a zero lifetime and passes the clean systems',
    'GetEmitterInputValues shows a linked input as Module.None and a lifetime of 0; systems written as a whole report no problem and keep the stored values',
    JSON.stringify(audit.NS_Worked) === '[]' && JSON.stringify(audit.NS_Linked) === '[]' && problem('OrbEmpty', /^empty link: Module\.None/) && problem('OrbZero', /^lifetime reads 0$/)
      && (audit.NS_Broken || []).length === 2 && bound.zero_lifetime && bound.zero_lifetime.ok === true && floatOf(linked.lifetime, 3) && floatOf(linked.beam_width, 12),
    `worked ${JSON.stringify(audit.NS_Worked)}, linked ${JSON.stringify(audit.NS_Linked)}, broken ${(audit.NS_Broken || []).map((p) => `${p.emitter}: ${p.problem}`).join('; ')}`);
  check('a hidden input is refused and the message names the refused input, not the gating one',
    'Setting Color while Color Mode is Unset returns "Refusing to set input \'Color\'" with no value; Color Mode is a visible static switch; setting it first lets the colour be written',
    hidden.color_visible === false && hidden.mode_is_static_switch === true && hidden.refused_ok === false
      && /^Refusing to set input 'Color': input is hidden by static-switch \/ conditional logic and is not currently part of the executing graph\. Adjust the parent switch first\.$/.test(hidden.refused_error || '')
      && !/Color Mode/.test(hidden.refused_error || '') && hidden.flip_error === '' && hidden.painted_ok === true && hidden.painted_value && hidden.painted_value.g > 0.19 && hidden.painted_value.g < 0.21,
    String(hidden.refused_error || ''));
  check('an input hidden by a visible condition is refused until its gating input is flipped',
    'Loop Duration on an emitter whose Life Cycle Mode is System is refused with a VisibleCondition message; after Life Cycle Mode is set to Self the value is stored',
    hidden.duration_visible === false && /^Refusing to set input 'Loop Duration': its VisibleCondition currently evaluates false\./.test(hidden.duration_error || '')
      && hidden.cycle_error === '' && hidden.duration_ok === true && hidden.duration_value && hidden.duration_value.value === 6,
    String(hidden.duration_error || ''));
  check('SetEmitterData switches an emitter to local space with emitter and emitterData',
    'Every template emitter starts in world space; the argument names are emitter and emitterData; propertyValues must be a JSON string',
    Object.keys(templates).length === 14 && Object.values(templates).every((t) => t.local_space === false)
      && local.before === false && /^Function "SetEmitterData", input param "emitter" is required/.test(local.wrong_name_error || '') && local.after_wrong === false
      && local.object_error === '' && local.after_object === false && local.string_error === '' && local.after_string === true,
    `${Object.keys(templates).length} templates, before ${local.before}, wrong name: ${String(local.wrong_name_error || '').split('\n')[0]}, object ${local.after_object}, string ${local.after_string}`);
  check('SortOrderHint is a renderer property on sprite and ribbon renderers',
    'SetRendererData with propertyValues {"SortOrderHint": N} stores N (default 0) on a sprite renderer and on a ribbon renderer',
    hints.sort_before === 0 && hints.sort_sprite_error === '' && hints.sort_sprite_after === 7 && hints.sort_ribbon_error === '' && hints.sort_ribbon_after === 3 && linked.orb_sort === 7 && linked.beam_sort === 3,
    `sprite ${hints.sort_before} -> ${hints.sort_sprite_after}, ribbon -> ${hints.sort_ribbon_after}`);
  const flags = hints.flags_flagged || {}, bare = hints.flags_default || {};
  check('a ribbon renderer takes a material with its own usage flag',
    'used_with_niagara_ribbons is a separate material property from used_with_niagara_sprites, false on a new material; SetRendererData stores either material on the ribbon renderer',
    flags.used_with_niagara_ribbons === true && flags.used_with_niagara_sprites === false && bare.used_with_niagara_ribbons === false && bare.used_with_niagara_sprites === false
      && hints.ribbon_material && hints.ribbon_material.refPath === '/Game/FX/M_Beam.M_Beam' && hints.flagless_error === ''
      && hints.flagless_material && hints.flagless_material.refPath === '/Game/FX/M_NoFlag.M_NoFlag' && linked.beam_material && linked.beam_material.refPath === '/Game/FX/M_Beam.M_Beam',
    `flagged ${JSON.stringify(flags)}, new material ${JSON.stringify(bare)}`);
  const results = (r.issues || {}).results || {}, issuesOf = (name) => (((results[name] || {}).GetStackIssues || {}).value || {}), compileOf = (name) => (((results[name] || {}).GetSystemCompileState || {}).value || {});
  const found = (name, severity) => (issuesOf(name).issues || []).filter((i) => i.severity === severity);
  const broken = found('NS_Broken', 'Error')[0] || {}, flagWarning = found('NS_Broken', 'Warning')[0] || {};
  const emptyScript = (compileOf('NS_Broken').scripts || []).find((x) => x.emitterName === 'OrbEmpty' && x.lastCompileStatus === 'Error') || {};
  check('the editor tick reports an emptied link and a ribbon material without its flag',
    'GetStackIssues and GetSystemCompileState report a compile error for the emptied link, a warning that names the material lacking the usage flag on the Ribbon renderer, and nothing for the systems written as a whole',
    issuesOf('NS_Linked').numErrors === 0 && issuesOf('NS_Linked').numWarnings === 0 && compileOf('NS_Linked').aggregateStatus === 'UpToDate'
      && issuesOf('NS_Broken').numErrors === 1 && broken.location && broken.location.emitterName === 'OrbEmpty' && /compile errors/.test(broken.shortDescription || '')
      && /InitializeParticle\.Lifetime/.test(emptyScript.errorSummary || '') && compileOf('NS_Broken').aggregateStatus === 'Error'
      && issuesOf('NS_Broken').numWarnings === 1 && flagWarning.location && flagWarning.location.emitterName === 'BeamNoFlag' && flagWarning.stackDisplayPath === '/Render/Ribbon Renderer'
      && /^Some materials 'M_NoFlag' do not have the correct usage flags set, and will use the default material\.$/.test(flagWarning.longDescription || ''),
    `NS_Linked ${issuesOf('NS_Linked').numErrors} errors, ${issuesOf('NS_Linked').numWarnings} warnings; NS_Broken: ${broken.shortDescription} (${(broken.location || {}).emitterName}); ${flagWarning.longDescription}`);
  const t = (name) => templates[name] || {}, spawns = (name) => (t(name).spawn_modules || []).join(',');
  check('the template emitters cover the effects the templates reference names',
    'SingleLoopingParticle is one sprite per loop with its lifetime linked to the loop duration; OmnidirectionalBurst a burst; StaticBeam a ribbon beam; Fountain a continuous spawn rate; LocationBasedRibbon a ribbon with no spawn module',
    t('SingleLoopingParticle').renderer === 'NiagaraSpriteRendererProperties' && t('SingleLoopingParticle').burst_count === 1 && t('SingleLoopingParticle').lifetime_link === 'Emitter.CurrentLoopDuration'
      && t('SingleLoopingParticle').loop_behavior === 'Once' && spawns('SingleLoopingParticle') === 'SpawnBurst_Instantaneous'
      && t('OmnidirectionalBurst').burst_count === 100 && spawns('OmnidirectionalBurst') === 'SpawnBurst_Instantaneous'
      && t('StaticBeam').renderer === 'NiagaraRibbonRendererProperties' && t('StaticBeam').loop_behavior === 'Infinite' && spawns('StaticBeam') === 'SpawnBurst_Instantaneous,SpawnBeam'
      && t('Fountain').renderer === 'NiagaraSpriteRendererProperties' && spawns('Fountain') === 'SpawnRate' && t('Fountain').loop_behavior === 'Infinite'
      && t('LocationBasedRibbon').renderer === 'NiagaraRibbonRendererProperties' && spawns('LocationBasedRibbon') === ''
      && t('SingleLoopingParticle').description === 'Emits a single particle whose lifetime is linked to emitter loop duration' && t('Fountain').spawn_rate === 90
      && t('StaticBeam').beam_start === 'SimulationPosition' && JSON.stringify(t('StaticBeam').beam_end) === JSON.stringify({ x: 200, y: 0, z: 0 })
      && (t('DynamicBeam').modules || []).includes('UpdateBeam') && !(t('StaticBeam').modules || []).includes('UpdateBeam') && (t('RecycleParticlesInView').modules || []).includes('ViewRecycler'),
    ['SingleLoopingParticle', 'OmnidirectionalBurst', 'StaticBeam', 'Fountain', 'LocationBasedRibbon'].map((n) => `${n}: ${(t(n).renderer || '').replace(/Niagara|RendererProperties/g, '')} [${spawns(n)}]`).join('; '));

  // delete and recreate
  const same = notes.same_process || [], stale = notes.stale || [], rescan = notes.rescan_only || [], fixed = notes.remove_rescan || [];
  const crashed = (phase) => exits[phase] !== 0 && has(logs[phase], /EXCEPTION_ACCESS_VIOLATION/) && !finished(notes[phase]);
  const deleteLine = (n) => { const d = note(n, 'delete_asset') || {}; return `delete_asset ${d.returned}, file on disk ${d.file_on_disk}, registry ${d.registry_has_it}`; };
  check('a system made and saved in this process is deleted and recreated without a crash',
    'In one process delete_asset removes the file and the registry entry, and a new system at the same path saves',
    exits.same_process === 0 && finished(same) && (note(same, 'delete_asset') || {}).file_on_disk === false && (note(same, 'delete_asset') || {}).registry_has_it === false
      && (note(same, 'save_asset') || {}).returned === true,
    `${deleteLine(same)}, exit ${exits.same_process}`);
  check('delete_asset on a system saved by an earlier process leaves the file',
    'delete_asset returns True but the .uasset and the registry entry remain',
    (note(stale, 'start') || {}).on_disk === true && (note(stale, 'delete_asset') || {}).returned === true
      && (note(stale, 'delete_asset') || {}).file_on_disk === true && (note(stale, 'delete_asset') || {}).registry_has_it === true,
    deleteLine(stale));
  check('creating over the left-over file and saving crashes the editor',
    'CreateNiagaraSystem and AddEmitter succeed, then save_asset ends the process with an access violation',
    (note(stale, 'create') || {}).result === 'ok' && (note(stale, 'add_emitter') || {}).result === 'ok' && !note(stale, 'save_asset') && crashed('stale'),
    `exit ${exits.stale}, last note ${(stale[stale.length - 1] || {}).note}`);
  check('a rescan without removing the file still crashes',
    'scan_paths_synchronous alone does not clear the left-over system',
    (note(rescan, 'rescanned') || {}).registry_has_it === true && !note(rescan, 'save_asset') && crashed('rescan_only'),
    `exit ${exits.rescan_only}, registry after rescan ${(note(rescan, 'rescanned') || {}).registry_has_it}`);
  check('removing the file and rescanning lets the new system be created and saved',
    'Delete the file, scan_paths_synchronous, then create: the system saves and the process exits 0',
    (note(fixed, 'rescanned') || {}).registry_has_it === false && (note(fixed, 'create') || {}).result === 'ok'
      && (note(fixed, 'save_asset') || {}).returned === true && finished(fixed) && exits.remove_rescan === 0,
    `${deleteLine(fixed)}, rescan registry ${(note(fixed, 'rescanned') || {}).registry_has_it}, exit ${exits.remove_rescan}`);
  return out;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}
