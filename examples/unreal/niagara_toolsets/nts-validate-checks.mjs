// Pure checks for nts_validate.mjs: turn the JSON reports, progress notes, exit codes and log text of the Niagara toolset scripts into
// pass or fail results, one per claim in skills/unreal-effects/references/unreal-niagara-toolsets.md. No Unreal, no files:
// nts-validate.test.mjs feeds it canned reports, and nts_validate.mjs feeds it real ones.

const has = (text, pattern) => pattern.test(String(text || ''));
const step = (report, name) => ((report || {}).steps || []).find((s) => s.step === name) || {};
const note = (notes, name) => (notes || []).find((n) => n.note === name);
const finished = (notes) => (notes || []).some((n) => n.note === 'done');

/**
 * @param {{ author?: object, readback?: object, authorLog?: string, startup?: object, startupLog?: string, startupExit?: number|null,
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
    String(input.unknown_input_error || '').split('\n')[0].slice(0, 160));
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
