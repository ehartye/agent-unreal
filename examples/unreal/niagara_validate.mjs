// node niagara_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep]
// Validates skills/unreal-effects/references/unreal-niagara.md against a real Unreal 5.8 install.
// It makes a throwaway project in the OS temp folder (PythonScriptPlugin, EditorScriptingUtilities, Niagara, NiagaraToolsets, NiagaraFluids),
// runs the Niagara scripts in this folder (traps, build, author twice, templates, verify), reads their JSON reports, reads the engine's
// Niagara plugin descriptors (engine_plugins.mjs, no Unreal process) and checks each claim (niagara-validate-checks.mjs).
// Exit code 0 when every check passes. Takes several minutes; needs a GPU-less machine for the commandlets and an offscreen
// editor for the last step. Not part of node scripts/check.mjs; the pure checks are tested there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { evaluate, summarize } from './niagara-validate-checks.mjs';
import { readPlugins, select } from './engine_plugins.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node niagara_validate.mjs --engine <UE_5.8 folder> [--keep]'); process.exit(2); }
const bin = join(engine, 'Engine', 'Binaries', 'Win64');
const cmd = join(bin, 'UnrealEditor-Cmd.exe'), editor = join(bin, 'UnrealEditor.exe');
for (const exe of [cmd, editor]) if (!existsSync(exe)) { console.error(`not found: ${exe}`); process.exit(2); }

const here = import.meta.dirname;
const root = mkdtempSync(join(tmpdir(), 'niagara-validate-'));
const project = join(root, 'NiagaraValidate.uproject');
writeFileSync(project, JSON.stringify({
  FileVersion: 3, EngineAssociation: '5.8',
  Plugins: ['PythonScriptPlugin', 'EditorScriptingUtilities', 'Niagara', 'NiagaraToolsets', 'NiagaraFluids'].map((Name) => ({ Name, Enabled: true })),
}, null, 2));
mkdirSync(join(root, 'Saved'), { recursive: true });
const report = (name) => join(root, 'Saved', `${name}.json`);

function run(label, exe, argv, name, timeout, envVar = 'NIAGARA_PROBE_REPORT') {
  const started = Date.now();
  const result = spawnSync(exe, argv, { env: { ...process.env, [envVar]: report(name) }, stdio: 'ignore', timeout });
  console.log(`  ${label}: exit ${result.status}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
}
const headless = ['-unattended', '-nullrhi', '-nosplash', '-nopause', '-nosound', '-notraceserver'];
const script = (file) => [project, '-run=pythonscript', `-script=${resolve(here, file)}`, ...headless];

console.log(`Niagara validation in ${root}`);
// This step exits 1 on purpose: it triggers and logs the expected duplicate_asset error.
run('traps', cmd, script('niagara_traps.py'), 'niagara-traps', 300000);
run('build', cmd, script('niagara_build.py'), 'niagara-build', 300000);
run('author', cmd, script('niagara_toolset_author.py'), 'niagara-author', 300000);
run('author again (must refuse)', cmd, script('niagara_toolset_author.py'), 'niagara-author-rerun', 300000);
// niagara_templates.py lists the stock systems and inspects two of them; it needs NiagaraFluids and, for the inspection, NiagaraToolsets.
run('templates', cmd, script('niagara_templates.py'), 'niagara-templates', 300000, 'NIAGARA_TEMPLATES_REPORT');
run('verify (offscreen play)', editor, [project, '/Game/Maps/NiagaraProbe', '-RenderOffScreen', `-ExecCmds=py ${resolve(here, 'niagara_verify.py')}`,
  '-notraceserver', '-nosplash', '-unattended', '-nosound'], 'niagara-verify', 480000);

const read = (name) => (existsSync(report(name)) ? JSON.parse(readFileSync(report(name), 'utf8')) : undefined);
const checks = evaluate({
  traps: read('niagara-traps'), build: read('niagara-build'), author: read('niagara-author'),
  authorRerun: read('niagara-author-rerun'), verify: read('niagara-verify'), templates: read('niagara-templates'),
  plugins: select(readPlugins(join(engine, 'Engine', 'Plugins')).plugins, { names: ['Niagara', 'NiagaraFluids'] }),
});
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
if (keep) console.log(`kept ${root}`); else rmSync(root, { recursive: true, force: true });
process.exit(passed === total ? 0 : 1);
