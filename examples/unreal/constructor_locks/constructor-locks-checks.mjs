// Judges the runs that constructor_locks.mjs collects. Pure functions, no Unreal and no dependencies; the node test feeds them results
// shaped like the ones lock_hold.py and lock_try.py produced on Unreal 5.8.2.
//   run = { hold: report of lock_hold.py, tries: [{ file, op, ok, error_type?, error_text? }], log: editor log text }.

export const CTOR = ['M_Ctor.uasset', 'SM_Ctor.uasset'];
export const RUNTIME = ['M_Post.uasset', 'SM_Post.uasset', 'M_Soft.uasset', 'SM_Soft.uasset'];
const OPS = ['open_for_write', 'rename_and_back', 'overwrite', 'delete'];

/** Tries on `files` that Windows refused (ok === false) and tries that worked, per operation. */
export function outcome(tries, files) {
  const mine = (tries ?? []).filter((t) => files.includes(t.file));
  return { refused: mine.filter((t) => t.ok === false), allowed: mine.filter((t) => t.ok === true), count: mine.length };
}

/** True when every operation on every file was refused. */
export function allRefused(tries, files) {
  const o = outcome(tries, files);
  return o.count === files.length * OPS.length && o.refused.length === o.count;
}

/** True when every operation on every file succeeded. */
export function allAllowed(tries, files) {
  const o = outcome(tries, files);
  return o.count === files.length * OPS.length && o.allowed.length === o.count;
}

/** The refusal text of the delete try (the first file in `files` that was refused). */
export function deleteError(tries, files) {
  const t = (tries ?? []).find((x) => files.includes(x.file) && x.op === 'delete' && x.ok === false);
  return t ? `${t.error_type}: ${String(t.error_text).replace(/: '.*$/, '')}` : undefined;
}

const WINDOWS_SHARING = /WinError 32\] The process cannot access the file because it is being used by another process/;

export function evaluate({ build, setup, runs }) {
  const { control, loaded, spawned, played, ended } = runs ?? {};
  const checks = [];
  checks.push({ name: 'module compiles', claim: 'UBT builds the editor target with the LockProbe module',
    pass: build?.exit === 0 && /Result: Succeeded/.test(build?.log ?? ''), detail: `exit ${build?.exit}` });
  checks.push({ name: 'assets created', claim: 'lock_setup.py saves six assets (a material and a static mesh for each actor)',
    pass: (setup?.assets ?? []).length === 6 && setup.assets.every((a) => a.saved === true), detail: `${(setup?.assets ?? []).filter((a) => a.saved).length} of ${(setup?.assets ?? []).length} saved` });
  checks.push({ name: 'control: no editor', claim: 'with no editor open every open, rename, overwrite and delete of the six files succeeds',
    pass: allAllowed(control?.tries, [...CTOR, ...RUNTIME]), detail: `${outcome(control?.tries, [...CTOR, ...RUNTIME]).allowed.length} of 24 allowed` });
  checks.push({ name: 'classes visible', claim: 'the three actor classes are loaded in the editor and visible to Python',
    pass: !!loaded?.hold && Object.values(loaded.hold.classes_found ?? {}).length === 3 && Object.values(loaded.hold.classes_found).every(Boolean), detail: JSON.stringify(loaded?.hold?.classes_found) });
  checks.push({ name: 'constructor-loaded assets are in memory', claim: 'the editor has loaded the ConstructorHelpers assets at startup and not the others',
    pass: !!loaded?.hold && CTOR.every((f) => loaded.hold.loaded_at_start?.[f.replace('.uasset', '')] === true) && RUNTIME.every((f) => loaded.hold.loaded_at_start?.[f.replace('.uasset', '')] === false),
    detail: JSON.stringify(loaded?.hold?.loaded_at_start) });
  checks.push({ name: 'constructor-loaded assets are locked', claim: 'with the editor open and no actor spawned, all four operations on the ConstructorHelpers assets are refused',
    pass: allRefused(loaded?.tries, CTOR), detail: `${outcome(loaded?.tries, CTOR).refused.length} of 8 refused` });
  checks.push({ name: 'windows error text', claim: 'a refused delete or rename reports WinError 32 (PermissionError): the file is being used by another process',
    pass: WINDOWS_SHARING.test(JSON.stringify((loaded?.tries ?? []).filter((t) => t.op === 'delete' && t.ok === false).map((t) => t.error_text))), detail: deleteError(loaded?.tries, CTOR) ?? 'no refused delete' });
  checks.push({ name: 'runtime-loaded assets are free', claim: 'LoadObject in PostInitializeComponents and soft references resolved at runtime leave their files free while no actor has initialised',
    pass: allAllowed(loaded?.tries, RUNTIME), detail: `${outcome(loaded?.tries, RUNTIME).allowed.length} of 16 allowed` });
  checks.push({ name: 'editor-world spawn does not load runtime assets', claim: 'actors spawned in the editor world run no PostInitializeComponents, so the runtime-loaded files stay free',
    pass: !!spawned?.hold && allAllowed(spawned.tries, RUNTIME) && allRefused(spawned.tries, CTOR) && !/LockPost PostInitializeComponents|LockSoft PostInitializeComponents/.test(spawned.log ?? ''),
    detail: `runtime allowed ${outcome(spawned?.tries, RUNTIME).allowed.length} of 16, constructor refused ${outcome(spawned?.tries, CTOR).refused.length} of 8` });
  const ran = (r) => /LockPost PostInitializeComponents mesh=loaded material=loaded/.test(r?.log ?? '') && /LockSoft PostInitializeComponents mesh=loaded material=loaded/.test(r?.log ?? '');
  checks.push({ name: 'play session locks runtime-loaded assets', claim: 'once Play-In-Editor has run PostInitializeComponents the runtime-loaded files are refused too',
    pass: ran(played) && allRefused(played?.tries, [...CTOR, ...RUNTIME]), detail: `ran=${ran(played)} refused ${outcome(played?.tries, [...CTOR, ...RUNTIME]).refused.length} of 24` });
  checks.push({ name: 'locks outlive the play session', claim: 'after Play-In-Editor ends and garbage is collected the six files are still refused',
    pass: ran(ended) && allRefused(ended?.tries, [...CTOR, ...RUNTIME]), detail: `refused ${outcome(ended?.tries, [...CTOR, ...RUNTIME]).refused.length} of 24` });
  return checks;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}
