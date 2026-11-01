// Separate native lane: run on an engine-equipped Windows host after inert acceptance.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCodeProject, discoverToolchain } from '../native-build.mjs';
import { loadConfiguration, readJson } from '../../../scripts/lib/unreal-run/controller.mjs';
import { verifyLifecycle, verifyIdentity, hash } from '../../../scripts/lib/unreal-run/contracts.mjs';
import { sourceIdentity, verifyArtifactFiles } from '../../../scripts/lib/unreal-run/identity.mjs';
const here = fileURLToPath(new URL('.', import.meta.url));
const launcher = fileURLToPath(new URL('../../../scripts/unreal-run.mjs', import.meta.url));
const args = process.argv.slice(2);
const get = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
if (process.platform !== 'win32' || !get('--engine') || !get('--evidence')) throw Error('Usage: node native-acceptance.mjs --engine <engine> --evidence <fresh-directory> [--only build,commandlet,editor,game,package,packaged] [--compiler version --sdk version]');
const root = resolve(get('--evidence')); const project = join(root, 'project');
const selected = (get('--only') ?? 'build,commandlet,editor,game,package,packaged').split(',');
const allowed = ['build', 'commandlet', 'editor', 'game', 'package', 'packaged'];
if (new Set(selected).size !== selected.length || selected.some(s => !allowed.includes(s))) throw Error('Unknown or duplicate native step');
mkdirSync(root, { recursive: true });
const output = join(root, `acceptance-${selected.join('-')}.json`);
if (existsSync(output)) throw Error('Acceptance report already exists; preserve prior evidence');
const toolchain = discoverToolchain({ compiler: get('--compiler'), sdk: get('--sdk') });
const configFile = join(project, 'launcher.local.json');
if (!existsSync(configFile)) {
  mkdirSync(project, { recursive: true });
  writeCodeProject({ root: project, name: 'LauncherSample', plugins: [], modules: [{ name: 'LauncherSmoke', type: 'Runtime', sourceDir: join(here, 'sample/LauncherSmoke') }] });
  const descriptor = readJson(join(project, 'LauncherSample.uproject')); descriptor.DisableEnginePluginsByDefault = true;
  writeFileSync(join(project, 'LauncherSample.uproject'), JSON.stringify(descriptor, null, 2));
  mkdirSync(join(project, 'Config'), { recursive: true });
  writeFileSync(join(project, 'Config/DefaultEngine.ini'), '[/Script/EngineSettings.GameMapsSettings]\nGameDefaultMap=/Engine/Maps/Entry\nEditorStartupMap=/Engine/Maps/Entry\n[/Script/Engine.RendererSettings]\nr.DynamicGlobalIlluminationMethod=0\nr.ReflectionMethod=0\n');
  writeFileSync(join(project, 'Config/DefaultGame.ini'), '[/Script/UnrealEd.ProjectPackagingSettings]\n+MapsToCook=(FilePath="/Engine/Maps/Entry")\n');
  writeFileSync(join(project, '.gitignore'), readFileSync(join(here, 'sample/.gitignore')));
  writeFileSync(configFile, JSON.stringify({ version: 1, project: './LauncherSample.uproject', engine: resolve(get('--engine')), sourceRoot: '.', editorTarget: 'LauncherSampleEditor', gameTarget: 'LauncherSample', packageDirectory: './Saved/Package' }, null, 2));
  const git = a => execFileSync('git', ['-C', project, ...a], { windowsHide: true, encoding: 'utf8' });
  git(['init']); git(['add', '--', '.']); git(['-c', 'user.name=Launcher fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Create disposable launcher acceptance sample']);
}
const config = loadConfiguration(configFile);
const results = [];
function command(operation, evidence, extra = [], file = configFile) { return [launcher, operation, '--config', file, '--evidence', evidence, '--timeout', operation === 'package' ? '1200' : operation === 'build' ? '600' : '120', '--wait', '60', '--', ...extra]; }
async function execute(name, operation, extra, file = configFile) {
  const evidence = join(root, name); if (existsSync(evidence)) throw Error(`Retained step exists: ${name}`);
  const argv = command(operation, evidence, extra, file); const started = new Date().toISOString();
  const out = openSync(join(root, `${name}.cli.log`), 'wx');
  const child = spawn(process.execPath, argv, { windowsHide: true, stdio: ['ignore', out, out] });
  const code = await new Promise((res, rej) => { child.once('error', rej); child.once('exit', res); }); closeSync(out);
  const lifecycle = existsSync(join(evidence, 'lifecycle.json')) ? readJson(join(evidence, 'lifecycle.json')) : null;
  const row = { name, operation, command: [process.execPath, ...argv], started, finished: new Date().toISOString(), exitCode: code, evidence, lifecycle: verifyLifecycle(lifecycle) };
  results.push(row);
  assert.equal(code, 0, `${name} exit ${code}; inspect ${evidence}`); assert.equal(row.lifecycle.valid, true, row.lifecycle.errors.join('; '));
  if (['build', 'package'].includes(operation)) {
    const identity = readJson(join(evidence, 'identity.json'));
    row.identity = verifyIdentity(identity, lifecycle, { source: sourceIdentity(config), operation }); row.artifacts = verifyArtifactFiles(identity);
    assert.equal(row.identity.valid, true, row.identity.errors.join('; ')); assert.equal(row.artifacts.valid, true, row.artifacts.errors.join('; '));
  }
  if (['editor', 'game'].includes(operation)) {
    const log = readFileSync(join(evidence, 'stdout.log'), 'utf8') + readFileSync(join(evidence, 'stderr.log'), 'utf8');
    assert.match(log, /LauncherSmoke completed/); row.smokeObserved = true;
  }
}
let failure;
try {
  for (const step of selected) {
    const common = ['-unattended', '-nosplash', '-nosound', '-notraceserver', '-stdout', '-FullStdOutLogOutput'];
    if (step === 'build') await execute(step, 'build', [`-CompilerVersion=${toolchain.compiler}`, `-WindowsSDKVersion=${toolchain.sdk}`, '-NoHotReload']);
    if (step === 'commandlet') await execute(step, 'commandlet', [...common, '-nullrhi', '-run=Cook', '-TargetPlatform=Windows', '-Map=/Engine/Maps/Entry', '-SkipZenStore', '-unversioned']);
    if (['editor', 'game'].includes(step)) await execute(step, step, [...common, '-nullrhi', '-LauncherSmokeSeconds=4']);
    if (step === 'package') await execute(step, 'package', ['-noP4', '-utf8output', '-unattended', '-nocompileeditor', '-map=/Engine/Maps/Entry', `-UbtArgs=-CompilerVersion=${toolchain.compiler} -WindowsSDKVersion=${toolchain.sdk}`]);
    if (step === 'packaged') {
      const file = join(project, 'packaged.local.json');
      writeFileSync(file, JSON.stringify({ ...readJson(configFile), gameExecutable: './Saved/Package/Windows/LauncherSample.exe' }, null, 2));
      await execute(step, 'game', [...common, '-nullrhi', '-LauncherSmokeSeconds=4'], file);
    }
  }
} catch (error) { failure = error.stack; console.error(failure); process.exitCode = 1; }
const report = { version: 1, kind: 'unreal-run/engine-acceptance', source: sourceIdentity(config), selected, results, passed: !failure && results.length === selected.length, failure: failure ?? null };
writeFileSync(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ report: output, passed: report.passed, sha256: hash(readFileSync(output)) }));
