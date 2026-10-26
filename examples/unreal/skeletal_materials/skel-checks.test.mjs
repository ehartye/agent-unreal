// node --test examples/unreal/skeletal_materials/skel-checks.test.mjs  (no Unreal, no dependencies)
// The reports below follow what skel_probe.py wrote on Unreal 5.8.2: the engine skeletal cube has one slot named MaterialSlot with no material
// (an empty path) and an imported name of None; the element edit changes nothing; the assign-back changes memory and dirties the package; the
// C++ function persists. Each test changes one fact and expects the matching check to fail, and an empty report fails everything that reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize, parseMaterialsTag, sameSlots, MESH_NAMES } from './skel-checks.mjs';

const ORIGINAL = '';
const RED = '/Game/Skel/M_ProbeRed.M_ProbeRed';
const BLUE = '/Game/Skel/M_ProbeBlue.M_ProbeBlue';
const row = (name, material, imported = 'None') => ({ name, material, imported_name: imported });
const one = (material) => [row('MaterialSlot', material)];
const padded = [row('MaterialSlot', ORIGINAL), row('ProbeSlot1', ORIGINAL)];
const tagOf = (rows) => rows.map((r) => `${r.name},'${r.material}'>`).join('');
const mesh = (slots) => ({ class: 'SkeletalMesh', slots, registry: { route: 'get_asset_by_object_path', raw: "(True, '...')", value: tagOf(slots) } });

const good = () => ({
  build: { exit: 0, log: 'Result: Succeeded' },
  author: {
    log: "LogSkeletalMaterialsBridge: Error: SetSkeletalMeshMaterials: /Game/Skel/SK_Two.SK_Two has 2 material slots and 3 materials were given",
    report: {
      mode: 'author', errors: [], bridge: { class_found: true, members: ['set_skeletal_mesh_materials'] },
      steps: {
        materials: {
          red: { path: RED, class: 'Material', compile_errors: [], stats: { pixel_instructions: 8, vertex_instructions: 20 }, saved: true },
          blue: { path: BLUE, class: 'Material', compile_errors: [], stats: { pixel_instructions: 8, vertex_instructions: 20 }, saved: true },
        },
        SK_Element: { slots_before: one(ORIGINAL), raised: null, after: one(ORIGINAL), in_memory_changed: false, forced_save_file_changed: true },
        SK_Assign: { slots_before: one(ORIGINAL), raised: null, after: one(RED), in_memory_changed: true, dirty_after_set_1: true, default_save_1: true, file_changed_after_save_1: true, dirty_after_save_1: false, raised_again: null, dirty_after_set_2: true, default_save_2: true, file_changed_after_save_2: true, file_changed_by_save_2: true },
        SK_Control: { dirty_before_save: false, default_save: true, file_changed_after_default_save: false },
        SK_AssignForced: { slots_before: one(ORIGINAL), raised: null, after: one(RED), in_memory_changed: true, forced_save_file_changed: true },
        SK_Single: { slots_before: one(ORIGINAL), returned: true, after: one(RED), in_memory_changed: true, default_save: true, file_changed_after_default_save: true },
        SK_Two: {
          slots_before_padding: one(ORIGINAL), pad_raised: null, slots_padded: padded, refused_returned: false, slots_after_refusal: padded, returned: true,
          after: [row('MaterialSlot', RED), row('ProbeSlot1', BLUE)], default_save: true, file_changed_after_default_save: true,
        },
      },
    },
  },
  read: {
    log: '',
    report: {
      mode: 'read', errors: [],
      meshes: {
        SK_Element: mesh(one(ORIGINAL)), SK_Assign: mesh(one(RED)), SK_AssignForced: mesh(one(RED)), SK_Single: mesh(one(RED)),
        SK_Two: mesh([row('MaterialSlot', RED), row('ProbeSlot1', BLUE)]),
      },
      steps: { materials: { red: { exists: true, path: RED, class: 'Material' }, blue: { exists: true, path: BLUE, class: 'Material' } } },
    },
  },
});
const failing = (input) => evaluate(input).filter((c) => !c.pass).map((c) => c.name);
const mutate = (fn) => { const g = good(); fn(g); return g; };

test('every check passes on the outcomes of the 5.8.2 run', () => {
  assert.deepEqual(failing(good()), []);
  assert.deepEqual(summarize(evaluate(good())), { passed: 15, total: 15 });
});

test('the registry tag parser reads slot and material pairs and empty slots', () => {
  assert.deepEqual(parseMaterialsTag(tagOf(padded)), padded.map((r) => ({ name: r.name, material: r.material })));
  assert.deepEqual(parseMaterialsTag("Empty,''>"), [{ name: 'Empty', material: '' }]);
  assert.deepEqual(parseMaterialsTag(undefined), []);
  assert.equal(sameSlots(one(RED), one(RED)), true);
  assert.equal(sameSlots(one(RED), one(BLUE)), false);
  assert.equal(sameSlots(undefined, one(RED)), false);
  assert.equal(MESH_NAMES.length, 5);
});

test('a failed build fails the build check', () => {
  assert.ok(failing(mutate((g) => { g.build = { exit: 1, log: 'error C2065' }; })).includes('module compiles'));
});

test('a missing report fails what reads it without throwing', () => {
  const noAuthor = mutate((g) => { g.author = { report: undefined, log: '' }; g.read = { report: undefined, log: '' }; });
  const names = failing(noAuthor);
  assert.ok(names.includes('author process ran'));
  assert.ok(names.includes('read process ran'));
  assert.ok(names.includes('registry tag agrees with the slots'));
  const noRead = failing(mutate((g) => { g.read = { report: undefined, log: '' }; }));
  assert.ok(noRead.includes('read process ran'));
  assert.ok(!noRead.includes('author process ran'));
});

test('a fatal error or a script error fails the process check', () => {
  assert.deepEqual(failing(mutate((g) => { g.author.log += '\nFatal error: [File:Unknown]'; })), ['author process ran']);
  assert.ok(failing(mutate((g) => { g.read.report.errors = [{ step: 'load_SK_Two' }]; })).includes('read process ran'));
  assert.ok(failing(mutate((g) => { g.author.report.bridge.members = []; })).includes('author process ran'));
});

test('each Python-route check fails when its fact changes', () => {
  assert.deepEqual(failing(mutate((g) => { g.author.report.steps.SK_Element.slots_before = []; })), ['Python reads the slots', 'element edit changes nothing']);
  assert.deepEqual(failing(mutate((g) => { g.author.report.steps.SK_Element.in_memory_changed = true; })), ['element edit changes nothing']);
  assert.deepEqual(failing(mutate((g) => { g.read.report.meshes.SK_Element = mesh(one(RED)); })), ['element edit changes nothing']);
  assert.deepEqual(failing(mutate((g) => { g.author.report.steps.SK_Assign.after = one(ORIGINAL); g.author.report.steps.SK_Assign.in_memory_changed = false; })), ['assign-back sets the slots in memory']);
  const dirties = 'assign-back dirties the package';
  assert.deepEqual(failing(mutate((g) => { g.author.report.steps.SK_Assign.dirty_after_set_1 = false; })), [dirties]);
  assert.deepEqual(failing(mutate((g) => { g.author.report.steps.SK_Assign.file_changed_after_save_1 = false; })), [dirties]);
  assert.deepEqual(failing(mutate((g) => { g.author.report.steps.SK_Assign.dirty_after_set_2 = false; })), [dirties]);
  assert.deepEqual(failing(mutate((g) => { g.author.report.steps.SK_Assign.file_changed_by_save_2 = false; })), [dirties]);
  // a default save that always writes would make the control write too, and the finding would be void
  assert.deepEqual(failing(mutate((g) => { g.author.report.steps.SK_Control.file_changed_after_default_save = true; })), [dirties]);
  assert.deepEqual(failing(mutate((g) => { delete g.author.report.steps.SK_Control; })), [dirties]);
  assert.deepEqual(failing(mutate((g) => { g.read.report.meshes.SK_Assign = mesh(one(ORIGINAL)); })), [dirties]);
  assert.deepEqual(failing(mutate((g) => { g.read.report.meshes.SK_AssignForced = mesh(one(ORIGINAL)); })), ['a forced save persists the assign-back']);
  assert.deepEqual(failing(mutate((g) => { g.author.report.steps.SK_Two.slots_padded = one(ORIGINAL); })).includes('Python pads a mesh to two slots'), true);
});

test('each C++ function check fails when its fact changes', () => {
  assert.deepEqual(failing(mutate((g) => { g.author.report.steps.SK_Two.refused_returned = true; })), ['the C++ function refuses a wrong count']);
  assert.deepEqual(failing(mutate((g) => { g.author.log = ''; })), ['the C++ function refuses a wrong count']);
  assert.deepEqual(failing(mutate((g) => { g.author.report.steps.SK_Two.slots_after_refusal = [row('MaterialSlot', RED), row('ProbeSlot1', ORIGINAL)]; })), ['the C++ function refuses a wrong count']);
  assert.deepEqual(failing(mutate((g) => { g.author.report.steps.SK_Single.returned = false; })), ['the C++ function sets the slots']);
  assert.deepEqual(failing(mutate((g) => { g.author.report.steps.SK_Two.after = [row('MaterialSlot', BLUE), row('ProbeSlot1', RED)]; })), ['the C++ function sets the slots']);
  assert.deepEqual(failing(mutate((g) => { g.author.report.steps.SK_Single.file_changed_after_default_save = false; })), ['the C++ function marks the package dirty']);
  assert.deepEqual(failing(mutate((g) => { g.read.report.meshes.SK_Single = mesh(one(ORIGINAL)); })), ['the C++ function result persists']);
});

test('a stale or unreadable registry tag fails the tag check and names the mesh', () => {
  const stale = mutate((g) => { g.read.report.meshes.SK_Two.registry.value = tagOf(padded); });
  assert.deepEqual(failing(stale), ['registry tag agrees with the slots']);
  assert.match(evaluate(stale).find((c) => c.name === 'registry tag agrees with the slots').detail, /SK_Two/);
  assert.deepEqual(failing(mutate((g) => { g.read.report.meshes.SK_Single.registry = { route: null, raw: null, value: null, attempts: [] }; })), ['registry tag agrees with the slots']);
});

test('authored materials that did not save or load fail their check', () => {
  assert.deepEqual(failing(mutate((g) => { g.author.report.steps.materials.blue.saved = false; })), ['authored materials survive the save']);
  assert.deepEqual(failing(mutate((g) => { g.read.report.steps.materials.red.class = 'MaterialInstanceConstant'; })), ['authored materials survive the save']);
  // compile errors are recorded, not judged
  assert.deepEqual(failing(mutate((g) => { g.author.report.steps.materials.red.compile_errors = ['no shader compiler']; })), []);
});
