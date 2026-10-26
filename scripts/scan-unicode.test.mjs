/** @lane merge @subject scripts/scan-unicode.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanText, scanTree, listFiles, main, invisibleKind } from './scan-unicode.mjs';

// Every invisible character in this file is built from its code point, so the file itself is clean (the scan below proves it).
const ch = (cp) => String.fromCodePoint(cp);
const ROOT = resolve(process.env.AGENT_UNREAL_ROOT ?? join(import.meta.dirname, '..'));

/** A fresh folder holding the given files (path -> text or Buffer). */
function mkRoot(files) {
  const root = mkdtempSync(join(tmpdir(), 'scan-unicode-'));
  for (const [rel, data] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
  }
  return root;
}

test('format, private-use and unassigned code points and the whole tag block are found, with line, column and the escaped form', () => {
  const cases = [
    [0xfeff, 'Cf', 'byte-order mark'],
    [0x200b, 'Cf', 'zero-width'],
    [0x200d, 'Cf', 'zero-width'],
    [0x00ad, 'Cf', 'soft hyphen'],
    [0x202e, 'Cf', 'bidirectional control'],
    [0x2066, 'Cf', 'bidirectional control'],
    [0xe0001, 'tag', 'tag block'],
    [0xe0041, 'tag', 'tag block'],
    [0xe007f, 'tag', 'tag block'],
    [0xe0000, 'tag', 'tag block'], // unassigned in the block, still rejected as a tag
    [0xe000, 'Co', ''],
    [0xf8ff, 'Co', ''],
    [0x0378, 'Cn', ''],
    [0x10ffff, 'Cn', ''],
  ];
  for (const [cp, kind, name] of cases) {
    const found = scanText(`ab${ch(cp)}c\nsecond line`);
    assert.equal(found.length, 1, `U+${cp.toString(16)}`);
    assert.deepEqual([found[0].line, found[0].column, found[0].kind, found[0].name], [1, 3, kind, name]);
    assert.equal(found[0].escaped, `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
    assert.equal(invisibleKind(cp), kind);
  }
  // Line numbers count lines, columns count code points (an astral character before it is one column), CRLF is not a column.
  const found = scanText(`one\r\ntwo ${ch(0x1f600)}${ch(0xfeff)}\r\n`);
  assert.deepEqual(found.map((f) => [f.line, f.column]), [[2, 6]]);
  assert.equal(found[0].context, 'two \u{1f600}<U+FEFF>');
});

test('ordinary non-ASCII text is not reported: accents, CJK, an emoji, a variation selector, dashes and curly quotes', () => {
  const text = ['café', '漢字', ch(0x1f600), `a${ch(0xfe0f)}`, '– — “”', '   ', 'tab\there'].join('\n');
  assert.deepEqual(scanText(text), []);
});

test('a U+FEFF inside a .mjs source is found at its line; so is one that opens the file; a CRLF file keeps its line numbers', () => {
  const lines = Array.from({ length: 700 }, (_, i) => `const line${i + 1} = ${i + 1};`);
  lines[638] = `const marker = '${ch(0xfeff)}';`; // line 639
  const root = mkRoot({
    'examples/engine_source.mjs': `${lines.join('\n')}\n`,
    'examples/bom.json': `${ch(0xfeff)}{}\n`,
    'examples/crlf.md': `a\r\nb ${ch(0x200b)}\r\n`,
    'examples/clean.md': 'nothing here\n',
  });
  const found = scanTree(root);
  assert.deepEqual(found.map((f) => `${f.file}:${f.line}:${f.column}:${f.rule}`), [
    'examples/bom.json:1:1:invisible-unicode',
    'examples/crlf.md:2:3:invisible-unicode',
    'examples/engine_source.mjs:639:17:invisible-unicode',
  ]);
  assert.match(found[2].message, /^U\+FEFF byte-order mark \(Cf\) in "const marker = '<U\+FEFF>';"$/);
});

test('binary files are skipped and a text file that is not valid UTF-8 is reported', () => {
  const root = mkRoot({
    'a.bin': Buffer.from([0x89, 0x50, 0x00, 0xef, 0xbb, 0xbf, 0x41]), // has a NUL: binary
    'latin1.txt': Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]), // "cafe" with a Latin-1 e-acute: not UTF-8
    'ok.txt': 'café\n',
  });
  assert.deepEqual(scanTree(root).map((f) => [f.file, f.rule]), [['latin1.txt', 'invalid-utf8']]);
});

/** A git repo with the given files tracked, then more files left untracked and ignored. */
function gitRoot() {
  const root = mkRoot({ '.gitignore': 'ignored.md\nbuild/\n', 'tracked.md': 'tracked\n', 'dir/also.md': 'x\n' });
  const run = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  };
  run('init', '--quiet');
  run('add', '-A');
  run('commit', '--quiet', '-m', 'c');
  writeFileSync(join(root, 'untracked.md'), `new ${ch(0xe0041)}\n`);
  writeFileSync(join(root, 'ignored.md'), `ignored ${ch(0xfeff)}\n`);
  mkdirSync(join(root, 'build'));
  writeFileSync(join(root, 'build', 'out.md'), `${ch(0xfeff)}\n`);
  return root;
}

test('in a git checkout, tracked and untracked files are scanned and ignored ones are not', () => {
  const root = gitRoot();
  assert.deepEqual(listFiles(root), ['.gitignore', 'dir/also.md', 'tracked.md', 'untracked.md']);
  assert.deepEqual(scanTree(root).map((f) => f.file), ['untracked.md']);
});

test('without git, every file is walked except .git and node_modules', () => {
  const root = mkRoot({ 'a.md': 'a\n', 'sub/b.md': 'b\n', 'node_modules/x/y.md': `${ch(0xfeff)}\n`, '.git/config': 'c\n' });
  assert.deepEqual(listFiles(root), ['a.md', 'sub/b.md']);
});

test('main: 0 and a summary when clean (nothing with --quiet), 1 with the findings printed, 2 on a usage error', () => {
  const log = console.log;
  const err = console.error;
  let out = [];
  console.log = (line) => out.push(line);
  console.error = () => {};
  try {
    const clean = mkRoot({ 'a.md': 'fine\n' });
    assert.equal(main([clean]), 0);
    assert.deepEqual(out, ['scan-unicode: ok']);
    out = [];
    assert.equal(main(['--quiet', clean]), 0);
    assert.deepEqual(out, []);

    const dirty = mkRoot({ 'x/a.md': `fine\nbad ${ch(0xe0041)}\n` });
    assert.equal(main(['--quiet', dirty]), 1);
    assert.deepEqual(out, ['x/a.md:2:5: invisible-unicode: U+E0041 tag block (Cf) in "bad <U+E0041>"', 'scan-unicode: 1 finding(s)']);
    assert.equal(main(['--bogus']), 2);
    assert.equal(main([join(clean, 'missing')]), 2);
    assert.equal(main([clean, dirty]), 2);
  } finally {
    console.log = log;
    console.error = err;
  }
});

test("this plugin's scripts folder holds no invisible Unicode", () => {
  // The whole checkout is the gate's job (check.mjs runs the scan over it); the scripts are checked here so a fixture built
  // with a literal character cannot slip in unnoticed.
  assert.deepEqual(scanTree(ROOT).filter((f) => f.file.startsWith('scripts/')), []);
});
