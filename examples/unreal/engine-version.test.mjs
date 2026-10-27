// node --test examples/unreal/engine-version.test.mjs  (no Unreal, no dependencies, no Windows)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changelistFromProductVersion, readEngineVersion, describeEngine, readPin, pinNote, validatePin } from './engine-version.mjs';

function withEngine(buildVersion, run) {
  const root = mkdtempSync(join(tmpdir(), 'engine-version-'));
  try {
    if (buildVersion !== undefined) {
      mkdirSync(join(root, 'Engine', 'Build'), { recursive: true });
      writeFileSync(join(root, 'Engine', 'Build', 'Build.version'), typeof buildVersion === 'string' ? buildVersion : JSON.stringify(buildVersion));
    }
    return run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

const fileVersion = (patch, changelist) => ({ MajorVersion: 5, MinorVersion: 8, PatchVersion: patch, Changelist: changelist, BranchName: '++UE5+Release-5.8' });
const NO_PIN = { pin: null };
const win = (productVersion) => ({ platform: 'win32', readProductVersion: () => productVersion });

test('changelistFromProductVersion reads the CL number and nothing else', () => {
  assert.equal(changelistFromProductVersion('++UE5+Release-5.8-CL-58902052'), 58902052);
  assert.equal(changelistFromProductVersion('5.8.4.0'), undefined);
  assert.equal(changelistFromProductVersion(undefined), undefined);
  assert.equal(changelistFromProductVersion(''), undefined);
});

test('the version file and the executable agree: no warning, one plain line', () => {
  withEngine(fileVersion(4, 58902052), (root) => {
    const info = readEngineVersion(root, win('++UE5+Release-5.8-CL-58902052'));
    assert.deepEqual([info.major, info.minor, info.patch, info.changelist, info.source], [5, 8, 4, 58902052, 'executable']);
    assert.deepEqual(info.warnings, []);
    assert.deepEqual(describeEngine(info, 'E:/UE', NO_PIN), ['engine 5.8.4 (changelist 58902052), E:/UE']);
  });
});

test('the changelists differ: the executable wins, the numbers are marked as the version file, and a warning names both', () => {
  withEngine(fileVersion(3, 58210709), (root) => {
    const info = readEngineVersion(root, win('++UE5+Release-5.8-CL-58902052'));
    assert.deepEqual([info.major, info.minor, info.patch, info.changelist, info.source], [5, 8, 3, 58902052, 'executable']);
    assert.equal(info.versionFileChangelist, 58210709);
    assert.equal(info.warnings.length, 1);
    assert.match(info.warnings[0], /58902052/);
    assert.match(info.warnings[0], /58210709/);
    assert.match(info.warnings[0], /stale after a launcher update/);
    const lines = describeEngine(info, 'E:/UE', NO_PIN);
    assert.equal(lines[0], 'engine 5.8.3 (version file), changelist 58902052 (editor executable), E:/UE');
    assert.match(lines[1], /^WARNING: /);
  });
});

test('an executable that cannot be read leaves the version file as the answer, with no warning and no crash', () => {
  withEngine(fileVersion(4, 58902052), (root) => {
    for (const options of [win(undefined), win('no changelist in here'), { platform: 'win32', readProductVersion: () => { throw new Error('powershell missing'); } }]) {
      const info = readEngineVersion(root, options);
      assert.deepEqual([info.changelist, info.source, info.warnings], [58902052, 'Build.version', []]);
      assert.equal(describeEngine(info, 'E:/UE', NO_PIN)[0], 'engine 5.8.4 (changelist 58902052), E:/UE');
    }
  });
});

test('off Windows the executable is not asked', () => {
  withEngine(fileVersion(3, 58210709), (root) => {
    let asked = false;
    const info = readEngineVersion(root, { platform: 'linux', readProductVersion: () => { asked = true; return '++UE5+Release-5.8-CL-58902052'; } });
    assert.equal(asked, false);
    assert.deepEqual([info.changelist, info.source, info.warnings], [58210709, 'Build.version', []]);
  });
});

test('a malformed or missing Build.version does not throw and says it is unreadable', () => {
  for (const content of ['{ not json', JSON.stringify({ MajorVersion: 5 }), JSON.stringify({ MajorVersion: '5', MinorVersion: 8, PatchVersion: 4 }), undefined]) {
    withEngine(content, (root) => {
      const info = readEngineVersion(root, { platform: 'linux' });
      assert.deepEqual([info.major, info.changelist, info.source, info.warnings], [null, null, 'unreadable', []]);
      assert.equal(describeEngine(info, 'E:/UE', NO_PIN)[0], 'engine version: Build.version unreadable, E:/UE');
    });
  }
});

test('a malformed Build.version with a readable executable still reports the executable changelist, without a warning', () => {
  withEngine('{ not json', (root) => {
    const info = readEngineVersion(root, win('++UE5+Release-5.8-CL-58902052'));
    assert.deepEqual([info.major, info.changelist, info.source, info.warnings], [null, 58902052, 'executable', []]);
    assert.equal(describeEngine(info, 'E:/UE', NO_PIN)[0], 'engine version: Build.version unreadable, changelist 58902052 (editor executable), E:/UE');
  });
});

// --- the pin: a note when the engine is another build, never a refusal ----------------------------------------------------------------

const PIN = { unreal: { version: '5.8.4', changelist: 58902052, verifiedOn: '2026-10-26' }, uefn: { version: '42.40', build: '59343437', verifiedOn: null } };
const NOTE = 'NOTE: not the pinned build (pin: 5.8.4, changelist 58902052); claims in this repo were verified on the pin and results here are at your own risk';

function withPinRoot(content, run) {
  const root = mkdtempSync(join(tmpdir(), 'engine-pin-'));
  try {
    if (content !== undefined) writeFileSync(join(root, 'engine-version.json'), typeof content === 'string' ? content : JSON.stringify(content));
    return run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('the engine agrees with the pin: no note, and describeEngine prints the plain line', () => {
  withEngine(fileVersion(4, 58902052), (root) => {
    const info = readEngineVersion(root, win('++UE5+Release-5.8-CL-58902052'));
    assert.equal(pinNote(info, PIN), null);
    assert.deepEqual(describeEngine(info, 'E:/UE', { pin: PIN }), ['engine 5.8.4 (changelist 58902052), E:/UE']);
  });
});

test('the engine differs from the pin: one NOTE line after the engine line, and the version numbers stay the engine\'s', () => {
  withEngine(fileVersion(3, 58210709), (root) => {
    const info = readEngineVersion(root, win('++UE5+Release-5.8-CL-58210709'));
    assert.equal(pinNote(info, PIN), NOTE);
    assert.deepEqual(describeEngine(info, 'E:/UE', { pin: PIN }), ['engine 5.8.3 (changelist 58210709), E:/UE', NOTE]);
  });
});

test('a stale version file with the pinned executable is the pinned build: the warning stays, the note does not appear', () => {
  withEngine(fileVersion(3, 58210709), (root) => {
    const info = readEngineVersion(root, win('++UE5+Release-5.8-CL-58902052'));
    const lines = describeEngine(info, 'E:/UE', { pin: PIN });
    assert.equal(lines.length, 2);
    assert.match(lines[1], /^WARNING: /);
  });
});

test('the warnings come before the note when both apply', () => {
  withEngine(fileVersion(3, 58210709), (root) => {
    const info = readEngineVersion(root, win('++UE5+Release-5.8-CL-56702186'));
    const lines = describeEngine(info, 'E:/UE', { pin: PIN });
    assert.deepEqual(lines.map((l) => l.split(':')[0].split(' ')[0]), ['engine', 'WARNING', 'NOTE']);
  });
});

test('the executable cannot be read: the pin is compared with the Build.version changelist', () => {
  withEngine(fileVersion(3, 58210709), (root) => {
    const info = readEngineVersion(root, win(undefined));
    assert.equal(info.source, 'Build.version');
    assert.equal(pinNote(info, PIN), NOTE);
  });
  withEngine(fileVersion(4, 58902052), (root) => {
    assert.equal(pinNote(readEngineVersion(root, win(undefined)), PIN), null);
    assert.equal(pinNote(readEngineVersion(root, { platform: 'linux' }), PIN), null);
  });
});

test('an engine that cannot be identified at all still gets the note (nothing shows it is the pinned build)', () => {
  withEngine(undefined, (root) => {
    const info = readEngineVersion(root, { platform: 'linux' });
    assert.equal(pinNote(info, PIN), NOTE);
    assert.equal(describeEngine(info, 'E:/UE', { pin: PIN })[1], NOTE);
  });
});

test('no pin: no note, whatever the engine is', () => {
  withEngine(fileVersion(3, 58210709), (root) => {
    const info = readEngineVersion(root, { platform: 'linux' });
    assert.equal(pinNote(info, null), null);
    assert.equal(pinNote(info, undefined), null);
    assert.equal(pinNote(info, {}), null);
    assert.deepEqual(describeEngine(info, 'E:/UE', NO_PIN), ['engine 5.8.3 (changelist 58210709), E:/UE']);
  });
});

test('readPin returns null for an absent, unreadable, malformed or invalid file and never throws', () => {
  withPinRoot(undefined, (root) => assert.equal(readPin(root), null));
  withPinRoot('{ not json', (root) => assert.equal(readPin(root), null));
  withPinRoot('[]', (root) => assert.equal(readPin(root), null));
  withPinRoot({ unreal: { version: '5.8', changelist: '58902052', verifiedOn: 'today' } }, (root) => assert.equal(readPin(root), null));
  assert.equal(readPin(join(tmpdir(), 'engine-pin-no-such-folder-0f3c')), null);
  withPinRoot(PIN, (root) => assert.deepEqual(readPin(root), PIN));
});

test('describeEngine without options reads the pin from the repo root', () => {
  withEngine(fileVersion(4, 1), (root) => {
    const info = readEngineVersion(root, win('++UE5+Release-5.8-CL-1'));
    const lines = describeEngine(info, 'E:/UE');
    const real = readPin();
    assert.equal(lines.length, real ? 2 : 1, 'the repo carries a pin, so another build gets the note');
    if (real) assert.match(lines[1], /^NOTE: not the pinned build \(pin: \d+\.\d+\.\d+, changelist \d+\)/);
  });
});

test('validatePin accepts the shape of the pin file and names each way it can be wrong', () => {
  assert.deepEqual(validatePin(PIN), []);
  assert.deepEqual(validatePin({ ...PIN, uefn: { ...PIN.uefn, verifiedOn: '2026-10-27', note: 'x' } }), []);
  const bad = (change) => validatePin(change(structuredClone(PIN)));
  assert.match(bad((p) => { p.unreal.version = '5.8'; return p; })[0], /unreal\.version/);
  assert.match(bad((p) => { p.unreal.changelist = '58902052'; return p; })[0], /unreal\.changelist/);
  assert.match(bad((p) => { p.unreal.changelist = 5.5; return p; })[0], /unreal\.changelist/);
  assert.match(bad((p) => { p.unreal.verifiedOn = null; return p; })[0], /unreal\.verifiedOn/);
  assert.match(bad((p) => { p.uefn.version = '42'; return p; })[0], /uefn\.version/);
  assert.match(bad((p) => { p.uefn.build = 59343437; return p; })[0], /uefn\.build/);
  assert.match(bad((p) => { p.uefn.verifiedOn = 'soon'; return p; })[0], /uefn\.verifiedOn/);
  assert.match(bad((p) => { delete p.uefn; return p; })[0], /uefn is missing/);
  assert.deepEqual(validatePin(null), ['the pin is not an object']);
});
