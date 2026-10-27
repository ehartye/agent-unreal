// node scripts/pin-engine.mjs --engine "<UE_5.8 folder>" [--version X.Y.Z] [--report <verify-report.json>]... [--write] [--force]
// Writes the engine pin (engine-version.json) from an installed engine once scripts/verify-engine.mjs has passed on it.
// Dry run by default: prints the pin it would write and what stands in the way. Dependency free; Node 20.11+.
//
// The changelist comes from the editor executable (through examples/unreal/engine-version.mjs), the version from Build.version or --version.
// After a launcher update Build.version can be stale while the binaries are new; then the version numbers cannot be trusted, and the
// tool refuses to write unless --version says what the build is. That is this tool's own safety against labelling a pin wrongly: nothing
// else in the repo refuses to run on an engine because of the pin.
// --write also needs green verify-engine reports (--report, repeatable, one per machine class) that cover every entry of the manifest
// except the owner entries and were run on this engine's changelist; --force writes without them. The uefn block is never touched.
// Exit code 0 on a dry run or a write, 1 when --write refused, 2 on a usage error.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readEngineVersion, validatePin } from '../examples/unreal/engine-version.mjs';
import { MANIFEST } from './verify-engine-manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_PIN_FILE = join(ROOT, 'engine-version.json');

export const USAGE = `usage: node scripts/pin-engine.mjs --engine <UE_5.8 folder> [--version X.Y.Z] [--report <verify-report.json>]... [--write] [--force]
  Dry run: prints the pin that would be written from the engine.
  --version X.Y.Z  the version, when Build.version is stale or unreadable (the changelist still comes from the editor executable)
  --report <file>  a verify-engine.mjs report (repeatable: one per machine class); --write needs green reports that cover the manifest
  --write          update the unreal block of engine-version.json (verifiedOn is today); the uefn block is left alone
  --force          write without green reports (an unidentified build is still refused)`;

/** { engine, version, reports, write, force, pinFile, help } or { error }. */
export function parseArgs(argv) {
  const out = { engine: null, version: null, reports: [], write: false, force: false, pinFile: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const name = ['--engine', '--version', '--report', '--pin-file'].find((o) => arg === o || arg.startsWith(`${o}=`));
    if (arg === '--write') out.write = true;
    else if (arg === '--force') out.force = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (name) {
      const value = arg === name ? argv[++i] : arg.slice(name.length + 1);
      if (value === undefined || value === '' || (arg === name && value.startsWith('--'))) return { error: `${name} needs a value` };
      if (name === '--engine') out.engine = value;
      else if (name === '--version') out.version = value;
      else if (name === '--pin-file') out.pinFile = value;
      else out.reports.push(value);
    } else return { error: `unknown option ${arg}` };
  }
  if (out.version !== null && !/^\d+\.\d+\.\d+$/.test(out.version)) return { error: `--version must look like 5.8.4, not ${out.version}` };
  return out;
}

/** Today as YYYY-MM-DD in local time. */
export const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const inline = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(', ')}}`;
};
/** The pin file's text: one line, keys in order, ", " and ": " separators, a final newline. */
export const formatPin = (pin) => `${inline(pin)}\n`;

/**
 * What the reports say about a build: { problems, covered }. A report counts when it is a verify-engine report, was run on `changelist`
 * and is green; covered lists the manifest entries that passed or failed as expected in the counted reports.
 */
export function readReports(paths, { changelist, readFile = (p) => readFileSync(p, 'utf8') }) {
  const problems = [];
  const covered = new Set();
  for (const path of paths) {
    let report;
    try { report = JSON.parse(readFile(path)); } catch (error) { problems.push(`${path}: cannot read the report (${error.message})`); continue; }
    if (!report || report.schema !== 'verify-engine/1' || !Array.isArray(report.entries)) { problems.push(`${path}: not a verify-engine.mjs report`); continue; }
    const reportChangelist = report.engine && report.engine.changelist;
    if (reportChangelist !== changelist) { problems.push(`${path}: run on changelist ${reportChangelist ?? 'unknown'}, not ${changelist}`); continue; }
    const bad = report.entries.filter((e) => e.status === 'mismatch' || e.status === 'error');
    if (bad.length > 0) { problems.push(`${path}: not green (${bad.map((e) => `${e.name} ${e.status}`).join(', ')})`); continue; }
    for (const e of report.entries) if (e.status === 'pass' || e.status === 'as-expected') covered.add(e.name);
  }
  return { problems, covered };
}

/**
 * Plans the pin without touching a file. Returns { newPin, version, changelist, identify: [string], evidence: [string], notes: [string] }:
 *   identify  reasons the build cannot be named (never overridden by --force)
 *   evidence  reasons the reports do not back a write (overridden by --force)
 *   newPin    the pin that would be written, or null when identify is not empty
 */
export function planPin({ info, versionArg, pin, reports, manifest = MANIFEST, today, readFile }) {
  const identify = [], evidence = [], notes = [];
  const changelist = info.changelist;
  if (changelist === null) identify.push('the engine\'s changelist cannot be read (no editor executable version, no Build.version)');
  let version = null;
  const fileVersion = info.major === null ? null : `${info.major}.${info.minor}.${info.patch}`;
  if (versionArg) {
    version = versionArg;
    if (fileVersion && fileVersion !== versionArg) notes.push(`Build.version says ${fileVersion}; ${versionArg} comes from --version`);
  } else if (fileVersion === null) {
    identify.push('Build.version is unreadable, so the version is unknown: pass --version X.Y.Z');
  } else if (info.warnings.length > 0) {
    identify.push(`Build.version (${fileVersion}, changelist ${info.versionFileChangelist}) disagrees with the editor executable (changelist ${info.executableChangelist}), so ${fileVersion} may be the old version: pass --version X.Y.Z to say what this build is`);
  } else version = fileVersion;
  if (info.warnings.length > 0 && versionArg) notes.push(...info.warnings);
  if (!pin) identify.push('engine-version.json is missing or invalid, so there is no pin to update');

  if (reports.length === 0) evidence.push('no verify-engine report was given (--report)');
  else {
    const { problems, covered } = readReports(reports, { changelist, readFile });
    evidence.push(...problems);
    const missing = manifest.filter((e) => e.class !== 'owner' && !covered.has(e.name)).map((e) => e.name);
    if (problems.length === 0 && missing.length > 0) evidence.push(`the reports do not cover ${missing.length} manifest ${missing.length === 1 ? 'entry' : 'entries'}: ${missing.join(', ')}`);
  }

  const newPin = identify.length > 0 ? null : { ...pin, unreal: { version, changelist, verifiedOn: today } };
  return { newPin, version, changelist, identify, evidence, notes };
}

/**
 * The command line. deps: { print, error, now, readVersion, readFile, writeFile, exists } (all optional). Returns the exit code.
 */
export function run(argv, deps = {}) {
  const print = deps.print ?? console.log, error = deps.error ?? console.error;
  const now = deps.now ?? (() => new Date());
  const readFile = deps.readFile ?? ((p) => readFileSync(p, 'utf8'));
  const writeFile = deps.writeFile ?? ((p, text) => writeFileSync(p, text));
  const exists = deps.exists ?? existsSync;
  const args = parseArgs(argv);
  if (args.error) { error(`${args.error}\n${USAGE}`); return 2; }
  if (args.help) { print(USAGE); return 0; }
  if (!args.engine) { error(`--engine is required\n${USAGE}`); return 2; }
  if (!exists(args.engine)) { error(`engine folder not found: ${args.engine}`); return 2; }

  const pinFile = args.pinFile ? resolve(args.pinFile) : DEFAULT_PIN_FILE;
  let pin = null;
  try { const parsed = JSON.parse(readFile(pinFile)); if (validatePin(parsed).length === 0) pin = parsed; } catch { /* reported by planPin */ }

  const info = (deps.readVersion ?? readEngineVersion)(args.engine);
  const plan = planPin({ info, versionArg: args.version, pin, reports: args.reports, today: localDate(now()), readFile });

  const source = info.source === 'executable' ? 'the editor executable' : info.source === 'Build.version' ? 'Build.version' : 'nowhere';
  print(`engine: ${info.major === null ? 'version unreadable' : `${info.major}.${info.minor}.${info.patch} (Build.version)`}, changelist ${info.changelist ?? 'unknown'} (from ${source})`);
  for (const w of info.warnings) print(`WARNING: ${w}`);
  for (const n of plan.notes) print(`note: ${n}`);
  print(`current pin: ${pin ? `${pin.unreal.version}, changelist ${pin.unreal.changelist}, verified ${pin.unreal.verifiedOn}` : 'none'}`);
  if (plan.newPin) print(`${args.write ? 'writing' : 'would write'} the unreal block: ${inline(plan.newPin.unreal)}   (the uefn block stays as it is)`);
  for (const p of plan.identify) print(`${args.write ? 'refusing' : 'would refuse'}: ${p}`);
  for (const p of plan.evidence) print(`${args.write ? (args.force ? 'forcing past' : 'refusing') : 'would refuse without --force'}: ${p}`);

  if (!args.write) {
    print(plan.identify.length === 0 && plan.evidence.length === 0 ? 'dry run: add --write to update the pin' : 'dry run: --write would not update the pin yet');
    return 0;
  }
  if (plan.identify.length > 0) return 1;
  if (plan.evidence.length > 0 && !args.force) return 1;
  try { writeFile(pinFile, formatPin(plan.newPin)); } catch (e) { error(`could not write ${pinFile}: ${e.message}`); return 1; }
  print(`wrote ${pinFile}; the docs need no edit`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = run(process.argv.slice(2));
