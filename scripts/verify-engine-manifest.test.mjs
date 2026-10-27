// node --test scripts/verify-engine-manifest.test.mjs  (no Unreal, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST, CLASSES } from './verify-engine-manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('the manifest has the four classes and no duplicate names', () => {
  assert.deepEqual([...CLASSES], ['headless', 'render', 'package', 'owner']);
  const names = MANIFEST.map((e) => e.name);
  assert.equal(new Set(names).size, names.length, `duplicates: ${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`);
  for (const name of names) assert.match(name, /^[a-z][a-z0-9_]*$/, name);
});

test('every entry has the fields the runner reads, with a valid class and expectation', () => {
  for (const e of MANIFEST) {
    assert.ok(CLASSES.includes(e.class), `${e.name}: class ${e.class}`);
    assert.ok(Array.isArray(e.args) && e.args.every((a) => typeof a === 'string'), `${e.name}: args`);
    assert.ok(Number.isInteger(e.timeoutMs) && e.timeoutMs >= 60_000 && e.timeoutMs <= 6 * 3_600_000, `${e.name}: timeoutMs ${e.timeoutMs}`);
    assert.ok(e.needs === undefined || (typeof e.needs === 'string' && e.needs.length > 0), `${e.name}: needs`);
    assert.ok(!e.args.includes('--engine'), `${e.name}: the runner adds --engine`);
    const x = e.expect;
    assert.ok(x && typeof x === 'object', `${e.name}: expect`);
    const kinds = ['passed', 'exitOnly', 'note'].filter((k) => x[k] !== undefined);
    assert.ok(kinds.length >= 1, `${e.name}: expect names no kind`);
    if (x.passed !== undefined) {
      assert.ok(Number.isInteger(x.passed) && Number.isInteger(x.total) && x.total >= x.passed && x.passed >= 0 && x.total > 0, `${e.name}: counts`);
      assert.ok(x.exitOnly === undefined, `${e.name}: counts and exitOnly together`);
    } else {
      assert.ok(x.exitOnly === true || (typeof x.note === 'string' && x.note.length > 0), `${e.name}: exitOnly must be true, or note a sentence`);
    }
    if (x.note !== undefined) assert.equal(typeof x.note, 'string', `${e.name}: note`);
  }
});

test('a partial pass names its known failures, and nothing else carries them', () => {
  for (const e of MANIFEST) {
    const partial = e.expect.passed !== undefined && e.expect.passed < e.expect.total;
    if (partial) {
      assert.ok(Array.isArray(e.knownFailures) && e.knownFailures.length === e.expect.total - e.expect.passed, `${e.name}: one known failure per failing check`);
      assert.equal(new Set(e.knownFailures).size, e.knownFailures.length, `${e.name}: duplicate known failure`);
      for (const f of e.knownFailures) assert.ok(typeof f === 'string' && f.length > 0 && !/^\[/.test(f), `${e.name}: check name without a group tag`);
    } else assert.equal(e.knownFailures, undefined, `${e.name}: knownFailures on a full pass`);
  }
});

test('every script exists, and so does the example folder it is in', () => {
  for (const e of MANIFEST) {
    assert.ok(!e.script.startsWith('/') && !/^[A-Za-z]:/.test(e.script) && !e.script.includes('..') && e.script.startsWith('examples/unreal/'), `${e.name}: script path is relative to the repo root and under examples/unreal`);
    const file = join(ROOT, e.script);
    assert.ok(existsSync(file) && statSync(file).isFile(), `${e.name}: ${e.script} does not exist`);
    const folder = dirname(file);
    assert.ok(existsSync(folder) && statSync(folder).isDirectory(), `${e.name}: folder`);
  }
});

test('placeholders are only the two atlas paths, and the wire entry uses both', () => {
  for (const e of MANIFEST) {
    for (const a of e.args) for (const m of a.matchAll(/\{([^}]*)\}/g)) assert.ok(['atlasPng', 'atlasJson'].includes(m[1]), `${e.name}: unknown placeholder {${m[1]}}`);
  }
  const wire = MANIFEST.find((e) => e.name === 'nts_probe_wire');
  assert.ok(wire.args.includes('{atlasPng}') && wire.args.includes('{atlasJson}') && wire.args.includes('builtin'));
});

test('the manifest names no machine, home directory or GPU', () => {
  const text = JSON.stringify(MANIFEST);
  for (const [what, re] of [
    ['a home-directory path', /[A-Za-z]:[\\/]+Users[\\/]|\/Users\/|\/home\//],
    ['a drive path', /[A-Za-z]:[\\/]/],
    ['a laptop or desktop', /\b(?:laptop|desktop)\b/i],
    ['a host name', /\bhal\d*\b|\bssh\b/i],
    ['a GPU model', new RegExp(`${['Ge', 'Force'].join('')}|\\b${['R', 'TX'].join('')}\\b|${['Rade', 'on'].join('')}|\\b${['Ir', 'is'].join('')}\\b`)],
  ]) assert.ok(!re.test(text), `the manifest names ${what}`);
});

test('each class is used, and an owner entry has no count to judge', () => {
  const count = (c) => MANIFEST.filter((e) => e.class === c).length;
  for (const c of CLASSES) assert.ok(count(c) > 0, `no ${c} entry`);
  assert.equal(MANIFEST.filter((e) => e.class === 'owner').every((e) => e.expect.passed === undefined), true, 'an owner entry has no count to judge');
});
