// node scripts/verify-engine.mjs --engine "<UE_5.8 folder>" [--class headless,render,package] [--only name,name] [--skip name,name] [--report <path>] [--stop-on-fail] [--list]
// Plugin development tooling: re-verifies an engine build by running every probe and validator in verify-engine-manifest.mjs one at a time,
// judging each against its expected count, printing a table and writing a JSON report; scripts/pin-engine.mjs reads the reports.
// Exit code 0 when everything that ran passed or failed as expected, 1 on a mismatch or error, 2 on usage. No dependencies; Node 20.11+.
// Nothing here refuses to run, or exits non-zero, because the engine is not the pinned build: the pin note is printed and recorded in the
// report, and the result is judged only against the manifest.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MANIFEST, CLASSES } from './verify-engine-manifest.mjs';
import { readEngineVersion, describeEngine, pinNote, readPin } from '../examples/unreal/engine-version.mjs';
import { encodePng } from '../examples/unreal/niagara_toolsets/nts-probe-assets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');
export const BASE_DIR = REPO_ROOT;

export const STATUSES = Object.freeze(['pass', 'as-expected', 'mismatch', 'error', 'skipped']);

// --- parsing -----------------------------------------------------------------------------------------------------------------

// "25 of 25 checks passed", "6 of 6 probe checks passed", "21 of 21 checks passed; 3 of 3 observations recorded",
// "16 of 18 checks passed, 15 observations recorded". Only a line that starts with the count: sub-lines such as "6 of 6 saved" or an
// indented "3 of 3 asserted cases held" are other facts.
const SUMMARY = /^(\d+) of (\d+) (?:probe )?checks passed\b/;
const FAIL = /^FAIL\s+(?:\[[^\]]*\]\s+)?(.+?)\s*$/;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

const linesOf = (text) => String(text ?? '').replace(ANSI, '').split(/\r?\n/);

/**
 * The counts a run printed: every summary line is added together (compare_gpu_run prints one for the rendered judge and one for the
 * headless judge). { passed, total, summaries } or null when no summary line is there.
 */
export function parseSummary(text) {
  let passed = 0, total = 0, summaries = 0;
  for (const line of linesOf(text)) {
    const m = SUMMARY.exec(line);
    if (!m) continue;
    passed += Number(m[1]); total += Number(m[2]); summaries++;
  }
  return summaries === 0 ? null : { passed, total, summaries };
}

/** The names of the checks that failed ("FAIL  [group] name" or "FAIL  name"), in output order, without duplicates. */
export function parseFailures(text) {
  const names = [];
  for (const line of linesOf(text)) {
    const m = FAIL.exec(line);
    if (m && !names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

export const lastLines = (text, n = 20) => linesOf(text).filter((l) => l.trim() !== '').slice(-n);

// --- judging -----------------------------------------------------------------------------------------------------------------

const sameSet = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Judges one run against its manifest entry. `run` is { code, timedOut, spawnError, output, seconds }.
 * Returns { status, detail, passed, total, failing }. status:
 *   pass         the counts equal the expectation and the run exited 0 (or an exitOnly / note entry exited 0)
 *   as-expected  a known partial pass with the same counts and the same failing checks
 *   mismatch     the run finished with other counts, another set of failing checks or an exit code that does not fit
 *   error        the run could not be judged: it did not start, timed out or printed no summary
 */
export function judge(entry, run) {
  const out = { status: 'error', detail: '', passed: null, total: null, failing: [] };
  if (run.spawnError) return { ...out, detail: `could not start: ${run.spawnError}` };
  if (run.timedOut) return { ...out, detail: `timed out after ${Math.round(entry.timeoutMs / 1000)} s` };
  const expect = entry.expect ?? {};
  const counts = expect.passed !== undefined;
  const summary = parseSummary(run.output);
  if (summary) { out.passed = summary.passed; out.total = summary.total; }
  out.failing = parseFailures(run.output);
  if (!counts) {
    if (run.code === 0) return { ...out, status: 'pass', detail: expect.note ?? 'exited 0' };
    return { ...out, status: 'mismatch', detail: `exit code ${run.code}` };
  }
  if (!summary) return { ...out, detail: 'no "N of M checks passed" line in the output' };
  const wanted = `${expect.passed} of ${expect.total}`;
  if (summary.passed !== expect.passed || summary.total !== expect.total) {
    return { ...out, status: 'mismatch', detail: `${summary.passed} of ${summary.total} checks passed, expected ${wanted}` };
  }
  const known = entry.knownFailures ?? [];
  if (expect.passed === expect.total) {
    if (run.code !== 0) return { ...out, status: 'mismatch', detail: `${wanted} checks passed but the run exited ${run.code}` };
    return { ...out, status: 'pass', detail: `${wanted} checks passed` };
  }
  if (!sameSet(out.failing, known)) {
    const now = out.failing.length ? out.failing.map((n) => `"${n}"`).join(', ') : 'none named';
    return { ...out, status: 'mismatch', detail: `${wanted} as before, but the failing checks changed: now ${now}; expected ${known.map((n) => `"${n}"`).join(', ')}` };
  }
  return { ...out, status: 'as-expected', detail: `${wanted} checks passed; the ${plural(known.length, 'known failure')} failed as before` };
}

// --- selecting ---------------------------------------------------------------------------------------------------------------

/**
 * Which manifest entries run: [{ entry, skip: null | reason }] in manifest order. Without --class the owner entries are left out; naming
 * an entry with --only runs it whatever its class unless --class is also given. Throws an Error naming an unknown entry or class.
 */
export function selectEntries(manifest, { classes = null, only = [], skip = [] } = {}) {
  const names = new Set(manifest.map((e) => e.name));
  for (const n of [...only, ...skip]) if (!names.has(n)) throw new Error(`no manifest entry named ${n} (see --list)`);
  for (const c of classes ?? []) if (!CLASSES.includes(c)) throw new Error(`unknown class ${c} (${CLASSES.join(', ')})`);
  return manifest.map((entry) => {
    let reason = null;
    if (only.length > 0 && !only.includes(entry.name)) reason = 'not named by --only';
    else if (skip.includes(entry.name)) reason = 'named by --skip';
    else if (classes && !classes.includes(entry.class)) reason = `class ${entry.class} not selected`;
    else if (!classes && only.length === 0 && entry.class === 'owner') reason = 'needs a person (name it with --only, or use --class owner)';
    return { entry, skip: reason };
  });
}

// --- the stand-in atlas ------------------------------------------------------------------------------------------------------

/**
 * Writes sheet.png (128 x 160 px, 8 x 10 cells of 16 px, a coloured disc per cell) and sheet.atlas.json (Aseprite-style frames) into
 * `dir`, for the entries whose args name {atlasPng} and {atlasJson}. Returns the two paths with forward slashes.
 */
export function writeStandInAtlas(dir) {
  const COLS = 8, ROWS = 10, CELL = 16, W = COLS * CELL, H = ROWS * CELL;
  const rgba = Buffer.alloc(W * H * 4);
  const frames = {};
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c, hue = (i * 360) / (COLS * ROWS);
      const channel = (n) => { const k = (n + hue / 60) % 6; return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)))); };
      const rgb = [channel(5), channel(3), channel(1)];
      for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < CELL; x++) {
          const d = Math.hypot(x - 7.5, y - 7.5), radius = 3 + (i % 5);
          if (d >= radius) continue;
          const p = ((r * CELL + y) * W + c * CELL + x) * 4;
          rgba[p] = rgb[0]; rgba[p + 1] = rgb[1]; rgba[p + 2] = rgb[2]; rgba[p + 3] = 255;
        }
      }
      frames[`cell_${i}`] = { frame: { x: c * CELL, y: r * CELL, w: CELL, h: CELL }, duration: 100 };
    }
  }
  mkdirSync(dir, { recursive: true });
  const atlasPng = join(dir, 'sheet.png'), atlasJson = join(dir, 'sheet.atlas.json');
  writeFileSync(atlasPng, encodePng({ width: W, height: H, rgba }));
  writeFileSync(atlasJson, JSON.stringify({ frames, meta: { size: { w: W, h: H }, app: 'generated stand-in' } }));
  return { atlasPng: atlasPng.replaceAll('\\', '/'), atlasJson: atlasJson.replaceAll('\\', '/') };
}

/** The args with {atlasPng} and {atlasJson} replaced by the given paths. */
export const expandArgs = (args, assets = {}) => args.map((a) => String(a).replace(/\{(atlasPng|atlasJson)\}/g, (m, key) => assets[key] ?? m));
export const needsAtlas = (entries) => entries.some((e) => e.args.some((a) => /\{(atlasPng|atlasJson)\}/.test(a)));

// --- running one entry -------------------------------------------------------------------------------------------------------

/** Stops a child and whatever it started (the engine) on a timeout. */
function killTree(child) {
  try {
    if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch { /* already gone */ }
}

/**
 * Runs `node <script> --engine <engine> <args>` and resolves to { code, timedOut, spawnError, output, seconds }; the output is stdout and
 * stderr in the order they arrived. Never rejects.
 */
export function execEntry({ script, argv, cwd, timeoutMs }) {
  return new Promise((resolveRun) => {
    const started = Date.now();
    const chunks = [];
    let done = false, timedOut = false, child;
    const finish = (extra) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolveRun({ code: null, timedOut, spawnError: null, ...extra, output: Buffer.concat(chunks).toString('utf8'), seconds: Math.round((Date.now() - started) / 100) / 10 });
    };
    const timer = setTimeout(() => { timedOut = true; if (child) killTree(child); }, timeoutMs);
    try {
      child = spawn(process.execPath, [script, ...argv], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    } catch (error) { finish({ spawnError: error.message }); return; }
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));
    child.on('error', (error) => finish({ spawnError: error.message }));
    child.on('close', (code) => finish({ code: timedOut ? null : code }));
  });
}

// --- the table ---------------------------------------------------------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
export const TABLE_HEADER = `${pad('#', 7)}${pad('status', 13)}${pad('name', 30)}${pad('class', 10)}${pad('result', 14)}${pad('expected', 14)}seconds`;

/** Counts as "N of M", or "-" when there are none. */
const ofText = (passed, total) => (passed === null || total === null || passed === undefined ? '-' : `${passed} of ${total}`);
export const expectedText = (entry) => (entry.expect.passed !== undefined ? ofText(entry.expect.passed, entry.expect.total) : 'exit 0');

export function formatRow(index, count, row) {
  const width = String(count).length;
  return `${pad(`${String(index).padStart(width)}/${count}`, 7)}${pad(row.status, 13)}${pad(row.name, 30)}${pad(row.class, 10)}${pad(ofText(row.passed, row.total), 14)}${pad(row.expected, 14)}${row.seconds === null ? '' : row.seconds}`;
}

// --- the whole run -----------------------------------------------------------------------------------------------------------

/**
 * Runs the selected entries one at a time and returns { report, code }. Options:
 *   engine        the folder that contains Engine
 *   manifest      default: the repo's manifest
 *   select        { classes, only, skip } (see selectEntries)
 *   stopOnFail    leave the rest of the run out after the first mismatch or error
 *   baseDir   what the entries' scripts are relative to (default: the repo root); cwd is the repo root
 *   exec          replaces execEntry (tests)
 *   print         where the progress goes (default: console.log)
 *   now           () => Date (default: new Date)
 *   pin           replaces the pin read from the repo (null for none)
 *   readVersion   replaces readEngineVersion
 * code is 0 when every entry that ran is pass or as-expected, 1 when any is a mismatch or error. The pin note never changes it.
 */
export async function runAll({ engine, manifest = MANIFEST, select = {}, stopOnFail = false, baseDir = BASE_DIR, cwd = REPO_ROOT, exec = execEntry, print = console.log, now = () => new Date(), pin, readVersion = readEngineVersion }) {
  const selection = selectEntries(manifest, select);
  const toRun = selection.filter((s) => !s.skip);
  const info = readVersion(engine);
  const thePin = pin === undefined ? readPin() : pin;
  const note = pinNote(info, thePin);
  for (const line of describeEngine(info, engine, { pin: thePin })) print(line);
  print(`${toRun.length} of ${manifest.length} entries selected`);
  print(TABLE_HEADER);

  let tempDir = null, assets = {};
  const rows = [];
  let stopped = false;
  try {
    if (needsAtlas(toRun.map((s) => s.entry))) {
      tempDir = mkdtempSync(join(tmpdir(), 'verify-engine-'));
      assets = writeStandInAtlas(tempDir);
    }
    let n = 0;
    for (const { entry, skip } of selection) {
      const base = { name: entry.name, class: entry.class, expected: expectedText(entry), expect: entry.expect };
      if (skip || stopped) {
        rows.push({ ...base, status: 'skipped', passed: null, total: null, seconds: null, detail: skip ?? 'stopped after a failure (--stop-on-fail)' });
        continue;
      }
      n++;
      const argv = ['--engine', engine, ...expandArgs(entry.args, assets)];
      const run = await exec({ script: resolve(baseDir, entry.script), argv, cwd, timeoutMs: entry.timeoutMs, entry });
      const verdict = judge(entry, run);
      const row = { ...base, status: verdict.status, passed: verdict.passed, total: verdict.total, seconds: run.seconds ?? null, exitCode: run.code ?? null, detail: verdict.detail };
      if (verdict.failing.length) row.failing = verdict.failing;
      if (verdict.status === 'mismatch' || verdict.status === 'error') row.tail = lastLines(run.output, 20);
      rows.push(row);
      print(formatRow(n, toRun.length, row));
      if (row.status === 'mismatch' || row.status === 'error') {
        print(`        ${row.detail}`);
        if (stopOnFail) stopped = true;
      }
    }
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }

  const summary = Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
  const code = summary.mismatch > 0 || summary.error > 0 ? 1 : 0;
  print(`${STATUSES.map((s) => `${summary[s]} ${s}`).join(', ')}`);
  for (const r of rows.filter((x) => x.status === 'mismatch' || x.status === 'error')) {
    print(`${r.status.toUpperCase()} ${r.name}: ${r.detail}`);
    for (const l of r.tail ?? []) print(`    | ${l}`);
  }
  if (note) print('(the pin note above does not change the result)');
  const report = {
    schema: 'verify-engine/1',
    generatedAt: now().toISOString(),
    engine: { path: engine, major: info.major, minor: info.minor, patch: info.patch, changelist: info.changelist, source: info.source, warnings: info.warnings },
    pin: thePin ? thePin.unreal : null,
    pinNote: note,
    classes: [...new Set(toRun.map((s) => s.entry.class))],
    node: process.version,
    platform: process.platform,
    summary,
    green: code === 0 && toRun.length > 0,
    entries: rows,
  };
  return { report, code };
}

// --- the command line --------------------------------------------------------------------------------------------------------

export const USAGE = `usage: node scripts/verify-engine.mjs --engine <UE_5.8 folder> [--class headless,render,package] [--only name,name] [--skip name,name]
                         [--report <path>] [--stop-on-fail] [--list]
  Runs the manifest's probes and validators one at a time against an installed engine, judges each against its expected count,
  prints a table and writes a JSON report (default: a file in the system temp folder). The classes are headless (no GPU), render,
  package and owner (needs a person: left out unless named). Exit code 0 when every run entry passed or failed as expected,
  1 on any mismatch or error, 2 on a usage error. An engine that is not the pinned build gets a note and is judged the same way.`;

/** { engine, classes, only, skip, report, stopOnFail, list, help } or { error }. */
export function parseArgs(argv) {
  const out = { engine: null, classes: null, only: [], skip: [], report: null, stopOnFail: false, list: false, help: false };
  const listOf = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const name = ['--engine', '--class', '--only', '--skip', '--report'].find((o) => arg === o || arg.startsWith(`${o}=`));
    if (arg === '--stop-on-fail') out.stopOnFail = true;
    else if (arg === '--list') out.list = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (name) {
      const value = arg === name ? argv[++i] : arg.slice(name.length + 1);
      if (value === undefined || value === '' || (arg === name && value.startsWith('--'))) return { error: `${name} needs a value` };
      if (name === '--engine') out.engine = value;
      else if (name === '--report') out.report = value;
      else if (name === '--class') out.classes = [...(out.classes ?? []), ...listOf(value)];
      else if (name === '--only') out.only.push(...listOf(value));
      else out.skip.push(...listOf(value));
    } else return { error: `unknown option ${arg}` };
  }
  return out;
}

/** The --list text: one line per entry with its class, expectation, what it needs and the command. */
export function listText(manifest = MANIFEST) {
  const rows = manifest.map((e) => `${pad(e.name, 30)}${pad(e.class, 10)}${pad(expectedText(e), 12)}${e.script} ${e.args.join(' ')}`.trimEnd() + (e.needs ? `   [needs ${e.needs}]` : ''));
  const counts = CLASSES.map((c) => `${manifest.filter((e) => e.class === c).length} ${c}`).join(', ');
  return [...rows, `${manifest.length} entries: ${counts}`].join('\n');
}

/**
 * The command line, returning the exit code. io: { print, error, now, exec, pin, readVersion, baseDir, cwd, manifest }.
 */
export async function main(argv, io = {}) {
  const print = io.print ?? console.log, error = io.error ?? console.error;
  const manifest = io.manifest ?? MANIFEST;
  const args = parseArgs(argv);
  if (args.error) { error(`${args.error}\n${USAGE}`); return 2; }
  if (args.help) { print(USAGE); return 0; }
  if (args.list) { print(listText(manifest)); return 0; }
  if (!args.engine) { error(`--engine is required\n${USAGE}`); return 2; }
  if (!existsSync(args.engine)) { error(`engine folder not found: ${args.engine}`); return 2; }
  let selection;
  try { selection = selectEntries(manifest, { classes: args.classes, only: args.only, skip: args.skip }); } catch (e) { error(`${e.message}\n${USAGE}`); return 2; }
  if (selection.every((s) => s.skip)) { error('no entry is selected\n' + USAGE); return 2; }
  const reportPath = args.report ? resolve(args.report) : join(tmpdir(), `verify-engine-report-${(io.now ?? (() => new Date()))().toISOString().replace(/[:.]/g, '-')}.json`);
  const { report, code } = await runAll({
    engine: args.engine, manifest, select: { classes: args.classes, only: args.only, skip: args.skip }, stopOnFail: args.stopOnFail, print,
    ...(io.baseDir ? { baseDir: io.baseDir } : {}), ...(io.cwd ? { cwd: io.cwd } : {}), ...(io.exec ? { exec: io.exec } : {}),
    ...(io.now ? { now: io.now } : {}), ...(io.pin !== undefined ? { pin: io.pin } : {}), ...(io.readVersion ? { readVersion: io.readVersion } : {}),
  });
  try {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    print(`report: ${reportPath}`);
  } catch (e) { error(`could not write the report to ${reportPath}: ${e.message}`); return code === 0 ? 1 : code; }
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
