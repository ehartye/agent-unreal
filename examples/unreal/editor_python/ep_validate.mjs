// node ep_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--shots <folder>]
// Validates the editor Python guidance in skills/unreal-features/references/unreal-editor-python.md and unreal-geometry-scripting.md
// against a real Unreal 5.8 install. It makes a throwaway project in the OS temp folder (Python, Editor Scripting Utilities, Geometry
// Script), runs ep_probe.py headless (map re-creation, property names, rotation, plane cuts, instancing flag), ep_ground_map.py headless
// (copies the Open World template), ep_stages.py in a rendering editor (stage runner, materials, instanced boulders, picture),
// ep_flags.py headless (reads the saved flags back) and ep_ground.py in a rendering editor (line-trace camera placement on a
// Landscape). The reports are judged by ep-validate-checks.mjs. Exit code 0 when every check passes. Takes a few minutes. Not part of
// node scripts/check.mjs; the pure checks are tested there. --shots copies the PNGs to a folder.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { evaluate, summarize } from './ep-validate-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const shotsOut = flag('--shots');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node ep_validate.mjs --engine <UE_5.8 folder> [--keep] [--shots <folder>]'); process.exit(2); }
const bin = join(engine, 'Engine', 'Binaries', 'Win64');
const cmd = join(bin, 'UnrealEditor-Cmd.exe'), editor = join(bin, 'UnrealEditor.exe');
for (const exe of [cmd, editor]) if (!existsSync(exe)) { console.error(`not found: ${exe}`); process.exit(2); }

const here = import.meta.dirname;
const root = mkdtempSync(join(tmpdir(), 'ep-validate-'));
const project = join(root, 'EpValidate.uproject');
writeFileSync(project, JSON.stringify({
  FileVersion: 3, EngineAssociation: '5.8',
  Plugins: ['PythonScriptPlugin', 'EditorScriptingUtilities', 'GeometryScripting'].map((Name) => ({ Name, Enabled: true })),
}, null, 2));
const saved = join(root, 'Saved'), shots = join(saved, 'shots');
mkdirSync(join(saved, 'Logs'), { recursive: true });
mkdirSync(shots, { recursive: true });
const reportPath = (name) => join(saved, `${name}.json`);
const logPath = (name) => join(saved, 'Logs', `${name}.log`);
const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined);
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');

function run(label, exe, argv, name, timeout) {
  const started = Date.now();
  const result = spawnSync(exe, [...argv, `-abslog=${logPath(name)}`, '-unattended', '-nosplash', '-nosound', '-notraceserver'], {
    env: { ...process.env, EP_REPORT: reportPath(name), EP_SHOT_DIR: shots }, stdio: 'ignore', timeout, windowsHide: true });
  console.log(`  ${label}: exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
  return result.status;
}
const commandlet = (file) => [project, '-run=pythonscript', `-script=${resolve(here, file)}`, '-nullrhi', '-nopause'];
const editorRun = (file) => [project, '-RenderOffScreen', `-ExecCmds=py ${resolve(here, file)}`];

console.log(`Editor Python validation in ${root}`);
// ep_probe.py logs engine errors on purpose, so its exit code is not judged
run('probe (headless)', cmd, commandlet('ep_probe.py'), 'probe', 600000);
run('copy the Open World template (headless)', cmd, commandlet('ep_ground_map.py'), 'ground-map', 600000);
run('stages (rendering editor)', editor, editorRun('ep_stages.py'), 'stages', 900000);
run('read the saved flags (headless)', cmd, commandlet('ep_flags.py'), 'flags', 600000);
run('ground (rendering editor)', editor, editorRun('ep_ground.py'), 'ground', 900000);

const checks = evaluate({
  probe: readJson(reportPath('probe')), probeLog: readText(logPath('probe')), stages: readJson(reportPath('stages')), stagesLog: readText(logPath('stages')),
  flags: readJson(reportPath('flags')), ground: readJson(reportPath('ground')),
});
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (shotsOut) {
  mkdirSync(resolve(shotsOut), { recursive: true });
  for (const f of readdirSync(shots)) copyFileSync(join(shots, f), join(resolve(shotsOut), f));
  console.log(`pictures copied to ${resolve(shotsOut)}`);
}
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
