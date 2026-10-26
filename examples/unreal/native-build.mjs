// Shared by the native C++ examples (landscape_bridge, automation_test). No dependencies; Windows.
//   - discoverToolchain(): finds the Visual Studio 2022 MSVC toolset and the Windows SDK that are actually installed, so no
//     compiler version is written into a script. Override with the options { compiler, sdk } or the flags the runners pass on.
//   - writeCodeProject(): writes a throwaway Unreal code project (descriptor, two target files, module sources).
//   - buildEditor(), buildGame(): run Epic's Build.bat for the project's Editor or Game target, hidden, logging to a file.
//   - packageGame(): runs RunUAT.bat BuildCookRun (build, cook, stage, pak, archive) for a Windows Development game.
//   - runIfBuilt(): runs a follow-on step (a replay, a test run) only when the build succeeded, and says so when it skipped it.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readdirSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';

/** Highest dotted version in a list ("14.44.35207" > "14.9.1"); entries that are not dotted numbers are ignored. */
export function highestVersion(names) {
  const parsed = names.filter((n) => /^\d+(\.\d+)+$/.test(n)).map((n) => ({ n, parts: n.split('.').map(Number) }));
  parsed.sort((a, b) => {
    for (let i = 0; i < Math.max(a.parts.length, b.parts.length); i++) {
      const d = (a.parts[i] ?? 0) - (b.parts[i] ?? 0);
      if (d) return d;
    }
    return 0;
  });
  return parsed.length ? parsed[parsed.length - 1].n : undefined;
}

/** The compiler version UBT expects: the first three parts of cl.exe's ProductVersion ("14.44.35228.0" becomes "14.44.35228"). */
export function compilerFlagVersion(productVersion) {
  const m = /^(\d+\.\d+\.\d+)/.exec(String(productVersion ?? '').trim());
  return m ? m[1] : undefined;
}

/** The Build.bat argument list for an Editor target. */
export function buildArguments({ target, uproject, compiler, sdk, extraArgs = [] }) {
  return [target, 'Win64', 'Development', `-Project=${uproject}`, '-WaitMutex', '-NoHotReloadFromIDE', '-2022',
    ...(compiler ? [`-CompilerVersion=${compiler}`] : []), ...(sdk ? [`-WindowsSDKVersion=${sdk}`] : []), ...extraArgs];
}

const programFilesX86 = () => process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';

export function discoverToolchain(options = {}) {
  const result = { compiler: options.compiler, sdk: options.sdk, notes: [] };
  if (!result.compiler) {
    const vswhere = join(programFilesX86(), 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    let install;
    if (existsSync(vswhere)) {
      const out = spawnSync(vswhere, ['-latest', '-products', '*', '-version', '[17.0,18.0)', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
        { encoding: 'utf8', windowsHide: true });
      install = out.stdout.trim().split(/\r?\n/)[0];
    }
    const msvcRoot = install && join(install, 'VC', 'Tools', 'MSVC');
    if (msvcRoot && existsSync(msvcRoot)) {
      const toolset = highestVersion(readdirSync(msvcRoot));
      const cl = toolset && join(msvcRoot, toolset, 'bin', 'Hostx64', 'x64', 'cl.exe');
      if (cl && existsSync(cl)) {
        const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item '${cl}').VersionInfo.ProductVersion`], { encoding: 'utf8', windowsHide: true });
        result.compiler = compilerFlagVersion(ps.stdout);
        result.notes.push(`toolset folder ${toolset}, cl.exe ProductVersion ${ps.stdout.trim()}`);
      }
    }
  }
  if (!result.sdk) {
    const include = join(programFilesX86(), 'Windows Kits', '10', 'Include');
    if (existsSync(include)) result.sdk = highestVersion(readdirSync(include).filter((n) => /^10\.0\.\d+\.\d+$/.test(n)).map((n) => n.slice(0)));
  }
  return result;
}

/**
 * Writes <root>/<name>.uproject, Source/<name>.Target.cs, Source/<name>Editor.Target.cs and copies each module folder from
 * `modules` ({ name, type, sourceDir }) into Source/. The Editor target lists every module in ExtraModuleNames.
 */
export function writeCodeProject({ root, name, engineAssociation = '5.8', plugins = [], modules }) {
  const source = join(root, 'Source');
  mkdirSync(source, { recursive: true });
  writeFileSync(join(root, `${name}.uproject`), JSON.stringify({
    FileVersion: 3, EngineAssociation: engineAssociation, Category: '', Description: '',
    Modules: modules.map((m) => ({ Name: m.name, Type: m.type, LoadingPhase: 'Default' })),
    Plugins: plugins.map((p) => ({ Name: p, Enabled: true })),
  }, null, 2));
  const extra = modules.map((m) => `"${m.name}"`).join(', ');
  const target = (suffix, type) => `using UnrealBuildTool;
using System.Collections.Generic;

public class ${name}${suffix}Target : TargetRules
{
	public ${name}${suffix}Target(TargetInfo Target) : base(Target)
	{
		Type = TargetType.${type};
		DefaultBuildSettings = BuildSettingsVersion.V7;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8;
		ExtraModuleNames.AddRange(new string[] { ${extra} });
	}
}
`;
  writeFileSync(join(source, `${name}.Target.cs`), target('', 'Game'));
  writeFileSync(join(source, `${name}Editor.Target.cs`), target('Editor', 'Editor'));
  for (const m of modules) cpSync(m.sourceDir, join(source, m.name), { recursive: true });
  return join(root, `${name}.uproject`);
}

/** Runs a hidden cmd.exe command line, logging to `logPath`; resolves { exit, seconds, timedOut }. */
function runHidden({ line, logPath, timeoutMs }) {
  const fd = openSync(logPath, 'w');
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], { windowsHide: true, windowsVerbatimArguments: true, stdio: ['ignore', fd, fd] });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); }, timeoutMs);
    child.on('exit', (code) => { clearTimeout(timer); closeSync(fd); resolve({ exit: code, seconds: Math.round((Date.now() - started) / 1000), timedOut }); });
  });
}

const quoteArg = (a) => (/[\s]/.test(a) ? `"${a}"` : a);

/** Runs Build.bat for `<name>Editor` hidden; resolves { exit, seconds, timedOut }. Output goes to `logPath`. `extraArgs` are appended to the Build.bat arguments (for example "-ForceUnity"). */
export function buildEditor({ engine, uproject, name, toolchain, logPath, timeoutMs = 1800000, extraArgs = [] }) {
  const bat = join(engine, 'Engine', 'Build', 'BatchFiles', 'Build.bat').replace(/\//g, '\\');
  const args = buildArguments({ target: `${name}Editor`, uproject: uproject.replace(/\//g, '\\'), compiler: toolchain.compiler, sdk: toolchain.sdk, extraArgs });
  return runHidden({ line: `""${bat}" ${args.map(quoteArg).join(' ')}"`, logPath, timeoutMs });
}

/** Runs Build.bat for the Game target `<name>` (Win64 Development) hidden; same result and arguments as buildEditor. */
export function buildGame({ engine, uproject, name, toolchain, logPath, timeoutMs = 1800000, extraArgs = [] }) {
  const bat = join(engine, 'Engine', 'Build', 'BatchFiles', 'Build.bat').replace(/\//g, '\\');
  const args = buildArguments({ target: name, uproject: uproject.replace(/\//g, '\\'), compiler: toolchain.compiler, sdk: toolchain.sdk, extraArgs });
  return runHidden({ line: `""${bat}" ${args.map(quoteArg).join(' ')}"`, logPath, timeoutMs });
}

/** The RunUAT.bat argument list that builds, cooks, stages, paks and archives a Windows Development game. */
export function packageArguments({ uproject, archiveDirectory, compiler, sdk, extraArgs = [] }) {
  return ['BuildCookRun', `-project=${uproject}`, '-platform=Win64', '-clientconfig=Development', '-build', '-cook', '-stage', '-pak', '-archive',
    `-archivedirectory=${archiveDirectory}`, '-noP4', '-utf8output', '-unattended', ...(compiler ? [`-CompilerVersion=${compiler}`] : []),
    ...(sdk ? [`-WindowsSDKVersion=${sdk}`] : []), ...extraArgs];
}

/** Runs RunUAT.bat BuildCookRun hidden (see packageArguments); resolves { exit, seconds, timedOut }. */
export function packageGame({ engine, uproject, archiveDirectory, toolchain, logPath, timeoutMs = 3600000, extraArgs = [] }) {
  const bat = join(engine, 'Engine', 'Build', 'BatchFiles', 'RunUAT.bat').replace(/\//g, '\\');
  const args = packageArguments({ uproject: uproject.replace(/\//g, '\\'), archiveDirectory: archiveDirectory.replace(/\//g, '\\'), compiler: toolchain.compiler, sdk: toolchain.sdk, extraArgs });
  return runHidden({ line: `""${bat}" ${args.map(quoteArg).join(' ')}"`, logPath, timeoutMs });
}

/** True when a buildEditor() result is a success: exit code 0 and no timeout. Anything else (including a killed build, exit null) is not. */
export function buildSucceeded(build) {
  return !!build && build.exit === 0 && !build.timedOut;
}

/**
 * Runs `step` (a replay, a test run, a capture; sync or async) only when the build succeeded. After a failed build the previous
 * binary is still on disk, so an unconditional follow-on step would test it and report on the old code. Resolves
 * { ran: true, result } or { ran: false, reason }; a skipped step is reported through `log` (default console.log), never silent.
 */
export async function runIfBuilt(build, step, { label = 'follow-on step', log = console.log } = {}) {
  if (!buildSucceeded(build)) {
    const why = build?.timedOut ? 'timed out' : `failed (exit ${build?.exit ?? 'unknown'})`;
    const reason = `build ${why}`;
    log(`${label} skipped: ${reason}; the previous binary is still on disk and was not tested`);
    return { ran: false, reason };
  }
  return { ran: true, result: await step() };
}
