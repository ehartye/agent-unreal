// The engine version is one fact, engine-version.json. This test validates that file and, once the prose is version free, fails on any
// patch-level Unreal version, UEFN version or changelist number in the skills, READMEs and docs outside an explicit allowlist.
//   node --test scripts/engine-version-pin.test.mjs
// Out of scope by construction (the scan reads only Markdown in the folders below): scripts/, every *.test.mjs, the examples' code and the
// pin file itself. "5.7" and "5.8" alone are not flagged: they name a minor version or cite an Epic page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { validatePin } from '../examples/unreal/engine-version.mjs';

const ROOT = resolve(process.env.AGENT_UNREAL_ROOT ?? join(import.meta.dirname, '..'));
const ALLOWLIST_FILE = join(import.meta.dirname, 'engine-version-allowlist.json');

// The pinned changelists this repo has used: they identify a build as surely as a version number does.
const LITERAL_CHANGELISTS = ['58902052', '58210709', '56702186', '58557680', '59343437', '55116800'];
const PATTERNS = [
  ['an Unreal patch version', /\b5\.[0-9]\.[0-9]{1,2}\b/g],
  ['a UEFN version', /\bUEFN[ -]?(?:Release-)?42\.[0-9]+/g],
  ['a changelist', /\bCL-?\s?[0-9]{7,8}\b/g],
  ['a known changelist number', new RegExp(`\\b(?:${LITERAL_CHANGELISTS.join('|')})\\b`, 'g')],
];

// Markdown the scan reads, as [folder, recursive]; root files are named.
const SCOPE_DIRS = ['skills', 'docs', 'examples'];
const SCOPE_FILES = ['README.md', 'AGENTS.md'];
const SKIP_DIRS = new Set(['.git', 'node_modules']);

const toPosix = (p) => p.split(sep).join('/');
const markdownUnder = (root, dir) => {
  const base = join(root, dir);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : markdownUnder(root, `${dir}/${e.name}`);
    return e.isFile() && e.name.endsWith('.md') ? [`${dir}/${e.name}`] : [];
  });
};

/** The Markdown files in scope under `root`, root-relative with forward slashes, sorted. */
export function scopeFiles(root) {
  return [...SCOPE_FILES.filter((f) => existsSync(join(root, f))), ...SCOPE_DIRS.flatMap((d) => markdownUnder(root, d))].sort();
}

/** A path entry of the allowlist as a test: an exact file, a directory prefix (with or without the trailing slash) or a glob with * and **. */
function allowMatcher(path) {
  if (/[*?]/.test(path)) {
    const source = path.split('**').map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')).join('.*');
    const re = new RegExp(`^${source}$`);
    return (rel) => re.test(rel);
  }
  const dir = path.endsWith('/') ? path : `${path}/`;
  return (rel) => rel === path || rel.startsWith(dir);
}

/**
 * Finds version strings in the Markdown of skills/, docs/, examples/, README.md and AGENTS.md under `root`. `allow` is a list of
 * { path, reason } entries (a file, a directory prefix or a glob, root-relative); a file it matches is not scanned.
 * Returns sorted findings as "file:line: <what> (<match>)"; an empty list means the tree is clean.
 */
export function scanVersionStrings(root, { allow = [] } = {}) {
  const allowed = allow.map((a) => allowMatcher(a.path));
  const hits = [];
  for (const rel of scopeFiles(root)) {
    if (allowed.some((is) => is(rel))) continue;
    readFileSync(join(root, rel), 'utf8').split(/\r?\n/).forEach((line, i) => {
      for (const [what, re] of PATTERNS) {
        for (const m of line.matchAll(re)) hits.push(`${rel}:${i + 1}: ${what} (${m[0]})`);
      }
    });
  }
  return hits.sort();
}

const loadAllowlist = () => JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf8'));

// --- the pin file ------------------------------------------------------------------------------------------------------------

test('engine-version.json is a valid pin: Unreal X.Y.Z with an integer changelist and a date, UEFN NN.NN with a build', () => {
  const pin = JSON.parse(readFileSync(join(ROOT, 'engine-version.json'), 'utf8'));
  assert.deepEqual(validatePin(pin), []);
  assert.deepEqual(Object.keys(pin), ['unreal', 'uefn']);
  assert.equal(pin.uefn.verifiedOn === null || /^\d{4}-\d{2}-\d{2}$/.test(pin.uefn.verifiedOn), true);
  if (pin.uefn.verifiedOn === null) assert.match(pin.uefn.note ?? '', /no claim has been run/, 'an unverified UEFN entry says so');
});

test('the allowlist is an array of { path, reason } with a reason for every entry', () => {
  const allow = loadAllowlist();
  assert.ok(Array.isArray(allow));
  for (const a of allow) {
    assert.deepEqual(Object.keys(a).sort(), ['path', 'reason']);
    assert.ok(typeof a.path === 'string' && a.path.length > 0 && !a.path.startsWith('/') && !a.path.includes('..'), `path ${JSON.stringify(a.path)}`);
    assert.ok(typeof a.reason === 'string' && a.reason.trim().length >= 10, `${a.path}: say why`);
  }
  assert.equal(new Set(allow.map((a) => a.path)).size, allow.length, 'no duplicate paths');
});

// --- the scanner on fixture trees --------------------------------------------------------------------------------------------

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'engine-version-pin-'));
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}
const scan = (files, options) => {
  const root = tree(files);
  try { return scanVersionStrings(root, options); } finally { rmSync(root, { recursive: true, force: true }); }
};

test('a clean tree passes: minor versions, page citations, plugin versions and numbers that are not versions', () => {
  assert.deepEqual(scan({
    'README.md': 'Targets Unreal Engine 5.8 and UEFN. See the Epic 5.7 page and the 5.8 release notes.\nPlugin 0.17.1 and 15 of 25 checks, 42.40 on its own.\n',
    'AGENTS.md': 'Nothing here.\n',
    'skills/a/SKILL.md': '---\nname: a\ndescription: "Use when 5.8 work starts"\n---\nA cvar default of 1.5.\n',
    'docs/guide.md': 'Epic documents this at 5.7 and 5.8; 100 frames at 60.5 ms.\n',
    'examples/unreal/README.md': 'Run the probes. Build 12345 and CL 123456 (six digits) are not changelists.\n',
  }), []);
});

test('each pattern fails in its own right, with the file, the line and the match', () => {
  const hits = scan({
    'README.md': 'line one\nVerified on 5.8.4 only.\n',
    'skills/a/SKILL.md': '---\nname: a\ndescription: "Works on 5.7.3"\n---\n',
    'skills/a/references/r.md': 'Seen on UEFN 42.30 and UEFN-Release-42.40 and UEFN Release-42.10.\n',
    'docs/d.md': 'Built at CL-58902052, then CL 58210709, then CL58557680.\n',
    'examples/e/README.md': 'The pinned numbers 56702186 and 55116800 and 59343437 appear bare.\n',
    'AGENTS.md': 'A two digit patch: 5.8.10.\n',
  });
  assert.deepEqual(hits, [
    'AGENTS.md:1: an Unreal patch version (5.8.10)',
    'README.md:2: an Unreal patch version (5.8.4)',
    'docs/d.md:1: a changelist (CL 58210709)',
    'docs/d.md:1: a changelist (CL-58902052)',
    'docs/d.md:1: a changelist (CL58557680)',
    'docs/d.md:1: a known changelist number (58210709)',
    'docs/d.md:1: a known changelist number (58902052)',
    'examples/e/README.md:1: a known changelist number (55116800)',
    'examples/e/README.md:1: a known changelist number (56702186)',
    'examples/e/README.md:1: a known changelist number (59343437)',
    'skills/a/SKILL.md:3: an Unreal patch version (5.7.3)',
    'skills/a/references/r.md:1: a UEFN version (UEFN 42.30)',
    'skills/a/references/r.md:1: a UEFN version (UEFN Release-42.10)',
    'skills/a/references/r.md:1: a UEFN version (UEFN-Release-42.40)',
  ].sort());
});

test('Windows line endings do not hide a finding or move its line', () => {
  assert.deepEqual(scan({ 'docs/d.md': 'a\r\nb 5.8.2\r\n' }), ['docs/d.md:2: an Unreal patch version (5.8.2)']);
});

test('an allowlisted path passes: a file, a directory prefix with or without the slash, and a glob; a path that is not listed still fails', () => {
  const files = {
    'skills/x/references/history.md': 'On 5.8.2 this was different.\n',
    'docs/notes/a.md': 'UEFN 42.30 notes.\n',
    'docs/notes/deep/b.md': 'Pinned at 5.8.9.\n',
    'examples/unreal/fixtures/f.md': 'engine 5.8.3\n',
    'examples/unreal/other/g.md': 'engine 5.8.3\n',
    'README.md': 'clean\n',
  };
  const reason = 'kept as history';
  assert.equal(scan(files, { allow: [] }).length, 5);
  assert.deepEqual(scan(files, { allow: [{ path: 'skills/x/references/history.md', reason }] }).map((h) => h.split(':')[0]).sort(),
    ['docs/notes/a.md', 'docs/notes/deep/b.md', 'examples/unreal/fixtures/f.md', 'examples/unreal/other/g.md']);
  assert.deepEqual(scan(files, { allow: [{ path: 'docs/notes', reason }] }).map((h) => h.split(':')[0]).sort(),
    ['examples/unreal/fixtures/f.md', 'examples/unreal/other/g.md', 'skills/x/references/history.md']);
  assert.deepEqual(scan(files, { allow: [{ path: 'docs/notes/', reason }] }).length, 3);
  assert.deepEqual(scan(files, { allow: [{ path: 'examples/**/fixtures/*.md', reason }] }).map((h) => h.split(':')[0]).sort(),
    ['docs/notes/a.md', 'docs/notes/deep/b.md', 'examples/unreal/other/g.md', 'skills/x/references/history.md']);
  assert.deepEqual(scan(files, { allow: [{ path: 'docs/*.md', reason }] }).length, 5, '* does not cross a folder');
  assert.deepEqual(scan(files, { allow: [{ path: 'docs', reason }, { path: 'examples', reason }, { path: 'skills', reason }] }), []);
  assert.equal(scan(files, { allow: [{ path: 'docs/not', reason }] }).length, 5, 'a prefix is a folder, not a string prefix');
});

test('only Markdown in the named folders is read: code, JSON, scripts, tests, node_modules and other folders are out of scope', () => {
  assert.deepEqual(scan({
    'scripts/README.md': 'pin 5.8.4\n',
    'scripts/x.mjs': '// 5.8.4 CL-58902052\n',
    'engine-version.json': '{"version": "5.8.4", "changelist": 58902052}\n',
    'examples/unreal/a.mjs': "const v = '5.8.4';\n",
    'examples/unreal/a.test.mjs': "assert.equal(v, '5.8.4');\n",
    'examples/unreal/data.json': '{"engine": "5.8.4"}\n',
    'examples/unreal/node_modules/p/README.md': 'v5.8.4\n',
    'skills/a/scripts/s.py': '# 5.8.4\n',
    'other/notes.md': '5.8.4\n',
    'CHANGELOG.md': '5.8.4\n',
    '.claude-plugin/plugin.json': '{"x": "5.8.4"}\n',
  }), []);
});

test('a tree with none of the folders or files scans clean', () => {
  assert.deepEqual(scan({ 'unrelated.txt': '5.8.4\n' }), []);
});

// --- the real tree -----------------------------------------------------------------------------------------------------------

// Reports the findings without failing until the version sweep lands. To enforce it, delete the options argument ({ todo: ... }) below.
test('the skills, READMEs and docs name no patch version, UEFN version or changelist outside the allowlist', { todo: 'until the version sweep lands' }, () => {
  assert.deepEqual(scanVersionStrings(ROOT, { allow: loadAllowlist() }), []);
});
