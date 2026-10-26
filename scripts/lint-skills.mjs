#!/usr/bin/env node
// Lint for agent-unreal skills. Zero dependencies; Node 20+.
//
//   node scripts/lint-skills.mjs [path ...] [options]
//
// A path is one skill folder (has SKILL.md) or a folder of skills. Default: ./skills
// Options:
//   --label-pattern <regex>   evidence label regex (default matches [tested] [documented] [general])
//   --max-skill-bytes <n>     SKILL.md size budget (default 8000)
//   --max-ref-bytes <n>       per-reference size budget (default 9000)
//   --skill-md-labels         also require labels on SKILL.md bullets
//   --require-claims          every ## section of SKILL.md and of each reference needs at least one labelled claim bullet
//   --labels-since <ref>      claim bullets added or changed since the git ref (working tree against the ref, untracked files
//                             whole) must carry a label that matches the default pattern, whatever --label-pattern says for the
//                             rest; the exempt headings are the same ones the label rule uses
//   --file <name>             report only findings in this file (repeatable): a reference's file name with or without .md, or
//                             SKILL.md. Every rule still runs, so a finding that depends on other files is the one the gate prints
//   --allow-orphan <name>     do not report this reference as an orphan (repeatable), for a new reference whose SKILL.md row
//                             the integrator has not written yet
//   --listing                 do not lint; print each skill's listing length and headroom and the trigger words shared by skills
// Findings are errors (exit code 1) unless marked "(warning)", which print but do not change the exit code.
// Exit code 1 when any error is reported, 2 on a usage error.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, basename, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export const DEFAULTS = {
  maxSkillBytes: 8000,
  maxRefBytes: 9000,
  labelPattern: '\\[(?:tested|documented|general)\\]',
  skillMdLabels: false,
  requireClaims: false,
  exemptHeadings: ['links', 'related', 'see also', 'sources', 'not covered here'],
  // Claude Code lists a skill as description + ' - ' + when_to_use and cuts the listing at 1,536 characters.
  listingWarn: 1400,
  listingMax: 1536,
  labelsSince: null,
  files: [],
  allowOrphans: [],
};

const FENCE = /^\s*(```|~~~)/;
const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const LINK_STRIP = /\[[^\]]*\]\([^)]*\)/g;

const posix = (p) => p.split(sep).join('/');

/** The value of a one-line scalar as YAML reads it: quotes removed, \" and \\ (double) or '' (single) undone. */
function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(["\\])/g, '$1');
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

/** Parse `---` frontmatter of simple `key: value` lines. Returns null if absent. */
export function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  const data = {};
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (m) data[m[1]] = unquote(m[2]);
  }
  return { data, bodyStart: end + 1, lines: lines.slice(0, end + 1) };
}

/** End index (exclusive) of the quoted scalar that starts at text[0], or -1 when it is not closed on this line. */
function quotedEnd(text, quote) {
  for (let i = 1; i < text.length; i++) {
    if (quote === '"' && text[i] === '\\') i++;
    else if (text[i] === quote) {
      if (quote === "'" && text[i + 1] === "'") i++;
      else return i + 1;
    }
  }
  return -1;
}

/**
 * Strict reading of the frontmatter lines (the `---` line to the closing `---` line) as the YAML subset skills use: top-level
 * `key: value` lines, plain, single-quoted, double-quoted or block scalars, indented continuation lines. Returns
 * [{ line, key, message }] with 1-based file line numbers. Not a YAML parser: it finds the mistakes that make a strict parser
 * (any agent that is not Claude Code) read a different value or fail: a colon followed by a space, or ' #', inside an unquoted
 * value; an unclosed quote; text after a closing quote; a value that starts with a YAML indicator; a duplicate key; a line that
 * is not `key: value`.
 */
export function frontmatterIssues(lines) {
  const issues = [];
  const seen = new Set();
  let key = null;
  let mode = 'none'; // how the lines after the key line are read: plain, dq/sq (open quote), skip (block, flow, nested)
  const bad = (line, k, message) => issues.push({ line, key: k, message });
  const plain = (n, text) => {
    if (/:(?:\s|$)/.test(text)) bad(n, key, `unquoted value contains a colon followed by a space (or ends in a colon); YAML reads it as a nested mapping and fails. Wrap the value in double quotes`);
    else if (/\s#/.test(text)) bad(n, key, `unquoted value contains " #", which YAML reads as a comment and drops the rest. Wrap the value in double quotes`);
  };
  for (let i = 1; i < lines.length - 1; i++) {
    const n = i + 1;
    const raw = lines[i];
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    if (/^\s/.test(raw)) { // continuation of the previous key
      if (mode === 'plain') plain(n, raw.trim());
      else if (mode === 'dq' || mode === 'sq') {
        const end = quotedEnd(`${mode === 'dq' ? '"' : "'"}${raw.trim()}`, mode === 'dq' ? '"' : "'");
        if (end !== -1) mode = 'none';
      }
      continue;
    }
    const m = /^([A-Za-z_][\w-]*):(?:\s+(.*)|\s*)$/.exec(raw);
    if (!m) { bad(n, null, 'not a `key: value` line'); key = null; mode = 'skip'; continue; }
    key = m[1];
    if (seen.has(key)) bad(n, key, `duplicate key "${key}"`);
    seen.add(key);
    const value = (m[2] ?? '').trim();
    mode = 'none';
    if (value === '') { mode = 'skip'; continue; }
    const first = value[0];
    if (first === '"' || first === "'") {
      const end = quotedEnd(value, first);
      if (end === -1) { mode = first === '"' ? 'dq' : 'sq'; }
      else if (!/^\s*(?:#.*)?$/.test(value.slice(end))) bad(n, key, 'text after the closing quote; escape inner quotes (\\" in double quotes, \'\' in single quotes) or rephrase');
    } else if (first === '|' || first === '>' || first === '[' || first === '{') mode = 'skip';
    else if ('&*!%@`'.includes(first) || (/^[-?:]\s/.test(value))) bad(n, key, `a plain value cannot start with "${first}"; wrap the value in double quotes`);
    else { mode = 'plain'; plain(n, value); }
  }
  if (mode === 'dq' || mode === 'sq') bad(lines.length, key, 'a quoted value is never closed');
  return issues;
}

/**
 * Lines annotated with: 1-based number, whether they sit in a code fence, the nearest heading
 * (lowercased) and the enclosing level-two heading { title, n } if any.
 */
function annotate(text) {
  let inFence = false;
  let heading = '';
  let h2 = null;
  return text.split(/\r?\n/).map((raw, i) => {
    const fenceLine = FENCE.test(raw);
    if (fenceLine) inFence = !inFence;
    const skip = inFence || fenceLine;
    if (!skip) {
      const h = /^(#{1,6})\s+(.*)$/.exec(raw);
      if (h) {
        heading = h[2].trim().toLowerCase();
        if (h[1].length === 1) h2 = null;
        if (h[1].length === 2) h2 = { title: heading, n: i + 1 };
      }
    }
    return { n: i + 1, raw, skip, heading, h2 };
  });
}

/** Relative link targets on a line (code spans removed), as { target, path }. */
function linksIn(raw) {
  const out = [];
  const clean = raw.replace(/`[^`]*`/g, '');
  for (const m of clean.matchAll(LINK)) {
    const target = m[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue;
    const path = target.split('#')[0].split('?')[0];
    if (path) out.push({ target, path });
  }
  return out;
}

/**
 * Claim bullets: { n, end, text, h2 }, where n..end are the bullet's own line and its wrapped continuation lines (joined into
 * text). Skipped: code fences, bullets under an exempt heading, and bullets that are only links.
 */
function claimItems(lines, exemptHeadings) {
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    if (cur.skip) continue;
    const m = BULLET.exec(cur.raw);
    if (!m || exemptHeadings.includes(cur.heading)) continue;
    let text = m[2];
    let end = cur.n;
    for (let j = i + 1; j < lines.length; j++) {
      const nx = lines[j];
      if (nx.skip || nx.raw.trim() === '' || BULLET.test(nx.raw) || /^#{1,6}\s/.test(nx.raw) || nx.raw.trim().startsWith('|')) break;
      text += ' ' + nx.raw.trim();
      end = nx.n;
    }
    const linkOnly = text.replace(LINK_STRIP, '').replace(/[\s\p{P}]/gu, '') === '';
    if (!linkOnly) items.push({ n: cur.n, end, text, h2: cur.h2 });
  }
  return items;
}

/** Size the way the repository stores text: line endings normalised to LF, so a CRLF working copy measures like CI. */
const lfBytes = (text) => Buffer.byteLength(text.replace(/\r\n/g, '\n'));

/** Characters of the skill listing entry: description, then ' - ' and when_to_use when there is one. */
export const listingLength = (description, whenToUse) => (whenToUse ? description.length + 3 + whenToUse.length : description.length);

/** Whether a finding's file (SKILL.md or references/x.md) is one of the --file names (with or without .md, any folder). */
export function fileSelected(file, names) {
  const base = basename(file);
  return names.some((raw) => {
    const name = basename(raw.replace(/\\/g, '/'));
    return base === name || base === `${name}.md`;
  });
}

/**
 * The lines added or changed since a git ref, as Map(path relative to dir -> Set of 1-based line numbers); the value is the
 * string 'all' for a file git does not track yet. The working tree is compared with the ref, so uncommitted edits count.
 * Throws an Error that names the ref when git cannot produce the diff.
 */
export function changedLines(dir, ref) {
  const git = (args) => spawnSync('git', ['-c', 'core.quotepath=off', '-C', dir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const diff = git(['diff', '--relative', '--unified=0', '--no-color', '--no-ext-diff', '--no-renames', ref, '--', '.']);
  if (diff.error || diff.status !== 0) {
    throw new Error(`git diff ${ref} failed in ${dir}: ${(diff.error?.message ?? diff.stderr ?? '').trim()}`);
  }
  const files = new Map();
  let current = null;
  for (const line of diff.stdout.split('\n')) {
    if (line.startsWith('+++ ')) {
      current = line === '+++ /dev/null' ? null : line.slice(line.startsWith('+++ b/') ? 6 : 4);
      if (current !== null && !files.has(current)) files.set(current, new Set());
      continue;
    }
    const hunk = current === null ? null : /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk) continue;
    const first = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    for (let n = first; n < first + count; n++) files.get(current).add(n);
  }
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', '.']);
  if (untracked.status === 0) for (const path of untracked.stdout.split('\n').filter(Boolean)) files.set(path, 'all');
  return files;
}

/** Lint one skill folder. Returns [{ file, line, rule, message, level }]; level is 'error' or 'warning'. */
export function lintSkill(dir, options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const label = new RegExp(opt.labelPattern);
  const strictLabel = new RegExp(DEFAULTS.labelPattern);
  const findings = [];
  const add = (file, line, rule, message, level = 'error') => findings.push({ file, line, rule, message, level });
  const skillPath = join(dir, 'SKILL.md');
  if (!existsSync(skillPath)) {
    add('SKILL.md', 1, 'skill-missing', 'no SKILL.md in this folder');
    return findings;
  }
  const skillText = readFileSync(skillPath, 'utf8');

  // 1. Frontmatter
  const fm = parseFrontmatter(skillText);
  if (!fm) {
    add('SKILL.md', 1, 'frontmatter-missing', 'SKILL.md must start with a --- frontmatter block');
  } else {
    const { name, description } = fm.data;
    const folder = basename(resolve(dir));
    if (!name) add('SKILL.md', 1, 'name-missing', 'frontmatter has no name');
    else if (name !== folder) add('SKILL.md', 1, 'name-mismatch', `name "${name}" does not match folder "${folder}"`);
    if (!description) add('SKILL.md', 1, 'description-missing', 'frontmatter has no description');
    else {
      if (description.length > 1024) add('SKILL.md', 1, 'description-length', `description is ${description.length} characters; the limit is 1024`);
      if (!/\buse\b/i.test(description) || !/\b(?:not for|do not use)\b/i.test(description)) {
        add('SKILL.md', 1, 'description-scope', 'description must say when to use the skill ("Use ...") and when not to ("Not for ...")');
      }
      // The skill listing is description + ' - ' + when_to_use, cut at 1,536 characters.
      const whenToUse = fm.data.when_to_use ?? '';
      const combined = listingLength(description, whenToUse);
      if (combined > opt.listingMax) add('SKILL.md', 1, 'listing-length', `description + " - " + when_to_use is ${combined} characters; the listing is cut at ${opt.listingMax}`);
      else if (combined >= opt.listingWarn) add('SKILL.md', 1, 'listing-length', `description + " - " + when_to_use is ${combined} characters, ${opt.listingMax - combined} below the ${opt.listingMax} cut`, 'warning');
      // "(use unreal-import)" in a Not-for clause satisfies the scope rule above, so ask for the words "Use when" where they belong.
      if (whenToUse ? !/^use when\b/i.test(whenToUse) : !/\buse when\b/i.test(description)) {
        add('SKILL.md', 1, 'use-when', whenToUse ? 'when_to_use must start with "Use when"' : 'with no when_to_use, the description must contain "Use when"');
      }
    }
    for (const issue of frontmatterIssues(fm.lines)) add('SKILL.md', issue.line, 'frontmatter-yaml', `${issue.key ? `${issue.key}: ` : ''}${issue.message}`);
  }

  // 2. Size of SKILL.md
  const skillBytes = lfBytes(skillText);
  if (skillBytes > opt.maxSkillBytes) add('SKILL.md', 1, 'size-skill', `SKILL.md is ${skillBytes} bytes; the budget is ${opt.maxSkillBytes}`);

  // 3. The "You are about to | Read" table, and references it must cover
  const refsDir = join(dir, 'references');
  const refFiles = existsSync(refsDir) ? readdirSync(refsDir).filter((f) => f.endsWith('.md')).sort() : [];
  const skillLines = annotate(skillText);
  const tableStart = skillLines.findIndex((l) => !l.skip && /^\|\s*You are about to\s*\|\s*Read\s*\|/i.test(l.raw));
  const linked = new Set();
  const tableRows = new Set();
  if (tableStart === -1) {
    add('SKILL.md', 1, 'table-missing', 'SKILL.md needs a "| You are about to | Read |" table');
  } else {
    for (let i = tableStart + 1; i < skillLines.length && skillLines[i].raw.trim().startsWith('|'); i++) {
      const { n, raw } = skillLines[i];
      tableRows.add(n);
      if (/^\|\s*:?-{2,}/.test(raw)) continue;
      const rowLinks = linksIn(raw);
      if (rowLinks.length === 0) add('SKILL.md', n, 'table-row-no-link', 'table row has no link to a reference');
      for (const l of rowLinks) {
        const abs = resolve(dir, l.path);
        if (existsSync(abs)) linked.add(abs);
        else add('SKILL.md', n, 'table-link-broken', `table links to ${l.target}, which does not exist`);
      }
    }
  }
  for (const f of refFiles) {
    if (!linked.has(resolve(refsDir, f)) && !fileSelected(`references/${f}`, opt.allowOrphans)) add(`references/${f}`, 1, 'reference-orphan', 'not linked from the SKILL.md table');
  }

  // 4. Reference size and heading; every relative link in SKILL.md and each reference resolves
  const documents = [{ rel: 'SKILL.md', abs: skillPath, lines: skillLines, isRef: false }];
  for (const f of refFiles) {
    const abs = join(refsDir, f);
    const text = readFileSync(abs, 'utf8');
    documents.push({ rel: `references/${f}`, abs, lines: annotate(text), isRef: true });
    const bytes = lfBytes(text);
    if (bytes > opt.maxRefBytes) add(`references/${f}`, 1, 'size-reference', `${bytes} bytes; the budget is ${opt.maxRefBytes}`);
    const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== '');
    if (!firstLine || !/^#\s+\S/.test(firstLine)) add(`references/${f}`, 1, 'reference-h1', 'a reference must open with a level-one heading');
  }
  for (const doc of documents) {
    for (const { n, raw, skip } of doc.lines) {
      if (skip) continue;
      if (doc.rel === 'SKILL.md' && tableRows.has(n)) continue; // reported as table-link-broken
      for (const l of linksIn(raw)) {
        const abs = resolve(dirname(doc.abs), l.path);
        if (!existsSync(abs)) add(doc.rel, n, 'link-broken', `link to ${l.target} does not resolve (${posix(relative(dir, abs))})`);
      }
    }
  }

  // 5a. No unfilled placeholders anywhere, code fences included
  for (const doc of documents) {
    for (const { n, raw } of doc.lines) {
      const m = /\{\{[^}]*\}\}|\b(?:TODO|TBD|FIXME)\b/.exec(raw);
      if (m) add(doc.rel, n, 'placeholder', `unfilled placeholder "${m[0]}"`);
    }
  }

  // 5a'. Claude Code replaces $ARGUMENTS, $ARGUMENTS[n] and $n in a skill's text when the skill is invoked, and does not read code
  // fences. SKILL.md is checked everywhere, fences included. A reference is read, not substituted, so shell, regex and PowerShell
  // text with $1 is legitimate in its fences and inline code: there $ARGUMENTS is rejected everywhere and $n only in prose.
  for (const doc of documents) {
    for (const { n, raw, skip } of doc.lines) {
      const scanned = !doc.isRef || /\$ARGUMENTS\b/.test(raw) ? raw : skip ? '' : raw.replace(/`[^`]*`/g, '');
      const m = /\$ARGUMENTS\b|\$\d/.exec(scanned);
      if (m) add(doc.rel, n, 'arguments-placeholder', `"${m[0]}" is replaced with the invocation arguments when a skill runs; spell the example out${doc.isRef ? ' or put it in code' : ''}`);
    }
  }

  // 5b. Evidence labels on claim bullets, and (optionally) at least one per section
  const changed = opt.labelsSince ? changedLines(dir, opt.labelsSince) : null;
  for (const doc of documents) {
    if (!doc.isRef && !opt.skillMdLabels && !opt.requireClaims) continue;
    const items = claimItems(doc.lines, opt.exemptHeadings);
    const touched = changed?.get(doc.rel);
    for (const it of items) {
      if (!(doc.isRef || opt.skillMdLabels)) continue;
      // A bullet added or changed since the ref answers to the default pattern, the rest to the pattern in force.
      const isNew = touched === 'all' || (touched !== undefined && [...touched].some((n) => n >= it.n && n <= it.end));
      if (isNew && !(strictLabel.test(it.text) && label.test(it.text))) add(doc.rel, it.n, 'label-missing', `claim bullet added or changed since ${opt.labelsSince} has no evidence label (${DEFAULTS.labelPattern}): ${it.text.slice(0, 60)}`);
      else if (!isNew && !label.test(it.text)) add(doc.rel, it.n, 'label-missing', `claim bullet has no evidence label (${opt.labelPattern}): ${it.text.slice(0, 60)}`);
    }
    if (opt.requireClaims) {
      const counts = new Map();
      for (const l of doc.lines) {
        if (!l.skip && /^##\s/.test(l.raw) && !opt.exemptHeadings.includes(l.h2.title)) counts.set(l.h2.n, 0);
      }
      for (const it of items) {
        if (label.test(it.text) && it.h2 && counts.has(it.h2.n)) counts.set(it.h2.n, counts.get(it.h2.n) + 1);
      }
      for (const [n, count] of counts) if (count === 0) add(doc.rel, n, 'section-empty', 'section has no labelled claim bullet');
    }
  }
  return opt.files.length === 0 ? findings : findings.filter((f) => fileSelected(f.file, opt.files));
}

/** A skill folder itself, or every child folder with a SKILL.md. */
export function discoverSkills(path) {
  const abs = resolve(path);
  if (existsSync(join(abs, 'SKILL.md'))) return [abs];
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  return readdirSync(abs)
    .map((d) => join(abs, d))
    .filter((d) => statSync(d).isDirectory() && existsSync(join(d, 'SKILL.md')))
    .sort();
}

// Words that carry no trigger: English function words and the vocabulary every skill of this plugin shares.
const GENERIC_WORDS = new Set(('a an the and or of to in on for with from by as at is are be it its this that these those when use used using not no '
  + 'your you we can may into than then also any all one two more most other such what which who whom how why whether about asked ask while where '
  + 'there their them they have has had do does done will would should could phrases phrase either each every both few many some same out up off over '
  + 'under again once here only own so too very just unreal engine project game code build building run running set needs missing never order edit '
  + 'author plan review content native checking').split(' '));

/**
 * What the skill listing costs and where skills compete. For each skill folder: name, description and when_to_use lengths, the
 * listing length (description + ' - ' + when_to_use) and the headroom under the cut. Plus the pairs of skills whose
 * when_to_use share at least `sharedMin` (2) trigger words that no third skill uses; singular and plural count once, so
 * "effect" and "effects" are one word. One shared word is common vocabulary, two or more is a pair that competes on a topic.
 * { rows: [{ name, description, whenToUse, listing, headroom }], shared: [{ skills: [a, b], words }] }.
 * Without a when_to_use the description's text before "Not for" stands in for it.
 */
export function libraryReport(dirs, options = {}) {
  const opt = { sharedMin: 2, ...DEFAULTS, ...options };
  const rows = [];
  const owners = new Map(); // stem -> Map(skill -> the word as written)
  for (const dir of dirs) {
    const skillPath = join(dir, 'SKILL.md');
    const fm = existsSync(skillPath) ? parseFrontmatter(readFileSync(skillPath, 'utf8')) : null;
    if (!fm) continue;
    const name = basename(resolve(dir));
    const description = fm.data.description ?? '';
    const whenToUse = fm.data.when_to_use ?? '';
    const listing = listingLength(description, whenToUse);
    rows.push({ name, description: description.length, whenToUse: whenToUse.length, listing, headroom: opt.listingMax - listing });
    const trigger = whenToUse || description.split(/not for/i)[0];
    for (const w of trigger.toLowerCase().match(/[a-z][a-z0-9+]*(?:-[a-z0-9]+)*/g) ?? []) {
      if (w.length < 3 || GENERIC_WORDS.has(w)) continue;
      const stem = w.replace(/s$/, '');
      if (!owners.has(stem)) owners.set(stem, new Map());
      if (!owners.get(stem).has(name)) owners.get(stem).set(name, w);
    }
  }
  const pairs = new Map();
  for (const bySkill of owners.values()) {
    if (bySkill.size !== 2) continue; // a word in three or more skills is too common to route on
    const key = [...bySkill.keys()].sort().join('|');
    pairs.set(key, [...(pairs.get(key) ?? []), [...new Set(bySkill.values())].sort().join('/')]);
  }
  const shared = [...pairs]
    .filter(([, words]) => words.length >= opt.sharedMin)
    .map(([key, words]) => ({ skills: key.split('|'), words: words.sort() }))
    .sort((x, y) => x.skills.join().localeCompare(y.skills.join()));
  return { rows, shared };
}

export function main(argv) {
  const options = {};
  const paths = [];
  let listing = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--label-pattern') options.labelPattern = argv[++i];
    else if (a === '--max-skill-bytes') options.maxSkillBytes = Number(argv[++i]);
    else if (a === '--max-ref-bytes') options.maxRefBytes = Number(argv[++i]);
    else if (a === '--skill-md-labels') options.skillMdLabels = true;
    else if (a === '--require-claims') options.requireClaims = true;
    else if (a === '--labels-since' || a === '--file' || a === '--allow-orphan') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) { console.error(`${a} needs a value`); return 2; }
      if (a === '--labels-since') options.labelsSince = v;
      else (options[a === '--file' ? 'files' : 'allowOrphans'] ??= []).push(v);
    } else if (a === '--listing') listing = true;
    else if (a.startsWith('--')) { console.error(`unknown option ${a}`); return 2; }
    else paths.push(a);
  }
  const skills = (paths.length ? paths : ['skills']).flatMap(discoverSkills);
  if (skills.length === 0) { console.error('no skills found'); return 2; }
  if (listing) {
    const { rows, shared } = libraryReport(skills);
    const pad = Math.max(...rows.map((r) => r.name.length));
    for (const r of rows) console.log(`listing: ${r.name.padEnd(pad)}  description ${r.description} + when_to_use ${r.whenToUse} = ${r.listing} of ${DEFAULTS.listingMax} (${r.headroom} left)`);
    for (const s of shared) console.log(`listing: warning: ${s.skills.join(' and ')} share the trigger words ${s.words.join(', ')}`);
    console.log(`listing: ${rows.length} skill(s), ${shared.length} pair(s) with shared trigger words`);
    return 0;
  }
  let total = 0;
  try {
    for (const dir of skills) {
      const findings = lintSkill(dir, options);
      const errors = findings.filter((f) => f.level !== 'warning').length;
      const warnings = findings.length - errors;
      total += errors;
      for (const f of findings) console.log(`${basename(dir)}/${f.file}:${f.line}: ${f.rule}${f.level === 'warning' ? ' (warning)' : ''}: ${f.message}`);
      const note = warnings ? `${errors ? ', ' : ' ('}${warnings} warning(s)${errors ? '' : ')'}` : '';
      console.log(`${basename(dir)}: ${errors === 0 ? 'ok' : `${errors} finding(s)`}${note}`);
    }
  } catch (error) {
    console.error(`lint-skills: ${error.message}`);
    return 2;
  }
  return total === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
