// node --test examples/unreal/engine-version.test.mjs  (no Unreal, no dependencies, no Windows)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changelistFromProductVersion, readEngineVersion, describeEngine } from './engine-version.mjs';

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
    assert.deepEqual(describeEngine(info, 'E:/UE'), ['engine 5.8.4 (changelist 58902052), E:/UE']);
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
    const lines = describeEngine(info, 'E:/UE');
    assert.equal(lines[0], 'engine 5.8.3 (version file), changelist 58902052 (editor executable), E:/UE');
    assert.match(lines[1], /^WARNING: /);
  });
});

test('an executable that cannot be read leaves the version file as the answer, with no warning and no crash', () => {
  withEngine(fileVersion(4, 58902052), (root) => {
    for (const options of [win(undefined), win('no changelist in here'), { platform: 'win32', readProductVersion: () => { throw new Error('powershell missing'); } }]) {
      const info = readEngineVersion(root, options);
      assert.deepEqual([info.changelist, info.source, info.warnings], [58902052, 'Build.version', []]);
      assert.equal(describeEngine(info, 'E:/UE')[0], 'engine 5.8.4 (changelist 58902052), E:/UE');
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
      assert.equal(describeEngine(info, 'E:/UE')[0], 'engine version: Build.version unreadable, E:/UE');
    });
  }
});

test('a malformed Build.version with a readable executable still reports the executable changelist, without a warning', () => {
  withEngine('{ not json', (root) => {
    const info = readEngineVersion(root, win('++UE5+Release-5.8-CL-58902052'));
    assert.deepEqual([info.major, info.changelist, info.source, info.warnings], [null, 58902052, 'executable', []]);
    assert.equal(describeEngine(info, 'E:/UE')[0], 'engine version: Build.version unreadable, changelist 58902052 (editor executable), E:/UE');
  });
});
