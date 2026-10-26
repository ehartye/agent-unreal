import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { lintSkill, discoverSkills, main, DEFAULTS, parseFrontmatter, frontmatterIssues, listingLength, libraryReport, fileSelected } from './lint-skills.mjs';

const GOOD_SKILL = `---
name: demo
description: Build a demo. Use when writing demo code. Not for choosing an engine.
---

# Demo

| You are about to | Read |
| --- | --- |
| Do the first thing | [first](references/first.md) |

## Rules

- A rule.
`;

const GOOD_REF = `# First

- [tested] A labelled claim.
`;

/** Make a skill folder named \`name\` in a fresh temp dir; returns its path. */
function mk(files, name = 'demo') {
  const root = mkdtempSync(join(tmpdir(), 'lint-skills-'));
  const dir = join(root, name);
  for (const [rel, text] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return dir;
}
const rules = (findings) => findings.map((f) => f.rule).sort();

test('a well-formed skill has no findings', () => {
  const dir = mk({ 'SKILL.md': GOOD_SKILL, 'references/first.md': GOOD_REF });
  assert.deepEqual(lintSkill(dir), []);
});

test('frontmatter: missing, mismatched and unscoped names and descriptions', () => {
  const noFm = mk({ 'SKILL.md': '# no frontmatter\n' });
  assert.deepEqual(rules(lintSkill(noFm)).includes('frontmatter-missing'), true);

  const noName = mk({ 'SKILL.md': '---\ndescription: Use it. Not for x.\n---\n# t\n' });
  assert.ok(rules(lintSkill(noName)).includes('name-missing'));

  const wrongName = mk({ 'SKILL.md': GOOD_SKILL.replace('name: demo', 'name: other'), 'references/first.md': GOOD_REF });
  assert.ok(rules(lintSkill(wrongName)).includes('name-mismatch'));

  const noDesc = mk({ 'SKILL.md': '---\nname: demo\n---\n# t\n' });
  assert.ok(rules(lintSkill(noDesc)).includes('description-missing'));

  const noNot = mk({
    'SKILL.md': GOOD_SKILL.replace(' Not for choosing an engine.', ''),
    'references/first.md': GOOD_REF,
  });
  assert.ok(rules(lintSkill(noNot)).includes('description-scope'));

  const noUse = mk({
    'SKILL.md': GOOD_SKILL.replace('Use when writing demo code. ', ''),
    'references/first.md': GOOD_REF,
  });
  assert.ok(rules(lintSkill(noUse)).includes('description-scope'));

  const long = mk({
    'SKILL.md': GOOD_SKILL.replace('Build a demo.', 'x'.repeat(1100)),
    'references/first.md': GOOD_REF,
  });
  assert.ok(rules(lintSkill(long)).includes('description-length'));
});

test('links: broken relative links are reported with a line number; code, urls and anchors are not', () => {
  const dir = mk({
    'SKILL.md': GOOD_SKILL + '\nSee [gone](references/gone.md) and [web](https://example.com/x.md) and [top](#rules).\n\n```md\n[in code](nope.md)\n```\n\nInline `[also code](nope2.md)` is ignored.\n',
    'references/first.md': GOOD_REF + '\nSee [anchor](first.md#heading) and [bad](../missing/SKILL.md).\n',
  });
  const found = lintSkill(dir).filter((f) => f.rule === 'link-broken');
  assert.equal(found.length, 2);
  assert.ok(found.some((f) => f.file === 'SKILL.md' && f.line > 10 && f.message.includes('references/gone.md')));
  assert.ok(found.some((f) => f.file === 'references/first.md' && f.message.includes('../missing/SKILL.md')));
});

test('table: required, its links must resolve, every reference must be linked from it', () => {
  const noTable = mk({ 'SKILL.md': GOOD_SKILL.replace(/\| You are about to[\s\S]*?first\.md\) \|\n/, ''), 'references/first.md': GOOD_REF });
  assert.ok(rules(lintSkill(noTable)).includes('table-missing'));

  const deadRow = mk({ 'SKILL.md': GOOD_SKILL + '', 'references/other.md': GOOD_REF });
  const f = lintSkill(deadRow);
  assert.ok(f.some((x) => x.rule === 'table-link-broken' && x.message.includes('references/first.md')));
  assert.ok(f.some((x) => x.rule === 'reference-orphan' && x.file === 'references/other.md'));

  const rowNoLink = mk({
    'SKILL.md': GOOD_SKILL.replace('[first](references/first.md)', 'first, later'),
    'references/first.md': GOOD_REF,
  });
  assert.ok(rules(lintSkill(rowNoLink)).includes('table-row-no-link'));
});

test('evidence labels: unlabelled claim bullets are reported at their line', () => {
  const ref = '# First\n\n- [tested] ok one.\n- unlabelled claim.\n1. numbered unlabelled.\n  - nested unlabelled.\n- [documented] ok two.\n';
  const dir = mk({ 'SKILL.md': GOOD_SKILL, 'references/first.md': ref });
  const missing = lintSkill(dir).filter((x) => x.rule === 'label-missing');
  assert.deepEqual(missing.map((x) => x.line), [4, 5, 6]);
});

test('evidence labels: continuation lines count, link-only bullets and exempt headings and code fences are skipped', () => {
  const ref = [
    '# First', '',
    '- A claim that wraps onto a second line',
    '  and carries its label here [general].',
    '- [Another reference](first.md)',
    '',
    '```text',
    '- a bullet inside a code fence',
    '```',
    '',
    '## Links', '',
    '- plain bullet under an exempt heading',
    '',
  ].join('\n');
  const dir = mk({ 'SKILL.md': GOOD_SKILL, 'references/first.md': ref });
  assert.deepEqual(lintSkill(dir), []);
});

test('evidence labels: a custom pattern replaces the default, and SKILL.md bullets are checked only on request', () => {
  const ref = '# First\n\n- A claim *verified* in source.\n';
  const dir = mk({ 'SKILL.md': GOOD_SKILL, 'references/first.md': ref });
  assert.equal(lintSkill(dir).filter((x) => x.rule === 'label-missing').length, 1);
  assert.equal(lintSkill(dir, { labelPattern: '\\*(?:verified|convention)\\*' }).length, 0);
  const strict = lintSkill(dir, { labelPattern: '\\*(?:verified|convention)\\*', skillMdLabels: true });
  assert.deepEqual(strict.map((x) => [x.rule, x.file]), [['label-missing', 'SKILL.md']]);
});

test('requireClaims: every ## section of a reference needs a labelled claim bullet', () => {
  const ref = [
    '# First', '',
    '## Has a claim', '',
    '- [tested] yes.', '',
    '## Empty section', '',
    'Only prose here.', '',
    '## Links', '',
    '- [x](first.md)', '',
  ].join('\n');
  const labelledSkill = GOOD_SKILL.replace('- A rule.', '- [tested] A rule.');
  const dir = mk({ 'SKILL.md': labelledSkill, 'references/first.md': ref });
  assert.deepEqual(lintSkill(dir), []);
  const f = lintSkill(dir, { requireClaims: true });
  assert.deepEqual(f.map((x) => [x.rule, x.line]), [['section-empty', 7]]);

  // SKILL.md sections count too, but its unlabelled bullets are only an error with skillMdLabels.
  const bare = mk({ 'SKILL.md': GOOD_SKILL.replace('- A rule.', 'Prose only.'), 'references/first.md': GOOD_REF });
  const g = lintSkill(bare, { requireClaims: true });
  assert.deepEqual(g.map((x) => [x.rule, x.file]), [['section-empty', 'SKILL.md']]);
  const h = lintSkill(dir, { requireClaims: true, labelPattern: '\\[general\\]' });
  assert.ok(h.every((x) => x.rule !== 'label-missing' || x.file === 'references/first.md'));
});

test('placeholders such as {{field}}, TODO and TBD are reported, even inside code fences', () => {
  const ref = '# First\n\n- [tested] Version is {{version}}.\n- [general] TODO check this.\n\n```text\nTBD\n```\n';
  const dir = mk({ 'SKILL.md': GOOD_SKILL, 'references/first.md': ref });
  const f = lintSkill(dir).filter((x) => x.rule === 'placeholder');
  assert.deepEqual(f.map((x) => x.line), [3, 4, 7]);
});

test('size budgets apply to SKILL.md and to each reference', () => {
  const dir = mk({
    'SKILL.md': GOOD_SKILL + '\n' + 'x'.repeat(300) + '\n',
    'references/first.md': GOOD_REF + '\n' + 'y'.repeat(300) + '\n',
  });
  const f = lintSkill(dir, { maxSkillBytes: 200, maxRefBytes: 200 });
  assert.deepEqual(rules(f), ['size-reference', 'size-skill']);
  assert.deepEqual(lintSkill(dir), []);
  assert.ok(DEFAULTS.maxRefBytes > 0 && DEFAULTS.maxSkillBytes > 0);
});

test('a reference must open with a level-one heading', () => {
  const dir = mk({ 'SKILL.md': GOOD_SKILL, 'references/first.md': '- [tested] no heading first.\n' });
  assert.ok(rules(lintSkill(dir)).includes('reference-h1'));
});

test('main returns 0 for a clean skill, 1 for findings and 2 for a usage error', () => {
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    const good = mk({ 'SKILL.md': GOOD_SKILL, 'references/first.md': GOOD_REF });
    const bad = mk({ 'SKILL.md': GOOD_SKILL, 'references/first.md': '# First\n\n- unlabelled.\n' });
    assert.equal(main([good]), 0);
    assert.equal(main([bad]), 1);
    assert.equal(main([bad, '--label-pattern', '.']), 0);
    assert.equal(main([good, '--nope']), 2);
    assert.equal(main([join(good, 'missing-dir')]), 2);
  } finally {
    console.log = log;
    console.error = err;
  }
});

test('discoverSkills finds one skill dir, or every skill under a skills dir', () => {
  const dir = mk({ 'SKILL.md': GOOD_SKILL });
  assert.deepEqual(discoverSkills(dir), [dir]);
  assert.deepEqual(discoverSkills(dirname(dir)), [dir]);
});

// --- listing length, "Use when", strict YAML, argument placeholders, LF sizes ------------------------------------------

/** A SKILL.md whose frontmatter lines are given verbatim. */
const withFrontmatter = (lines) => `---\nname: demo\n${lines.join('\n')}\n---\n\n${GOOD_SKILL.split('---\n\n')[1]}`;
const DESC = 'description: "Build a demo. Use when writing demo code. Not for choosing an engine."';
const WHEN = 'when_to_use: "Use when editing the demo."';
const lintFm = (lines, files = { 'references/first.md': GOOD_REF }) => lintSkill(mk({ 'SKILL.md': withFrontmatter(lines), ...files }));

test('listing length: description + " - " + when_to_use warns from 1,400 characters and fails over 1,536', () => {
  const sized = (total) => {
    const description = `Use it. Not for x. ${'d'.repeat(700 - 19)}`; // 700 characters
    const whenToUse = `Use when ${'w'.repeat(total - 700 - 3 - 9)}`;
    return [`description: "${description}"`, `when_to_use: "${whenToUse}"`];
  };
  assert.deepEqual(lintFm(sized(1399)), []);
  const warn = lintFm(sized(1400));
  assert.deepEqual(warn.map((f) => [f.rule, f.level]), [['listing-length', 'warning']]);
  assert.match(warn[0].message, /is 1400 characters, 136 below the 1536 cut/);
  assert.deepEqual(lintFm(sized(1536)).map((f) => f.level), ['warning'], '1,536 is still listed whole');
  const over = lintFm(sized(1537));
  assert.deepEqual(over.map((f) => [f.rule, f.level]), [['listing-length', 'error']]);
  assert.match(over[0].message, /is 1537 characters; the listing is cut at 1536/);
  // Without a when_to_use the description alone is the listing.
  assert.equal(listingLength('abc', ''), 3);
  assert.equal(listingLength('abc', 'de'), 8);
});

test('a warning prints and does not change the exit code', () => {
  const log = console.log;
  const lines = [];
  console.log = (line) => lines.push(line);
  let code;
  try {
    const dir = mk({
      'SKILL.md': withFrontmatter([`description: "Use it. Not for x. ${'d'.repeat(1000)}"`, `when_to_use: "Use when ${'w'.repeat(380)}"`]),
      'references/first.md': GOOD_REF,
    });
    code = main([dir]);
  } finally {
    console.log = log;
  }
  assert.equal(code, 0);
  assert.match(lines[0], /^demo\/SKILL\.md:1: listing-length \(warning\): /);
  assert.equal(lines[1], 'demo: ok (1 warning(s))');
});

test('use-when: when_to_use must start with "Use when"; with none, the description must contain it; "(use x)" in a Not-for clause is not enough', () => {
  const noWhen = (description) => lintFm([`description: "${description}"`]);
  assert.deepEqual(rules(lintFm([DESC, WHEN])), []);
  assert.deepEqual(rules(lintFm([DESC, 'when_to_use: "Asked about the demo."'])), ['use-when']);
  assert.deepEqual(rules(lintFm([DESC, 'when_to_use: "Also use when editing."'])), ['use-when'], 'it must be at the start');
  assert.deepEqual(rules(noWhen('Build a demo. Use when writing demo code. Not for engines.')), []);
  assert.deepEqual(rules(noWhen('Build a demo. Use it for demos. Not for engines.')), ['use-when']);
  assert.deepEqual(rules(noWhen('Build a demo. Not for engines (use other-skill).')), ['use-when'], 'the old scope rule passes this one');
  assert.deepEqual(rules(lintFm([DESC.replace('Use when writing demo code. ', ''), WHEN])), ['description-scope'], 'with a when_to_use the scope rule is unchanged');
});

test('strict YAML: an unquoted colon-space, " #", an open quote, text after a quote, a duplicate key or a stray line fails; quoted and block values pass', () => {
  const yaml = (lines) => lintFm(lines).filter((f) => f.rule === 'frontmatter-yaml');
  const bare = yaml(['description: Build a demo: fast. Use when writing demo code. Not for engines.', WHEN]);
  assert.deepEqual(bare.map((f) => [f.line, f.rule]), [[3, 'frontmatter-yaml']]);
  assert.match(bare[0].message, /^description: unquoted value contains a colon followed by a space/);
  // The same text in double quotes, in single quotes and as a folded block is valid.
  assert.deepEqual(yaml(['description: "Build a demo: fast. Use when writing demo code. Not for engines."', WHEN]), []);
  assert.deepEqual(yaml(["description: 'Build a demo: it''s fast. Use when writing demo code. Not for engines.'", WHEN]), []);
  assert.deepEqual(yaml(['description: >', '  Build a demo: fast. Use when writing demo code.', '  Not for engines.', WHEN]), []);
  // A colon without a space, a URL and a time are plain scalars.
  assert.deepEqual(yaml(['description: Build a demo at http://example.com/a:b or 12:30. Use when writing demo code. Not for engines.', WHEN]), []);
  assert.match(yaml(['description: Build a demo #fast. Use when writing demo code. Not for engines.'])[0].message, /" #"/);
  assert.match(yaml(['description: Ends with a colon:'])[0].message, /colon followed by a space \(or ends in a colon\)/);
  assert.match(yaml(['description: "Never closed. Use when x. Not for y.'])[0].message, /never closed/);
  assert.match(yaml(['description: "Closed" and then more text'])[0].message, /text after the closing quote/);
  assert.match(yaml(['description: "an inner "quote" breaks it"'])[0].message, /text after the closing quote/);
  assert.match(yaml(['description: @starts with an indicator'])[0].message, /cannot start with "@"/);
  assert.match(yaml([DESC, DESC])[0].message, /duplicate key "description"/);
  assert.match(yaml([DESC, 'this is not a mapping line'])[0].message, /not a `key: value` line/);
  // A plain value that continues on an indented line is checked on that line too.
  assert.equal(yaml(['description: Build a demo.', '  Continues: here. Use when x. Not for y.']).length, 1);
  // The parsed description is the unquoted text, so the length rules count what the listing shows.
  assert.equal(parseFrontmatter('---\ndescription: "say \\"hi\\" there"\n---\n').data.description, 'say "hi" there');
  assert.equal(parseFrontmatter("---\ndescription: 'it''s'\n---\n").data.description, "it's");
  assert.deepEqual(frontmatterIssues(['---', 'name: demo', 'description: "ok: yes"', '---']), []);
});

test('$ARGUMENTS and $n: rejected in SKILL.md everywhere; in a reference rejected in prose, and $ARGUMENTS also in code', () => {
  const skill = `${GOOD_SKILL}\nRun with $1 or $ARGUMENTS[0].\n\n\`\`\`sh\necho $2\n\`\`\`\n`;
  const lineOf = (needle) => skill.split('\n').findIndex((l) => l.includes(needle)) + 1;
  const sk = lintSkill(mk({ 'SKILL.md': skill, 'references/first.md': GOOD_REF })).filter((f) => f.rule === 'arguments-placeholder');
  assert.deepEqual(sk.map((f) => [f.file, f.line]), [['SKILL.md', lineOf('Run with')], ['SKILL.md', lineOf('echo $2')]]);
  assert.match(sk[0].message, /^"\$1" is replaced/);

  const ref = [
    '# First', '',
    '- [tested] Costs $5 in prose.',
    '- [tested] Use `sed s/a/$1/` inline.',
    '- [tested] Pass $ARGUMENTS in prose.',
    '',
    '```sh',
    "awk '{ print $1 }'",
    'echo "$ARGUMENTS"',
    '```', '',
  ].join('\n');
  const found = lintSkill(mk({ 'SKILL.md': GOOD_SKILL, 'references/first.md': ref })).filter((f) => f.rule === 'arguments-placeholder');
  assert.deepEqual(found.map((f) => f.line), [3, 5, 9], 'prose $5, prose $ARGUMENTS and fenced $ARGUMENTS; inline code and a fenced $1 pass');
  assert.deepEqual(lintSkill(mk({ 'SKILL.md': GOOD_SKILL, 'references/first.md': '# First\n\n- [tested] Price is `$5` and ${HOME} and $name and $$.\n' })), []);
});

test('sizes count LF-normalised bytes: a CRLF reference of 5,094 bytes measures 5,060', () => {
  // 34 lines: a heading and 33 prose lines, 5,060 bytes with LF line endings.
  const lines = ['# First', ...Array.from({ length: 33 }, (_, i) => 'p'.repeat(i < 3 ? 153 : 152))];
  const lf = `${lines.join('\n')}\n`;
  const crlf = `${lines.join('\r\n')}\r\n`;
  assert.deepEqual([Buffer.byteLength(lf), Buffer.byteLength(crlf)], [5060, 5094]);
  const files = (text) => ({ 'SKILL.md': GOOD_SKILL, 'references/first.md': text });
  for (const text of [lf, crlf]) {
    assert.deepEqual(lintSkill(mk(files(text)), { maxRefBytes: 5060 }), [], 'the budget of 5,060 holds for both');
    const over = lintSkill(mk(files(text)), { maxRefBytes: 5059 });
    assert.deepEqual(over.map((f) => [f.rule, f.message]), [['size-reference', '5060 bytes; the budget is 5059']]);
  }
  const skillCrlf = GOOD_SKILL.replace(/\n/g, '\r\n');
  assert.deepEqual(lintSkill(mk({ 'SKILL.md': skillCrlf, 'references/first.md': GOOD_REF }), { maxSkillBytes: Buffer.byteLength(GOOD_SKILL) }), []);
});

// --- --file, --allow-orphan, --labels-since ----------------------------------------------------------------------------

test('--file reports only the findings in the named files, by name with or without .md', () => {
  const dir = mk({ 'SKILL.md': GOOD_SKILL, 'references/first.md': '# First\n\n- unlabelled one.\n', 'references/second.md': '# Second\n\n- unlabelled two.\n' });
  const all = lintSkill(dir).filter((f) => f.rule === 'label-missing');
  assert.deepEqual(all.map((f) => f.file), ['references/first.md', 'references/second.md']);
  const labelFiles = (options) => lintSkill(dir, options).filter((f) => f.rule === 'label-missing').map((f) => f.file);
  assert.deepEqual(labelFiles({ files: ['second.md'] }), ['references/second.md']);
  assert.deepEqual(labelFiles({ files: ['second'] }), ['references/second.md']);
  assert.deepEqual(labelFiles({ files: ['references/first.md', 'second'] }), ['references/first.md', 'references/second.md']);
  assert.deepEqual(lintSkill(dir, { files: ['SKILL.md'] }), [], 'SKILL.md has no findings here');
  // The findings are the ones the unfiltered lint prints for that file, line for line (the orphan finding of second.md included).
  const unfiltered = lintSkill(dir);
  assert.deepEqual(lintSkill(dir, { files: ['second'] }), unfiltered.filter((f) => f.file === 'references/second.md'));
  assert.deepEqual(lintSkill(dir, { files: ['first'] }), unfiltered.filter((f) => f.file === 'references/first.md'));
  assert.equal(fileSelected('references/first.md', ['first']), true);
  assert.equal(fileSelected('references/first.md', []), false);
});

test('--allow-orphan hides the orphan finding for that reference only', () => {
  const dir = mk({ 'SKILL.md': GOOD_SKILL, 'references/first.md': GOOD_REF, 'references/new.md': GOOD_REF, 'references/other.md': GOOD_REF });
  assert.deepEqual(lintSkill(dir).map((f) => f.file), ['references/new.md', 'references/other.md']);
  assert.deepEqual(lintSkill(dir, { allowOrphans: ['new.md'] }).map((f) => f.file), ['references/other.md']);
  assert.deepEqual(lintSkill(dir, { allowOrphans: ['new', 'other.md'] }), []);
  // It does not excuse other findings in that file.
  const bare = mk({ 'SKILL.md': GOOD_SKILL, 'references/first.md': GOOD_REF, 'references/new.md': '# New\n\n- unlabelled.\n' });
  assert.deepEqual(rules(lintSkill(bare, { allowOrphans: ['new.md'] })), ['label-missing']);
});

/** A git repo in a fresh temp dir. commit(files) writes files and commits everything; returns the commit hash. */
function gitRepo() {
  const root = mkdtempSync(join(tmpdir(), 'lint-skills-git-'));
  const run = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  run('init', '--quiet');
  run('symbolic-ref', 'HEAD', 'refs/heads/main');
  const write = (files) => {
    for (const [rel, text] of Object.entries(files)) {
      const p = join(root, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text);
    }
  };
  return { root, run, write, commit(files) { write(files); run('add', '-A'); run('commit', '--quiet', '-m', 'c'); return run('rev-parse', 'HEAD'); } };
}

test('--labels-since: a bullet added or changed since the ref needs a real label; the same bullet written before the ref and exempt headings do not', () => {
  const repo = gitRepo();
  const ref = (extra = '') => `# First\n\n- old unlabelled before the ref.\n- [tested] old labelled.\n${extra}`;
  const base = repo.commit({ 'demo/SKILL.md': GOOD_SKILL, 'demo/references/first.md': ref() });
  const dir = join(repo.root, 'demo');
  const gate = { labelPattern: '.', labelsSince: base }; // the gate's any-text pattern plus the diff-aware mode
  assert.deepEqual(lintSkill(dir, gate), [], 'nothing changed since the ref');

  repo.write({ 'demo/references/first.md': ref('- new unlabelled bullet.\n- [documented] new labelled bullet.\n\n## Sources\n\n- new unlabelled under an exempt heading.\n') });
  const f = lintSkill(dir, gate);
  assert.deepEqual(f.map((x) => [x.rule, x.file, x.line]), [['label-missing', 'references/first.md', 5]]);
  assert.match(f[0].message, /^claim bullet added or changed since [0-9a-f]{40} has no evidence label/);
  assert.deepEqual(lintSkill(dir, { labelPattern: '.' }), [], 'without the ref the gate pattern accepts it');

  // The old unlabelled bullet passes until it is edited; editing a wrapped continuation line counts as changing the bullet.
  repo.write({ 'demo/references/first.md': ref().replace('before the ref.', 'before the ref,\n  reworded here.') });
  assert.deepEqual(lintSkill(dir, gate).map((x) => x.line), [3]);

  // A change committed after the ref counts (the ref is a commit, not "uncommitted").
  const head = repo.commit({ 'demo/references/first.md': ref('- committed unlabelled.\n') });
  assert.deepEqual(lintSkill(dir, gate).map((x) => x.line), [5]);
  assert.deepEqual(lintSkill(dir, { ...gate, labelsSince: head }), [], 'the same bullet is fine once the ref is after it');

  // An untracked reference is new in every line.
  repo.write({ 'demo/references/second.md': '# Second\n\n- fresh unlabelled.\n- [general] fresh labelled.\n' });
  const untracked = lintSkill(dir, { ...gate, labelsSince: head, allowOrphans: ['second'] });
  assert.deepEqual(untracked.map((x) => [x.file, x.line]), [['references/second.md', 3]]);
  // A stricter custom pattern still applies to the new bullet as well as the default.
  const strict = lintSkill(dir, { ...gate, labelsSince: head, labelPattern: '\\[general\\]', allowOrphans: ['second'] });
  assert.deepEqual(strict.map((x) => [x.file, x.line]), [['references/first.md', 3], ['references/first.md', 4], ['references/first.md', 5], ['references/second.md', 3]]);
});

test('--labels-since agrees with the lint on exempt headings and claim shape: the same bullets are skipped, with no second rule', () => {
  const repo = gitRepo();
  const base = repo.commit({ 'demo/SKILL.md': GOOD_SKILL, 'demo/references/first.md': '# First\n' });
  const dir = join(repo.root, 'demo');
  const body = ['# First', '', '- [link only](first.md)', '', '```text', '- bullet in a fence', '```', '', '## Related', '', '- unlabelled related', '', '## See also', '', '- unlabelled see also', '', '## Not covered here', '', '- unlabelled not covered', ''].join('\n');
  repo.write({ 'demo/references/first.md': body });
  assert.deepEqual(lintSkill(dir, { labelsSince: base }), []);
  assert.deepEqual(lintSkill(dir, {}), [], 'the plain lint skips the same bullets');
  repo.write({ 'demo/references/first.md': `${body}\n## Notes\n\n- unlabelled in a normal section\n` });
  assert.deepEqual(lintSkill(dir, { labelsSince: base }).map((x) => x.rule), ['label-missing']);
  assert.deepEqual(lintSkill(dir, {}).map((x) => x.rule), ['label-missing'], 'and the plain lint reports the same bullet');
});

test('--labels-since with a ref git cannot resolve is a usage error, not a pass', () => {
  const repo = gitRepo();
  repo.commit({ 'demo/SKILL.md': GOOD_SKILL, 'demo/references/first.md': GOOD_REF });
  const demo = join(repo.root, 'demo');
  assert.throws(() => lintSkill(demo, { labelsSince: 'no-such-ref' }), /git diff no-such-ref failed/);
  const err = console.error;
  console.error = () => {};
  try {
    assert.equal(main([demo, '--labels-since', 'no-such-ref']), 2);
    assert.equal(main([demo, '--labels-since']), 2);
    assert.equal(main([demo, '--file']), 2);
  } finally {
    console.error = err;
  }
});

// --- the listing report ------------------------------------------------------------------------------------------------

test('libraryReport: listing length and headroom per skill, and pairs of skills that share two or more trigger words nobody else uses', () => {
  const skill = (name, whenToUse) => mk({ 'SKILL.md': `---\nname: ${name}\ndescription: "Does ${name}. Use when asked. Not for others."\nwhen_to_use: "${whenToUse}"\n---\n` }, name);
  const whens = {
    alpha: 'Use when asked about profiling, toon or cel looks, and shadows.',
    beta: 'Use when asked for a cel or toon style on an effect, or when shadows pop.',
    gamma: 'Use when asked about shadows in a level.',
  };
  const dirs = Object.entries(whens).map(([name, when]) => skill(name, when));
  const { rows, shared } = libraryReport(dirs);
  const listing = (name) => `Does ${name}. Use when asked. Not for others.`.length + 3 + whens[name].length;
  assert.deepEqual(rows.map((r) => [r.name, r.listing, r.headroom]), Object.keys(whens).map((n) => [n, listing(n), 1536 - listing(n)]));
  // cel and toon are shared by exactly two skills; shadows is in three, so it is too common to count; one shared word is not a pair.
  assert.deepEqual(shared, [{ skills: ['alpha', 'beta'], words: ['cel', 'toon'] }]);
});

test('main --listing prints one line per skill and the shared trigger words, and exits 0', () => {
  const log = console.log;
  const lines = [];
  console.log = (line) => lines.push(line);
  let code;
  try {
    const root = mkdtempSync(join(tmpdir(), 'lint-listing-'));
    for (const [name, when] of [['alpha', 'toon and cel looks'], ['beta', 'a cel or toon style']]) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: "Does it. Use when x. Not for y."\nwhen_to_use: "Use when ${when}."\n---\n`);
    }
    code = main([root, '--listing']);
  } finally {
    console.log = log;
  }
  assert.equal(code, 0);
  assert.match(lines[0], /^listing: alpha  description 31 \+ when_to_use \d+ = \d+ of 1536 \(\d+ left\)$/);
  assert.equal(lines[2], 'listing: warning: alpha and beta share the trigger words cel, toon');
  assert.equal(lines.at(-1), 'listing: 2 skill(s), 1 pair(s) with shared trigger words');
});
