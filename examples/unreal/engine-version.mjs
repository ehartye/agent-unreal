// Shared by the runners that print or record which engine they ran on. No dependencies; Node 20.11+.
//   - readEngineVersion(): the version from Engine/Build/Build.version and, on Windows, the changelist inside the editor
//     executable's product version ("++UE5+Release-5.8-CL-58902052"). After a Launcher update the version files can be left
//     stale while the binaries are new, so a disagreement is reported as a warning and the executable's changelist wins.
//   - describeEngine(): the lines a runner prints first (the engine line, then one line per warning).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The changelist in an editor executable's product version ("++UE5+Release-5.8-CL-58902052" gives 58902052), or undefined. */
export function changelistFromProductVersion(productVersion) {
  const m = /CL-(\d+)/.exec(String(productVersion ?? ''));
  return m ? Number(m[1]) : undefined;
}

/** Reads the editor executable's ProductVersion through PowerShell (Windows only); undefined when it cannot be read. */
export function readExecutableProductVersion(exe) {
  if (!existsSync(exe)) return undefined;
  const quoted = exe.replace(/'/g, "''");
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item -LiteralPath '${quoted}').VersionInfo.ProductVersion`], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  return ps.status === 0 && ps.stdout.trim() ? ps.stdout.trim() : undefined;
}

/**
 * Identifies the engine install at `engine` (the folder that contains Engine). Never throws.
 * Returns { major, minor, patch, changelist, source, warnings, versionFileChangelist, executableChangelist }:
 *   - major, minor, patch come from Build.version (null when it is unreadable or malformed);
 *   - changelist is the executable's when it could be read, else Build.version's (null when neither);
 *   - source is 'executable' (changelist from the editor executable), 'Build.version' or 'unreadable';
 *   - warnings is a list of sentences, empty when the two changelists agree or the executable was not read.
 * Options (for tests): platform (default process.platform), readProductVersion(exePath) (default PowerShell).
 */
export function readEngineVersion(engine, { platform = process.platform, readProductVersion = readExecutableProductVersion } = {}) {
  const info = { major: null, minor: null, patch: null, changelist: null, source: 'unreadable', warnings: [], versionFileChangelist: null, executableChangelist: null };
  try {
    const v = JSON.parse(readFileSync(join(engine, 'Engine', 'Build', 'Build.version'), 'utf8'));
    const whole = (n) => (Number.isInteger(n) && n >= 0 ? n : null);
    if (whole(v.MajorVersion) !== null && whole(v.MinorVersion) !== null && whole(v.PatchVersion) !== null) {
      info.major = v.MajorVersion; info.minor = v.MinorVersion; info.patch = v.PatchVersion;
      info.versionFileChangelist = whole(v.Changelist);
      info.changelist = info.versionFileChangelist;
      info.source = 'Build.version';
    }
  } catch { /* unreadable or not JSON: reported as source 'unreadable' */ }
  if (platform === 'win32') {
    let exeChangelist;
    try { exeChangelist = changelistFromProductVersion(readProductVersion(join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe'))); } catch { /* not readable: no warning */ }
    if (exeChangelist !== undefined) {
      info.executableChangelist = exeChangelist;
      if (info.versionFileChangelist !== null && info.versionFileChangelist !== exeChangelist) {
        info.warnings.push(`the editor executable is changelist ${exeChangelist} but Build.version says ${info.versionFileChangelist}: the version files may be stale after a launcher update, so the version numbers on the engine line are from the version file`);
      }
      info.changelist = exeChangelist;
      info.source = 'executable';
    }
  }
  return info;
}

/** The lines a runner prints for an engine read by readEngineVersion: the engine line, then each warning prefixed "WARNING: ". */
export function describeEngine(info, engine) {
  const numbers = info.major === null ? null : `${info.major}.${info.minor}.${info.patch}`;
  const stale = info.warnings.length > 0;
  let line;
  if (numbers === null && info.changelist === null) line = 'engine version: Build.version unreadable';
  else if (numbers === null) line = `engine version: Build.version unreadable, changelist ${info.changelist} (editor executable)`;
  else if (stale) line = `engine ${numbers} (version file), changelist ${info.changelist} (editor executable)`;
  else line = `engine ${numbers} (changelist ${info.changelist ?? 'unknown'})`;
  return [`${line}, ${engine}`, ...info.warnings.map((w) => `WARNING: ${w}`)];
}
