#!/usr/bin/env node
// Find invisible Unicode in every text file of the checkout, tracked or not (skills, references, examples and the scripts
// themselves). Zero dependencies; Node 20.11+.
//
//   node scripts/scan-unicode.mjs [--quiet] [root]   root defaults to the checkout this script lives in (AGENT_UNREAL_ROOT
//                                                    overrides); --quiet prints nothing when the scan is clean
//
// Rejected: format characters (category Cf: zero-width, bidirectional, byte-order mark, soft hyphen, the tag block), private-use
// characters (Co) and unassigned code points (Cn), plus the whole tag block U+E0000..U+E007F. Each finding prints the file, line
// and column and the escaped form, so the fix needs no byte editing:
//
//   examples/unreal/engine_source.mjs:639:5: invisible-unicode: U+FEFF byte-order mark (Cf) in "  <U+FEFF>const a"
//
// Which files: `git ls-files --cached --others --exclude-standard` when the root has a .git entry, otherwise a walk that skips
// .git and node_modules. A file is text when it has no NUL byte in its first 8,000 bytes (git's own test); text that is not valid
// UTF-8 is reported as invalid-utf8. Cn depends on the Unicode version of the Node ICU data, so a code point assigned in a newer
// Unicode than the running Node knows can be reported as unassigned; the finding names the code point so it can be judged.
// Exit code 0 when clean, 1 with findings, 2 on a usage error.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const SKIP_WALK = new Set(['.git', 'node_modules']);
const CF = /\p{Cf}/u;
const CO = /\p{Co}/u;
const CN = /\p{Cn}/u;
const hex = (cp) => cp.toString(16).toUpperCase().padStart(4, '0');

/** What the code point is called here, by code-point arithmetic only. */
function describe(cp) {
  if (cp >= 0xe0000 && cp <= 0xe007f) return 'tag block';
  if (cp === 0xfeff) return 'byte-order mark';
  if (cp === 0xad) return 'soft hyphen';
  if (cp >= 0x200b && cp <= 0x200d) return 'zero-width';
  if (cp === 0x2060) return 'word joiner';
  if (cp === 0x200e || cp === 0x200f || cp === 0x061c || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) return 'bidirectional control';
  return '';
}

/** The category of an invisible code point ('Cf', 'Co', 'Cn' or 'tag'), or null for an ordinary one. */
export function invisibleKind(cp) {
  if (cp >= 0xe0000 && cp <= 0xe007f) return 'tag';
  const ch = String.fromCodePoint(cp);
  if (CF.test(ch)) return 'Cf';
  if (CO.test(ch)) return 'Co';
  if (CN.test(ch)) return 'Cn';
  return null;
}

/** The text with each invisible code point shown as <U+XXXX>, clipped to a readable length around the first one. */
function context(chars, at) {
  const shown = chars.map((c) => (invisibleKind(c.codePointAt(0)) ? `<U+${hex(c.codePointAt(0))}>` : c)).join('');
  const lead = chars.slice(0, at).map((c) => (invisibleKind(c.codePointAt(0)) ? `<U+${hex(c.codePointAt(0))}>` : c)).join('').length;
  const from = Math.max(0, lead - 20);
  return `${from > 0 ? '...' : ''}${shown.slice(from, from + 60)}${shown.length > from + 60 ? '...' : ''}`;
}

/** Every invisible code point in a text: [{ line, column, codePoint, kind, name, escaped, context }], 1-based, column in code points. */
export function scanText(text) {
  const found = [];
  text.split('\n').forEach((raw, i) => {
    const chars = [...raw.endsWith('\r') ? raw.slice(0, -1) : raw];
    chars.forEach((ch, col) => {
      const cp = ch.codePointAt(0);
      if (cp < 0x80) return; // ASCII has no Cf, Co or Cn
      const kind = invisibleKind(cp);
      if (kind === null) return;
      const name = describe(cp);
      found.push({
        line: i + 1,
        column: col + 1,
        codePoint: cp,
        kind,
        name,
        escaped: `U+${hex(cp)}`,
        context: context(chars, col),
      });
    });
  });
  return found;
}

/** Root-relative paths (forward slashes) of the files to scan. */
export function listFiles(root) {
  const out = new Set();
  if (existsSync(join(root, '.git'))) {
    const r = spawnSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status === 0) {
      for (const rel of r.stdout.split('\0').filter(Boolean)) if (existsSync(join(root, rel)) && statSync(join(root, rel)).isFile()) out.add(rel);
      return [...out].sort();
    }
  }
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_WALK.has(e.name)) walk(full); } else if (e.isFile()) out.add(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root);
  return [...out].sort();
}

/** Scan a checkout: [{ file, line, column, rule, message }], rule invisible-unicode or invalid-utf8. */
export function scanTree(root) {
  const findings = [];
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }); // ignoreBOM keeps a leading U+FEFF in the text
  for (const file of listFiles(root)) {
    const bytes = readFileSync(join(root, file));
    if (bytes.subarray(0, 8000).includes(0)) continue; // binary
    let text;
    try {
      text = decoder.decode(bytes);
    } catch {
      findings.push({ file, line: 1, column: 1, rule: 'invalid-utf8', message: 'text file that is not valid UTF-8' });
      continue;
    }
    for (const f of scanText(text)) {
      const label = f.name ? `${f.name} (${f.kind === 'tag' ? 'Cf' : f.kind})` : `(${f.kind})`;
      findings.push({ file, line: f.line, column: f.column, rule: 'invisible-unicode', message: `${f.escaped} ${label} in "${f.context}"` });
    }
  }
  return findings;
}

export function main(argv, env = process.env) {
  const quiet = argv.includes('--quiet');
  const rest = argv.filter((a) => a !== '--quiet');
  if (rest.some((a) => a.startsWith('-')) || rest.length > 1) { console.error('usage: node scripts/scan-unicode.mjs [--quiet] [root]'); return 2; }
  const root = resolve(rest[0] ?? env.AGENT_UNREAL_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
  if (!existsSync(root) || !statSync(root).isDirectory()) { console.error(`scan-unicode: ${root} is not a folder`); return 2; }
  const findings = scanTree(root);
  for (const f of findings) console.log(`${f.file}:${f.line}:${f.column}: ${f.rule}: ${f.message}`);
  if (findings.length > 0 || !quiet) console.log(`scan-unicode: ${findings.length === 0 ? 'ok' : `${findings.length} finding(s)`}`);
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
