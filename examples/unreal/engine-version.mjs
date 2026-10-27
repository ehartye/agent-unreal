// Shared by the runners that print or record which engine they ran on. No dependencies; Node 20.11+.
//   - readEngineVersion(): the version from Engine/Build/Build.version and, on Windows, the changelist inside the editor
//     executable's product version ("++UE5+Release-5.8-CL-58902052"). After a Launcher update the version files can be left
//     stale while the binaries are new, so a disagreement is reported as a warning and the executable's changelist wins.
//   - readPin() and pinNote(): the pinned engine build in engine-version.json at the repo root, and the one line a runner prints when
//     the engine it found is another build. The note informs; nothing in this repo refuses to run, or exits non-zero, on a different build.
//   - describeEngine(): the lines a runner prints first (the engine line, one line per warning, then the pin note when it applies).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The problems with a parsed pin file (an empty list when it is valid): the unreal block needs a version "X.Y.Z", an integer
 * changelist and a verifiedOn date; the uefn block needs a version "NN.NN", a build, a verifiedOn date or null, and may carry a note.
 */
export function validatePin(pin) {
  const problems = [];
  const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!object(pin)) return ['the pin is not an object'];
  const { unreal, uefn } = pin;
  if (!object(unreal)) problems.push('unreal is missing');
  else {
    if (typeof unreal.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(unreal.version)) problems.push('unreal.version must look like 5.8.4');
    if (!Number.isInteger(unreal.changelist) || unreal.changelist <= 0) problems.push('unreal.changelist must be a positive integer');
    if (typeof unreal.verifiedOn !== 'string' || !DATE.test(unreal.verifiedOn)) problems.push('unreal.verifiedOn must be a date like 2026-10-26');
  }
  if (!object(uefn)) problems.push('uefn is missing');
  else {
    if (typeof uefn.version !== 'string' || !/^\d+\.\d{2}$/.test(uefn.version)) problems.push('uefn.version must look like 42.40');
    if (typeof uefn.build !== 'string' || !/^\d+$/.test(uefn.build)) problems.push('uefn.build must be a string of digits');
    if (uefn.verifiedOn !== null && (typeof uefn.verifiedOn !== 'string' || !DATE.test(uefn.verifiedOn))) problems.push('uefn.verifiedOn must be a date or null');
    if (uefn.note !== undefined && typeof uefn.note !== 'string') problems.push('uefn.note must be a string');
  }
  return problems;
}

/**
 * The pin in engine-version.json at `root` (default: the repo root, found from this module's location). Never throws: returns null
 * when the file is absent, unreadable, not JSON or not a valid pin (see validatePin).
 */
export function readPin(root = REPO_ROOT) {
  try {
    const pin = JSON.parse(readFileSync(join(root, 'engine-version.json'), 'utf8'));
    return validatePin(pin).length === 0 ? pin : null;
  } catch { return null; }
}

/**
 * null when there is no pin or the engine's changelist (the editor executable's when it could be read, else Build.version's)
 * equals the pin's; otherwise one line saying this is not the pinned build. An engine whose changelist could not be read gets the
 * line too, since nothing shows it is the pinned build. It is a note, not a gate.
 */
export function pinNote(info, pin) {
  const unreal = pin && pin.unreal;
  if (!unreal || !Number.isInteger(unreal.changelist)) return null;
  if (info && info.changelist === unreal.changelist) return null;
  return `NOTE: not the pinned build (pin: ${unreal.version}, changelist ${unreal.changelist}); claims in this repo were verified on the pin and results here are at your own risk`;
}

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

/**
 * The lines a runner prints for an engine read by readEngineVersion: the engine line, each warning prefixed "WARNING: ", then the pin
 * note (see pinNote) when the engine is not the pinned build. options.pin replaces the pin read from the repo (null means none).
 */
export function describeEngine(info, engine, options = {}) {
  const pin = options.pin === undefined ? readPin() : options.pin;
  const numbers = info.major === null ? null : `${info.major}.${info.minor}.${info.patch}`;
  const stale = info.warnings.length > 0;
  let line;
  if (numbers === null && info.changelist === null) line = 'engine version: Build.version unreadable';
  else if (numbers === null) line = `engine version: Build.version unreadable, changelist ${info.changelist} (editor executable)`;
  else if (stale) line = `engine ${numbers} (version file), changelist ${info.changelist} (editor executable)`;
  else line = `engine ${numbers} (changelist ${info.changelist ?? 'unknown'})`;
  const note = pinNote(info, pin);
  return [`${line}, ${engine}`, ...info.warnings.map((w) => `WARNING: ${w}`), ...(note ? [note] : [])];
}
