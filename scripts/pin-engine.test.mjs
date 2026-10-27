// node --test scripts/pin-engine.test.mjs  (no Unreal, no dependencies; temp folders only)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs, planPin, run, formatPin, localDate, readReports, DEFAULT_PIN_FILE } from './pin-engine.mjs';
import { MANIFEST } from '../examples/unreal/verify/manifest.mjs';
import { validatePin } from '../examples/unreal/engine-version.mjs';

const SCRIPT = resolve(import.meta.dirname, 'pin-engine.mjs');
const OLD_PIN = { unreal: { version: '5.8.3', changelist: 58210709, verifiedOn: '2026-10-20' }, uefn: { version: '42.40', build: '59343437', verifiedOn: null, note: 'a target' } };
const NOW = () => new Date(2026, 10, 2, 9, 30); // 2 November 2026, local time

const info = (patch, versionChangelist, exeChangelist) => {
  const stale = exeChangelist !== null && versionChangelist !== null && exeChangelist !== versionChangelist;
  return {
    major: patch === null ? null : 5, minor: patch === null ? null : 8, patch, changelist: exeChangelist ?? versionChangelist, source: exeChangelist !== null ? 'executable' : versionChangelist !== null ? 'Build.version' : 'unreadable',
    versionFileChangelist: versionChangelist, executableChangelist: exeChangelist,
    warnings: stale ? [`the editor executable is changelist ${exeChangelist} but Build.version says ${versionChangelist}: the version files may be stale after a launcher update`] : [],
  };
};
const NEW_BUILD = info(5, 58999999, 58999999);

/** A temp workspace: an engine folder, the pin file and a place for reports. */
function workspace(pin = OLD_PIN) {
  const root = mkdtempSync(join(tmpdir(), 'pin-engine-'));
  const engine = join(root, 'engine');
  mkdirSync(engine);
  const pinFile = join(root, 'engine-version.json');
  if (pin !== null) writeFileSync(pinFile, typeof pin === 'string' ? pin : formatPin(pin));
  return { root, engine, pinFile, read: () => readFileSync(pinFile, 'utf8'), clean: () => rmSync(root, { recursive: true, force: true }) };
}

/** A verify_all-style report; every non-owner manifest entry passes unless `statuses` says otherwise. */
function report(ws, name, { changelist = 58999999, statuses = {}, only = null, schema = 'verify-all/1' } = {}) {
  const entries = MANIFEST.filter((e) => e.class !== 'owner' && (!only || only.includes(e.name))).map((e) => ({ name: e.name, class: e.class, status: statuses[e.name] ?? 'pass' }));
  const path = join(ws.root, name);
  writeFileSync(path, JSON.stringify({ schema, engine: { changelist }, entries }));
  return path;
}

const drive = (ws, argv, deps = {}) => {
  const out = [], err = [];
  const code = run(['--engine', ws.engine, '--pin-file', ws.pinFile, ...argv], { print: (l) => out.push(l), error: (l) => err.push(l), now: NOW, readVersion: () => NEW_BUILD, ...deps });
  return { code, out: out.join('\n'), err: err.join('\n') };
};

test('parseArgs reads the options, repeats --report and rejects the unknown or malformed', () => {
  assert.deepEqual(parseArgs(['--engine', 'E', '--version', '5.8.5', '--report', 'a.json', '--report=b.json', '--write', '--force']),
    { engine: 'E', version: '5.8.5', reports: ['a.json', 'b.json'], write: true, force: true, pinFile: null, help: false });
  assert.match(parseArgs(['--engine']).error, /needs a value/);
  assert.match(parseArgs(['--version', '5.8']).error, /must look like 5\.8\.4/);
  assert.match(parseArgs(['--nope']).error, /unknown option/);
});

test('a dry run prints the pin it would write and leaves the file alone, even with green reports', () => {
  const ws = workspace();
  try {
    const before = ws.read();
    const r1 = report(ws, 'headless.json', { only: MANIFEST.filter((e) => e.class === 'headless').map((e) => e.name) });
    const r2 = report(ws, 'rest.json', { only: MANIFEST.filter((e) => e.class !== 'headless').map((e) => e.name) });
    const result = drive(ws, ['--report', r1, '--report', r2]);
    assert.equal(result.code, 0);
    assert.match(result.out, /would write the unreal block: \{"version": "5\.8\.5", "changelist": 58999999, "verifiedOn": "2026-11-02"\}/);
    assert.match(result.out, /current pin: 5\.8\.3, changelist 58210709/);
    assert.match(result.out, /dry run: add --write/);
    assert.equal(ws.read(), before);
  } finally { ws.clean(); }
});

test('a dry run without reports says --write would refuse, and still exits 0', () => {
  const ws = workspace();
  try {
    const result = drive(ws, []);
    assert.equal(result.code, 0);
    assert.match(result.out, /would refuse without --force: no verify_all report was given/);
    assert.match(result.out, /--write would not update the pin yet/);
  } finally { ws.clean(); }
});

test('--write with reports that cover the manifest on this changelist updates the unreal block and nothing else', () => {
  const ws = workspace();
  try {
    const result = drive(ws, ['--write', '--report', report(ws, 'all.json')]);
    assert.equal(result.code, 0, result.out);
    const written = JSON.parse(ws.read());
    assert.deepEqual(written.unreal, { version: '5.8.5', changelist: 58999999, verifiedOn: '2026-11-02' });
    assert.deepEqual(written.uefn, OLD_PIN.uefn);
    assert.deepEqual(validatePin(written), []);
    assert.equal(ws.read(), `{"unreal": {"version": "5.8.5", "changelist": 58999999, "verifiedOn": "2026-11-02"}, "uefn": {"version": "42.40", "build": "59343437", "verifiedOn": null, "note": "a target"}}\n`);
    assert.match(result.out, /the docs need no edit/);
  } finally { ws.clean(); }
});

test('--write refuses without green reports: none, red, another changelist, not a report, or too few entries', () => {
  const ws = workspace();
  try {
    const before = ws.read();
    const bad = join(ws.root, 'bad.json');
    writeFileSync(bad, '{ not json');
    const cases = {
      none: [[], /no verify_all report/],
      red: [[report(ws, 'red.json', { statuses: { nts_validate: 'mismatch', rp_rt_validate: 'error' } })], /not green \(nts_validate mismatch, rp_rt_validate error\)/],
      otherBuild: [[report(ws, 'other.json', { changelist: 58210709 })], /run on changelist 58210709, not 58999999/],
      notReport: [[report(ws, 'schema.json', { schema: 'something/1' })], /not a verify_all\.mjs report/],
      unreadable: [[bad], /cannot read the report/],
      missing: [[report(ws, 'partial.json', { only: ['nts_validate', 'rp_validate'] })], /do not cover \d+ manifest entries: .*pcg_packaged/],
    };
    for (const [label, [reports, pattern]] of Object.entries(cases)) {
      const result = drive(ws, ['--write', ...reports.flatMap((r) => ['--report', r])]);
      assert.equal(result.code, 1, label);
      assert.match(result.out, pattern, label);
      assert.equal(ws.read(), before, `${label}: the pin is untouched`);
    }
  } finally { ws.clean(); }
});

test('--force writes without the reports, and says what it went past', () => {
  const ws = workspace();
  try {
    const result = drive(ws, ['--write', '--force']);
    assert.equal(result.code, 0);
    assert.match(result.out, /forcing past: no verify_all report/);
    assert.equal(JSON.parse(ws.read()).unreal.changelist, 58999999);
  } finally { ws.clean(); }
});

test('stale version files: refuses to guess the version, even with --force; --version names it and the changelist stays the executable\'s', () => {
  const ws = workspace();
  try {
    const stale = () => info(3, 58210709, 58999999);
    const before = ws.read();
    const dry = drive(ws, [], { readVersion: stale });
    assert.equal(dry.code, 0);
    assert.match(dry.out, /would refuse: Build\.version \(5\.8\.3, changelist 58210709\) disagrees with the editor executable \(changelist 58999999\)/);
    assert.match(dry.out, /WARNING: the editor executable is changelist 58999999/);
    assert.doesNotMatch(dry.out, /would write the unreal block/);
    const refused = drive(ws, ['--write', '--force'], { readVersion: stale });
    assert.equal(refused.code, 1);
    assert.equal(ws.read(), before);

    const named = drive(ws, ['--write', '--force', '--version', '5.8.5'], { readVersion: stale });
    assert.equal(named.code, 0, named.out);
    assert.deepEqual(JSON.parse(ws.read()).unreal, { version: '5.8.5', changelist: 58999999, verifiedOn: '2026-11-02' });
  } finally { ws.clean(); }
});

test('an unreadable Build.version needs --version; an unreadable changelist cannot be written at all', () => {
  const ws = workspace();
  try {
    const noVersion = () => info(null, null, 58999999);
    assert.equal(drive(ws, ['--write', '--force'], { readVersion: noVersion }).code, 1);
    assert.match(drive(ws, [], { readVersion: noVersion }).out, /Build\.version is unreadable, so the version is unknown: pass --version/);
    assert.equal(drive(ws, ['--write', '--force', '--version', '5.8.5'], { readVersion: noVersion }).code, 0);

    const nothing = () => info(null, null, null);
    const result = drive(ws, ['--write', '--force', '--version', '5.8.6'], { readVersion: nothing });
    assert.equal(result.code, 1);
    assert.match(result.out, /changelist cannot be read/);
    assert.equal(JSON.parse(ws.read()).unreal.version, '5.8.5', 'the earlier write stands');
  } finally { ws.clean(); }
});

test('--version that differs from a trustworthy Build.version is written, with a note', () => {
  const ws = workspace();
  try {
    const result = drive(ws, ['--write', '--force', '--version', '5.9.0']);
    assert.equal(result.code, 0);
    assert.match(result.out, /note: Build\.version says 5\.8\.5; 5\.9\.0 comes from --version/);
    assert.equal(JSON.parse(ws.read()).unreal.version, '5.9.0');
  } finally { ws.clean(); }
});

test('a missing or invalid pin file cannot be updated', () => {
  for (const pin of [null, '{ nope', formatPin({ unreal: { version: '5.8' } })]) {
    const ws = workspace(pin);
    try {
      const result = drive(ws, ['--write', '--force']);
      assert.equal(result.code, 1);
      assert.match(result.out, /engine-version\.json is missing or invalid/);
    } finally { ws.clean(); }
  }
});

test('usage errors exit 2 and write nothing', () => {
  const ws = workspace();
  try {
    const before = ws.read();
    const quiet = { print: () => {}, error: () => {} };
    assert.equal(run([], quiet), 2);
    assert.equal(run(['--engine', join(ws.root, 'missing')], quiet), 2);
    assert.equal(run(['--engine', ws.engine, '--version', 'five'], quiet), 2);
    assert.equal(run(['--engine', ws.engine, '--bogus'], quiet), 2);
    assert.equal(run(['--help'], quiet), 0);
    assert.equal(ws.read(), before);
  } finally { ws.clean(); }
});

test('formatPin writes the shape of engine-version.json, and the repo\'s own file round-trips through it', () => {
  const text = readFileSync(DEFAULT_PIN_FILE, 'utf8');
  assert.equal(formatPin(JSON.parse(text)), text, 'the pin file stays one line in this format, so a write is a small diff');
  assert.deepEqual(validatePin(JSON.parse(text)), []);
});

test('localDate uses the local calendar day', () => {
  assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(localDate(new Date(2026, 11, 31, 0, 1)), '2026-12-31');
});

test('planPin and readReports are pure: the same input gives the same plan and no file is written', () => {
  const plan = planPin({ info: NEW_BUILD, versionArg: null, pin: OLD_PIN, reports: [], today: '2026-11-02', readFile: () => { throw new Error('no reads without reports'); } });
  assert.deepEqual(plan.newPin.unreal, { version: '5.8.5', changelist: 58999999, verifiedOn: '2026-11-02' });
  assert.deepEqual(plan.identify, []);
  assert.equal(plan.evidence.length, 1);
  const { problems, covered } = readReports(['x.json'], { changelist: 1, readFile: () => JSON.stringify({ schema: 'verify-all/1', engine: { changelist: 1 }, entries: [{ name: 'a', status: 'as-expected' }, { name: 'b', status: 'skipped' }] }) });
  assert.deepEqual([problems, [...covered]], [[], ['a']]);
});

test('the command line: --help exits 0, no arguments exit 2, and a dry run against a temp engine folder exits 0', () => {
  const ws = workspace();
  try {
    const exec = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    assert.equal(exec('--help').status, 0);
    assert.equal(exec().status, 2);
    const dry = exec('--engine', ws.engine, '--pin-file', ws.pinFile);
    assert.equal(dry.status, 0);
    assert.match(dry.stdout, /current pin: 5\.8\.3/);
    assert.match(dry.stdout, /would refuse/, 'an engine folder with no version files cannot be identified');
  } finally { ws.clean(); }
});
