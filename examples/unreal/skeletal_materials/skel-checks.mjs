// Judges what skeletal_materials.mjs collects: the build result and the reports and logs of two editor processes that skel_probe.py wrote.
// Pure functions, no Unreal and no dependencies.
//   author = report of the first process: bridge {class_found, members}, steps.materials.{red,blue}, steps.SK_* (see skel_probe.py)
//   read   = report of a fresh process: meshes.SK_*.{class, slots, registry:{route, raw, value}}, steps.materials
// Report shape: assumed until a first run (no run of this probe exists yet); see the README.
// A slot row is { name, material, imported_name }, material being the object path ('' for an empty slot).

export const MESH_NAMES = ['SK_Element', 'SK_Assign', 'SK_AssignForced', 'SK_Single', 'SK_Two'];

/** Parse the hidden asset-registry "Materials" tag: "Slot,'/Path/Mat.Mat'>Slot2,'/Path/Other.Other'>" -> [{ name, material }]. */
export function parseMaterialsTag(value) {
  const rows = [];
  for (const m of String(value ?? '').matchAll(/([^,>']*),'([^']*)'>/g)) rows.push({ name: m[1], material: m[2] });
  return rows;
}

const key = (rows) => (rows ?? []).map((r) => `${r.name}=${r.material}`).join('|');
export const sameSlots = (a, b) => Array.isArray(a) && Array.isArray(b) && key(a) === key(b);
const mats = (rows) => (rows ?? []).map((r) => r.material);
const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

export function evaluate({ build, author, read }) {
  const a = author?.report, r = read?.report;
  const s = a?.steps ?? {};
  const red = s.materials?.red?.path, blue = s.materials?.blue?.path;
  const meshes = r?.meshes ?? {};
  const checks = [];
  checks.push({ name: 'module compiles', claim: 'UBT builds the editor target with the SkeletalMaterialsBridge module (the first run is also the first compile of this module)',
    pass: build?.exit === 0 && /Result: Succeeded/.test(build?.log ?? ''), detail: `exit ${build?.exit}` });
  checks.push({ name: 'author process ran', claim: 'the first process wrote a report with no script error, the bridge class is visible to Python with set_skeletal_mesh_materials, and the log has no fatal error',
    pass: !!a && (a.errors ?? []).length === 0 && a.bridge?.class_found === true && (a.bridge?.members ?? []).includes('set_skeletal_mesh_materials') && !/Fatal error/.test(author?.log ?? ''),
    detail: !a ? 'no report' : `errors ${JSON.stringify((a.errors ?? []).map((e) => e.step))}; bridge members ${JSON.stringify(a.bridge?.members)}` });
  checks.push({ name: 'read process ran', claim: 'a fresh process wrote a report with no script error and loaded all five meshes as SkeletalMesh',
    pass: !!r && (r.errors ?? []).length === 0 && MESH_NAMES.every((n) => meshes[n]?.class === 'SkeletalMesh'),
    detail: !r ? 'no report' : `errors ${JSON.stringify((r.errors ?? []).map((e) => e.step))}; classes ${MESH_NAMES.map((n) => meshes[n]?.class).join(', ')}` });
  const authored = s.materials, readMat = r?.steps?.materials;
  checks.push({ name: 'authored materials survive the save', claim: 'two Materials built from nodes are saved by the first process and load as Material in the second. Compile errors and shader statistics are recorded in the report for comparison between a run without rendering and a run with it, and are not judged',
    pass: !!authored?.red?.saved && !!authored?.blue?.saved && readMat?.red?.exists === true && readMat?.blue?.exists === true && readMat?.red?.class === 'Material' && readMat?.blue?.class === 'Material',
    detail: authored ? `compile errors red ${JSON.stringify(authored.red?.compile_errors)} blue ${JSON.stringify(authored.blue?.compile_errors)}; statistics red ${JSON.stringify(authored.red?.stats)}` : 'no materials step' });

  const el = s.SK_Element;
  checks.push({ name: 'Python reads the slots', claim: 'mesh.get_editor_property("materials") returns one slot for the engine skeletal cube, each with a material_slot_name and a material_interface',
    pass: Array.isArray(el?.slots_before) && el.slots_before.length === 1 && !!el.slots_before[0].name, detail: JSON.stringify(el?.slots_before) });
  checks.push({ name: 'element edit changes nothing', claim: 'slots = mesh.get_editor_property("materials"); slots[0].material_interface = material raises nothing and the mesh still reads its original material, in memory and after a forced save and a fresh load',
    pass: !!el && el.raised === null && el.in_memory_changed === false && sameSlots(meshes.SK_Element?.slots, el.slots_before),
    detail: el ? `raised ${JSON.stringify(el.raised)}; changed in memory ${el.in_memory_changed}; after reload ${key(meshes.SK_Element?.slots)}` : 'no step' });

  const as = s.SK_Assign;
  checks.push({ name: 'assign-back sets the slots in memory', claim: 'set_editor_property("materials", new SkeletalMaterial structs) raises nothing and the mesh reads the new material at once',
    pass: !!as && as.raised === null && as.after?.length === as.slots_before?.length && as.after?.[0]?.material === red && as.in_memory_changed === true,
    detail: as ? `raised ${JSON.stringify(as.raised)}; slot 0 reads ${as.after?.[0]?.material}` : 'no step' });
  checks.push({ name: 'assign-back leaves the package clean', claim: 'after the assign-back set, and after an identical second set, a default save (only if dirty) writes nothing, and a fresh load reads the original material',
    pass: !!as && as.file_changed_after_save_1 === false && as.file_changed_after_save_2 === false && sameSlots(meshes.SK_Assign?.slots, as.slots_before),
    detail: as ? `file changed after save 1: ${as.file_changed_after_save_1}; after save 2: ${as.file_changed_after_save_2}; reload ${key(meshes.SK_Assign?.slots)}` : 'no step' });
  const af = s.SK_AssignForced;
  checks.push({ name: 'a forced save persists the assign-back', claim: 'the same assign-back followed by a save with only_if_is_dirty False writes the file and a fresh load reads the new material',
    pass: !!af && af.raised === null && af.forced_save_file_changed === true && meshes.SK_AssignForced?.slots?.[0]?.material === red,
    detail: af ? `file changed ${af.forced_save_file_changed}; reload slot 0 ${meshes.SK_AssignForced?.slots?.[0]?.material}` : 'no step' });

  const two = s.SK_Two;
  checks.push({ name: 'Python pads a mesh to two slots', claim: 'assign-back of two SkeletalMaterial structs onto the one-slot engine mesh gives it two slots, the second named ProbeSlot1 (the structs\' imported slot names are recorded, not judged)',
    pass: !!two && two.pad_raised === null && two.slots_padded?.length === 2 && two.slots_padded[1].name === 'ProbeSlot1',
    detail: two ? `raised ${JSON.stringify(two.pad_raised)}; slots ${JSON.stringify(two.slots_padded)}` : 'no step' });
  checks.push({ name: 'the C++ function refuses a wrong count', claim: 'three materials for two slots return False, leave both slots as they were, and log the module\'s error',
    pass: !!two && two.refused_returned === false && sameSlots(two.slots_after_refusal, two.slots_padded)
      && /LogSkeletalMaterialsBridge: Error: SetSkeletalMeshMaterials: .* has 2 material slots and 3 materials were given/.test(author?.log ?? ''),
    detail: two ? `returned ${two.refused_returned}; slots unchanged ${sameSlots(two.slots_after_refusal, two.slots_padded)}` : 'no step' });
  const one = s.SK_Single;
  checks.push({ name: 'the C++ function sets the slots', claim: 'SetSkeletalMeshMaterials returns True and the mesh reads the new materials in slot order, with the slot names unchanged: one slot on the single-slot mesh, two on the padded mesh',
    pass: one?.returned === true && one.after?.length === 1 && one.after[0].material === red && one.after[0].name === one.slots_before?.[0]?.name
      && two?.returned === true && sameList(mats(two.after), [red, blue]) && sameList((two.after ?? []).map((x) => x.name), (two.slots_padded ?? []).map((x) => x.name)),
    detail: `single ${JSON.stringify(one?.after)}; two ${JSON.stringify(two?.after)}` });
  checks.push({ name: 'the C++ function marks the package dirty', claim: 'a default save (only if dirty) after the function writes the file, for both meshes',
    pass: one?.file_changed_after_default_save === true && two?.file_changed_after_default_save === true,
    detail: `single ${one?.file_changed_after_default_save}; two ${two?.file_changed_after_default_save}` });
  checks.push({ name: 'the C++ function result persists', claim: 'a fresh process loads the single-slot mesh with the first material and the padded mesh with both, in order, with the same slot names',
    pass: meshes.SK_Single?.slots?.[0]?.material === red && sameList(mats(meshes.SK_Two?.slots), [red, blue]) && sameList((meshes.SK_Two?.slots ?? []).map((x) => x.name), (two?.slots_padded ?? []).map((x) => x.name)),
    detail: `single ${meshes.SK_Single?.slots?.[0]?.material}; two ${JSON.stringify(mats(meshes.SK_Two?.slots))}` });

  const stale = [];
  for (const n of MESH_NAMES) {
    const tag = meshes[n]?.registry;
    if (!tag || typeof tag.value !== 'string' || !sameSlots(parseMaterialsTag(tag.value), (meshes[n]?.slots ?? []).map((x) => ({ name: x.name, material: x.material })))) stale.push(`${n}: ${JSON.stringify(tag?.value ?? tag?.raw ?? null)}`);
  }
  checks.push({ name: 'registry tag agrees with the slots', claim: 'each saved mesh\'s hidden asset-registry Materials tag, read from disk before any mesh is loaded, lists the same slot names and materials as the loaded mesh (no stale tag after any of the routes)',
    pass: !!r && stale.length === 0, detail: stale.length ? `disagree or unreadable: ${stale.join('; ')}` : `routes ${MESH_NAMES.map((n) => meshes[n]?.registry?.route).join(', ')}` });
  return checks;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}
