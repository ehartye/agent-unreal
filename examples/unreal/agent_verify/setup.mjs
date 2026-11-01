import { existsSync, mkdirSync, writeFileSync, cpSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { writeCodeProject } from '../native-build.mjs';
const here = dirname(fileURLToPath(import.meta.url));

export function setup({ project, engine, compiler, sdk, comparison }) {
  const root = resolve(project);
  if (existsSync(root)) throw new Error('Project directory already exists; setup never overwrites a consumer.');
  if (!engine || !compiler || !sdk) throw new Error('Explicit engine, compiler and SDK are required.');
  mkdirSync(root, { recursive: true });
  const descriptor = writeCodeProject({ root, name: 'ObservationSample', plugins: ['AgentVerify'], modules: [{ name: 'ObservationSample', type: 'Runtime', sourceDir: join(here, 'module/ObservationSample') }] });
  const description = JSON.parse(readFileSync(descriptor)); description.DisableEnginePluginsByDefault = true;
  writeFileSync(descriptor, JSON.stringify(description, null, 2) + '\n');
  cpSync(resolve(here, '../../../runtime/AgentVerify'), join(root, 'Plugins/AgentVerify'), { recursive: true });
  mkdirSync(join(root, 'Config'));
  writeFileSync(join(root, 'Config/DefaultEngine.ini'), '[/Script/EngineSettings.GameMapsSettings]\nGameDefaultMap=/Engine/Maps/Entry\nEditorStartupMap=/Engine/Maps/Entry\nGlobalDefaultGameMode=/Script/ObservationSample.ObservationGameMode\n[/Script/Engine.RendererSettings]\nr.DefaultFeature.AutoExposure=False\nr.AntiAliasingMethod=0\nr.DynamicGlobalIlluminationMethod=0\nr.ReflectionMethod=0\n');
  writeFileSync(join(root, '.gitignore'), 'Binaries/\nIntermediate/\nSaved/\nDerivedDataCache/\nPlugins/*/Binaries/\nPlugins/*/Intermediate/\nlauncher.local.json\nacceptance.local.json\n');
  writeFileSync(join(root, 'launcher.local.json'), JSON.stringify({ version: 1, project: './ObservationSample.uproject', engine: resolve(engine), sourceRoot: '.', editorTarget: 'ObservationSampleEditor', gameTarget: 'ObservationSample' }, null, 2) + '\n');
  writeFileSync(join(root, 'acceptance.local.json'), JSON.stringify({ schema_version: 1, compiler, sdk, comparison: comparison ? resolve(comparison) : null }, null, 2) + '\n');
  for (const args of [['init'], ['add', '--', '.'], ['-c', 'user.name=Observation sample', '-c', 'user.email=sample@example.invalid', 'commit', '-m', 'Create disposable observation sample']]) execFileSync('git', ['-C', root, ...args], { stdio: 'pipe', windowsHide: true });
  return { project: root, descriptor };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const name = process.argv[i]?.slice(2);
      if (!['project', 'engine', 'compiler', 'sdk', 'comparison'].includes(name) || !process.argv[i + 1] || options[name]) throw new Error('usage: setup.mjs --project <fresh-directory> --engine <engine> --compiler <version> --sdk <version> [--comparison <manifest>]');
      options[name] = process.argv[i + 1];
    }
    console.log(JSON.stringify(setup(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
