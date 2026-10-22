import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { importGlb } from '../skills/unreal-import/scripts/unreal-import.mjs';

const NATIVE = new URL('../skills/unreal-import/scripts/unreal_import_native.py', import.meta.url);
const DEST = '/Game/Generated/Kit';
const INK = '/Game/Art/M_Ink';

function put(path, data) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); }
function glb() {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }).padEnd(100, ' '));
  const header = Buffer.alloc(20); header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + json.length, 8); header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, json]);
}
// A read-back for one imported mesh that satisfies the kit config below; each test overrides what it breaks.
const readback = (name, over = {}) => ({
  asset: `${DEST}/${name}.${name}`, requested: name, node: null, renamedFrom: null,
  naniteEnabled: false, fullPrecisionUvs: true, allowCpuAccess: true,
  collisionTraceFlag: 'CTF_USE_COMPLEX_AS_SIMPLE', doubleSidedCollision: true,
  materialSlots: [`${INK}.M_Ink`], hasVertexColors: true, uvChannels: 1, vertices: 24,
  boundsCm: { min: [-50, -50, 0], max: [50, 50, 200] }, ...over,
});
const baseConfig = {
  options: { combineStaticMeshes: false, importMaterials: false, nanite: false, vertexColors: 'replace' },
  meshes: [
    { node: 'Kit_Tower', asset: 'SM_Tower', allowCpuAccess: true, fullPrecisionUVs: true, material: INK, collision: 'complex-as-simple',
      expect: { boundsCm: { min: [-50, -50, 0], max: [50, 50, 200], toleranceCm: 0.6 }, maxVertices: 100, vertexColors: true, minUvChannels: 1 } },
    { node: 'Kit_Rotor', asset: 'SM_Rotor' },
  ],
};

function fixture(patch = {}, makeReadbacks = () => [readback('SM_Tower'), readback('SM_Rotor', { collisionTraceFlag: 'CTF_USE_SIMPLE_AND_COMPLEX', doubleSidedCollision: false, allowCpuAccess: false, fullPrecisionUvs: false, materialSlots: [] })]) {
  const root = mkdtempSync(join(tmpdir(), 'engine-policy-'));
  put(join(root, 'Project/Test.uproject'), JSON.stringify({ FileVersion: 3 }));
  put(join(root, 'Project/Config/DefaultEngine.ini'), '[a]\n');
  put(join(root, 'UE/Engine/Build/Build.version'), '{}');
  put(join(root, 'UE/Engine/Binaries/Win64/UnrealEditor.exe'), 'editor');
  put(join(root, 'model.glb'), glb());
  const config = { source: 'model.glb', project: 'Project/Test.uproject', engine: 'UE', destination: DEST, ...baseConfig, ...patch };
  put(join(root, 'import.json'), JSON.stringify(config));
  const requests = [];
  let readbacks = makeReadbacks;
  const runEditor = async request => {
    requests.push(JSON.parse(readFileSync(request.requestFile, 'utf8')));
    for (const name of ['SM_Tower', 'SM_Rotor']) put(join(request.outputDirectory, `${name}.uasset`), `${name}:${requests.length}`);
    put(request.report, JSON.stringify({
      ok: true, operation: request.operation, destination: request.destination, engine: '5.8.2',
      assets: [`${DEST}/SM_Tower`, `${DEST}/SM_Rotor`], pipeline: { combineStaticMeshes: 'DO_NOT_COMBINE', nanite: false },
      meshes: readbacks(), problems: [],
    }));
    return { code: 0 };
  };
  const configPath = join(root, 'import.json');
  const edit = fn => { const next = JSON.parse(readFileSync(configPath, 'utf8')); fn(next); put(configPath, JSON.stringify(next)); };
  return { root, requests, edit, setReadbacks: fn => { readbacks = fn; }, configPath,
    execute: options => importGlb(configPath, { ...options, runEditor }) };
}
const receiptOf = f => {
  const base = join(f.root, 'Project/Saved/AgentEngineImports');
  const [state] = readdirSync(base).filter(name => name.length === 20);
  return JSON.parse(readFileSync(join(base, state, 'receipt.json'), 'utf8'));
};

test('without the new keys the request is exactly what 0.12.0 sent and no policy appears in the receipt', async () => {
  const f = fixture({ options: {}, meshes: undefined });
  const result = await f.execute({});
  assert.equal(result.status, 'built');
  assert.deepEqual(f.requests[0].options, { combineStaticMeshes: true, combineSkeletalMeshes: true, importMaterials: true });
  for (const key of ['meshes', 'readback', 'policy']) assert.equal(key in f.requests[0], false, key);
  assert.equal('policy' in receiptOf(f), false);
});

test('config accepts the new options and per-mesh policy and sends them to the native script', async () => {
  const f = fixture();
  assert.equal((await f.execute({})).status, 'built');
  const [request] = f.requests;
  assert.equal(request.options.nanite, false);
  assert.equal(request.options.vertexColors, 'replace');
  assert.equal(request.readback, true);
  assert.equal(request.meshes.length, 2);
  assert.equal(request.meshes[0].material, INK);
  assert.equal(request.meshes[0].collision, 'complex-as-simple');
});

test('invalid policy is rejected before any launch', async () => {
  const cases = {
    'unknown vertex colour mode': { options: { vertexColors: 'merge' } },
    'non-boolean nanite': { options: { nanite: 'off' } },
    'unknown mesh key': { meshes: [{ asset: 'SM_A', mystery: 1 }] },
    'unknown expect key': { meshes: [{ asset: 'SM_A', expect: { mystery: 1 } }] },
    'missing asset': { meshes: [{ node: 'A' }] },
    'bad asset name': { meshes: [{ asset: '../SM_A' }] },
    'duplicate asset': { options: { combineStaticMeshes: false }, meshes: [{ node: 'A', asset: 'SM_A' }, { node: 'B', asset: 'sm_a' }] },
    'duplicate node': { options: { combineStaticMeshes: false }, meshes: [{ node: 'A', asset: 'SM_A' }, { node: 'A', asset: 'SM_B' }] },
    'several meshes without node': { options: { combineStaticMeshes: false }, meshes: [{ asset: 'SM_A' }, { node: 'B', asset: 'SM_B' }] },
    'several meshes combined': { options: { combineStaticMeshes: true }, meshes: [{ node: 'A', asset: 'SM_A' }, { node: 'B', asset: 'SM_B' }] },
    'material outside the game': { meshes: [{ asset: 'SM_A', material: 'C:/x' }] },
    'material inside the owned folder': { meshes: [{ asset: 'SM_A', material: `${DEST}/Ink` }] },
    'unknown collision': { meshes: [{ asset: 'SM_A', collision: 'box' }] },
    'non-boolean cpu access': { meshes: [{ asset: 'SM_A', allowCpuAccess: 1 }] },
    'bounds with two numbers': { meshes: [{ asset: 'SM_A', expect: { boundsCm: { min: [0, 0], max: [1, 1, 1] } } }] },
    'negative tolerance': { meshes: [{ asset: 'SM_A', expect: { boundsCm: { min: [0, 0, 0], max: [1, 1, 1], toleranceCm: -1 } } }] },
    'bounds min above max': { meshes: [{ asset: 'SM_A', expect: { boundsCm: { min: [2, 0, 0], max: [1, 1, 1] } } }] },
    'zero max vertices': { meshes: [{ asset: 'SM_A', expect: { maxVertices: 0 } }] },
    'empty meshes': { meshes: [] },
  };
  for (const [name, patch] of Object.entries(cases)) {
    const f = fixture({ options: {}, meshes: undefined, ...patch });
    await assert.rejects(f.execute({}), /CONFIG/, name);
    assert.equal(f.requests.length, 0, name);
  }
});

test('each new option and each per-mesh key is part of the reuse identity', async () => {
  const f = fixture();
  assert.equal((await f.execute({ ifChanged: true })).status, 'built');
  assert.equal((await f.execute({ ifChanged: true })).status, 'reused');
  writeFileSync(join(f.root, 'original.json'), readFileSync(f.configPath));
  const edits = [
    c => { c.options.nanite = true; },
    c => { c.options.vertexColors = 'override'; },
    c => { c.meshes[0].material = '/Game/Art/M_Other'; },
    c => { c.meshes[0].fullPrecisionUVs = false; },
    c => { c.meshes[0].expect.maxVertices = 99; },
    c => { c.meshes[1].asset = 'SM_Rotor2'; },
  ];
  for (const edit of edits) {
    f.edit(edit);
    assert.equal((await f.execute({ inspect: true })).status, 'needs-import', String(edit));
    f.edit(c => { Object.assign(c, JSON.parse(readFileSync(join(f.root, 'original.json'), 'utf8'))); });
    assert.equal((await f.execute({ inspect: true })).status, 'reusable', `restored after ${edit}`);
  }
  assert.equal(f.requests.length, 1);
});

test('a satisfied policy is read back into the receipt, and an unchanged policy is reused', async () => {
  const f = fixture();
  await f.execute({ ifChanged: true });
  const receipt = receiptOf(f);
  assert.deepEqual(receipt.policy.failures, []);
  assert.equal(receipt.policy.meshes.length, 2);
  assert.deepEqual(receipt.policy.meshes[0].boundsCm, { min: [-50, -50, 0], max: [50, 50, 200] });
  assert.equal(receipt.policy.pipeline.combineStaticMeshes, 'DO_NOT_COMBINE');
  assert.equal((await f.execute({ ifChanged: true })).status, 'reused');
  assert.equal(f.requests.length, 1);
});

test('every mismatch fails the import, listed in the message and written to the receipt first', async () => {
  const f = fixture({}, () => [
    readback('SM_Tower', {
      naniteEnabled: true, fullPrecisionUvs: false, allowCpuAccess: false, collisionTraceFlag: 'CTF_USE_DEFAULT', doubleSidedCollision: false,
      materialSlots: [`${INK}.M_Ink`, '/Game/Other.Other'], hasVertexColors: false, uvChannels: 0, vertices: 101,
      boundsCm: { min: [-50, -50, 0], max: [52, 50, 200] },
    }),
    readback('SM_Rotor'),
  ]);
  const error = await f.execute({}).then(() => null, e => e);
  assert.ok(error, 'import should fail');
  assert.match(error.message, /^IMPORT_EXPECTATIONS_FAILED/);
  for (const piece of [
    /SM_Tower: Nanite is on but the options ask for off/,
    /SM_Tower: full-precision UVs are off but the config asks for on/,
    /SM_Tower: CPU access is off but the config asks for on/,
    /SM_Tower: collision trace flag is CTF_USE_DEFAULT, not CTF_USE_COMPLEX_AS_SIMPLE/,
    /SM_Tower: double-sided collision is off but the config asks for on/,
    /SM_Tower: material slots are .*not all \/Game\/Art\/M_Ink/,
    /SM_Tower: no vertex colours were imported/,
    /SM_Tower: 0 UV channels, expected at least 1/,
    /SM_Tower: 101 vertices, more than the allowed 100/,
    /SM_Tower: X bounds \[-50\.00, 52\.00\] cm differ from expected \[-50, 50\] by more than 0\.6/,
  ]) assert.match(error.message, piece);
  assert.doesNotMatch(error.message, /SM_Rotor:/);
  const receipt = receiptOf(f);
  assert.ok(receipt.policy.failures.length >= 10);
  assert.equal(receipt.policy.meshes[0].naniteEnabled, true);
  // Known outcome, not an uncertain one: no pending journal, and the next invocation can proceed.
  assert.equal((await f.execute({ inspect: true })).status, 'needs-import');
});

test('a failed policy is never reused, and a corrected policy replaces it', async () => {
  const f = fixture({}, () => [readback('SM_Tower', { vertices: 500 }), readback('SM_Rotor')]);
  await assert.rejects(f.execute({ ifChanged: true }), /IMPORT_EXPECTATIONS_FAILED/);
  await assert.rejects(f.execute({ ifChanged: true }), /IMPORT_EXPECTATIONS_FAILED/);
  assert.equal(f.requests.length, 2);
  f.setReadbacks(() => [readback('SM_Tower'), readback('SM_Rotor', { collisionTraceFlag: 'CTF_USE_DEFAULT' })]);
  assert.equal((await f.execute({ ifChanged: true })).status, 'built');
  assert.deepEqual(receiptOf(f).policy.failures, []);
  assert.equal((await f.execute({ ifChanged: true })).status, 'reused');
});

test('expectations with no read-back, structural problems and missing meshes are failures too', async () => {
  const f = fixture({}, () => [readback('SM_Tower', { boundsCm: null, vertices: null, naniteEnabled: null })]);
  const error = await f.execute({}).then(() => null, e => e);
  assert.match(error.message, /SM_Tower: bounds could not be read back/);
  assert.match(error.message, /SM_Tower: vertex count could not be read back/);
  assert.match(error.message, /SM_Tower: Nanite state could not be read back/);
  assert.match(error.message, /SM_Rotor: no imported mesh was read back/);
  const g = fixture({}, () => [readback('SM_Tower'), readback('SM_Rotor')]);
  g.setReadbacks(() => [readback('SM_Tower'), readback('SM_Rotor'), readback('Extra')]);
  const extra = await g.execute({}).then(() => null, e => e);
  assert.match(extra.message, /Extra: imported mesh matches no entry in meshes/);
});

test('problems the native script collected are reported with the other mismatches', async () => {
  const f = fixture();
  const error = await importGlb(f.configPath, { runEditor: async request => {
    for (const name of ['SM_Tower', 'SM_Rotor']) put(join(request.outputDirectory, `${name}.uasset`), name);
    put(request.report, JSON.stringify({ ok: true, operation: request.operation, destination: request.destination, assets: [`${DEST}/SM_Tower`, `${DEST}/SM_Rotor`],
      meshes: [readback('SM_Tower', { vertices: 500 }), readback('SM_Rotor')], problems: ['material /Game/Art/M_Ink does not exist'] }));
    return { code: 0 };
  } }).then(() => null, e => e);
  assert.match(error.message, /material \/Game\/Art\/M_Ink does not exist/);
  assert.match(error.message, /500 vertices/);
});

test('options only (no meshes) still reads back every imported mesh and enforces the Nanite option', async () => {
  const f = fixture({ options: { nanite: false }, meshes: undefined }, () => [readback('SM_Tower', { naniteEnabled: true }), readback('SM_Rotor')]);
  const error = await f.execute({}).then(() => null, e => e);
  assert.match(error.message, /SM_Tower: Nanite is on but the options ask for off/);
  assert.equal(f.requests[0].readback, true);
  assert.equal('meshes' in f.requests[0], false);
});

test('inspect names the recorded failures of a failed receipt', async () => {
  const f = fixture({}, () => [readback('SM_Tower', { vertices: 500 }), readback('SM_Rotor')]);
  await assert.rejects(f.execute({}), /IMPORT_EXPECTATIONS_FAILED/);
  const inspect = await f.execute({ inspect: true });
  assert.equal(inspect.status, 'needs-import');
  assert.match(inspect.failures.join('\n'), /500 vertices/);
});

// The native script only runs inside Unreal, so its pure helpers are exercised here against a stub `unreal` module.
function python(code) {
  const result = spawnSync('python', ['-I', '-B', '-c', code], { encoding: 'utf8' });
  if (result.error && result.error.code === 'ENOENT') return null;
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const STUB = `
import sys, types, json, importlib.util
unreal = types.ModuleType('unreal')
class Behavior:
    ALL = 'ALL'
    NONE = 'NONE'
unreal.InterchangeCombineStaticMeshesBehavior = Behavior
sys.modules['unreal'] = unreal
spec = importlib.util.spec_from_file_location('native', ${JSON.stringify(NATIVE.pathname.replace(/^\/([A-Za-z]:)/, '$1'))})
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
`;
test('native helper resolves the do-not-combine enum defensively and reports which name worked', t => {
  const result = python(STUB + `
class Other:
    DO_NOT_COMBINE = 'DNC'
    NONE = 'NONE'
class OnlyNone:
    NONE = 'NONE'
print(json.dumps([list(native.resolve_enum(Other, 'DO_NOT_COMBINE', 'NONE')), list(native.resolve_enum(OnlyNone, 'DO_NOT_COMBINE', 'NONE'))]))
`);
  if (result === null) return t.skip('python is not installed');
  assert.deepEqual(result, [['DO_NOT_COMBINE', 'DNC'], ['NONE', 'NONE']]);
});
test('native helper converts engine bounds to a centimetre min/max pair', t => {
  const result = python(STUB + `
class V:
    def __init__(self, x, y, z): self.x, self.y, self.z = x, y, z
class B:
    origin = V(100, 0, 50)
    box_extent = V(10, 20, 30)
print(json.dumps(native.bounds_cm(B)))
`);
  if (result === null) return t.skip('python is not installed');
  assert.deepEqual(result, { min: [90, -20, 20], max: [110, 20, 80] });
});
