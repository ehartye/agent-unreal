import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { lintSkill, discoverSkills, main, DEFAULTS } from './lint-skills.mjs';

const GOOD_SKILL = `---
name: demo
description: Build a demo. Use before writing demo code. Not for choosing an engine.
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
    'SKILL.md': GOOD_SKILL.replace('Use before writing demo code. ', ''),
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
