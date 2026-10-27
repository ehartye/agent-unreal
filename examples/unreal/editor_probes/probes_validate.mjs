// node probes_validate.mjs --engine "<UE_5.8 folder>" [--keep]
// Validates the three read-back probes (probe.mjs --probe doc|system|asset, see README.md) against a real Unreal 5.8 install, judging the values the
// README section "What a run showed" records. It makes a throwaway project in the OS temp folder (PythonScriptPlugin, EditorScriptingUtilities, Niagara,
// NiagaraToolsets), then:
//   1 fixture  probes_fixture.py in a headless commandlet: a copy of the engine cube, a second copy with Nanite saved on, a masked two-sided material with
//              the sprite flag, an instance of it, and a Niagara system made through the toolset with emitters Dust and Motes (Motes' Lifetime Min 2.5)
//   2 doc      probe.mjs --probe doc --callables EditorAssetLibrary.save_asset,EditorAssetLibrary,EditorAssetLibrary.save_assets
//   3 system   probe.mjs --probe system on the fixture system, a path with no asset and the material, with --modules InitializeParticle,Dust:Nothing
//   4 asset    probe.mjs --probe asset on the cube copies, the material, its instance and the Niagara system
//   5 broken   a copy of the launcher beside a doc_probe.py that does not parse: it must exit 1 with the "wrote no report" message
// and judges the reports in probes-validate-checks.mjs. Exit code 0 when every asserted check passes; observations are recorded, never judged.
// Prepared, not yet run on an engine. Takes about five minutes: the first editor start is slow (60 to 80 s), later runs 15 to 20 s each.
// Windows editor paths only (the launcher chooses the path by platform, but only Windows was run). No dependencies. Not part of node scripts/check.mjs; the checks are tested there.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ASSET_NAMES, DOC_NAMES, MODULE_NAMES, SYSTEM_NAMES, evaluate, summarize } from './probes-validate-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node probes_validate.mjs --engine <UE_5.8 folder> [--keep]'); process.exit(2); }
const bin = join(engine, 'Engine', 'Binaries', 'Win64');
const commandlet = join(bin, 'UnrealEditor-Cmd.exe');
for (const exe of [commandlet, join(bin, 'UnrealEditor.exe')]) if (!existsSync(exe)) { console.error(`not found: ${exe}`); process.exit(2); }

const here = import.meta.dirname;
const root = mkdtempSync(join(tmpdir(), 'probes-validate-'));
const project = join(root, 'ProbesValidate.uproject');
writeFileSync(project, JSON.stringify({
  FileVersion: 3, EngineAssociation: '5.8',
  Plugins: ['PythonScriptPlugin', 'EditorScriptingUtilities', 'Niagara', 'NiagaraToolsets'].map((Name) => ({ Name, Enabled: true })),
}, null, 2));
const saved = join(root, 'Saved');
mkdirSync(join(saved, 'Logs'), { recursive: true });
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const readJson = (path) => { try { return existsSync(path) ? JSON.parse(readText(path)) : undefined; } catch { return undefined; } };

console.log(`Editor probe validation in ${root}`);

// 1 the fixture, in a headless commandlet like the other Niagara authoring steps
const fixtureReport = join(saved, 'probes-fixture.json');
const started = Date.now();
const built = spawnSync(commandlet, [project, '-run=pythonscript', `-script=${resolve(here, 'probes_fixture.py')}`, '-unattended', '-nullrhi', '-nosplash', '-nopause', '-nosound', '-notraceserver',
  `-abslog=${join(saved, 'Logs', 'probes-fixture.log')}`],
{ env: { ...process.env, PROBES_FIXTURE_REPORT: fixtureReport }, stdio: 'ignore', timeout: 900000, windowsHide: true });
console.log(`  fixture: exit ${built.status}${built.error ? ` (${built.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
const fixture = readJson(fixtureReport);

/** Runs a launcher script as a child and measures what its caller sees. */
function launch(label, launcher, kind, extraArgs) {
  const report = join(saved, `${label}.json`), log = join(saved, 'Logs', `probe-${label}.log`);
  const begun = Date.now();
  const result = spawnSync(process.execPath, [launcher, '--engine', engine, '--project', project, '--probe', kind, '--report', report, '--log', log, '--timeout', '600000', ...extraArgs],
    { encoding: 'utf8', windowsHide: true, timeout: 700000, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  const seconds = Math.round((Date.now() - begun) / 1000);
  console.log(`  ${label}: launcher exit ${result.status}, ${seconds} s`);
  return { exit: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', seconds, report: readJson(report), reportPath: report, logPath: log };
}
const probe = (label, kind, flags) => launch(label, join(here, 'probe.mjs'), kind, flags);

let doc, system, asset, broken;
if (!fixture) {
  console.log('  no fixture report: the editor probes are skipped (see Saved/Logs/probes-fixture.log)');
} else {
  doc = probe('doc', 'doc', ['--callables', DOC_NAMES.join(',')]);
  system = probe('system', 'system', ['--systems', SYSTEM_NAMES.join(','), '--modules', MODULE_NAMES.join(',')]);
  asset = probe('asset', 'asset', ['--assets', ASSET_NAMES.join(',')]);
  // 5 a copy of the launcher beside a probe script that does not parse: the editor ends without a report
  const lonely = join(root, 'broken-launcher');
  mkdirSync(lonely, { recursive: true });
  for (const file of ['probe.mjs', 'probe-checks.mjs']) copyFileSync(join(here, file), join(lonely, file));
  writeFileSync(join(lonely, 'doc_probe.py'), 'import unreal\ndef broken(:\n    pass\n');
  broken = launch('broken', join(lonely, 'probe.mjs'), 'doc', ['--callables', 'EditorAssetLibrary.save_asset']);
}

const checks = evaluate({ fixture, doc, system, asset, broken });
for (const c of checks) console.log(`${c.observe ? (c.pass ? 'OBSERVE' : 'NOT RECORDED') : c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total, observed, observedRecorded } = summarize(checks);
console.log(`${passed} of ${total} checks passed; ${observedRecorded} of ${observed} observations recorded`);
if (keep || passed !== total) console.log(`kept ${root} (reports in Saved, editor logs in Saved/Logs)`);
else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
