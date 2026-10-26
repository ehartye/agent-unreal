/** @lane merge @subject scripts/check.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// The file under test. Never run the real tree here without --no-tests or --skill: the gate would run this file again.
const SUBJECT = 'check.mjs';
const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const CHECK = join(SCRIPTS, SUBJECT);
const REAL_SKILLS = join(SCRIPTS, '..', 'skills');
const { STRICTNESS, DIFF_AWARE, lintPlan, discoverTests, parseArgs, resolveLabelsRef } = await import(pathToFileURL(CHECK).href);

// --- fixtures ---------------------------------------------------------------------------------------------------

const skillMd = (name, rule = '[tested] A rule.') => `---
name: ${name}
description: Build a demo. Use when writing demo code. Not for choosing an engine.
---

# Demo

| You are about to | Read |
| --- | --- |
| Do the first thing | [first](references/first.md) |

## Rules

- ${rule}
`;
const GOOD_REF = '# First\n\n- [tested] A labelled claim.\n';
const BARE_REF = '# First\n\n- A claim with no label.\n';
// A fixture test file leaves ran.txt beside itself, so a run is proven by that file and not by what a reporter prints.
const RAN = "import { writeFileSync } from 'node:fs';\nimport { test } from 'node:test';\nwriteFileSync(new URL('./ran.txt', import.meta.url), 'ran');\n";
const PASSING_TEST = RAN + "test('passes', () => {});\n";
const FAILING_TEST = RAN + "import assert from 'node:assert/strict';\ntest('fails on purpose', () => assert.equal(1, 2));\n";
const ran = (root, dir = 'scripts') => existsSync(join(root, dir, 'ran.txt'));
// A reference the SKILL.md table does not link: exactly one reference-orphan finding.
const ORPHAN = { 'references/orphan.md': GOOD_REF };

/** The files of one skill folder, keyed by path from the fixture root. */
function skill(name, { rule, first = GOOD_REF, extra = {} } = {}) {
  return {
    [`skills/${name}/SKILL.md`]: skillMd(name, rule),
    [`skills/${name}/references/first.md`]: first,
    ...Object.fromEntries(Object.entries(extra).map(([rel, text]) => [`skills/${name}/${rel}`, text])),
  };
}

/** A fresh fixture root in the OS temp folder holding the given files. */
function mkRoot(files) {
  const root = mkdtempSync(join(tmpdir(), 'check-script-'));
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}

/** Run check.mjs in a child. NODE_TEST_CONTEXT is stripped first (this file runs under node --test), then env is applied. */
function runCheck(root, args, env = {}, script = CHECK) {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.AGENT_UNREAL_ROOT;
  if (root) childEnv.AGENT_UNREAL_ROOT = root;
  Object.assign(childEnv, env);
  const r = spawnSync(process.execPath, [script, ...args], { cwd: tmpdir(), env: childEnv, encoding: 'utf8', timeout: 120000 });
  const all = r.stdout.split(/\r?\n/).filter(Boolean);
  // The "listing:" lines (each skill's listing length, shared trigger words) are tested on their own.
  const lines = all.filter((line) => !line.startsWith('listing: '));
  return { code: r.status, out: r.stdout, err: r.stderr, lines, listing: all.filter((line) => line.startsWith('listing: ')), last: lines.at(-1) };
}

// --- lintPlan ---------------------------------------------------------------------------------------------------

test('lintPlan lists every folder with a SKILL.md, sorted, with the table flags; a folder not in the table gets the default rules', () => {
  const root = mkRoot({
    ...skill('beta'), ...skill('alpha'), ...skill('gamma'),
    'skills/not-a-skill/readme.md': 'no SKILL.md here\n',
    'skills/loose-file.md': 'a file, not a folder\n',
  });
  const table = { alpha: ['--label-pattern', '.'], beta: [] };
  const plan = lintPlan(join(root, 'skills'), table);
  assert.deepEqual(plan.map((p) => [p.name, p.flags]), [['alpha', ['--label-pattern', '.']], ['beta', []], ['gamma', []]]);
  assert.equal(plan[0].dir, join(root, 'skills', 'alpha'));
  plan[0].flags.push('--mutated');
  assert.deepEqual(table.alpha, ['--label-pattern', '.'], 'the plan holds copies, so the table cannot be changed through it');
});

test('lintPlan: a table entry with no skill folder throws and names it; requireAll false allows it', () => {
  const root = mkRoot({ ...skill('alpha') });
  const skillsDir = join(root, 'skills');
  assert.throws(() => lintPlan(skillsDir, { alpha: [], renamed: ['--label-pattern', '.'] }), /renamed/);
  assert.throws(() => lintPlan(skillsDir, { alpha: [], 'gone-a': [], 'gone-b': [] }), /gone-a.*gone-b/);
  assert.deepEqual(lintPlan(skillsDir, { alpha: [], renamed: [] }, { requireAll: false }).map((p) => p.name), ['alpha']);
  // A folder that lost its SKILL.md is no skill folder, so its entry is stale too.
  const hollow = mkRoot({ ...skill('alpha'), 'skills/hollow/references/x.md': GOOD_REF });
  assert.throws(() => lintPlan(join(hollow, 'skills'), { alpha: [], hollow: [] }), /hollow/);
});

test('golden: on the real skills/ the plan keeps the flags the gate used before it derived its list', () => {
  // The nine invocations check.mjs hard-coded before the list came from skills/, written out here on purpose.
  const previous = [
    ['unreal-native', '--require-claims', '--skill-md-labels'],
    ['unreal-effects', '--label-pattern', '.'],
    ['unreal-animation', '--label-pattern', '.'],
    ['unreal-gameplay', '--label-pattern', '.'],
    ['unreal-procedural', '--label-pattern', '.'],
    ['unreal-rendering', '--label-pattern', '.'],
    ['unreal-editor-scripting', '--label-pattern', '.'],
    ['uefn'],
    ['unreal-import', '--label-pattern', '.'],
  ];
  const plan = lintPlan(REAL_SKILLS); // requireAll by default: a stale table entry throws here
  const planned = new Map(plan.map((p) => [p.name, p.flags]));
  for (const [name, ...flags] of previous) assert.deepEqual(planned.get(name), flags, `${name} keeps its strictness`);
  assert.deepEqual(plan.map((p) => p.name), [...plan.map((p) => p.name)].sort(), 'sorted');
  // Every real skill folder with a SKILL.md is planned, so none is skipped.
  const folders = readdirSync(REAL_SKILLS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(REAL_SKILLS, d.name, 'SKILL.md'))).map((d) => d.name).sort();
  assert.deepEqual(plan.map((p) => p.name), folders);
  // The table has no entry that skills/ lacks.
  assert.deepEqual(Object.keys(STRICTNESS).filter((n) => !folders.includes(n)), []);
});

test('a tenth skill folder is in the plan with the default rules, and the gate fails until it complies', () => {
  const known = Object.keys(STRICTNESS);
  const stubs = Object.assign({}, ...known.map((n) => skill(n)));
  const full = mkRoot({ ...stubs, ...skill('tenth', { first: BARE_REF }) });
  const plan = lintPlan(join(full, 'skills'));
  assert.equal(plan.length, known.length + 1);
  assert.deepEqual(plan.find((p) => p.name === 'tenth').flags, []);

  // The same shape, small enough to run through check.mjs: one table skill and the tenth.
  const bare = mkRoot({ ...skill('unreal-effects', { first: BARE_REF }), ...skill('tenth', { first: BARE_REF }) });
  const failing = runCheck(bare, ['--no-tests']);
  assert.equal(failing.code, 1, failing.out + failing.err);
  assert.match(failing.out, /^tenth\/references\/first\.md:3: label-missing: /m);
  assert.doesNotMatch(failing.out, /unreal-effects\/.*label-missing/, 'the table entry (any text counts as a label) accepts the same bullet');
  assert.match(failing.out, /^unreal-effects: ok$/m);
  assert.match(failing.out, /^tenth: 1 finding\(s\)$/m);
  assert.equal(failing.last, 'check: FAILED tenth');

  const labelled = mkRoot({ ...skill('unreal-effects', { first: BARE_REF }), ...skill('tenth') });
  const passing = runCheck(labelled, ['--no-tests']);
  assert.equal(passing.code, 0, passing.out + passing.err);
  assert.equal(passing.last, 'check: ok (2 lints)');
});

// --- the runner -------------------------------------------------------------------------------------------------

test('every lint runs after a failure: two failing skills and a clean one print all findings, name both, exit 1', () => {
  const root = mkRoot({ ...skill('a', { extra: ORPHAN }), ...skill('b', { extra: ORPHAN }), ...skill('c') });
  const r = runCheck(root, ['--no-tests']);
  assert.equal(r.code, 1, r.out + r.err);
  assert.deepEqual(r.lines, [
    'a/references/orphan.md:1: reference-orphan: not linked from the SKILL.md table',
    'a: 1 finding(s)',
    'b/references/orphan.md:1: reference-orphan: not linked from the SKILL.md table',
    'b: 1 finding(s)',
    'c: ok',
    'check: FAILED a, b',
  ]);
});

test('a clean fixture ends with the ok line and counts its lints; a single lint is singular', () => {
  const root = mkRoot({ ...skill('a'), ...skill('b') });
  const both = runCheck(root, ['--no-tests']);
  assert.deepEqual([both.code, both.lines], [0, ['a: ok', 'b: ok', 'check: ok (2 lints)']]);
  const one = runCheck(root, ['--skill', 'a']);
  assert.deepEqual([one.code, one.lines], [0, ['a: ok', 'check: ok (1 lint)']]);
});

test('the strictness table reaches the lint: unreal-native is strict, uefn uses the default rules, other table skills accept any label text', () => {
  const root = mkRoot({
    ...skill('unreal-native', { rule: 'A rule with no label.' }),
    ...skill('uefn', { first: BARE_REF }),
    ...skill('unreal-import', { first: BARE_REF }),
  });
  const r = runCheck(root, ['--no-tests']);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /^unreal-native\/SKILL\.md:\d+: label-missing: /m, '--skill-md-labels');
  assert.match(r.out, /^uefn\/references\/first\.md:3: label-missing: /m, 'default label rule');
  assert.match(r.out, /^unreal-import: ok$/m, "--label-pattern '.'");
  assert.equal(r.last, 'check: FAILED uefn, unreal-native', 'plan order is sorted by folder name');
});

test('--skill lints only the named skills, repeated or comma-separated, in plan order, and skips the test step', () => {
  const root = mkRoot({
    ...skill('a', { extra: ORPHAN }), ...skill('b'), ...skill('c', { extra: ORPHAN }),
    'scripts/fixture.test.mjs': FAILING_TEST,
  });
  const some = runCheck(root, ['--skill', 'c', '--skill', 'b']);
  assert.equal(some.code, 1, some.out + some.err);
  assert.deepEqual(some.lines, [
    'b: ok',
    'c/references/orphan.md:1: reference-orphan: not linked from the SKILL.md table',
    'c: 1 finding(s)',
    'check: FAILED c',
  ]);
  assert.equal(ran(root), false, 'the failing test file was not run');
  const joined = runCheck(root, ['--skill=b,a']);
  assert.deepEqual(joined.lines.filter((l) => /^[abc]: /.test(l)), ['a: 1 finding(s)', 'b: ok']);
  const once = runCheck(root, ['--skill', 'b,b', '--skill', 'b']);
  assert.deepEqual(once.lines, ['b: ok', 'check: ok (1 lint)']);
});

test('--skill with an unknown name exits 2, runs nothing and names the known skills', () => {
  const root = mkRoot({ ...skill('a', { extra: ORPHAN }), ...skill('b') });
  const r = runCheck(root, ['--skill', 'b,nope']);
  assert.equal(r.code, 2);
  assert.equal(r.out, '', 'no lint ran, not even for the known name');
  assert.match(r.err, /unknown skill "nope"/);
  assert.match(r.err, /known skills: a, b/);
});

test('real tree: --skill unreal-effects lints only that skill and prints no test output; --skill nope exits 2 naming the known skills', () => {
  const effects = runCheck(null, ['--skill', 'unreal-effects']);
  // Only the shape is asserted: whether the skill is clean is the gate's job and changes while its files are edited.
  const lint = effects.lines.slice(0, -1);
  assert.ok(lint.length >= 1 && lint.every((l) => l.startsWith('unreal-effects')), effects.out);
  assert.match(lint.at(-1), /^unreal-effects: (?:ok|\d+ finding\(s\))$/);
  assert.doesNotMatch(effects.out, /^(?:# tests|ℹ tests|TAP version)/m, 'no test output');
  if (lint.at(-1) === 'unreal-effects: ok') {
    assert.deepEqual([effects.code, effects.last], [0, 'check: ok (1 lint)']);
  } else {
    assert.deepEqual([effects.code, effects.last], [1, 'check: FAILED unreal-effects']);
  }

  const nope = runCheck(null, ['--skill', 'nope']);
  assert.equal(nope.code, 2);
  assert.equal(nope.out, '');
  for (const name of Object.keys(STRICTNESS)) assert.ok(nope.err.includes(name), `${name} is listed`);
});

test('usage errors exit 2 and run nothing', () => {
  const root = mkRoot({ ...skill('a') });
  for (const args of [['--bogus'], ['stray'], ['--skill'], ['--skill', '--no-tests'], ['--skill', ''], ['--skill', ',']]) {
    const r = runCheck(root, args);
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.out}${r.err}`);
    assert.equal(r.out, '', args.join(' '));
    assert.match(r.err, /usage:/, args.join(' '));
  }
  const help = runCheck(root, ['--help']);
  assert.deepEqual([help.code, /--skill/.test(help.out), /--no-tests/.test(help.out)], [0, true, true]);
});

test('an empty skills folder is a usage error, not a pass', () => {
  const root = mkRoot({ 'skills/.keep': '' });
  const r = runCheck(root, ['--no-tests']);
  assert.equal(r.code, 2);
  assert.match(r.err, /no skills found/);
});

// --- the test step does not pass vacuously --------------------------------------------------------------------

test('a failing test file still exits 1 while the lints print, and the FAILED line names tests first', () => {
  // Pass NODE_TEST_CONTEXT in on purpose: a node --test child that inherits it exits 0 without running the file on
  // Node 24 and prints a binary report on Node 20.11. check.mjs removes it, so the failure is reported on both.
  for (const env of [{}, { NODE_TEST_CONTEXT: 'child-v8' }]) {
    const root = mkRoot({ ...skill('a'), ...skill('b', { extra: ORPHAN }), 'scripts/fixture.test.mjs': FAILING_TEST });
    const r = runCheck(root, [], env);
    assert.equal(r.code, 1, JSON.stringify(env) + r.out + r.err);
    assert.equal(ran(root), true, 'the fixture test file really ran');
    assert.match(r.out, /^a: ok$/m);
    assert.match(r.out, /^b: 1 finding\(s\)$/m);
    assert.equal(r.last, 'check: FAILED tests, b');
  }
});

test('passing test files run and are counted in the ok line; --no-tests skips them', () => {
  const root = mkRoot({ ...skill('a'), 'scripts/fixture.test.mjs': PASSING_TEST, 'examples/x/sample.test.mjs': PASSING_TEST });
  const r = runCheck(root, [], { NODE_TEST_CONTEXT: 'child-v8' });
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(ran(root), true);
  assert.equal(ran(root, 'examples/x'), true, 'a test under examples/ runs too');
  assert.equal(r.last, 'check: ok (tests + 1 lint)');

  const skippedRoot = mkRoot({ ...skill('a'), 'scripts/fixture.test.mjs': FAILING_TEST });
  const skipped = runCheck(skippedRoot, ['--no-tests']);
  assert.deepEqual([skipped.code, ran(skippedRoot), skipped.last], [0, false, 'check: ok (1 lint)']);
});

test('a root with no test files fails the test step instead of passing it', () => {
  const root = mkRoot({ ...skill('a') });
  const r = runCheck(root, []);
  assert.equal(r.code, 1);
  assert.match(r.err, /no \*\.test\.mjs files/);
  assert.deepEqual(r.lines, ['a: ok', 'check: FAILED tests']);
});

test('discoverTests: scripts first, then examples recursively, sorted; a missing scripts/ or examples/ folder is tolerated', () => {
  const root = mkRoot({
    'scripts/b.test.mjs': '', 'scripts/a.test.mjs': '', 'scripts/helper.mjs': '', 'scripts/deep/inner.test.mjs': '',
    'examples/z/z.test.mjs': '', 'examples/a/b/deep.test.mjs': '', 'examples/a/a.test.mjs': '', 'examples/a/a.mjs': '',
  });
  assert.deepEqual(discoverTests(root), [
    'scripts/a.test.mjs', 'scripts/b.test.mjs',
    'examples/a/a.test.mjs', 'examples/a/b/deep.test.mjs', 'examples/z/z.test.mjs',
  ]);
  assert.deepEqual(discoverTests(mkRoot({ 'scripts/only.test.mjs': '' })), ['scripts/only.test.mjs']);
  assert.deepEqual(discoverTests(mkRoot({ 'examples/e/e.test.mjs': '' })), ['examples/e/e.test.mjs']);
  assert.deepEqual(discoverTests(mkRoot({ 'README.md': '' })), []);
});

// --- arguments and the entry point ------------------------------------------------------------------------------

test('parseArgs reads --skill (repeated, comma-separated, =), --file, --allow-orphan, --labels-since, --no-tests and --help, and rejects the rest', () => {
  const none = { skills: null, files: [], allowOrphans: [], labelsSince: null, noTests: false, help: false };
  assert.deepEqual(parseArgs([]), none);
  assert.deepEqual(parseArgs(['--no-tests']), { ...none, noTests: true });
  assert.deepEqual(parseArgs(['--file', 'a.md', '--file=b', '--allow-orphan', 'new.md', '--labels-since', 'origin/main']),
    { ...none, files: ['a.md', 'b'], allowOrphans: ['new.md'], labelsSince: 'origin/main' });
  assert.deepEqual(parseArgs(['--labels-since=HEAD~2']).labelsSince, 'HEAD~2');
  for (const bad of [['--file'], ['--file', '--skill', 'a'], ['--allow-orphan'], ['--labels-since'], ['--labels-since', '--no-tests'], ['--file=']]) {
    assert.equal(typeof parseArgs(bad).error, 'string', bad.join(' '));
  }
  assert.deepEqual(parseArgs(['--skill', 'a,b', '--skill=c', '--skill', ' d ']).skills, ['a', 'b', 'c', 'd']);
  assert.equal(parseArgs(['-h']).help, true);
  for (const bad of [['--skill'], ['--skill', ''], ['--skill=', ], ['--skill', ','], ['--nope'], ['name']]) {
    assert.equal(typeof parseArgs(bad).error, 'string', bad.join(' '));
  }
});

test('importing check.mjs does not run the gate', () => {
  const code = `const m = await import(${JSON.stringify(pathToFileURL(CHECK).href)}); console.log(Object.keys(m).sort().join(','));`;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: tmpdir(), env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  const exported = r.stdout.trim().split(',');
  for (const name of ['STRICTNESS', 'lintPlan', 'discoverTests', 'parseArgs', 'main']) assert.ok(exported.includes(name), `${name} is exported: ${r.stdout}`);
  assert.doesNotMatch(r.stdout, /check:|: ok/, 'no gate output');
});

test('check.mjs still runs when started through a linked folder (a symlink or junction must not turn the gate into a silent pass)', (t) => {
  const holder = mkRoot({});
  const link = join(holder, 'linked-scripts');
  try {
    symlinkSync(SCRIPTS, link, 'junction');
  } catch (error) {
    t.skip(`cannot create a link here: ${error.code}`);
    return;
  }
  try {
    const r = runCheck(null, ['--skill', 'nope'], {}, join(link, SUBJECT));
    assert.equal(r.code, 2, `exit ${r.code}: ${r.out}${r.err}`);
    assert.match(r.err, /unknown skill/);
  } finally {
    // Remove only the link, never what it points at: a later recursive delete of the temp folder must not reach the scripts.
    if (process.platform === 'win32') rmdirSync(link); else unlinkSync(link);
  }
  assert.equal(existsSync(CHECK), true, 'the linked folder is intact');
});

test('a repo laid out like the real one (no override): all table skills and a test give the full ok line; a renamed skill fails the run by name', () => {
  const known = Object.keys(STRICTNESS);
  const repo = mkRoot({
    ...Object.assign({}, ...known.map((n) => skill(n))),
    'scripts/fixture.test.mjs': PASSING_TEST,
    'scripts/check.mjs': readFileSync(CHECK, 'utf8'),
    'scripts/lint-skills.mjs': readFileSync(join(SCRIPTS, 'lint-skills.mjs'), 'utf8'),
    'scripts/scan-unicode.mjs': readFileSync(join(SCRIPTS, 'scan-unicode.mjs'), 'utf8'),
  });
  const copy = join(repo, 'scripts', 'check.mjs');
  const full = runCheck(null, [], {}, copy);
  assert.equal(full.code, 0, full.out + full.err);
  assert.equal(ran(repo), true);
  // The test reporter's lines depend on the Node version, so only the lint and check lines are compared.
  const shown = full.lines.filter((l) => /^(?:check: |[\w-]+: ok$)/.test(l));
  assert.deepEqual(shown, [...known].sort().map((n) => `${n}: ok`).concat(`check: ok (tests + ${known.length} lints)`));

  // A skill folder renamed without its table entry: the entry is named, the run fails (exit 1, not a usage error).
  const renamed = mkRoot({
    ...Object.assign({}, ...known.filter((n) => n !== 'uefn').map((n) => skill(n))),
    ...skill('uefn-renamed'),
    'scripts/fixture.test.mjs': PASSING_TEST,
    'scripts/check.mjs': readFileSync(CHECK, 'utf8'),
    'scripts/lint-skills.mjs': readFileSync(join(SCRIPTS, 'lint-skills.mjs'), 'utf8'),
    'scripts/scan-unicode.mjs': readFileSync(join(SCRIPTS, 'scan-unicode.mjs'), 'utf8'),
  });
  const stale = runCheck(null, ['--skill', 'unreal-effects'], {}, join(renamed, 'scripts', 'check.mjs'));
  assert.equal(stale.code, 1, stale.out + stale.err);
  assert.match(stale.err, /strictness table names uefn,/);
  assert.equal(stale.last, 'check: FAILED strictness table');
});

test('AGENT_UNREAL_ROOT picks the skills and tests; lint-skills.mjs still comes from the scripts folder (a fixture root needs no copy)', () => {
  const root = mkRoot({ ...skill('a'), 'scripts/fixture.test.mjs': PASSING_TEST });
  assert.equal(existsSync(join(root, 'scripts', 'lint-skills.mjs')), false);
  const r = runCheck(root, []);
  assert.deepEqual([r.code, r.last], [0, 'check: ok (tests + 1 lint)']);
  // Without the override the real tree is used: a nonexistent name is unknown to it.
  assert.match(runCheck(null, ['--skill', 'a']).err, /unknown skill "a"/);
});
const DESC_LEN = 'Build a demo. Use when writing demo code. Not for choosing an engine.'.length;

// --- --file, --allow-orphan, --labels-since, the listing and the Unicode scan --------------------------------------------

test('--file lints only the named files with the gate\'s flags; it prints what the gate prints for that file and skips the tests', () => {
  const root = mkRoot({
    ...skill('a', { first: BARE_REF, extra: { 'references/second.md': BARE_REF } }),
    ...skill('b'),
    'scripts/fixture.test.mjs': FAILING_TEST,
  });
  const gate = runCheck(root, ['--no-tests']);
  const wanted = gate.lines.filter((l) => l.startsWith('a/references/second.md'));
  assert.equal(wanted.length, 2, 'the gate prints the label finding and the orphan finding for second.md');
  // The a skill is not in the table, so it gets the default rules; --file keeps them.
  const one = runCheck(root, ['--file', 'second.md']);
  assert.equal(one.code, 1, one.out + one.err);
  assert.deepEqual(one.lines, [...wanted, 'a: 2 finding(s)', 'check: FAILED a']);
  assert.equal(ran(root), false, 'the test step is skipped');
  assert.deepEqual(runCheck(root, ['--file', 'second']).lines, one.lines, 'the .md is optional');
  // A file only b has leaves a out; SKILL.md with --skill names the skill.
  assert.deepEqual(runCheck(root, ['--file', 'first.md', '--skill', 'b']).lines, ['b: ok', 'check: ok (1 lint)']);
  assert.deepEqual(runCheck(root, ['--file', 'SKILL.md', '--skill', 'a']).lines, ['a: ok', 'check: ok (1 lint)']);
  // Unknown file, or a file that is in no selected skill, is a usage error that runs nothing.
  const nope = runCheck(root, ['--file', 'nope.md']);
  assert.deepEqual([nope.code, nope.out], [2, '']);
  assert.match(nope.err, /no skill has the file "nope\.md"/);
  const outside = runCheck(root, ['--skill', 'b', '--file', 'second.md']);
  assert.deepEqual([outside.code, outside.out], [2, '']);
  assert.match(outside.err, /no selected skill has the file "second\.md"/);
});

test('real tree: --file prints exactly the findings the gate prints for that file', () => {
  const refs = join(REAL_SKILLS, 'unreal-rendering', 'references');
  const name = existsSync(join(refs, 'unreal-megalights.md')) ? 'unreal-megalights.md' : readdirSync(refs).sort()[0];
  // The gate's flags for this skill: its table flags plus the diff-aware base it resolves (none outside a git checkout).
  const { ref } = resolveLabelsRef(join(SCRIPTS, '..'), undefined);
  const flags = [...STRICTNESS['unreal-rendering'], ...(ref ? ['--labels-since', ref] : [])];
  const gateLines = spawnSync(process.execPath, [join(SCRIPTS, 'lint-skills.mjs'), join(REAL_SKILLS, 'unreal-rendering'), ...flags], { encoding: 'utf8' })
    .stdout.split(/\r?\n/).filter((l) => l.startsWith(`unreal-rendering/references/${name}:`));
  const filtered = runCheck(null, ['--file', name]);
  const shown = filtered.lines.filter((l) => l.startsWith('unreal-rendering/references/'));
  assert.deepEqual(shown, gateLines);
  assert.ok(filtered.lines.every((l) => l.startsWith('unreal-rendering') || l.startsWith('check: ')), 'no other skill is linted');
});

test('--allow-orphan lets a new reference pass before its SKILL.md row exists, and only that reference', () => {
  const root = mkRoot({ ...skill('a', { extra: { 'references/new.md': GOOD_REF, 'references/other.md': GOOD_REF } }) });
  const without = runCheck(root, ['--no-tests']);
  assert.equal(without.code, 1);
  assert.match(without.out, /^a\/references\/new\.md:1: reference-orphan/m);
  const partial = runCheck(root, ['--no-tests', '--allow-orphan', 'new.md']);
  assert.equal(partial.code, 1);
  assert.deepEqual(partial.lines, ['a/references/other.md:1: reference-orphan: not linked from the SKILL.md table', 'a: 1 finding(s)', 'check: FAILED a']);
  const both = runCheck(root, ['--no-tests', '--allow-orphan', 'new', '--allow-orphan', 'other.md']);
  assert.deepEqual([both.code, both.lines], [0, ['a: ok', 'check: ok (1 lint)']]);
  // A name that matches no reference of the selected skills is a typo, not a pass.
  for (const bad of ['missing.md', 'SKILL.md']) {
    const r = runCheck(root, ['--no-tests', '--allow-orphan', bad]);
    assert.deepEqual([r.code, r.out], [2, ''], bad);
    assert.match(r.err, /names no reference in the selected skills/);
  }
});

/** A git checkout fixture on branch main holding the given files in one commit. */
function gitRoot(files) {
  const root = mkRoot(files);
  const run = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  run('init', '--quiet');
  run('symbolic-ref', 'HEAD', 'refs/heads/main');
  run('add', '-A');
  run('commit', '--quiet', '-m', 'base');
  return { root, run, write(rel, text) { writeFileSync(join(root, rel), text); }, commit() { run('add', '-A'); run('commit', '--quiet', '-m', 'work'); } };
}

test('diff-aware labels: a bullet added to unreal-rendering since the base fails; the same bullet written earlier, a labelled one and an exempt heading pass', () => {
  const old = '# First\n\n- an old bullet with no label.\n- [tested] an old labelled bullet.\n';
  const repo = gitRoot({ ...skill('unreal-rendering', { first: old }), ...skill('uefn') });
  const refFile = 'skills/unreal-rendering/references/first.md';
  assert.deepEqual(runCheck(repo.root, ['--no-tests']).lines.at(-1), 'check: ok (2 lints)', 'the old unlabelled bullet passes on the base');

  repo.run('checkout', '--quiet', '-b', 'work');
  repo.write(refFile, `${old}- [documented] a new labelled bullet.\n\n## Sources\n\n- a new unlabelled bullet under an exempt heading.\n`);
  assert.equal(runCheck(repo.root, ['--no-tests']).code, 0, 'a labelled bullet and an exempt heading pass');

  repo.write(refFile, `${old}- a new bullet with no label.\n`);
  const bad = runCheck(repo.root, ['--no-tests']);
  assert.equal(bad.code, 1, bad.out + bad.err);
  assert.match(bad.out, /^unreal-rendering\/references\/first\.md:5: label-missing: claim bullet added or changed since [0-9a-f]{40} has no evidence label/m);
  assert.equal(bad.last, 'check: FAILED unreal-rendering');

  // Committed on the branch it still fails (the base is the merge base with main); the other skill is untouched by the mode.
  repo.commit();
  assert.equal(runCheck(repo.root, ['--no-tests']).code, 1);
  const main = repo.run('rev-parse', 'main');
  assert.equal(runCheck(repo.root, ['--no-tests', '--labels-since', main]).code, 1, 'an explicit base');
  assert.equal(runCheck(repo.root, ['--no-tests', '--labels-since', 'HEAD']).code, 0, 'the same bullet written before the ref passes');

  // On main itself the base is HEAD: nothing is new, so the old any-text rule applies.
  repo.run('checkout', '--quiet', 'main');
  repo.run('merge', '--quiet', '--ff-only', 'work');
  assert.equal(runCheck(repo.root, ['--no-tests']).code, 0);

  const missing = runCheck(repo.root, ['--no-tests', '--labels-since', 'no-such-ref']);
  assert.deepEqual([missing.code, missing.out], [2, '']);
  assert.match(missing.err, /--labels-since no-such-ref is not a commit/);
  // Only the diff-aware skills use the ref: uefn is not named in it.
  assert.doesNotMatch(runCheck(repo.root, ['--no-tests', '--skill', 'uefn', '--labels-since', 'no-such-ref']).err, /not a commit/);
});

test('resolveLabelsRef: the merge base with origin/main, else main; a checkout that is not git, or has neither, falls back with a note', () => {
  assert.deepEqual(resolveLabelsRef(mkRoot({ 'a.txt': 'x' }), undefined), { ref: null, note: 'not a git checkout' });
  const repo = gitRoot({ 'a.txt': 'x' });
  const base = repo.run('rev-parse', 'HEAD');
  repo.run('checkout', '--quiet', '-b', 'work');
  repo.write('a.txt', 'y');
  repo.commit();
  assert.deepEqual(resolveLabelsRef(repo.root, undefined), { ref: base });
  assert.deepEqual(resolveLabelsRef(repo.root, 'HEAD'), { ref: 'HEAD' });
  assert.match(resolveLabelsRef(repo.root, 'nope').error, /nope is not a commit/);
  repo.run('branch', '-m', 'main', 'trunk');
  assert.deepEqual(resolveLabelsRef(repo.root, undefined), { ref: null, note: 'neither origin/main nor main exists here' });
});

test('DIFF_AWARE names unreal-effects and unreal-rendering, both of which the table leaves on the any-text label rule', () => {
  assert.deepEqual([...DIFF_AWARE].sort(), ['unreal-effects', 'unreal-rendering']);
  for (const name of DIFF_AWARE) assert.deepEqual(STRICTNESS[name], ['--label-pattern', '.']);
});

test('the gate prints each skill\'s listing length and headroom, and --skill lists only the selected skills; --file prints none', () => {
  const root = mkRoot({ ...skill('a'), ...skill('b') });
  const all = runCheck(root, ['--no-tests']);
  assert.deepEqual(all.listing.slice(0, 2), [
    `listing: a  description ${DESC_LEN} + when_to_use 0 = ${DESC_LEN} of 1536 (${1536 - DESC_LEN} left)`,
    `listing: b  description ${DESC_LEN} + when_to_use 0 = ${DESC_LEN} of 1536 (${1536 - DESC_LEN} left)`,
  ]);
  assert.deepEqual(runCheck(root, ['--skill', 'b']).listing.filter((l) => /^listing: [ab] /.test(l)).length, 1);
  assert.deepEqual(runCheck(root, ['--file', 'first.md']).listing, []);
});

test('the gate scans every text file for invisible Unicode in a full run, and not in a --skill or --file run', () => {
  const root = mkRoot({ ...skill('a'), 'tools/x.mjs': `// ok\nconst a = '${String.fromCodePoint(0xfeff)}';\n` });
  const bad = runCheck(root, ['--no-tests']);
  assert.equal(bad.code, 1, bad.out + bad.err);
  assert.match(bad.out, /^tools\/x\.mjs:2:12: invisible-unicode: U\+FEFF byte-order mark \(Cf\) in /m);
  assert.equal(bad.last, 'check: FAILED unicode');
  assert.equal(runCheck(root, ['--skill', 'a']).code, 0);
  assert.equal(runCheck(root, ['--file', 'first.md']).code, 0);
  const clean = runCheck(mkRoot({ ...skill('a') }), ['--no-tests']);
  assert.deepEqual(clean.lines, ['a: ok', 'check: ok (1 lint)'], 'a clean scan prints nothing');
});
