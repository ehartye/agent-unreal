import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, relative, extname, sep } from 'node:path';

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
// AGENT_UNREAL_PRIVATE_TERMS_FILE at a local file with one case-insensitive term per line to check those too.
const TEXT = new Set(['.md', '.mjs', '.js', '.jsx', '.json', '.yml', '.yaml', '.py', '.gd', '.cs', '.html', '.sh', '.txt', '']);
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

test('plugin content names no home directory, GPU model, non-plugin repository or wiki path', () => {
  const termsFile = process.env.AGENT_UNREAL_PRIVATE_TERMS_FILE;
  const extra = termsFile
    ? readFileSync(termsFile, 'utf8').split(/\r?\n/).map((t) => t.trim()).filter(Boolean)
    : [];
  const rules = [...HYGIENE, ...extra.map((t) => [`the private term "${t}"`, new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')])];
  const hits = [];
  const self = resolve(import.meta.filename);
  for (const file of walk(ROOT)) {
    if (resolve(file) === self) continue; // this file holds the patterns
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const [what, re] of rules) if (re.test(line)) hits.push(`${relative(ROOT, file).split(sep).join('/')}:${i + 1}: ${what}`);
    });
  }
  assert.deepEqual(hits, []);
});
