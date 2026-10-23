// node --test examples/unreal/constructor_locks/constructor-locks.test.mjs  (no Unreal, no dependencies)
// The runs below have the shape constructor_locks.mjs collected on Unreal 5.8.2. Each test changes one fact and expects the matching
// check to fail, so the judge cannot pass by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize, outcome, allRefused, allAllowed, deleteError, CTOR, RUNTIME } from './constructor-locks-checks.mjs';

const OPS = ['open_for_write', 'rename_and_back', 'overwrite', 'delete'];
const SHARING = "[WinError 32] The process cannot access the file because it is being used by another process: 'x'";
const DENIED = "[Errno 13] Permission denied: 'x'";
const tries = (locked) => [...CTOR, ...RUNTIME].flatMap((file) => OPS.map((op) => (locked.includes(file)
  ? { file, op, ok: false, error_type: 'PermissionError', error_text: op === 'delete' || op === 'rename_and_back' ? SHARING : DENIED }
  : { file, op, ok: true })));
const hold = (loadedAtStart) => ({ classes_found: { LockCtorActor: true, LockPostActor: true, LockSoftActor: true }, loaded_at_start: { ...loadedAtStart } });
const start = { M_Ctor: true, SM_Ctor: true, M_Post: false, SM_Post: false, M_Soft: false, SM_Soft: false };
const ranLog = 'LogLockProbe: Display: LockPost PostInitializeComponents mesh=loaded material=loaded\nLogLockProbe: Display: LockSoft PostInitializeComponents mesh=loaded material=loaded';
const good = () => ({
  build: { exit: 0, log: 'Result: Succeeded' },
  setup: { assets: Array.from({ length: 6 }, (_, i) => ({ path: `/Game/Lock/A${i}`, saved: true })) },
  runs: {
    control: { tries: tries([]) },
    loaded: { hold: hold(start), tries: tries(CTOR), log: '' },
    spawned: { hold: hold(start), tries: tries(CTOR), log: '' },
    played: { hold: hold(start), tries: tries([...CTOR, ...RUNTIME]), log: ranLog },
    ended: { hold: hold(start), tries: tries([...CTOR, ...RUNTIME]), log: ranLog },
  },
});
const failedNames = (input) => evaluate(input).filter((c) => !c.pass).map((c) => c.name);

test('every check passes on the 5.8.2 shaped results', () => {
  assert.deepEqual(failedNames(good()), []);
  assert.deepEqual(summarize(evaluate(good())), { passed: 11, total: 11 });
});

test('helpers count refused and allowed tries and quote the delete error without the path', () => {
  const t = tries(CTOR);
  assert.equal(outcome(t, CTOR).refused.length, 8);
  assert.equal(allRefused(t, CTOR), true);
  assert.equal(allAllowed(t, RUNTIME), true);
  assert.equal(allAllowed(t, CTOR), false);
  assert.equal(deleteError(t, CTOR), 'PermissionError: [WinError 32] The process cannot access the file because it is being used by another process');
  assert.equal(deleteError(tries([]), CTOR), undefined);
  assert.equal(allRefused([], CTOR), false);
});

test('each check fails when its fact changes', () => {
  let g = good(); g.build.exit = 1;
  assert.deepEqual(failedNames(g), ['module compiles']);
  g = good(); g.runs.control.tries = tries(CTOR);
  assert.deepEqual(failedNames(g), ['control: no editor']);
  g = good(); g.runs.loaded.tries = tries(['M_Ctor.uasset']);
  assert.deepEqual(failedNames(g), ['constructor-loaded assets are locked']);
  g = good(); g.runs.loaded.tries = tries([...CTOR, 'M_Post.uasset']);
  assert.deepEqual(failedNames(g), ['runtime-loaded assets are free']);
  g = good(); g.runs.loaded.tries = tries(CTOR).map((t) => ({ ...t, error_text: DENIED }));
  assert.deepEqual(failedNames(g), ['windows error text']);
  g = good(); g.runs.loaded.hold.loaded_at_start.M_Soft = true;
  assert.deepEqual(failedNames(g), ['constructor-loaded assets are in memory']);
  g = good(); g.runs.spawned.log = ranLog;
  assert.deepEqual(failedNames(g), ['editor-world spawn does not load runtime assets']);
  g = good(); g.runs.played.tries = tries(CTOR);
  assert.deepEqual(failedNames(g), ['play session locks runtime-loaded assets']);
  g = good(); g.runs.ended.tries = tries(CTOR);
  assert.deepEqual(failedNames(g), ['locks outlive the play session']);
  g = good(); g.setup.assets[3].saved = false;
  assert.deepEqual(failedNames(g), ['assets created']);
});

test('missing runs fail their checks instead of throwing', () => {
  const g = good(); g.runs = {};
  assert.ok(failedNames(g).length >= 8);
  assert.doesNotThrow(() => evaluate({}));
});
