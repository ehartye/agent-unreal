// node compare_gpu_run.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--skip-package] [--project <existing project folder>] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
// Runs the comparison scene's GPU time probe end to end on one machine: writes a throwaway code project (one Game module holding Source/*.cpp and AECompare.h, an empty map),
// builds the Editor target (the map commandlet needs it), makes the map, builds the Game target, packages with RunUAT BuildCookRun, runs compare.ps1 twice from the packaged
// executable (-Set perf rendered, and -Set perf -Headless) and judges each receipt with compare_perf.mjs. Exit code 0 only when both judges pass.
//   --project <folder>  reuse a project folder this runner wrote earlier (the sources are not rewritten; the builds and the package still run, incrementally)
//   --skip-package      do not package; run the executable already archived under <project>/Archive (needs --project)
//   --modes <list>      comma-separated runs to make, default rendered,headless (for example --modes headless)
//   --keep              keep the temp project folder when the run succeeds (it is always kept when a step fails)
// Windows, PowerShell 7 (pwsh) and Node only. Not part of node scripts/check.mjs; the pure pieces it uses are tested there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverToolchain, writeCodeProject, buildEditor, buildGame, packageGame } from '../native-build.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const skipPackage = args.includes('--skip-package');
const engine = flag('--engine') || process.env.UE_ROOT;
const existing = flag('--project');
if (!engine || (skipPackage && !existing)) {
  console.error('usage: node compare_gpu_run.mjs --engine <UE_5.8 folder> [--keep] [--skip-package --project <folder>] [--project <existing folder>] [--compiler <x.y.z>] [--sdk <10.0.n.n>]');
  process.exit(2);
}
const editorCmd = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe');
if (!existsSync(editorCmd)) { console.error(`not found: ${editorCmd}`); process.exit(2); }

const here = import.meta.dirname;
const name = 'CompareGpuProbe';
const moduleName = 'CompareGpu';
const mapPath = '/Game/Maps/CompareStage';
const root = existing || mkdtempSync(join(tmpdir(), 'cgr-'));
const saved = join(root, 'Saved');
mkdirSync(saved, { recursive: true });
const uproject = join(root, `${name}.uproject`);
const archive = join(root, 'Archive');
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const tail = (p, n = 25) => readText(p).split(/\r?\n/).filter(Boolean).slice(-n).join('\n');
const summary = [];
const note = (line) => { summary.push(line); console.log(line); };
const failed = (step, detail) => { note(`STOPPED at ${step}: ${detail}`); note(`project kept at ${root}`); process.exit(1); };

try {
  const version = JSON.parse(readText(join(engine, 'Engine', 'Build', 'Build.version')));
  note(`engine ${version.MajorVersion}.${version.MinorVersion}.${version.PatchVersion} (changelist ${version.Changelist}), ${engine}`);
} catch { note('engine version: Build.version unreadable'); }
note(`project folder ${root}`);

const toolchain = discoverToolchain({ compiler: flag('--compiler'), sdk: flag('--sdk') });
note(`toolchain: compiler ${toolchain.compiler}, SDK ${toolchain.sdk}`);

if (!existing) {
  // The module folder: the harness sources as they are, a Build.cs with the dependencies the README lists, and the primary game module.
  const stage = mkdtempSync(join(tmpdir(), 'cgr-module-'));
  for (const file of ['AECompare.h', 'AECompare.cpp', 'ExampleSets.cpp', 'PerfSets.cpp']) cpSync(join(here, 'Source', file), join(stage, file));
  writeFileSync(join(stage, `${moduleName}.Build.cs`), `using UnrealBuildTool;

public class ${moduleName} : ModuleRules
{
	public ${moduleName}(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine" });
		PrivateDependencyModuleNames.AddRange(new string[] { "InputCore", "Json", "RHI", "RenderCore", "Niagara" });
	}
}
`);
  writeFileSync(join(stage, `${moduleName}Module.cpp`), `#include "Modules/ModuleManager.h"

IMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, ${moduleName}, "${moduleName}");
`);
  writeCodeProject({ root, name, modules: [{ name: moduleName, type: 'Runtime', sourceDir: stage }] });
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(root, 'Config'), { recursive: true });
  writeFileSync(join(root, 'Config', 'DefaultGame.ini'), `[/Script/UnrealEd.ProjectPackagingSettings]
+DirectoriesToAlwaysCook=(Path="/Niagara/DefaultAssets/Templates/Systems")
+MapsToCook=(FilePath="${mapPath}")
`);
  writeFileSync(join(root, 'Config', 'DefaultEngine.ini'), `[/Script/EngineSettings.GameMapsSettings]
GameDefaultMap=${mapPath}
EditorStartupMap=${mapPath}
`);
  writeFileSync(join(root, 'make_map.py'), `import unreal
unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
world = unreal.EditorLevelLibrary.get_editor_world()
ok = unreal.EditorLoadingAndSavingUtils.save_map(world, "${mapPath}")
unreal.log("COMPARE_MAP_SAVED " + str(bool(ok)))
`);

  const editorBuild = await buildEditor({ engine, uproject, name, toolchain, logPath: join(saved, 'build-editor.log') });
  note(`build Editor target: exit ${editorBuild.exit}, ${editorBuild.seconds} s${editorBuild.timedOut ? ' (timed out)' : ''}`);
  if (editorBuild.exit !== 0) failed('Editor build', `see ${join(saved, 'build-editor.log')}\n${tail(join(saved, 'build-editor.log'))}`);

  const started = Date.now();
  const mapLog = join(saved, 'make-map.log');
  const mapRun = spawnSync(editorCmd, [uproject, '-run=pythonscript', `-script=${join(root, 'make_map.py')}`, '-nullrhi', '-nopause', '-unattended', '-nosplash', '-nosound', `-abslog=${mapLog}`],
    { stdio: 'ignore', timeout: 900000, windowsHide: true });
  const mapFile = join(root, 'Content', 'Maps', 'CompareStage.umap');
  note(`make map: exit ${mapRun.status}, ${Math.round((Date.now() - started) / 1000)} s, ${existsSync(mapFile) ? 'CompareStage.umap written' : 'NO MAP WRITTEN'}`);
  if (!existsSync(mapFile)) failed('map commandlet', `see ${mapLog}\n${tail(mapLog)}`);
}

if (!skipPackage) {
  const gameBuild = await buildGame({ engine, uproject, name, toolchain, logPath: join(saved, 'build-game.log') });
  note(`build Game target: exit ${gameBuild.exit}, ${gameBuild.seconds} s${gameBuild.timedOut ? ' (timed out)' : ''}`);
  if (gameBuild.exit !== 0) failed('Game build', `see ${join(saved, 'build-game.log')}\n${tail(join(saved, 'build-game.log'))}`);

  rmSync(archive, { recursive: true, force: true });
  const pack = await packageGame({ engine, uproject, archiveDirectory: archive, toolchain, logPath: join(saved, 'package.log') });
  note(`package (BuildCookRun): exit ${pack.exit}, ${pack.seconds} s${pack.timedOut ? ' (timed out)' : ''}`);
  if (pack.exit !== 0) failed('packaging', `see ${join(saved, 'package.log')}\n${tail(join(saved, 'package.log'), 40)}`);
}

// The packaged executable: <archive>/<platform folder>/<name>.exe
const findExe = (dir) => {
  if (!existsSync(dir)) return undefined;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === `${name}.exe`) return join(dir, entry.name);
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== 'Engine' && entry.name !== name) { const hit = findExe(join(dir, entry.name)); if (hit) return hit; }
  }
  return undefined;
};
const exe = findExe(archive);
if (!exe) failed('locating the packaged game', `no ${name}.exe under ${archive}`);
note(`packaged game: ${exe}`);

const outRoot = join(root, 'out', String(Date.now()));
const results = {};
const modes = (flag('--modes') || 'rendered,headless').split(',').map((m) => m.trim()).filter((m) => m === 'rendered' || m === 'headless');
for (const mode of modes) {
  const out = join(outRoot, mode);
  const started = Date.now();
  const run = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', join(here, 'compare.ps1'), '-Exe', exe, '-Set', 'perf', '-OutputDirectory', out,
    '-GameMode', `/Script/${moduleName}.AECompareGameMode`, '-Map', mapPath, '-RequirePerf', ...(mode === 'headless' ? ['-Headless'] : [])],
    { encoding: 'utf8', timeout: 900000, windowsHide: true });
  note(`compare.ps1 (${mode}): exit ${run.status}, ${Math.round((Date.now() - started) / 1000)} s, output ${out}`);
  console.log((run.stdout || '').trim());
  if (run.stderr?.trim()) console.log(run.stderr.trim());
  const judge = spawnSync(process.execPath, [join(here, 'compare_perf.mjs'), out], { encoding: 'utf8', windowsHide: true });
  console.log((judge.stdout || '').trim());
  if (judge.stderr?.trim()) console.log(judge.stderr.trim());
  results[mode] = { runExit: run.status, judgeExit: judge.status };
  note(`compare_perf.mjs (${mode}): exit ${judge.status}`);
}

const ok = modes.length > 0 && Object.values(results).every((r) => r.runExit === 0 && r.judgeExit === 0);
note(ok ? 'RESULT: both judges pass' : `RESULT: not every judge passes ${JSON.stringify(results)}`);
if (ok && !keep && !existing) rmSync(root, { recursive: true, force: true }); else note(`project kept at ${root}`);
process.exit(ok ? 0 : 1);
