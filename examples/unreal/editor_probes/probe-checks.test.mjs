// node --test examples/unreal/editor_probes/probe-checks.test.mjs  (no Unreal, no dependencies)
// The reports below have the shape the three probe scripts wrote on Unreal 5.8.2. Each test changes one fact and expects the matching
// problem, so the checks cannot pass by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROBES, buildLaunch, checkReport, editorPath, missingReportMessage, splitNames, summarizeReport } from './probe-checks.mjs';

const docReport = () => ({
  'EditorAssetLibrary.save_asset': { status: 'found', kind: 'callable', doc: 'X.save_asset(asset_to_save, only_if_is_dirty=True) -> bool\nSave the packages.' },
  'EditorAssetLibrary.save_assets': { status: 'missing', reason: "unreal.EditorAssetLibrary has no attribute 'save_assets'", nearby: ['save_asset'] },
  'EditorAssetLibrary.nothing': { status: 'unavailable', reason: 'unreal.EditorAssetLibrary.nothing has no docstring' },
});
const systemReport = () => ({
  '/Game/FX/NS_Worked': {
    status: 'found', summary: { systemName: 'NS_Worked', emitters: [] }, system_data: {}, problems: [],
    emitters: { Motes: { summary: {}, data: {}, modules: {}, renderers: [] } },
    modules: {
      'Motes:ParticleSpawnScript:InitializeParticle': { status: 'found', inputs: [] },
      'Motes:Missing': { status: 'missing', reason: 'no emitter in this system has a module named Missing' },
    },
  },
  '/Game/FX/NS_Gone': { status: 'missing', reason: 'no asset at /Game/FX/NS_Gone' },
});
const assetReport = () => ({
  '/Game/P/SM_Cube': { status: 'found', class: 'StaticMesh', material_slots: [{ slot: 'Base', material: null }], bounds: {}, nanite_enabled: false },
  '/Game/P/M_Probe': {
    status: 'found', class: 'Material', blend_mode: 'BLEND_MASKED', shading_model: 'MSM_DEFAULT_LIT', two_sided: true, used_with_nanite: false,
    used_with_niagara_sprites: true, used_with_niagara_ribbons: 'unavailable',
  },
  '/Game/P/MI_Probe': { status: 'found', class: 'MaterialInstanceConstant', parent: '/Game/P/M_Probe.M_Probe', scalar_parameters: { Opacity: 0.5 } },
  '/Game/P/T_Tex': { status: 'unavailable', reason: 'no description for class Texture2D', class: 'Texture2D' },
});
const cases = { doc: docReport, system: systemReport, asset: assetReport };

test('well formed reports of each probe have no problems', () => {
  for (const [probe, make] of Object.entries(cases)) assert.deepEqual(checkReport(probe, Object.keys(make()), make()), [], probe);
});

test('a requested name with no entry is reported, never skipped', () => {
  const report = docReport();
  delete report['EditorAssetLibrary.save_asset'];
  assert.deepEqual(checkReport('doc', ['EditorAssetLibrary.save_asset', 'EditorAssetLibrary.save_assets'], report),
    ['EditorAssetLibrary.save_asset: no entry in the report']);
});

test('a missing or unavailable entry must say why, and an unknown status is refused', () => {
  const report = docReport();
  delete report['EditorAssetLibrary.save_assets'].reason;
  report['EditorAssetLibrary.nothing'].status = 'absent';
  const problems = checkReport('doc', Object.keys(report), report);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /save_assets: missing without a reason/);
  assert.match(problems[1], /status is "absent"/);
});

test('a found doc entry needs a kind and text; an empty doc should have been unavailable', () => {
  const report = docReport();
  report['EditorAssetLibrary.save_asset'].doc = '  ';
  assert.match(checkReport('doc', Object.keys(report), report)[0], /empty doc/);
});

test('a found system needs its summary, emitters and modules, and each module entry has a status', () => {
  const report = systemReport();
  delete report['/Game/FX/NS_Worked'].summary;
  report['/Game/FX/NS_Worked'].modules['Motes:Missing'] = { status: 'found' };
  const problems = checkReport('system', Object.keys(report), report);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /without a summary/);
  assert.match(problems[1], /found without inputs/);
});

test('a found asset carries every field of its class, and an unreadable flag is the string unavailable, not a gap', () => {
  const report = assetReport();
  delete report['/Game/P/M_Probe'].used_with_niagara_ribbons;
  delete report['/Game/P/SM_Cube'].nanite_enabled;
  report['/Game/P/MI_Probe'].class = 'Texture2D';
  const problems = checkReport('asset', Object.keys(report), report);
  assert.deepEqual(problems, [
    '/Game/P/SM_Cube: StaticMesh entry lacks nanite_enabled',
    '/Game/P/M_Probe: Material entry lacks used_with_niagara_ribbons',
    '/Game/P/MI_Probe: class Texture2D has no description; it should be unavailable',
  ]);
});

test('a report that is not an object fails', () => {
  assert.deepEqual(checkReport('doc', ['a'], []), ['the report is not a JSON object']);
  assert.deepEqual(checkReport('doc', ['a'], null), ['the report is not a JSON object']);
});

test('names split on commas, semicolons and white space, without repeats', () => {
  assert.deepEqual(splitNames('A.b, C;D  E\nA.b'), ['A.b', 'C', 'D', 'E']);
  assert.deepEqual(splitNames(undefined), []);
  assert.deepEqual(splitNames(' , '), []);
});

test('the launch runs the probe script with -ExecutePythonScript and hands the names over by environment', () => {
  const launch = buildLaunch({ probe: 'system', project: 'C:/p/P.uproject', report: 'C:/p/r.json', logPath: 'C:/p/l.log', scriptDir: 'C:/ex/', names: '/Game/A /Game/B',
    extras: { PROBE_MODULES: 'Motes:InitializeParticle, Dust:Drag' } });
  assert.equal(launch.script, 'C:/ex/inspect_system.py');
  assert.deepEqual(launch.args.slice(0, 3), ['C:/p/P.uproject', '-ExecutePythonScript=C:/ex/inspect_system.py', '-abslog=C:/p/l.log']);
  assert.ok(launch.args.includes('-nullrhi') && launch.args.includes('-unattended'));
  assert.deepEqual(launch.env, { PROBE_REPORT: 'C:/p/r.json', PROBE_SYSTEMS: '/Game/A,/Game/B', PROBE_MODULES: 'Motes:InitializeParticle,Dust:Drag' });
  assert.deepEqual(launch.requested, ['/Game/A', '/Game/B']);
  for (const probe of Object.keys(PROBES)) assert.ok(buildLaunch({ probe, project: 'p', report: 'r', logPath: 'l', scriptDir: '.', names: 'x' }).env[PROBES[probe].input]);
});

test('the launch refuses what cannot work before an editor starts', () => {
  const base = { probe: 'asset', project: 'p', report: 'r', logPath: 'l', scriptDir: '.', names: '/Game/A' };
  assert.throws(() => buildLaunch({ ...base, probe: 'mesh' }), /unknown probe "mesh"/);
  assert.throws(() => buildLaunch({ ...base, names: ' ' }), /needs at least one name in --assets/);
  assert.throws(() => buildLaunch({ ...base, project: undefined }), /--project/);
  assert.throws(() => buildLaunch({ ...base, report: '' }), /--report/);
});

test('the editor path follows the platform folder', () => {
  assert.equal(editorPath('C:/Program Files/Epic Games/UE_5.8/', 'win32'), 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor.exe');
  assert.match(editorPath('/opt/ue', 'linux'), /Binaries\/Linux\/UnrealEditor$/);
});

test('a missing report names the editor log and says how the editor ended', () => {
  const base = { probe: 'asset', report: 'C:/p/r.json', logPath: 'C:/p/Saved/Logs/probe-asset.log' };
  const exited = missingReportMessage({ ...base, exit: 3 });
  assert.match(exited, /wrote no report/);
  assert.match(exited, /exited with code 3/);
  assert.match(exited, /Editor log: C:\/p\/Saved\/Logs\/probe-asset\.log$/);
  assert.match(missingReportMessage({ ...base, timedOut: true }), /did not finish before the time limit/);
  assert.match(missingReportMessage({ ...base, error: 'spawn ENOENT' }), /could not be started \(spawn ENOENT\)/);
});

test('the console summary has one line per key with its status and reason', () => {
  assert.deepEqual(summarizeReport(docReport()), [
    'found  EditorAssetLibrary.save_asset',
    "missing  EditorAssetLibrary.save_assets  (unreal.EditorAssetLibrary has no attribute 'save_assets')",
    'unavailable  EditorAssetLibrary.nothing  (unreal.EditorAssetLibrary.nothing has no docstring)',
  ]);
  assert.deepEqual(summarizeReport(undefined), []);
});

test('the hang probe (the launcher timeout case) needs slept_seconds on a found hold', () => {
  assert.deepEqual(checkReport('hang', ['3'], { 3: { status: 'found', requested_seconds: 3, slept_seconds: 3 } }), []);
  assert.deepEqual(checkReport('hang', ['3'], { 3: { status: 'found' } }), ['3: found without slept_seconds']);
  assert.equal(PROBES.hang.script, 'hang_probe.py');
});
