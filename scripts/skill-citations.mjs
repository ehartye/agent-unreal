#!/usr/bin/env node
// Check that every citation of another plugin's skill names a skill that exists. Zero dependencies; Node 20.11+.
// The grammar, the resolution rules and the limits are in scripts/README.md.
//
//   node scripts/skill-citations.mjs                       check skills/**, examples/**/*.md and README.md against
//                                                          scripts/sibling-skills.json, and against live sibling checkouts
//                                                          too when AGENT_UNREAL_SIBLING_PLUGINS names a folder of them
//   node scripts/skill-citations.mjs --write-snapshot <folder> [--plugins a,b,c] [--merge]
//                                                          rewrite scripts/sibling-skills.json from <folder>/<plugin>/skills/*
//                                                          (or the newest <folder>/<plugin>/<version>/skills/*)
// Exit code 0 when clean, 1 with findings, 2 on a usage error.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_PATH = join(SCRIPTS, 'sibling-skills.json');
export const OWN_PLUGIN = 'agent-unreal';

const NAME = '[a-z][a-z0-9]*(?:-[a-z0-9]+)+';
const SEPARATOR = '(?:\\s*,\\s*(?:(?:and|or)\\s+)?|\\s+(?:and|or)\\s+)';
const list = (name) => `${name}(?:${SEPARATOR}${name})*`;
// A name beside its plugin may be bare (a description has no code spans); a name with only the word "skill" must be in backticks,
// so that an adjective such as "instruction-text skills" is not read as a skill name.
const LIST = list(`\`?${NAME}\`?`);
const LIST_CODE = list(`\`${NAME}\``);
const NAME_G = new RegExp(NAME, 'g');

/** { plugin: sorted names } from the committed snapshot. */
export function loadSnapshot(path = SNAPSHOT_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const isDir = (p) => existsSync(p) && statSync(p).isDirectory();

/** Names of the folders under a skills folder that hold a SKILL.md, sorted. */
export function skillNames(skillsDir) {
  if (!isDir(skillsDir)) return [];
  return readdirSync(skillsDir).filter((d) => existsSync(join(skillsDir, d, 'SKILL.md'))).sort();
}

const versionKey = (v) => v.split('.').map((part) => Number.parseInt(part, 10) || 0);
const compareVersions = (a, b) => {
  const [x, y] = [versionKey(a), versionKey(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** The skills folder of a plugin folder: <dir>/skills, else <dir>/<newest version>/skills. Null when there is none. */
function pluginSkillsDir(dir) {
  if (skillNames(join(dir, 'skills')).length > 0) return join(dir, 'skills');
  if (!isDir(dir)) return null;
  const versions = readdirSync(dir).filter((v) => /^\d+(?:\.\d+)*$/.test(v) && skillNames(join(dir, v, 'skills')).length > 0).sort(compareVersions);
  return versions.length > 0 ? join(dir, versions.at(-1), 'skills') : null;
}

/** Skill names of each wanted plugin under a folder of sibling checkouts: { found: { plugin: names }, missing: [plugin] }. */
export function liveSkills(siblingsDir, plugins) {
  const found = {};
  const missing = [];
  for (const plugin of plugins) {
    const skills = pluginSkillsDir(join(siblingsDir, plugin));
    if (skills) found[plugin] = skillNames(skills);
    else missing.push(plugin);
  }
  return { found, missing };
}

/**
 * Compare the committed snapshot with live checkouts. A plugin folder that is absent is a note, not an error (not every machine
 * has every sibling). A name the snapshot lists that the checkout lacks, and a name the checkout has that the snapshot lacks,
 * are errors: the snapshot is stale or the sibling changed.
 */
export function compareSnapshot(snapshot, live) {
  const errors = [];
  const notes = live.missing.map((plugin) => `${plugin}: no checkout in the sibling folder; its snapshot entry was not verified`);
  for (const [plugin, names] of Object.entries(live.found)) {
    for (const name of snapshot[plugin] ?? []) if (!names.includes(name)) errors.push(`${plugin}: the snapshot lists "${name}" but the checkout has no such skill (renamed, split or removed?)`);
    for (const name of names) if (!(snapshot[plugin] ?? []).includes(name)) errors.push(`${plugin}: the checkout has the skill "${name}" that the snapshot lacks; refresh scripts/sibling-skills.json`);
  }
  return { errors, notes };
}

/** Text with fenced code blocks blanked (line numbers kept). */
function prepare(text) {
  let fence = false;
  return text.split(/\r?\n/).map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return ''; }
    return fence ? '' : line;
  }).join('\n');
}

/**
 * The citations of other skills in one text. Each is { line, names, plugin, via } where plugin is the plugin the text binds the
 * names to (null: no plugin, the names are this plugin's own) and via is how: 'in' (NAME in|from PLUGIN), 'paren'
 * (NAME (PLUGIN)), 'skill-comma' (NAME skill, PLUGIN), 'possessive' (PLUGIN plugin's NAME skills), 'its' (its NAME skill),
 * 'whose' (PLUGIN, whose NAME ...) or 'unqualified' (NAME skill). An 'its', 'whose' or 'unqualified' citation takes the nearest
 * plugin mentioned earlier in the same paragraph (via 'unqualified' keeps plugin null when there is none, and also lists it in
 * `fallback`).
 */
export function extractCitations(text, pluginNames = []) {
  const pluginPattern = `(?:agent-[a-z]+|${[...new Set(pluginNames)].filter((p) => !p.startsWith('agent-')).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') || '(?!)'})`;
  const P = `\`?(?<plugin>${pluginPattern})\`?`;
  const forms = [
    ['in', new RegExp(`(?<names>${LIST})(?:\\s+skills?)?\\s+(?:in|from)\\s+(?:the\\s+)?${P}\\b`, 'g')],
    ['paren', new RegExp(`(?<names>${LIST})(?:\\s+skills?)?\\s*\\(\\s*${P}\\s*\\)`, 'g')],
    ['skill-comma', new RegExp(`(?<names>${LIST})\\s+skills?,\\s*${P}\\b`, 'g')],
    ['possessive', new RegExp(`${P}(?:\\s+plugin)?'s\\s+(?<names>${LIST})\\s+skills?\\b`, 'g')],
    ['its', new RegExp(`\\bits\\s+(?<names>${LIST})\\s+skills?\\b`, 'g')],
    ['whose', new RegExp(`\\bwhose\\s+(?<names>\`?${NAME}\`?)`, 'g')],
    ['unqualified', new RegExp(`(?<names>${LIST_CODE})\\s+skills?\\b`, 'g')],
  ];
  const clean = prepare(text);
  const citations = [];
  const lineAt = (offset) => clean.slice(0, offset).split('\n').length;
  const mention = new RegExp(`\\b${pluginPattern}\\b`, 'g');
  const bounds = [];
  let from0 = 0;
  for (const gap of clean.matchAll(/\n[ \t]*\n/g)) {
    bounds.push([from0, gap.index]);
    from0 = gap.index + gap[0].length;
  }
  bounds.push([from0, clean.length]);
  for (const [start, end] of bounds) {
    const paragraph = clean.slice(start, end);
    const consumed = [];
    const mentions = [...paragraph.matchAll(mention)].map((m) => ({ at: m.index, plugin: m[0] }));
    const before = (at) => mentions.filter((m) => m.at < at).at(-1)?.plugin ?? null;
    for (const [via, re] of forms) {
      for (const m of paragraph.matchAll(re)) {
        const [from, to] = [m.index, m.index + m[0].length];
        if (consumed.some(([a, b]) => from < b && to > a)) continue;
        consumed.push([from, to]);
        const names = m.groups.names.match(NAME_G);
        const plugin = m.groups.plugin ?? before(from);
        if ((via === 'its' || via === 'whose') && !plugin) continue; // a pronoun with no plugin before it is not a citation
        citations.push({ line: lineAt(start + from), names, plugin, via, hasPlugin: Boolean(m.groups.plugin) });
      }
    }
  }
  return citations.sort((a, b) => a.line - b.line);
}

/** Markdown files that may cite a skill, root-relative with forward slashes: skills/**, examples/**, README.md. */
export function citationFiles(root) {
  const out = [];
  const walk = (dir) => {
    if (!isDir(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') walk(full); } else if (e.name.endsWith('.md')) out.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(join(root, 'skills'));
  walk(join(root, 'examples'));
  if (existsSync(join(root, 'README.md'))) out.push('README.md');
  return out.sort();
}

/**
 * Check every citation under root. `siblings` is { plugin: names } (the snapshot, or live data over it). Returns
 * [{ file, line, message }]. A name resolves in the plugin the citation binds it to; an unqualified name resolves in this
 * plugin's own skills, then in the plugin mentioned earlier in its paragraph, and otherwise fails.
 */
export function checkCitations(root, siblings, { ownPlugin = OWN_PLUGIN } = {}) {
  const own = skillNames(join(root, 'skills'));
  const plugins = { ...siblings, [ownPlugin]: own };
  const findings = [];
  for (const file of citationFiles(root)) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const c of extractCitations(text, Object.keys(plugins))) {
      for (const name of c.names) {
        const add = (message) => findings.push({ file, line: c.line, message });
        if (c.via === 'unqualified') {
          if (own.includes(name) || (c.plugin && plugins[c.plugin]?.includes(name))) continue;
          add(c.plugin
            ? `"${name}" is not a skill of ${ownPlugin} or ${c.plugin}; check the name${c.plugin in plugins ? ` (${c.plugin} has: ${plugins[c.plugin].join(', ')})` : ''}`
            : `"${name}" is not a skill of ${ownPlugin}; if it belongs to another plugin, write it as "${name} in <plugin>"`);
          continue;
        }
        if (!(c.plugin in plugins)) { add(`"${name}" is cited in the plugin "${c.plugin}", which is not in scripts/sibling-skills.json; refresh the snapshot or fix the plugin name`); continue; }
        if (!plugins[c.plugin].includes(name)) add(`"${name}" is not a skill of ${c.plugin} (it has: ${plugins[c.plugin].join(', ')})`);
      }
    }
  }
  return findings;
}

/** Rewrite the snapshot from a folder of sibling checkouts or plugin-cache folders. Returns the snapshot written. */
export function writeSnapshot(siblingsDir, { plugins, merge = false, path = SNAPSHOT_PATH } = {}) {
  const previous = existsSync(path) ? loadSnapshot(path) : {};
  const wanted = plugins ?? Object.keys(previous);
  if (wanted.length === 0) throw new Error('no plugins to read: pass --plugins a,b,c');
  const { found, missing } = liveSkills(siblingsDir, wanted);
  if (missing.length > 0) throw new Error(`no skills found for ${missing.join(', ')} under the folder given`);
  const next = Object.fromEntries(Object.entries({ ...(merge ? previous : {}), ...found }).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** Runs the check and returns the exit code. */
export function main(argv, env = process.env) {
  const write = argv.indexOf('--write-snapshot');
  if (write !== -1) {
    const folder = argv[write + 1];
    const listAt = argv.indexOf('--plugins');
    if (!folder || folder.startsWith('--')) { console.error('usage: --write-snapshot <folder> [--plugins a,b,c] [--merge]'); return 2; }
    try {
      const plugins = listAt === -1 ? undefined : (argv[listAt + 1] ?? '').split(',').map((p) => p.trim()).filter(Boolean);
      const next = writeSnapshot(resolve(folder), { plugins, merge: argv.includes('--merge') });
      console.log(`skill-citations: wrote ${Object.keys(next).length} plugins, ${Object.values(next).flat().length} skill names to scripts/sibling-skills.json`);
      return 0;
    } catch (error) {
      console.error(`skill-citations: ${error.message}`);
      return 2;
    }
  }
  if (argv.length > 0) { console.error('usage: node scripts/skill-citations.mjs [--write-snapshot <folder> [--plugins a,b,c] [--merge]]'); return 2; }
  const root = resolve(env.AGENT_UNREAL_ROOT || join(SCRIPTS, '..'));
  const snapshot = loadSnapshot();
  const problems = [];
  let siblings = snapshot;
  const live = env.AGENT_UNREAL_SIBLING_PLUGINS;
  if (live) {
    const { errors, notes } = compareSnapshot(snapshot, liveSkills(resolve(live), Object.keys(snapshot)));
    for (const note of notes) console.log(`skill-citations: note: ${note}`);
    problems.push(...errors.map((message) => ({ file: 'scripts/sibling-skills.json', line: 1, message })));
    siblings = { ...snapshot, ...liveSkills(resolve(live), Object.keys(snapshot)).found };
  }
  problems.push(...checkCitations(root, siblings));
  for (const f of problems) console.log(`${f.file}:${f.line}: citation: ${f.message}`);
  console.log(`skill-citations: ${problems.length === 0 ? 'ok' : `${problems.length} finding(s)`}${live ? ' (snapshot and live siblings)' : ' (snapshot)'}`);
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
