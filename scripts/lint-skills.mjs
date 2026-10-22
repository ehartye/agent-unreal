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
// Exit code 1 when any finding is reported, 2 on a usage error.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, basename, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULTS = {
  maxSkillBytes: 8000,
  maxRefBytes: 9000,
  labelPattern: '\\[(?:tested|documented|general)\\]',
  skillMdLabels: false,
  requireClaims: false,
  exemptHeadings: ['links', 'related', 'see also', 'sources', 'not covered here'],
};

const FENCE = /^\s*(```|~~~)/;
const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const LINK_STRIP = /\[[^\]]*\]\([^)]*\)/g;

const posix = (p) => p.split(sep).join('/');

/** Parse `---` frontmatter of simple `key: value` lines. Returns null if absent. */
export function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  const data = {};
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (m) data[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { data, bodyStart: end + 1 };
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
 * Claim bullets: { n, text, h2 }. Wrapped continuation lines are joined. Skipped: code fences,
 * bullets under an exempt heading, and bullets that are only links.
 */
function claimItems(lines, exemptHeadings) {
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    if (cur.skip) continue;
    const m = BULLET.exec(cur.raw);
    if (!m || exemptHeadings.includes(cur.heading)) continue;
    let text = m[2];
    for (let j = i + 1; j < lines.length; j++) {
      const nx = lines[j];
      if (nx.skip || nx.raw.trim() === '' || BULLET.test(nx.raw) || /^#{1,6}\s/.test(nx.raw) || nx.raw.trim().startsWith('|')) break;
      text += ' ' + nx.raw.trim();
    }
    const linkOnly = text.replace(LINK_STRIP, '').replace(/[\s\p{P}]/gu, '') === '';
    if (!linkOnly) items.push({ n: cur.n, text, h2: cur.h2 });
  }
  return items;
}

/** Lint one skill folder. Returns [{ file, line, rule, message }]. */
export function lintSkill(dir, options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const label = new RegExp(opt.labelPattern);
  const findings = [];
  const add = (file, line, rule, message) => findings.push({ file, line, rule, message });
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
    }
  }

  // 2. Size of SKILL.md
  const skillBytes = Buffer.byteLength(skillText);
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
    if (!linked.has(resolve(refsDir, f))) add(`references/${f}`, 1, 'reference-orphan', 'not linked from the SKILL.md table');
  }

  // 4. Reference size and heading; every relative link in SKILL.md and each reference resolves
  const documents = [{ rel: 'SKILL.md', abs: skillPath, lines: skillLines, isRef: false }];
  for (const f of refFiles) {
    const abs = join(refsDir, f);
    const text = readFileSync(abs, 'utf8');
    documents.push({ rel: `references/${f}`, abs, lines: annotate(text), isRef: true });
    const bytes = Buffer.byteLength(text);
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

  // 5b. Evidence labels on claim bullets, and (optionally) at least one per section
  for (const doc of documents) {
    if (!doc.isRef && !opt.skillMdLabels && !opt.requireClaims) continue;
    const items = claimItems(doc.lines, opt.exemptHeadings);
    for (const it of items) {
      if ((doc.isRef || opt.skillMdLabels) && !label.test(it.text)) add(doc.rel, it.n, 'label-missing', `claim bullet has no evidence label (${opt.labelPattern}): ${it.text.slice(0, 60)}`);
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
  return findings;
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

export function main(argv) {
  const options = {};
  const paths = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--label-pattern') options.labelPattern = argv[++i];
    else if (a === '--max-skill-bytes') options.maxSkillBytes = Number(argv[++i]);
    else if (a === '--max-ref-bytes') options.maxRefBytes = Number(argv[++i]);
    else if (a === '--skill-md-labels') options.skillMdLabels = true;
    else if (a === '--require-claims') options.requireClaims = true;
    else if (a.startsWith('--')) { console.error(`unknown option ${a}`); return 2; }
    else paths.push(a);
  }
  const skills = (paths.length ? paths : ['skills']).flatMap(discoverSkills);
  if (skills.length === 0) { console.error('no skills found'); return 2; }
  let total = 0;
  for (const dir of skills) {
    const findings = lintSkill(dir, options);
    total += findings.length;
    for (const f of findings) console.log(`${basename(dir)}/${f.file}:${f.line}: ${f.rule}: ${f.message}`);
    console.log(`${basename(dir)}: ${findings.length === 0 ? 'ok' : `${findings.length} finding(s)`}`);
  }
  return total === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
