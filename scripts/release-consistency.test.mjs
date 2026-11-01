/** @lane merge @subject .claude-plugin/plugin.json @subject .claude-plugin/marketplace.json @subject scripts/skill-citations.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, extname, sep } from 'node:path';
import { loadSnapshot, checkCitations, extractCitations, compareSnapshot, liveSkills, writeSnapshot } from './skill-citations.mjs';

// Repo root: scripts/.. unless AGENT_UNREAL_ROOT points elsewhere.
const ROOT = resolve(process.env.AGENT_UNREAL_ROOT ?? join(import.meta.dirname, '..'));
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const readme = () => readFileSync(join(ROOT, 'README.md'), 'utf8');
const skills = () => readdirSync(join(ROOT, 'skills'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(ROOT, 'skills', d.name, 'SKILL.md')))
  .map((d) => d.name)
  .sort();

test('plugin.json and marketplace.json carry the same version', () => {
  const plugin = json('.claude-plugin/plugin.json');
  const market = json('.claude-plugin/marketplace.json');
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.equal(market.plugins[0].version, plugin.version);
});

test('the README status line names the current plugin version', () => {
  const { version } = json('.claude-plugin/plugin.json');
  assert.match(readme(), new RegExp(`^Early \\(${version.replace(/\./g, '\\.')}\\)\\.`, 'm'));
});

test('the README skills table lists every skill folder, and nothing else', () => {
  const text = readme();
  const start = text.indexOf('## Skills');
  const section = text.slice(start, text.indexOf('\n## ', start + 1));
  const listed = [...section.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]).sort();
  assert.deepEqual(listed, skills());
});

test('the README status line states the number of skills', () => {
  const words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen'];
  assert.match(readme(), new RegExp(`^Early \\([^)]*\\)\\. ${words[skills().length]} skills\\.`, 'm'));
});

test('plugin.json keywords name the engine and UEFN', () => {
  const keywords = json('.claude-plugin/plugin.json').keywords;
  for (const keyword of ['unreal', 'uefn']) assert.ok(keywords.includes(keyword), `keyword ${keyword}`);
});

// --- public-repo hygiene -----------------------------------------------------------------------------------------
// Plugin content stays free of language about our own machines and non-plugin projects; that belongs in the wiki.
// Generic patterns are checked here. Private project names are not listed in the repo: point
// AGENT_UNREAL_PRIVATE_TERMS_FILE at a local file to check those too. One term per line: a plain line is matched literally and
// case-insensitively; a line written /pattern/flags is a regular expression with exactly those flags (the format the other
// plugins' hygiene tests read), so a name that is also an ordinary word can be matched whole-word and case-sensitively.
// A line that is not a valid regular expression is reported, not skipped.
const TEXT = new Set(['.md', '.mjs', '.js', '.jsx', '.json', '.yml', '.yaml', '.py', '.gd', '.cs', '.cpp', '.h', '.hpp', '.inl', '.uplugin', '.html', '.sh', '.txt', '']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.playwright-mcp', 'results', 'dist', 'fixtures']);
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = join(dir, e.name);
  if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : walk(full);
  return e.isFile() && e.name !== '.git' && TEXT.has(extname(e.name)) ? [full] : [];
});
const HYGIENE = [
  ['a home-directory path', /[A-Za-z]:[\\/]+Users[\\/]+(?!<)[^\\/\s"']+|\/Users\/(?!<)[a-z][\w.-]*\/|\/home\/(?!runner\/|<)[a-z][\w.-]*\//],
  ['a GPU model name', /\b(?:GeForce|RTX ?\d{3,4}|Radeon(?: RX)?|Iris Xe|UHD Graphics)\b/],
  ['a link into a repository that is not a plugin', /github\.com\/ehartye\/(?!agent-|hartye-)[\w.-]+|ehartye\.github\.io\/(?!agent-|hartye-)/],
  ['a wiki vault path', /wiki\/(?:authored|sources|entities)\//],
];

/**
 * The rules a private-terms file adds, and its unusable lines: { rules: [[what, RegExp]], problems: [string] }. A line written
 * /pattern/flags is a regular expression with exactly those flags (g and y are dropped: they make .test() remember its place
 * between lines); any other line is a literal, case-insensitive term. A pattern that does not compile is a problem, named by
 * line number and error but not echoed, since the line may hold a private name.
 */
function parseTerms(text) {
  const rules = [];
  const problems = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const m = /^\/(.+)\/([a-z]*)$/.exec(line);
    if (!m) {
      rules.push([`the private term "${line}"`, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')]);
      return;
    }
    try {
      rules.push([`the private pattern ${line}`, new RegExp(m[1], [...new Set(m[2])].filter((f) => f !== 'g' && f !== 'y').join(''))]);
    } catch (error) {
      problems.push(`terms file line ${i + 1}: not a usable regular expression (${error.message.replace(/^Invalid regular expression: /, '')})`);
    }
  });
  return { rules, problems };
}

/** Scan a folder for the generic hygiene patterns plus the rules of a terms file: { hits, problems }. */
function scanHygiene(root, termsText = '', { skip = resolve(import.meta.filename) } = {}) {
  const { rules: extra, problems } = parseTerms(termsText);
  const rules = [...HYGIENE, ...extra];
  const hits = [];
  for (const file of walk(root)) {
    if (resolve(file) === skip) continue; // this file holds the patterns
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const [what, re] of rules) if (re.test(line)) hits.push(`${relative(root, file).split(sep).join('/')}:${i + 1}: ${what}`);
    });
  }
  return { hits, problems };
}

/** A fresh temp folder holding the given files (root-relative path -> text). */
function mkRoot(files) {
  const root = mkdtempSync(join(tmpdir(), 'release-consistency-'));
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}

test('plugin content names no home directory, GPU model, non-plugin repository or wiki path', () => {
  const termsFile = process.env.AGENT_UNREAL_PRIVATE_TERMS_FILE;
  const { hits, problems } = scanHygiene(ROOT, termsFile ? readFileSync(termsFile, 'utf8') : '');
  assert.deepEqual(problems, []);
  assert.deepEqual(hits, []);
});

test('a /pattern/flags line in the private-terms file is a regular expression; a plain line stays a literal; a bad pattern is reported, not thrown', () => {
  const root = mkRoot({ 'a.md': 'Tess walked in.\n', 'b.md': 'Tessellation and tess in lower case.\n', 'c.md': 'Run pip install first.\n' });
  const whole = scanHygiene(root, '/\\bTess\\b/\n');
  assert.deepEqual(whole, { hits: ['a.md:1: the private pattern /\\bTess\\b/'], problems: [] }, 'whole word, case sensitive: "Tessellation" and "tess" pass');
  assert.deepEqual(scanHygiene(root, '/\\btess\\b/i\n').hits.map((h) => h.split(':')[0]), ['a.md', 'b.md'], 'the i flag is honoured');
  assert.deepEqual(scanHygiene(root, 'Pip\n').hits.map((h) => h.split(':')[0]), ['c.md'], 'a plain line is literal and case-insensitive');
  assert.deepEqual(scanHygiene(root, '\n  \n').hits, [], 'blank lines are ignored');

  // g and y would make .test() skip a second match on the next line; both are dropped.
  const twice = mkRoot({ 'd.md': 'Tess one\nTess two\n' });
  assert.equal(scanHygiene(twice, '/Tess/g\n').hits.length, 2);

  // A literal with regex characters is escaped; a line that only looks like a path is a pattern, as in the other plugins.
  assert.deepEqual(scanHygiene(mkRoot({ 'e.md': 'a.b and aXb\n' }), 'a.b\n').hits.length, 1);

  const bad = scanHygiene(root, '/(/\n/x/zz\n/\\bTess\\b/\n');
  assert.equal(bad.problems.length, 2);
  assert.match(bad.problems[0], /^terms file line 1: not a usable regular expression/);
  assert.match(bad.problems[1], /^terms file line 2: /);
  assert.doesNotMatch(bad.problems.join('\n'), /Tess|x\/zz/, 'a bad line is not echoed');
  assert.equal(bad.hits.length, 1, 'the good line after the bad ones still applies');
});

test('the generic hygiene patterns catch a home path, a GPU model, a non-plugin repository link and a wiki path in a fixture', () => {
  const home = ['C:', 'Users', 'someone', 'x'].join('\\');
  const root = mkRoot({
    'p.md': `${home}\n`,
    'g.md': `${['Ge', 'Force'].join('')} card\n`,
    'r.md': 'https://github.com/ehartye/some-game\n',
    'w.md': 'see wiki/authored/x\n',
    'runtime/Source/Probe.cpp': `// ${home}\n`,
    'runtime/Source/Probe.h': '// https://github.com/ehartye/some-game\n',
    'runtime/Probe.uplugin': JSON.stringify({ Description: `Uses ${home}` }),
    'ok.md': 'https://github.com/ehartye/agent-meshes and C:\\Users\\<you>\\x\n',
  });
  const files = scanHygiene(root).hits.map((h) => h.split(':')[0]).sort();
  assert.deepEqual(files, ['g.md', 'p.md', 'r.md', 'runtime/Probe.uplugin', 'runtime/Source/Probe.cpp', 'runtime/Source/Probe.h', 'w.md']);
});

// --- citations of other plugins' skills ---------------------------------------------------------------------------
// scripts/skill-citations.mjs holds the grammar; scripts/README.md states it and the limits. The names of the sibling plugins'
// skills are the committed snapshot scripts/sibling-skills.json; with AGENT_UNREAL_SIBLING_PLUGINS set to a folder of sibling
// checkouts the same test also compares the snapshot with them.

const SNAPSHOT = {
  'agent-engine': ['engine-asset-import', 'engine-selection'],
  'agent-meshes': ['mesh-build', 'mesh-tool-selection'],
  'agent-phaser': ['engine-phaser', 'phaser-verification'],
  'agent-tests': ['test-audit', 'test-strategy'],
};
const cites = (text) => extractCitations(text, Object.keys(SNAPSHOT)).map((c) => [c.via, c.plugin ?? 'none', ...c.names].join(' '));
const problemsFor = (files) => checkCitations(mkRoot(files), SNAPSHOT).map((f) => `${f.file}:${f.line}: ${f.message}`);
const ownSkill = (name) => ({ [`skills/${name}/SKILL.md`]: `---\nname: ${name}\n---\n` });

test('every citation of another plugin\'s skill names a skill that exists in the snapshot (and in live siblings when AGENT_UNREAL_SIBLING_PLUGINS is set)', () => {
  const snapshot = loadSnapshot();
  let siblings = snapshot;
  const problems = [];
  const live = process.env.AGENT_UNREAL_SIBLING_PLUGINS;
  if (live) {
    const found = liveSkills(resolve(live), Object.keys(snapshot));
    problems.push(...compareSnapshot(snapshot, found).errors);
    siblings = { ...snapshot, ...found.found };
  }
  problems.push(...checkCitations(ROOT, siblings).map((f) => `${f.file}:${f.line}: ${f.message}`));
  assert.deepEqual(problems, []);
});

test('the sibling snapshot is names only: plugin -> sorted kebab-case skill names, no paths, and it covers every plugin the tree cites', () => {
  const snapshot = loadSnapshot();
  for (const [plugin, names] of Object.entries(snapshot)) {
    assert.match(plugin, /^[a-z][a-z0-9-]*$/, plugin);
    assert.ok(Array.isArray(names) && names.length > 0, `${plugin} has names`);
    assert.deepEqual(names, [...names].sort(), `${plugin} is sorted`);
    for (const name of names) assert.match(name, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, `${plugin}: ${name}`);
  }
});

test('citation grammar: the forms the skills use are read, with the plugin each binds to', () => {
  const read = [
    ['`engine-asset-import` and `engine-selection` in agent-engine.', ['in agent-engine engine-asset-import engine-selection']],
    ['(use engine-asset-import from agent-engine)', ['in agent-engine engine-asset-import']],
    ['Other engines are in `engine-asset-import` (agent-engine); the rest', ['paren agent-engine engine-asset-import']],
    ['method (`phaser-verification` skill, agent-phaser) for budgets', ['skill-comma agent-phaser phaser-verification']],
    ['the `mesh-tool-selection` and `mesh-build` skills in agent-meshes', ['in agent-meshes mesh-tool-selection mesh-build']],
    ['the `agent-tests` plugin\'s test-strategy and test-audit skills', ['possessive agent-tests test-strategy test-audit']],
    ['Check with agent-meshes `verify-unreal` (see its `mesh-build` skill).', ['its agent-meshes mesh-build']],
    ['agent-meshes, whose `mesh-tool-selection` decides between them', ['whose agent-meshes mesh-tool-selection']],
    ['import them with the `unreal-import` skill.', ['unqualified none unreal-import']],
    ['Use agent-meshes (the `mesh-tool-selection` skill decides).', ['unqualified agent-meshes mesh-tool-selection']],
    ['an `engine-selection`\n  in\nagent-engine split over lines', ['in agent-engine engine-selection']],
  ];
  for (const [text, expected] of read) assert.deepEqual(cites(text), expected, text);
  // Not citations: bare hyphenated words next to "skill", a pronoun with no plugin before it, fenced code, a plugin with no names.
  for (const text of ['seven instruction-text skills register', 'its `mesh-build` skill', '```\n`mesh-build` in agent-meshes\n```', 'import with agent-meshes now', 'the built-in agent-engine']) {
    assert.deepEqual(cites(text), [], text);
  }
  // A name is read per paragraph: a plugin in the previous paragraph does not bind a later "its".
  assert.deepEqual(cites('About agent-meshes.\n\nAnd its `mesh-build` skill.'), []);
});

test('a citation of a skill that does not exist fails, with the plugin\'s skill names in the message; one that exists passes', () => {
  const found = problemsFor({ ...ownSkill('unreal-import'), 'skills/unreal-import/references/a.md': '# A\n\n- See `engine-fizz` in agent-engine.\n- See `engine-selection` in agent-engine.\n' });
  assert.equal(found.length, 1);
  assert.match(found[0], /^skills\/unreal-import\/references\/a\.md:3: "engine-fizz" is not a skill of agent-engine \(it has: engine-asset-import, engine-selection\)/);

  // A chain fails by name, and a misspelt plugin or one the snapshot lacks is named.
  assert.equal(problemsFor({ ...ownSkill('x'), 'skills/x/references/a.md': 'the `mesh-build` and `mesh-bild` skills in agent-meshes\n' }).length, 1);
  assert.match(problemsFor({ ...ownSkill('x'), 'skills/x/references/a.md': '`mesh-build` in agent-meshs\n' })[0], /plugin "agent-meshs", which is not in scripts\/sibling-skills\.json/);
  assert.deepEqual(problemsFor({ ...ownSkill('x'), 'skills/x/references/a.md': '`mesh-build` in agent-meshes\n' }), []);
});

test('an unqualified skill name resolves in this plugin, then in the plugin named earlier in its paragraph, and otherwise fails', () => {
  const files = (text) => ({ ...ownSkill('unreal-import'), 'skills/unreal-import/references/a.md': text });
  assert.deepEqual(problemsFor(files('Use the `unreal-import` skill.\n')), []);
  assert.deepEqual(problemsFor(files('In agent-meshes the `mesh-build` skill checks it.\n')), []);
  assert.match(problemsFor(files('Use the `mesh-build` skill.\n'))[0], /"mesh-build" is not a skill of agent-unreal; if it belongs to another plugin, write it as "mesh-build in <plugin>"/);
  assert.match(problemsFor(files('In agent-meshes the `mesh-biuld` skill checks it.\n'))[0], /not a skill of agent-unreal or agent-meshes/);
  assert.deepEqual(problemsFor(files('Mentioned agent-meshes.\n\nUse the `mesh-build` skill.\n')).length, 1, 'a plugin in an earlier paragraph does not count');
});

test('limit: a name check passes a skill that exists but no longer holds the cited content (the stale engine-phaser pointer)', () => {
  // engine-phaser still exists in agent-phaser, so only a person or a content check can see that profiling moved out of it.
  assert.deepEqual(problemsFor({ ...ownSkill('x'), 'skills/x/references/a.md': 'method (`engine-phaser` skill, agent-phaser)\n' }), []);
});

test('citations are checked in skills, examples and the README', () => {
  const found = problemsFor({
    ...ownSkill('x'),
    'README.md': '`nope-one` in agent-engine\n',
    'skills/x/SKILL.md': '---\ndescription: Not for it (use nope-two from agent-engine).\n---\n',
    'examples/e/README.md': '`nope-three` in agent-meshes\n',
  });
  assert.deepEqual(found.map((f) => f.split(': ')[0]).sort(), ['README.md:1', 'examples/e/README.md:1', 'skills/x/SKILL.md:2']);
});

test('sibling mode: a snapshot name the checkout lacks and a checkout name the snapshot lacks fail; a missing plugin folder is a note; versioned folders use the newest', () => {
  const sibling = (plugin, names, { version } = {}) => Object.fromEntries(names.map((n) => [`${plugin}/${version ? `${version}/` : ''}skills/${n}/SKILL.md`, '---\n---\n']));
  const snapshot = { 'agent-engine': ['a-one', 'a-two'], 'agent-meshes': ['m-one'], 'agent-vids': ['v-one'] };
  const folder = mkRoot({
    ...sibling('agent-engine', ['a-one', 'a-three']),
    ...sibling('agent-meshes', ['m-old'], { version: '0.9.0' }),
    ...sibling('agent-meshes', ['m-one'], { version: '0.10.0' }),
  });
  const live = liveSkills(folder, Object.keys(snapshot));
  assert.deepEqual(live, { found: { 'agent-engine': ['a-one', 'a-three'], 'agent-meshes': ['m-one'] }, missing: ['agent-vids'] }, '0.10.0 is newer than 0.9.0');
  const { errors, notes } = compareSnapshot(snapshot, live);
  assert.deepEqual(errors, [
    'agent-engine: the snapshot lists "a-two" but the checkout has no such skill (renamed, split or removed?)',
    'agent-engine: the checkout has the skill "a-three" that the snapshot lacks; refresh scripts/sibling-skills.json',
  ]);
  assert.deepEqual(notes, ['agent-vids: no checkout in the sibling folder; its snapshot entry was not verified']);

  // --write-snapshot reads the same folders and writes names only, sorted; --merge keeps the other plugins.
  const out = join(mkRoot({}), 'snapshot.json');
  writeFileSync(out, JSON.stringify({ 'agent-vids': ['v-one'] }));
  assert.deepEqual(writeSnapshot(folder, { plugins: ['agent-meshes', 'agent-engine'], merge: true, path: out }), {
    'agent-engine': ['a-one', 'a-three'], 'agent-meshes': ['m-one'], 'agent-vids': ['v-one'],
  });
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8'))['agent-meshes'], ['m-one']);
  assert.throws(() => writeSnapshot(folder, { plugins: ['agent-vids'], path: out }), /agent-vids/);
});
