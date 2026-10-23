// node epf_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep]
// Validates two editor Python notes against a real Unreal 5.8 install: how unreal.Box is constructed
// (skills/unreal-editor-scripting/references/unreal-editor-python.md) and that the Interchange glTF log line "Invalid input AlphaMode ...
// MF_Default_Body" is logged while the meshes, materials and clips still import (skills/unreal-import/references/unreal-import-notes.md).
// It makes a throwaway project in the OS temp folder, writes two small glTF files with tiny_glb.mjs (no outside assets), runs epf_box.py
// and four Interchange imports headless (epf_import.py: static or skinned file, default stack or an owned pipeline), counts the log line
// of each import and judges the reports with epf-validate-checks.mjs. Exit code 0 when every check passes. Takes a few minutes.
// Not part of node scripts/check.mjs; the pure checks are tested there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildStatic, buildSkinned } from './tiny_glb.mjs';
import { evaluate, summarize } from './epf-validate-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node epf_validate.mjs --engine <UE_5.8 folder> [--keep]'); process.exit(2); }
const cmd = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe');
if (!existsSync(cmd)) { console.error(`not found: ${cmd}`); process.exit(2); }

const here = import.meta.dirname;
const root = mkdtempSync(join(tmpdir(), 'epf-validate-'));
const project = join(root, 'EpfValidate.uproject');
writeFileSync(project, JSON.stringify({
  FileVersion: 3, EngineAssociation: '5.8',
  Plugins: ['PythonScriptPlugin', 'EditorScriptingUtilities'].map((Name) => ({ Name, Enabled: true })),
}, null, 2));
const saved = join(root, 'Saved'), glb = join(root, 'glb');
mkdirSync(join(saved, 'Logs'), { recursive: true });
mkdirSync(glb, { recursive: true });
writeFileSync(join(glb, 'static.glb'), buildStatic());
writeFileSync(join(glb, 'skinned.glb'), buildSkinned());
const reportPath = (name) => join(saved, `${name}.json`);
const logPath = (name) => join(saved, 'Logs', `${name}.log`);
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const readJson = (path) => (existsSync(path) ? JSON.parse(readText(path)) : undefined);

function run(label, script, name, env = {}, timeout = 600000) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    const result = spawnSync(cmd, [project, '-run=pythonscript', `-script=${resolve(here, script)}`, `-abslog=${logPath(name)}`,
      '-unattended', '-nullrhi', '-nosplash', '-nopause', '-nosound', '-notraceserver'],
    { env: { ...process.env, EPF_REPORT: reportPath(name), ...env }, stdio: 'ignore', timeout, windowsHide: true });
    console.log(`  ${label}: exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
    if (result.status !== null) return result.status;   // a timeout is retried once
  }
  return null;
}

console.log(`Editor Python friction validation in ${root}`);
const exits = {};
exits.box = run('Box construction', 'epf_box.py', 'box');
const cases = {
  static_default: ['static', 'default'], static_owned: ['static', 'owned'],
  skinned_default: ['skinned', 'default'], skinned_owned: ['skinned', 'owned'],
};
for (const [name, [file, pipeline]] of Object.entries(cases)) {
  exits[name] = run(`import ${file}.glb, ${pipeline} pipeline`, 'epf_import.py', name,
    { EPF_GLB: join(glb, `${file}.glb`), EPF_DEST: `/Game/${name}`, EPF_PIPELINE: pipeline });
}

const checks = evaluate({
  box: readJson(reportPath('box')),
  imports: Object.fromEntries(Object.keys(cases).map((n) => [n, readJson(reportPath(n))])),
  logs: Object.fromEntries(Object.keys(cases).map((n) => [n, readText(logPath(n))])), exits,
});
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
