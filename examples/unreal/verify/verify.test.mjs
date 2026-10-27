// node --test examples/unreal/verify/verify.test.mjs  (no Unreal, no dependencies; the fake probes are tiny Node scripts in a temp folder)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseSummary, parseFailures, judge, selectEntries, runAll, main, parseArgs, listText, execEntry, writeStandInAtlas, expandArgs, needsAtlas, lastLines,
} from './verify-lib.mjs';
import { MANIFEST } from './manifest.mjs';
import { decodePng } from '../niagara_toolsets/nts-probe-assets.mjs';

const tempDir = (label) => mkdtempSync(join(tmpdir(), `verify-all-${label}-`));
const cleanup = (...dirs) => dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));

const PIN = { unreal: { version: '5.8.4', changelist: 58902052, verifiedOn: '2026-10-26' }, uefn: { version: '42.40', build: '59343437', verifiedOn: null } };
const pinnedVersion = () => ({ major: 5, minor: 8, patch: 4, changelist: 58902052, source: 'executable', warnings: [] });
const otherVersion = () => ({ major: 5, minor: 8, patch: 3, changelist: 58210709, source: 'executable', warnings: [] });

// --- parsing: real summary and failure lines from probe output -----------------------------------------------------------------

test('parseSummary reads every summary form the probes print', () => {
  const forms = [
    ['25 of 25 checks passed', [25, 25]],
    ['6 of 6 probe checks passed', [6, 6]],
    ['3 of 5 probe checks passed', [3, 5]],
    ['21 of 21 checks passed; 3 of 3 observations recorded', [21, 21]],
    ['16 of 18 checks passed, 15 observations recorded', [16, 18]],
    ['63 of 63 checks passed, 36 observed (recorded, not judged)', [63, 63]],
    ['11 of 11 checks passed\r', [11, 11]],
    ['\u001b[32m34 of 34 checks passed\u001b[0m', [34, 34]],
  ];
  for (const [line, [passed, total]] of forms) assert.deepEqual(parseSummary(`noise\n${line}\nexit=0\n`), { passed, total, summaries: 1 }, line);
});

test('parseSummary ignores the sub-lines that also say "N of M" and adds up a run that prints two summaries', () => {
  const output = [
    '      6 of 6 saved', '      24 of 24 allowed', '      runtime allowed 16 of 16, constructor refused 8 of 8', '      refused 24 of 24',
    '      44 of 44 recorded', '      2 of 2 asserted cases held', '      14 of 14 templates consistent; more than one renderer: none',
    '      19 of 20 readings present (the re-initialised activation is optional); 11 of 11 match the expectation',
    '      cells with instances 10 of 72 overlapped; columns [-18,-17]', '  PHASE 1 of 8: tie -- sun and moon both at ForwardShadingPriority 0',
    '      changed pixels 124375 of 921600',
  ].join('\n');
  assert.equal(parseSummary(output), null);
  assert.deepEqual(parseSummary(`${output}\n7 of 7 checks passed\ncompare_perf.mjs (rendered): exit 0\n4 of 4 checks passed\nRESULT: both judges pass\n`), { passed: 11, total: 11, summaries: 2 });
});

test('parseSummary returns null when there is no summary', () => {
  assert.equal(parseSummary(''), null);
  assert.equal(parseSummary(undefined), null);
  assert.equal(parseSummary('0 checks ran\nsomething crashed\n'), null);
});

test('parseFailures names the failing checks, with or without a group tag, once each', () => {
  const output = [
    'PASS  [frame] a float user parameter is added and listed',
    'FAIL  [frame] the sprite SubImageIndex follows the user parameter',
    '      claim: After the parameter is set from Python to 2 and to 9 ...',
    'FAIL  [frame] screenshots at the two values show different cells',
    'FAIL  pcg control: the non-partitioned volume generates points',
    'FAIL  pcg control: the non-partitioned volume generates points',
    'OBSERVE  unload: a proxy left unloaded',
    '3 of 5 probe checks passed',
  ].join('\n');
  assert.deepEqual(parseFailures(output), ['the sprite SubImageIndex follows the user parameter', 'screenshots at the two values show different cells', 'pcg control: the non-partitioned volume generates points']);
  assert.deepEqual(parseFailures('PASS  everything\n'), []);
});

test('lastLines keeps the last non-empty lines', () => {
  assert.deepEqual(lastLines('a\n\nb\r\nc\n\n', 2), ['b', 'c']);
});

// --- judging ---------------------------------------------------------------------------------------------------------------------

const entry = (extra) => ({ name: 'probe', script: 'probe.mjs', args: [], class: 'headless', expect: { passed: 25, total: 25 }, timeoutMs: 120000, ...extra });
const partial = entry({ expect: { passed: 3, total: 5 }, knownFailures: ['the sprite SubImageIndex follows the user parameter', 'screenshots at the two values show different cells'] });
const FRAME = 'FAIL  [frame] the sprite SubImageIndex follows the user parameter\nFAIL  [frame] screenshots at the two values show different cells\n3 of 5 probe checks passed\n';

test('judge: the expected count and exit 0 is a pass', () => {
  const v = judge(entry(), { code: 0, output: 'PASS  x\n25 of 25 checks passed\n' });
  assert.equal(v.status, 'pass');
  assert.deepEqual([v.passed, v.total], [25, 25]);
});

test('judge: another count is a mismatch that names both, whether lower or higher', () => {
  const low = judge(entry(), { code: 1, output: 'FAIL  [g] one\n24 of 25 checks passed\n' });
  assert.equal(low.status, 'mismatch');
  assert.match(low.detail, /24 of 25 checks passed, expected 25 of 25/);
  assert.deepEqual(low.failing, ['one']);
  assert.equal(judge(entry(), { code: 0, output: '26 of 26 checks passed\n' }).status, 'mismatch', 'a probe that gained checks needs a new expectation');
});

test('judge: the expected count with a non-zero exit is a mismatch', () => {
  const v = judge(entry(), { code: 3, output: '25 of 25 checks passed\n' });
  assert.equal(v.status, 'mismatch');
  assert.match(v.detail, /exited 3/);
});

test('judge: a known partial pass with the same failing checks is as-expected, whatever the exit code', () => {
  for (const code of [1, 0]) {
    const v = judge(partial, { code, output: FRAME });
    assert.equal(v.status, 'as-expected');
    assert.match(v.detail, /3 of 5/);
    assert.match(v.detail, /2 known failures/);
  }
});

test('judge: a changed failing set is a mismatch even with the same count', () => {
  const swapped = 'FAIL  [frame] the sprite SubImageIndex follows the user parameter\nFAIL  [frame] some other check\n3 of 5 probe checks passed\n';
  const v = judge(partial, { code: 1, output: swapped });
  assert.equal(v.status, 'mismatch');
  assert.match(v.detail, /failing checks changed/);
  assert.match(v.detail, /some other check/);
  const unnamed = judge(partial, { code: 1, output: '3 of 5 probe checks passed\n' });
  assert.equal(unnamed.status, 'mismatch');
  assert.match(unnamed.detail, /none named/);
});

test('judge: a known partial pass that now passes more, or fewer, is a mismatch', () => {
  assert.equal(judge(partial, { code: 0, output: '5 of 5 probe checks passed\n' }).status, 'mismatch');
  assert.equal(judge(partial, { code: 1, output: `${FRAME}`.replace('3 of 5', '2 of 5') }).status, 'mismatch');
});

test('judge: a timeout is an error', () => {
  const v = judge(entry({ timeoutMs: 90000 }), { code: null, timedOut: true, output: '25 of 25 checks passed\n' });
  assert.equal(v.status, 'error');
  assert.match(v.detail, /timed out after 90 s/);
});

test('judge: output without a summary line is an error, and so is a run that did not start', () => {
  const v = judge(entry(), { code: 0, output: 'the editor crashed\n' });
  assert.equal(v.status, 'error');
  assert.match(v.detail, /no "N of M checks passed" line/);
  assert.equal(judge(entry(), { code: null, spawnError: 'spawn ENOENT', output: '' }).status, 'error');
});

test('judge: exit-only and note entries need only exit 0', () => {
  assert.equal(judge(entry({ expect: { exitOnly: true } }), { code: 0, output: '' }).status, 'pass');
  assert.equal(judge(entry({ expect: { exitOnly: true } }), { code: 1, output: '' }).status, 'mismatch');
  const note = judge(entry({ expect: { note: 'prints routes' } }), { code: 0, output: 'route a\n' });
  assert.deepEqual([note.status, note.detail], ['pass', 'prints routes']);
});

// --- selecting -----------------------------------------------------------------------------------------------------------------

const small = [
  entry({ name: 'a', class: 'headless' }), entry({ name: 'b', class: 'render' }), entry({ name: 'c', class: 'package' }), entry({ name: 'd', class: 'owner', expect: { note: 'x' } }),
];
const ranNames = (sel) => sel.filter((s) => !s.skip).map((s) => s.entry.name);

test('selectEntries: the default leaves out owner entries and says why', () => {
  const sel = selectEntries(small);
  assert.deepEqual(ranNames(sel), ['a', 'b', 'c']);
  assert.match(sel[3].skip, /needs a person/);
});

test('selectEntries: --class, --only and --skip narrow the run, and --only can name an owner entry', () => {
  assert.deepEqual(ranNames(selectEntries(small, { classes: ['headless', 'render'] })), ['a', 'b']);
  assert.deepEqual(ranNames(selectEntries(small, { classes: ['owner'] })), ['d']);
  assert.deepEqual(ranNames(selectEntries(small, { only: ['c', 'a'] })), ['a', 'c'], 'manifest order, not the order named');
  assert.deepEqual(ranNames(selectEntries(small, { only: ['d'] })), ['d']);
  assert.deepEqual(ranNames(selectEntries(small, { skip: ['b'] })), ['a', 'c']);
  assert.deepEqual(ranNames(selectEntries(small, { classes: ['headless'], only: ['a', 'b'] })), ['a']);
});

test('selectEntries: an unknown entry or class is an error', () => {
  assert.throws(() => selectEntries(small, { only: ['zz'] }), /no manifest entry named zz/);
  assert.throws(() => selectEntries(small, { skip: ['zz'] }), /no manifest entry named zz/);
  assert.throws(() => selectEntries(small, { classes: ['gpu'] }), /unknown class gpu/);
});

test('parseArgs reads the options and rejects the unknown', () => {
  const ok = parseArgs(['--engine', 'E:/UE', '--class', 'headless,render', '--only=a,b', '--skip', 'c', '--report', 'r.json', '--stop-on-fail', '--list']);
  assert.deepEqual(ok, { engine: 'E:/UE', classes: ['headless', 'render'], only: ['a', 'b'], skip: ['c'], report: 'r.json', stopOnFail: true, list: true, help: false });
  assert.match(parseArgs(['--engine']).error, /--engine needs a value/);
  assert.match(parseArgs(['--engine', '--list']).error, /--engine needs a value/);
  assert.match(parseArgs(['--bogus']).error, /unknown option --bogus/);
});

// --- running with canned results ---------------------------------------------------------------------------------------------------

const outputs = {
  a: { code: 0, output: '25 of 25 checks passed\n', seconds: 1.5 },
  b: { code: 1, output: FRAME, seconds: 2 },
  c: { code: 0, output: 'no summary here\n', seconds: 0.5 },
};
const cannedManifest = [
  entry({ name: 'a' }), entry({ name: 'b', class: 'render', ...{ expect: partial.expect, knownFailures: partial.knownFailures } }), entry({ name: 'c', class: 'package' }),
  entry({ name: 'd', class: 'owner', expect: { note: 'x' } }),
];
const quiet = () => { const lines = []; return { lines, print: (l) => lines.push(l) }; };

test('runAll: a pass, an as-expected and an error; the owner entry is skipped; the report says which; exit 1', async () => {
  const { lines, print } = quiet();
  const asked = [];
  const { report, code } = await runAll({
    engine: 'E:/UE', manifest: cannedManifest, print, pin: PIN, readVersion: pinnedVersion, now: () => new Date('2026-11-02T10:00:00Z'),
    exec: async ({ entry: e }) => { asked.push(e.name); return outputs[e.name]; },
  });
  assert.deepEqual(asked, ['a', 'b', 'c']);
  assert.equal(code, 1);
  assert.deepEqual(report.entries.map((r) => [r.name, r.status]), [['a', 'pass'], ['b', 'as-expected'], ['c', 'error'], ['d', 'skipped']]);
  assert.deepEqual(report.summary, { pass: 1, 'as-expected': 1, mismatch: 0, error: 1, skipped: 1 });
  assert.equal(report.green, false);
  assert.equal(report.generatedAt, '2026-11-02T10:00:00.000Z');
  assert.equal(report.pinNote, null);
  assert.equal(report.engine.changelist, 58902052);
  assert.deepEqual(report.pin, PIN.unreal);
  assert.deepEqual(report.entries[2].tail, ['no summary here']);
  assert.equal(report.entries[0].tail, undefined, 'the output is kept only for a failure');
  assert.equal(report.entries[3].detail.startsWith('needs a person'), true);
  assert.ok(lines.some((l) => /^as-expected/.test(l.replace(/^\S+\s+/, '')) || /as-expected/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /^ERROR c:/.test(l)));
});

test('runAll: every entry passing or as expected is green with exit 0', async () => {
  const { report, code } = await runAll({
    engine: 'E:/UE', manifest: cannedManifest, select: { skip: ['c'] }, print: () => {}, pin: PIN, readVersion: pinnedVersion,
    exec: async ({ entry: e }) => outputs[e.name],
  });
  assert.equal(code, 0);
  assert.equal(report.green, true);
  assert.deepEqual(report.classes, ['headless', 'render']);
});

test('runAll: an engine that is not the pinned build prints the note, records it, and changes neither the verdicts nor the exit code', async () => {
  const run = (readVersion) => {
    const { lines, print } = quiet();
    return runAll({ engine: 'E:/UE', manifest: cannedManifest, select: { skip: ['c'] }, print, pin: PIN, readVersion, exec: async ({ entry: e }) => outputs[e.name] }).then((r) => ({ ...r, lines }));
  };
  const same = await run(pinnedVersion);
  const other = await run(otherVersion);
  assert.equal(same.report.pinNote, null);
  assert.match(other.report.pinNote, /^NOTE: not the pinned build \(pin: 5\.8\.4, changelist 58902052\)/);
  assert.match(other.lines[1], /^NOTE: not the pinned build/, 'printed right after the engine line');
  assert.equal(other.code, 0);
  assert.deepEqual(other.report.entries.map((r) => r.status), same.report.entries.map((r) => r.status));
  assert.equal(other.report.green, true);
});

test('runAll: --stop-on-fail leaves the rest out after the first failure', async () => {
  const asked = [];
  const { report, code } = await runAll({
    engine: 'E:/UE', manifest: [entry({ name: 'x' }), entry({ name: 'y' }), entry({ name: 'z' })], stopOnFail: true, print: () => {}, pin: null, readVersion: pinnedVersion,
    exec: async ({ entry: e }) => { asked.push(e.name); return e.name === 'x' ? { code: 1, output: '24 of 25 checks passed\n' } : { code: 0, output: '25 of 25 checks passed\n' }; },
  });
  assert.deepEqual(asked, ['x']);
  assert.equal(code, 1);
  assert.deepEqual(report.entries.map((r) => r.status), ['mismatch', 'skipped', 'skipped']);
  assert.match(report.entries[1].detail, /stopped after a failure/);
});

test('runAll: without --stop-on-fail a failure does not stop the run', async () => {
  const asked = [];
  await runAll({
    engine: 'E:/UE', manifest: [entry({ name: 'x' }), entry({ name: 'y' })], print: () => {}, pin: null, readVersion: pinnedVersion,
    exec: async ({ entry: e }) => { asked.push(e.name); return { code: 1, output: '1 of 25 checks passed\n' }; },
  });
  assert.deepEqual(asked, ['x', 'y']);
});

test('the stand-in atlas is a 128 x 160 PNG of 80 cells with matching Aseprite-style JSON, and the placeholders become its paths', async () => {
  const dir = tempDir('atlas');
  try {
    const { atlasPng, atlasJson } = writeStandInAtlas(dir);
    const png = decodePng(readFileSync(atlasPng));
    assert.deepEqual([png.width, png.height], [128, 160]);
    const json = JSON.parse(readFileSync(atlasJson, 'utf8'));
    const frames = Object.values(json.frames);
    assert.equal(frames.length, 80);
    assert.deepEqual(frames[79].frame, { x: 112, y: 144, w: 16, h: 16 });
    assert.deepEqual(json.meta.size, { w: 128, h: 160 });
    assert.ok(!atlasPng.includes('\\'));
    assert.deepEqual(expandArgs(['--atlas-png', '{atlasPng}', '--atlas-json', '{atlasJson}', '--x'], { atlasPng: 'P', atlasJson: 'J' }), ['--atlas-png', 'P', '--atlas-json', 'J', '--x']);
    assert.equal(needsAtlas([entry({ args: ['{atlasPng}'] })]), true);
    assert.equal(needsAtlas([entry()]), false);
  } finally { cleanup(dir); }

  const seen = [];
  const wire = entry({ name: 'wire', args: ['--only', 'wire', '--atlas-png', '{atlasPng}', '--atlas-json', '{atlasJson}'] });
  await runAll({
    engine: 'E:/UE', manifest: [wire], print: () => {}, pin: null, readVersion: pinnedVersion,
    exec: async ({ argv }) => { seen.push(argv, existsSync(argv[argv.indexOf('--atlas-png') + 1]), existsSync(argv[argv.indexOf('--atlas-json') + 1])); return { code: 0, output: '25 of 25 checks passed\n' }; },
  });
  assert.deepEqual(seen.slice(1), [true, true], 'the generated files exist while the probe runs');
  assert.equal(seen[0][0], '--engine');
  assert.ok(!existsSync(seen[0][seen[0].indexOf('--atlas-png') + 1]), 'and are removed afterwards');
});

test('listText lists every entry with its class and count, and ends with the totals', () => {
  const text = listText(MANIFEST);
  for (const e of MANIFEST) assert.ok(text.includes(e.name), e.name);
  assert.match(text, /nts_probe_frame\s+render\s+3 of 5/);
  assert.match(text.split('\n').at(-1), new RegExp(`^${MANIFEST.length} entries: \\d+ headless, \\d+ render, \\d+ package, \\d+ owner$`));
});

// --- real child processes: tiny fake probes -------------------------------------------------------------------------------------

function fakeProbes() {
  const dir = tempDir('probes');
  const write = (name, body) => writeFileSync(join(dir, name), body);
  write('ok.mjs', "console.log('PASS  [g] one');\nconsole.log('4 of 4 checks passed');\n");
  write('short.mjs', "console.log('FAIL  [g] two');\nconsole.error('3 of 4 checks passed');\nprocess.exitCode = 1;\n");
  write('garbage.mjs', "console.log('the editor crashed');\n");
  write('hang.mjs', "setInterval(() => {}, 1000);\nconsole.log('started');\n");
  write('args.mjs', "console.log(process.argv.slice(2).join(' '));\nconsole.log('1 of 1 checks passed');\n");
  return dir;
}
const fake = (name, script, extra = {}) => ({ name, script, args: [], class: 'headless', expect: { passed: 4, total: 4 }, timeoutMs: 20000, ...extra });

test('execEntry runs a script with --engine first, merges stdout and stderr, and reports the exit code', async () => {
  const dir = fakeProbes();
  try {
    const ok = await execEntry({ script: join(dir, 'args.mjs'), argv: ['--engine', 'E:/UE', '--only', 'x'], cwd: dir, timeoutMs: 20000 });
    assert.equal(ok.code, 0);
    assert.match(ok.output, /^--engine E:\/UE --only x\r?\n1 of 1 checks passed/);
    const short = await execEntry({ script: join(dir, 'short.mjs'), argv: [], cwd: dir, timeoutMs: 20000 });
    assert.equal(short.code, 1);
    assert.match(short.output, /FAIL {2}\[g\] two/);
    assert.match(short.output, /3 of 4 checks passed/);
    const missing = await execEntry({ script: join(dir, 'nope.mjs'), argv: [], cwd: dir, timeoutMs: 20000 });
    assert.notEqual(missing.code, 0);
  } finally { cleanup(dir); }
});

test('execEntry stops a run that exceeds its timeout and says so', async () => {
  const dir = fakeProbes();
  try {
    const started = Date.now();
    const run = await execEntry({ script: join(dir, 'hang.mjs'), argv: [], cwd: dir, timeoutMs: 600 });
    assert.equal(run.timedOut, true);
    assert.equal(run.code, null);
    assert.ok(Date.now() - started < 15000, 'the child was stopped, not waited for');
  } finally { cleanup(dir); }
});

test('main: a pass, a mismatch, an unparseable output and a timeout against real child processes, one report, exit 1', async () => {
  const dir = fakeProbes(), engine = tempDir('engine'), reportDir = tempDir('report');
  try {
    const manifest = [
      fake('ok', 'ok.mjs'), fake('short', 'short.mjs'), fake('garbage', 'garbage.mjs'), fake('hang', 'hang.mjs', { timeoutMs: 600 }),
      fake('owner', 'ok.mjs', { class: 'owner', expect: { exitOnly: true } }),
    ];
    const { lines, print } = quiet();
    const reportPath = join(reportDir, 'nested', 'report.json');
    const code = await main(['--engine', engine, '--report', reportPath], { manifest, examplesDir: dir, cwd: dir, print, error: print, pin: PIN, readVersion: otherVersion });
    assert.equal(code, 1);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.deepEqual(report.entries.map((r) => [r.name, r.status]), [['ok', 'pass'], ['short', 'mismatch'], ['garbage', 'error'], ['hang', 'error'], ['owner', 'skipped']]);
    assert.match(report.entries[3].detail, /timed out/);
    assert.deepEqual(report.entries[1].failing, ['two']);
    assert.ok(report.entries[1].tail.length > 0);
    assert.match(report.pinNote, /^NOTE: not the pinned build/);
    assert.ok(lines.some((l) => l.startsWith('report: ')));
    assert.ok(lines.some((l) => /^NOTE: not the pinned build/.test(l)));

    const again = await main(['--engine', engine, '--only', 'ok,owner', '--report', reportPath], { manifest, examplesDir: dir, cwd: dir, print: () => {}, error: () => {}, pin: PIN, readVersion: otherVersion });
    assert.equal(again, 0, 'a different build is a note, not a failure');
    assert.deepEqual(JSON.parse(readFileSync(reportPath, 'utf8')).summary, { pass: 2, 'as-expected': 0, mismatch: 0, error: 0, skipped: 3 });
  } finally { cleanup(dir, engine, reportDir); }
});

test('main: usage errors exit 2 and run nothing; --list and --help exit 0', async () => {
  const engine = tempDir('engine');
  try {
    const io = (extra = {}) => ({ manifest: [fake('ok', 'ok.mjs')], print: () => {}, error: () => {}, exec: async () => { throw new Error('must not run'); }, ...extra });
    assert.equal(await main([], io()), 2, 'no --engine');
    assert.equal(await main(['--engine', join(engine, 'missing')], io()), 2, 'no such folder');
    assert.equal(await main(['--engine', engine, '--only', 'nope'], io()), 2, 'unknown entry');
    assert.equal(await main(['--engine', engine, '--class', 'gpu'], io()), 2, 'unknown class');
    assert.equal(await main(['--engine', engine, '--class', 'owner'], io()), 2, 'nothing selected');
    assert.equal(await main(['--engine', engine, '--bogus'], io()), 2, 'unknown option');
    assert.equal(await main(['--list'], io()), 0, '--list needs no engine');
    assert.equal(await main(['--help'], io()), 0);
  } finally { cleanup(engine); }
});
