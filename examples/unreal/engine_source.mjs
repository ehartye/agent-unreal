#!/usr/bin/env node
// Look up where an Unreal Engine install defines a console variable, a symbol, a module or a file, and print
// install-relative `path:line` citations. No Unreal run, no ripgrep, no dependencies; Node 20.11+.
//
//   node engine_source.mjs --engine "<UE folder>" <query> [--kind cvar|symbol|module|file] [--root <folder under Engine>]...
//                          [--max N] [--json]
//
// Kinds (auto when --kind is left out):
//   cvar    a dotted name such as r.MegaLights.Allowed: the exact TEXT("name") registration, walked back to its declaration
//           (TAutoConsoleVariable, FAutoConsoleVariableRef, FAutoConsoleCommand* or RegisterConsoleVariable*) and forward to
//           its closing parenthesis. Prints path:first-last, the C++ variable (the anchor), type, default, flags and the first
//           help sentence. A trailing * lists every cvar with that prefix. A name that appears only in a comment, in a longer
//           message string or in a lookup such as FindConsoleVariable is not a definition.
//   symbol  a whole-word identifier, one line per hit, ranked declaration, then definition, then use, in path order within a rank,
//           capped by --max (20). The rank is a heuristic read of the hit's own line and what follows it, not a parse: a class,
//           struct or enum name ranks declaration only when its keyword is on that line. Read the printed line before citing a hit. Comments are not searched; `Class::Name` searches the last component.
//   module  a bare name with a matching <Name>.Build.cs: that file plus the nearest ancestor .uplugin, or "engine module".
//   file    a name ending in .h .cpp .inl .cs .uplugin or .ini (or any name given with --kind file): every file with it.
//
// Roots: Engine/Source/Runtime, Engine/Source/Editor, Engine/Plugins/FX, Engine/Plugins/Runtime and Engine/Plugins/Experimental,
// plus any --root. Folders named Intermediate, Binaries, ThirdParty, Saved and Content are skipped below a root (a --root that
// names one of them searches inside it). Content is read from .h, .cpp and .inl files only, through a pooled async reader.
//
// Results go to stdout, notes and a summary to stderr. Paths are relative to the install and use forward slashes.
// Exit 0 found, 1 none, 2 usage, 3 unexpected failure.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_ROOTS = ['Engine/Source/Runtime', 'Engine/Source/Editor', 'Engine/Plugins/FX', 'Engine/Plugins/Runtime', 'Engine/Plugins/Experimental'];
// Generated copies (Intermediate), build output, vendored libraries and assets. Folders named Resources or Documentation are not on
// this list: an engine install keeps real source in them (the Documentation editor module, Launch/Resources/Version.h).
export const SKIP_DIRS = new Set(['Intermediate', 'Binaries', 'ThirdParty', 'Saved', 'Content']);
const CONTENT_EXT = /\.(?:h|cpp|inl)$/;
const FILE_QUERY_EXT = /\.(?:h|cpp|inl|cs|uplugin|ini)$/;
const MAX_DEFAULT = { symbol: 20, file: 20 };

export class UsageError extends Error {}

// ---------------------------------------------------------------------------------------------------------------------------
// Source text helpers

const blank = (s) => s.replace(/[^\r\n]/g, ' ');
const isIdent = (c) => c !== undefined && /[A-Za-z0-9_]/.test(c);
const isHex = (code) => (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Characters a backslash at `at` consumes: the next one, or the next two when it is a CRLF line continuation. */
const skipEscape = (text, at) => (text.charCodeAt(at + 1) === 13 && text.charCodeAt(at + 2) === 10 ? 3 : 2);
const collapse = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * The same text with comments, and (unless keepStrings) the contents of string and character literals, replaced by spaces.
 * Length and line breaks are preserved, so an offset in the result is an offset in the input.
 */
export function maskCode(text, keepStrings = false) {
  const n = text.length, parts = [];
  let i = 0, last = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 47) { // /
      const d = text.charCodeAt(i + 1);
      if (d === 47) {
        let j = i + 2;
        while (j < n) {
          if (text.charCodeAt(j) === 10) {
            const p = text.charCodeAt(j - 1) === 13 ? j - 2 : j - 1;
            if (text.charCodeAt(p) === 92) { j++; continue; } // line continuation
            break;
          }
          j++;
        }
        parts.push(text.slice(last, i), blank(text.slice(i, j)));
        last = i = j;
        continue;
      }
      if (d === 42) {
        let j = text.indexOf('*/', i + 2);
        j = j < 0 ? n : j + 2;
        parts.push(text.slice(last, i), blank(text.slice(i, j)));
        last = i = j;
        continue;
      }
    } else if (c === 34) { // "
      const prev = text[i - 1];
      if (prev === 'R' && !isIdent(text[i - 2] === undefined ? undefined : text[i - 2].replace(/[LuU8]/, ''))) {
        const m = /^[^ ()\\\t\v\f\r\n]{0,16}\(/.exec(text.slice(i + 1, i + 20));
        if (m) {
          const delim = m[0].slice(0, -1);
          let j = text.indexOf(`)${delim}"`, i + 1 + m[0].length);
          j = j < 0 ? n : j + delim.length + 2;
          if (!keepStrings) parts.push(text.slice(last, i + 1), blank(text.slice(i + 1, j - 1)), '"');
          else parts.push(text.slice(last, j));
          last = i = j;
          continue;
        }
      }
      let j = i + 1;
      while (j < n) { const e = text.charCodeAt(j); if (e === 92) { j += skipEscape(text, j); continue; } if (e === 34 || e === 10) break; j++; }
      if (j > n) j = n;
      if (!keepStrings) parts.push(text.slice(last, i + 1), blank(text.slice(i + 1, j)));
      else parts.push(text.slice(last, j));
      last = j;
      i = text.charCodeAt(j) === 34 ? j + 1 : j;
      continue;
    } else if (c === 39) { // '
      if (isHex(text.charCodeAt(i - 1)) && isHex(text.charCodeAt(i + 1))) { i++; continue; } // digit separator
      let j = i + 1;
      while (j < n) { const e = text.charCodeAt(j); if (e === 92) { j += skipEscape(text, j); continue; } if (e === 39 || e === 10) break; j++; }
      if (j > n) j = n;
      if (!keepStrings) parts.push(text.slice(last, i + 1), blank(text.slice(i + 1, j)));
      else parts.push(text.slice(last, j));
      last = j;
      i = text.charCodeAt(j) === 39 ? j + 1 : j;
      continue;
    }
    i++;
  }
  parts.push(text.slice(last));
  return parts.join('');
}

/** Index of the bracket that closes the one at `open` in masked text, or -1. */
export function matchClose(masked, open) {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked.charCodeAt(i);
    if (c === 40 || c === 91 || c === 123) depth++;
    else if (c === 41 || c === 93 || c === 125) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** The top-level arguments between `open` and `close`, as trimmed slices of `text` (commas inside brackets, strings and comments do not split). */
export function splitArgs(masked, text, open, close) {
  const args = [];
  let depth = 0, start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const c = masked.charCodeAt(i);
    if (c === 40 || c === 91 || c === 123) depth++;
    else if (c === 41 || c === 93 || c === 125) depth--;
    else if (c === 44 && depth === 0) { args.push(text.slice(start, i)); start = i + 1; }
  }
  args.push(text.slice(start, close));
  const trimmed = args.map((a) => a.replace(/^[ \t]*#.*$/gm, '').trim());
  return trimmed.length === 1 && trimmed[0] === '' ? [] : trimmed;
}

function lineIndex(text) {
  const nl = [];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) nl.push(i);
  return (idx) => {
    let lo = 0, hi = nl.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (nl[mid] < idx) lo = mid + 1; else hi = mid; }
    return lo + 1;
  };
}

const unescapeC = (s) => s.replace(/\\\r?\n/g, '').replace(/\\(.)/g, (_, ch) => ({ n: '\n', t: '\t', r: '', '"': '"', "'": "'", '\\': '\\' })[ch] ?? ch);
const stringLiterals = (s) => [...s.matchAll(/"((?:[^"\\\n]|\\(?:\r\n|[\s\S]))*)"/g)].map((m) => unescapeC(m[1]));

function firstSentence(strings) {
  const lines = strings.join('').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  const m = /^(.*?[.!?])(?:\s|$)/.exec(lines[0]);
  const sentence = collapse(m ? m[1] : lines[0]);
  return sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Console variables

const CVAR_TYPE = /^[TF]AutoConsole\w*$/;
const CONSOLE_TYPE = /ConsoleVariable|ConsoleCommand|ConsoleObject|AutoConsole|CVar/i;
const REGISTER = /^Register(?:ConsoleVariable|ConsoleVariableRef|ConsoleCommand)$/;
const REGISTER_LIKE = /^(?:Register|Create|Make|Add|Define|Declare)\w*(?:ConsoleVariable|ConsoleCommand|ConsoleObject|CVar|Cmd)\w*$/;
const LOOKUP = /^(?:Find|Get|Is|Set|Has|Unregister|Remove)/;
const NOT_A_TYPE = /^(?:return|else|case|goto|delete|throw|new|using|typedef|co_return|if|while|for|do)$/;

function skipWsBack(s, i) { while (i >= 0 && /\s/.test(s[i])) i--; return i; }
function identBack(s, end) { let i = end; while (i >= 0 && /[\w:]/.test(s[i])) i--; return i + 1; }
function openAngleBack(s, close) {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (s[i] === '>') depth++;
    else if (s[i] === '<') { depth--; if (depth === 0) return i; }
    else if (s[i] === ';' || s[i] === '{' || s[i] === '}') return -1;
  }
  return -1;
}

/** The initial value (and declared type) of `expr` when a same-file declaration with an initialiser exists, else null. */
function resolveInitialiser(masked, clean, expr) {
  const v = expr.replace(/^[&*\s]+/, '').trim();
  if (!/^[A-Za-z_][\w:]*$/.test(v)) return null;
  const re = new RegExp(`(?<![\\w:.>])${esc(v)}(?!\\w)`, 'g');
  for (const m of masked.matchAll(re)) {
    const end = m.index + v.length;
    const lineStart = masked.lastIndexOf('\n', m.index - 1) + 1;
    const tm = /^[ \t]*(?:(?:static|extern|const|constexpr|inline|volatile|thread_local|mutable)[ \t]+)*([A-Za-z_][\w:]*(?:<[^<>;]*>)?(?:[ \t]+[A-Za-z_][\w:]*(?:<[^<>;]*>)?)*(?:[ \t]*[*&]+)?)[ \t]+$/.exec(masked.slice(lineStart, m.index));
    if (!tm || NOT_A_TYPE.test(tm[1].split(/\s/)[0])) continue;
    const im = /^\s*(?:=(?!=)([^;]*)|\{([^;{}]*)\})\s*;/d.exec(masked.slice(end, end + 800));
    if (!im) continue;
    const g = im[1] !== undefined ? 1 : 2;
    const value = collapse(clean.slice(end + im.indices[g][0], end + im.indices[g][1]));
    if (value) return { type: collapse(tm[1]), value };
  }
  return null;
}

const inferType = (arg) => {
  if (/^-?\d+$/.test(arg)) return 'int';
  if (/^-?(?:\d+\.\d*|\.\d+)f?$/.test(arg)) return 'float';
  if (/^(?:true|false)$/.test(arg)) return 'bool';
  if (/^(?:TEXT\s*\(|")/.test(arg)) return 'string';
  return '?';
};

const typed = (typeName, typeArg, anchor, start) => {
  const kind = /Command/.test(typeName) ? 'command' : /Ref/.test(typeName) ? 'ref' : /^[TF]AutoConsoleVariable$/.test(typeName) ? 'variable' : null;
  return kind ? { kind, typeName, typeArg, anchor, start } : { unparsed: true, typeName, start };
};

/**
 * What encloses the TEXT("name") literal whose opening bracket is at `open`: a registration form (`kind` variable, ref or command),
 * a lookup, a console-named construct the parser does not know (`unparsed`), or nothing relevant (null).
 */
function formAt(masked, open) {
  const q = skipWsBack(masked, open - 1);
  if (q < 0) return null;
  if (masked[q] === '>') { // Type<Arg>(TEXT(...)) or MakeUnique<Type>(TEXT(...))
    const lt = openAngleBack(masked, q);
    if (lt < 0) return null;
    const r = skipWsBack(masked, lt - 1);
    if (r < 0 || !isIdent(masked[r])) return null;
    const s = identBack(masked, r);
    const name = masked.slice(s, r + 1).split('::').pop();
    const inner = masked.slice(lt + 1, q).trim();
    const innerType = inner.split(/[\s<]/)[0].split('::').pop();
    if (CVAR_TYPE.test(name)) return typed(name, inner, null, s);
    return CVAR_TYPE.test(innerType) ? typed(innerType, null, null, s) : null;
  }
  if (!isIdent(masked[q])) return null;
  const chainStart = identBack(masked, q);
  const chain = masked.slice(chainStart, q + 1);
  const callee = chain.split('::').pop();
  if (REGISTER.test(callee)) {
    return { kind: /Command/.test(callee) ? 'command' : /Ref/.test(callee) ? 'ref' : 'variable', typeName: callee, typeArg: null, anchor: registerAnchor(masked, chainStart), start: chainStart };
  }
  if (CVAR_TYPE.test(callee)) return typed(callee, null, null, chainStart); // a temporary: new Type(TEXT(...))
  // A declaration: [Type<Arg>] Name(TEXT(...))
  let r = skipWsBack(masked, chainStart - 1), typeArg = null;
  if (masked[r] === '>') {
    const lt = openAngleBack(masked, r);
    if (lt >= 0) { typeArg = masked.slice(lt + 1, r).trim(); r = skipWsBack(masked, lt - 1); }
  }
  let typeName = null, typeStart = -1;
  if (r >= 0 && isIdent(masked[r])) { typeStart = identBack(masked, r); typeName = masked.slice(typeStart, r + 1).split('::').pop(); }
  if (typeName && CVAR_TYPE.test(typeName)) return typed(typeName, typeArg, chain, typeStart);
  if (typeName && CONSOLE_TYPE.test(typeName)) return { unparsed: true, typeName, start: typeStart };
  if (LOOKUP.test(callee)) return { lookup: true };
  if (REGISTER_LIKE.test(callee)) return { unparsed: true, typeName: callee, start: chainStart };
  return null;
}

const flagsFrom = (arg) => arg.split(/\|(?!\|)/)
  .map((piece) => { const t = /(?:\w+::)*ECVF_\w+/.exec(piece); return t ? t[0] : collapse(piece.replace(/[\\()]/g, ' ')); })
  .filter(Boolean).join('|');

/**
 * What the TEXT("name") literal at `lit` is: a registration (an object with the parsed fields), a lookup ({ lookup: true }),
 * or not a console-variable context at all (null). A console-named construct the parser does not know comes back
 * `unparsed` with its location, never dropped.
 */
function definitionAt(ctx, lit) {
  const { masked, clean, lineAt } = ctx;
  const open = skipWsBack(masked, lit.index - 1);
  if (masked[open] !== '(' && masked[open] !== '{') return null;
  const form = formAt(masked, open);
  if (!form) return null;
  if (form.lookup) return { lookup: true };
  const first = lineAt(form.start);
  const close = matchClose(masked, open);
  const last = close < 0 ? first : lineAt(close);
  if (form.unparsed || close < 0) return { unparsed: true, first, last, form: form.typeName };
  const args = splitArgs(masked, clean, open, close);
  const maskedArgs = splitArgs(masked, masked, open, close); // strings blanked, so a flag named in help text is not a flag
  const stringy = (a) => /\bTEXT\s*\(|^\s*"/.test(a);
  const helpArg = args.slice(form.kind === 'command' ? 1 : 2).find(stringy);
  let flags = null;
  if (form.kind !== 'command') {
    let at = -1;
    for (let i = maskedArgs.length - 1; i >= 2 && at < 0; i--) if (maskedArgs[i].includes('ECVF_')) at = i;
    flags = at >= 0 ? flagsFrom(maskedArgs[at]) : 'ECVF_Default (omitted)';
  }
  const out = { first, last, form: form.typeName, anchor: form.anchor || '-', help: helpArg ? firstSentence(stringLiterals(helpArg)) : '', flags };
  if (form.kind === 'command') return { ...out, type: 'command', default: null };
  if (form.kind === 'ref') {
    const refVar = (args[1] || '').replace(/^&\s*/, '');
    const resolved = resolveInitialiser(masked, clean, refVar);
    return { ...out, type: resolved ? resolved.type : '?', default: resolved ? resolved.value : `ref ${collapse(refVar)}, default not resolved` };
  }
  const def = collapse(args[1] || '?');
  return { ...out, type: form.typeArg ? collapse(form.typeArg) : inferType(def), default: def };
}

function registerAnchor(masked, calleeStart) {
  const segStart = Math.max(masked.lastIndexOf(';', calleeStart), masked.lastIndexOf('{', calleeStart), masked.lastIndexOf('}', calleeStart)) + 1;
  const m = /([A-Za-z_]\w*)\s*=(?!=)[^=;]*$/.exec(masked.slice(segStart, calleeStart));
  return m ? m[1] : null;
}

/**
 * Every console variable or command registered under a TEXT("name") literal that matches `{ name, prefix, ignoreCase }`.
 * Returns `{ defs, lookups }`: lookups counts exact-literal uses that are not registrations.
 */
export function findCvarDefinitions(text, rel, { name, prefix = false, ignoreCase = false }) {
  const masked = maskCode(text), clean = maskCode(text, true);
  const ctx = { masked, clean, lineAt: lineIndex(text) };
  const want = ignoreCase ? name.toLowerCase() : name;
  const defs = [];
  let lookups = 0;
  for (const m of clean.matchAll(/\bTEXT\s*\(\s*"((?:[^"\\\n]|\\.)*)"\s*\)/g)) {
    if (masked[m.index] !== 'T') continue;
    const lit = ignoreCase ? m[1].toLowerCase() : m[1];
    if (prefix ? !lit.startsWith(want) : lit !== want) continue;
    const d = definitionAt(ctx, { index: m.index });
    if (!d) continue;
    if (d.lookup) { lookups++; continue; }
    defs.push({ kind: 'cvar', path: rel, name: m[1], ...d });
  }
  return { defs, lookups };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Symbols

const RANK = { declaration: 0, definition: 1, use: 2 };
const TYPE_INTRO = /\b(?:class|struct|union|enum(?:\s+(?:class|struct))?|namespace|concept)\s+(?:(?:[A-Z][A-Z0-9_]*|\[\[[^\]]*\]\])\s+)*$/;

/** `s` with every ALL_CAPS macro call, `alignas(...)` and `__declspec(...)` replaced by a space, however deeply their parentheses nest, so `class UE_EXPERIMENTAL(5.0, "x") FName` reads `class  FName`. */
function dropMacroCalls(s) {
  let out = '', at = 0;
  for (const m of s.matchAll(/\b(?:[A-Z][A-Z0-9_]*|alignas|__declspec)[ \t]*\(/g)) {
    if (m.index < at) continue;
    const close = matchClose(s, m.index + m[0].length - 1);
    if (close < 0) continue;
    out += `${s.slice(at, m.index)} `;
    at = close + 1;
  }
  return out + s.slice(at);
}
const QUALIFIER = /^\s*(?:const\b|volatile\b|noexcept\b(?:\s*\([^()]*\))?|override\b|final\b|mutable\b|&&|&|=\s*0\b|=\s*default\b|=\s*delete\b|\[\[[^\]]*\]\]|[A-Z][A-Z0-9_]*(?:\([^()]*\))?)/;
const STATEMENT_KEYWORD = /(?:^|\s)(?:return|else|new|delete|throw|case|goto|co_return|co_await|co_yield|sizeof|typeof|typeid|do|and|or|not|noexcept|decltype|if|while|for|switch|using|namespace)$/;

function functionTail(masked, from) {
  let rest = masked.slice(from, from + 400);
  for (;;) {
    const m = QUALIFIER.exec(rest);
    if (!m) break;
    rest = rest.slice(m[0].length);
  }
  if (/^\s*(?:\{|:(?!:)|try\b)/.test(rest)) return 'body';
  if (/^\s*;/.test(rest)) return 'semi';
  return 'other';
}

/** The text after the `<...>` argument list that opens at `open` in `s`, or a marker that matches nothing when the list does not close. */
function afterAngles(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '<') depth++;
    else if (c === '>') { depth--; if (depth === 0) return s.slice(i + 1); }
    else if (c === ';' || c === '{' || c === '}') break;
  }
  return '?';
}

/** True when `prefix` reads as type words: names, scope, `*`, `&`, brackets and `<...>` argument lists that balance (so `Out <<` is not one). */
function isTypeText(prefix) {
  let s = prefix.replace(/^\s*>+/, ''), before; // a list that opened on an earlier line closes at the start of this one
  do { before = s; s = s.replace(/<[^<>]*>/g, ''); } while (s !== before);
  return /^[\w:,*&\s[\]]*$/.test(s);
}

/** 'declaration' | 'definition' | 'use' (plus `forward` for a forward declaration) for the whole-word hit of `len` characters at `idx`. */
function classifyHit(masked, idx, len, isHeader) {
  const lineStart = masked.lastIndexOf('\n', idx - 1) + 1;
  const before = masked.slice(lineStart, idx);
  const afterAt = idx + len;
  const after = masked.slice(afterAt, afterAt + 400);
  if (/^\s*#\s*define\s+$/.test(before)) return { rank: 'declaration' };
  // A name after `friend`, in a base list (`class D : public Base`, `, public Base`, `public Base,` on its own line), in a constructor
  // initialiser list or after a case label is a use of the name; the colon, comma or access keyword in front of it gives that away.
  const lead = before.replace(/^\s*(?:public|protected|private)\s*:(?!:)/, '');
  if (/\bfriend\b/.test(lead) || /^\s*,/.test(lead) || /(?<!:):(?!:)/.test(lead) || /\b(?:public|protected|private|virtual)\s*$/.test(lead)) return { rank: 'use' };
  if (/\busing\s+namespace\s+(?:\w+\s*::\s*)*$/.test(before)) return { rank: 'use' };
  // A name that opens its line continues the line above when that one ends in a comma, or in a colon after a closing parenthesis
  // (a constructor initialiser list written with the colon last).
  if (/^\s*$/.test(before) && /(?:,|\)[ \t\w]*:)\s*$/.test(masked.slice(Math.max(0, lineStart - 600), lineStart))) return { rank: 'use' };
  if (TYPE_INTRO.test(dropMacroCalls(before))) {
    if (/\btemplate\s+(?:class|struct)\s/.test(before)) return { rank: 'use' }; // an explicit instantiation
    const angle = /^\s*</.exec(after);
    const rest = angle ? afterAngles(after, angle[0].length - 1) : after; // `class X<Arg>` is a specialisation only when what follows the arguments reads like one
    // A forward declaration ends at the name (`class X;`) or, for an opaque enum, after its underlying type (`enum class E : uint8;`).
    return /^\s*(?:;|:(?!:)|\{|final\b|sealed\b|$)/.test(rest) ? { rank: 'declaration', forward: /^\s*(?:;|:(?!:)[^;{}]*;)/.test(rest) } : { rank: 'use' };
  }
  if (/\busing\s+$/.test(before) && /^\s*=/.test(after)) return { rank: 'declaration' };
  if (/\btypedef\b/.test(before) && /^\s*(?:;|\[)/.test(after)) return { rank: 'declaration' };

  const qm = /((?:[A-Za-z_]\w*(?:<[^<>]*>)?\s*::\s*)+)$/.exec(before);
  const qual = qm ? qm[1] : '';
  const prefix = before.slice(0, before.length - qual.length)
    .replace(/\b(?:__declspec|alignas|UE_DEPRECATED|DEPRECATED)\s*\([^()]*\)/g, '').trim();
  const typed = prefix !== '' && isTypeText(prefix) && !STATEMENT_KEYWORD.test(prefix);
  if (/^\s*\(/.test(after)) {
    const open = masked.indexOf('(', afterAt);
    const close = matchClose(masked, open);
    const tail = close < 0 ? 'other' : functionTail(masked, close + 1);
    if (tail === 'body' && (typed || qual || prefix === '')) return { rank: 'definition' };
    if (tail === 'semi' && typed) return { rank: 'declaration' };
    return { rank: 'use' };
  }
  if (typed && /^\s*(?:=(?!=)|;|\{|\[|:\s*\d)/.test(after)) {
    if (/\bextern\b/.test(prefix) || isHeader) return { rank: 'declaration' };
    if (before.length === before.trimStart().length) return { rank: 'definition' };
  }
  return { rank: 'use' };
}

/**
 * Whole-word hits of `symbol` in code and in string literals (not in comments), one per line, each ranked. A mention inside a
 * string literal, such as a node registered by name, is a 'use' flagged `string` and listed after the code uses.
 */
export function findSymbolHits(text, rel, symbol) {
  const masked = maskCode(text), clean = maskCode(text, true);
  const lineAt = lineIndex(text);
  const isHeader = rel.endsWith('.h');
  const re = new RegExp(`(?<![A-Za-z0-9_])${esc(symbol)}(?![A-Za-z0-9_])`, 'g');
  const byLine = new Map();
  const order = (h) => RANK[h.rank] * 4 + (h.forward ? 1 : 0) + (h.string ? 2 : 0);
  for (const m of clean.matchAll(re)) {
    const string = masked[m.index] === ' ';
    if (string && /^\s*#\s*include\b/.test(clean.slice(clean.lastIndexOf('\n', m.index - 1) + 1, m.index))) continue; // a header named like the symbol
    const hit = string ? { rank: 'use', string: true } : classifyHit(masked, m.index, symbol.length, isHeader);
    const line = lineAt(m.index);
    const prev = byLine.get(line);
    if (prev && order(prev) <= order(hit)) continue;
    const start = text.lastIndexOf('\n', m.index - 1) + 1;
    let end = text.indexOf('\n', m.index);
    if (end < 0) end = text.length;
    const src = collapse(text.slice(start, end));
    byLine.set(line, { kind: 'symbol', path: rel, line, rank: hit.rank, forward: !!hit.forward, string: !!hit.string, text: src.length > 140 ? `${src.slice(0, 137)}...` : src });
  }
  return [...byLine.values()];
}

// ---------------------------------------------------------------------------------------------------------------------------
// Walking and reading

/** Every file under the roots (install-relative, forward slashes), skipping the generated and third-party folder names below a root. */
export function walkRoots(engineDir, roots) {
  const files = [], seen = new Set(), present = [], absent = [];
  const walk = (abs, rel) => {
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(`${abs}/${e.name}`, `${rel}/${e.name}`); }
      else if (e.isFile()) { const r = `${rel}/${e.name}`; if (!seen.has(r)) { seen.add(r); files.push(r); } }
    }
  };
  for (const rel of roots) {
    const abs = `${engineDir}/${rel}`;
    let dir = false;
    try { dir = statSync(abs).isDirectory(); } catch { /* absent */ }
    if (dir) { present.push(rel); walk(abs, rel); } else absent.push(rel);
  }
  files.sort();
  return { files, present, absent };
}

/**
 * Read `files` (install-relative) with up to `concurrency` reads in flight and hand each buffer to `visit(buf, rel)`.
 * Non-null results come back in file order. A file that cannot be read or parsed is counted, not fatal.
 */
export async function scanContent(files, { engineDir, concurrency = 32, read, visit }) {
  const readFn = read || ((abs) => readFile(abs));
  const slots = new Array(files.length);
  let next = 0, bytes = 0, read_ = 0, unreadable = 0, failed = 0, firstError = null;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= files.length) return;
      let buf;
      try { buf = await readFn(`${engineDir}/${files[i]}`, files[i]); } catch { unreadable++; continue; }
      bytes += buf.length; read_++;
      try { const r = visit(buf, files[i]); if (r !== null && r !== undefined) slots[i] = r; }
      catch (err) { failed++; firstError ??= `${files[i]}: ${err.message}`; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return { results: slots.filter((r) => r !== undefined), bytes, files: read_, unreadable, failed, firstError };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Queries

/** auto -> file for a name with a source extension, cvar for a dotted name, module when a <Name>.Build.cs exists, else symbol. */
export function classifyQuery(query, { isModule = false, kind = 'auto' } = {}) {
  if (kind !== 'auto') return kind;
  if (FILE_QUERY_EXT.test(query)) return 'file';
  if (/^[A-Za-z].*\./.test(query)) return 'cvar';
  if (isModule && /^\w+$/.test(query)) return 'module';
  return 'symbol';
}

function engineRoot(engine) {
  const dir = resolve(engine).split('\\').join('/').replace(/\/+$/, '');
  const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
  if (isDir(`${dir}/Engine`)) return dir;
  throw new UsageError('no Engine folder under the --engine path; pass the Unreal install folder (the one that contains Engine)');
}

function normaliseRoot(engineDir, root) {
  const parts = root.split('\\').join('/').split('/').filter((p) => p && p !== '.');
  if (!parts.length || /^[A-Za-z]:$/.test(parts[0]) || /^[\\/]/.test(root) || parts.includes('..')) {
    throw new UsageError(`--root must be a folder inside the install, relative to it or to Engine (got "${root}")`);
  }
  if (parts[0] !== 'Engine') parts.unshift('Engine');
  const rel = parts.join('/');
  let ok = false;
  try { ok = statSync(`${engineDir}/${rel}`).isDirectory(); } catch { /* missing */ }
  if (!ok) throw new UsageError(`--root folder not found: ${rel}`);
  return rel;
}

function engineVersion(engineDir) {
  try {
    const v = JSON.parse(readFileSync(`${engineDir}/Engine/Build/Build.version`, 'utf8'));
    return `${v.MajorVersion}.${v.MinorVersion}.${v.PatchVersion} (CL ${v.Changelist})`;
  } catch { return null; }
}

function nearestUplugin(engineDir, buildRel) {
  let dir = buildRel.slice(0, buildRel.lastIndexOf('/'));
  while (dir.includes('/')) {
    let names = [];
    try { names = readdirSync(`${engineDir}/${dir}`); } catch { /* unreadable */ }
    const up = names.filter((n) => n.endsWith('.uplugin')).sort()[0];
    if (up) return `${dir}/${up}`;
    dir = dir.slice(0, dir.lastIndexOf('/'));
  }
  return null;
}

const baseName = (rel) => rel.slice(rel.lastIndexOf('/') + 1);

/** Look `query` up. Resolves to `{ kind, query, found, results, more, notes, roots, miss, stats, engineVersion }`; throws UsageError on bad input. */
export async function run({ engine, query, kind = 'auto', roots = [], max, concurrency = 32, read }) {
  if (!engine) throw new UsageError('--engine <UE folder> is required');
  if (!query) throw new UsageError('a query is required');
  if (!['auto', 'cvar', 'symbol', 'module', 'file'].includes(kind)) throw new UsageError(`--kind must be cvar, symbol, module or file (got "${kind}")`);
  if (max !== undefined && !(Number.isInteger(max) && max >= 1)) throw new UsageError('--max must be a positive whole number');
  const engineDir = engineRoot(engine);
  const extra = roots.map((r) => normaliseRoot(engineDir, r));
  const rootList = [...new Set([...DEFAULT_ROOTS, ...extra])];
  const t0 = performance.now();
  const walked = walkRoots(engineDir, rootList);
  const builds = new Map(), buildsLower = new Map();
  for (const f of walked.files) {
    if (!f.endsWith('.Build.cs')) continue;
    const n = baseName(f).slice(0, -'.Build.cs'.length);
    (builds.get(n) ?? builds.set(n, []).get(n)).push(f);
    (buildsLower.get(n.toLowerCase()) ?? buildsLower.set(n.toLowerCase(), []).get(n.toLowerCase())).push(f);
  }
  const chosen = classifyQuery(query, { isModule: builds.has(query), kind });
  const notes = [];
  const stats = { walked: walked.files.length, read: 0, bytes: 0, seconds: 0 };
  const scan = async (list, visit) => {
    const r = await scanContent(list, { engineDir, concurrency, read, visit });
    stats.read += r.files; stats.bytes += r.bytes;
    if (r.unreadable) notes.push(`${r.unreadable} files could not be read`);
    if (r.failed) notes.push(`${r.failed} files could not be parsed (first: ${r.firstError})`);
    return r.results;
  };
  const content = () => walked.files.filter((f) => CONTENT_EXT.test(f));
  let results = [], more = 0;

  if (chosen === 'cvar') {
    const prefix = query.endsWith('*');
    const name = prefix ? query.slice(0, -1) : query;
    if (!name) throw new UsageError('a cvar prefix query needs text before the *');
    let lookups = 0;
    const pass = async (ignoreCase) => {
      const needle = Buffer.from(prefix ? `"${name}` : `"${name}"`);
      const lower = needle.toString('latin1').toLowerCase();
      const hits = await scan(content(), (buf, rel) => {
        if (ignoreCase ? !buf.toString('latin1').toLowerCase().includes(lower) : buf.indexOf(needle) < 0) return null;
        return findCvarDefinitions(buf.toString('utf8'), rel, { name, prefix, ignoreCase });
      });
      const defs = hits.flatMap((h) => h.defs);
      lookups += hits.reduce((n, h) => n + h.lookups, 0);
      return defs;
    };
    results = await pass(false);
    if (!results.length) {
      results = await pass(true);
      if (results.length) notes.push(`no exact-case match for ${query}; showing the case-insensitive match`);
    }
    if (lookups) notes.push(`${lookups} other exact-literal reference${lookups === 1 ? '' : 's'} (lookups, not registrations) not listed`);
    results.sort((a, b) => a.name.localeCompare(b.name, 'en') || a.path.localeCompare(b.path, 'en') || a.first - b.first);
    if (max && results.length > max) { more = results.length - max; results = results.slice(0, max); }
  } else if (chosen === 'symbol') {
    let word = query;
    if (query.includes('::')) { word = query.split('::').pop(); notes.push(`searching the last component, ${word}`); }
    if (!/^[A-Za-z_]\w*$/.test(word)) throw new UsageError('a symbol query must be an identifier (use --kind cvar for a console variable)');
    const needle = Buffer.from(word);
    const hits = (await scan(content(), (buf, rel) => (buf.indexOf(needle) < 0 ? null : findSymbolHits(buf.toString('utf8'), rel, word)))).flat();
    hits.sort((a, b) => RANK[a.rank] - RANK[b.rank] || Number(a.forward) - Number(b.forward) || Number(a.string) - Number(b.string) || a.path.localeCompare(b.path, 'en') || a.line - b.line);
    const cap = max ?? MAX_DEFAULT.symbol;
    more = Math.max(0, hits.length - cap);
    results = hits.slice(0, cap);
    const counts = Object.keys(RANK).map((r) => `${hits.filter((h) => h.rank === r).length} ${r}`);
    if (hits.length) notes.push(`${hits.length} hits: ${counts.join(', ')}`);
  } else if (chosen === 'module') {
    let list = builds.get(query);
    if (!list) {
      list = buildsLower.get(query.toLowerCase());
      if (list) notes.push(`no exact-case ${query}.Build.cs; showing the case-insensitive match`);
    }
    results = (list || []).map((build) => {
      const plugin = nearestUplugin(engineDir, build);
      return { kind: 'module', name: baseName(build).slice(0, -'.Build.cs'.length), build, plugin, pluginName: plugin ? baseName(plugin).slice(0, -'.uplugin'.length) : null };
    });
    if (!results.length) { // a plugin is often named differently from its modules
      for (const descriptor of walked.files.filter((f) => baseName(f) === `${query}.uplugin`)) {
        let modules = [];
        try { modules = (JSON.parse(readFileSync(`${engineDir}/${descriptor}`, 'utf8').replace(/^\uFEFF/, '')).Modules || []).map((m) => m.Name); } catch { /* unreadable descriptor */ }
        notes.push(`${query} is a plugin, not a module: ${descriptor}${modules.length ? `; its modules: ${modules.join(', ')}` : ''}`);
      }
    }
  } else {
    const hasPath = query.includes('/');
    const matches = (f, q) => (hasPath ? f === q || f.endsWith(`/${q}`) : baseName(f) === q);
    let list = walked.files.filter((f) => matches(f, query));
    if (!list.length) {
      const lq = query.toLowerCase();
      list = walked.files.filter((f) => (hasPath ? f.toLowerCase().endsWith(lq) : baseName(f).toLowerCase() === lq));
      if (list.length) notes.push(`no exact-case file named ${query}; showing the case-insensitive match`);
    }
    const cap = max ?? MAX_DEFAULT.file;
    more = Math.max(0, list.length - cap);
    results = list.slice(0, cap).map((path) => ({ kind: 'file', path }));
  }

  stats.seconds = (performance.now() - t0) / 1000;
  const found = results.length > 0;
  const listed = rootList.map((r) => (walked.absent.includes(r) ? `${r} (not present)` : r)).join(', ');
  const skipped = [...SKIP_DIRS];
  const skippedText = `${skipped.slice(0, -1).join(', ')} and ${skipped[skipped.length - 1]}`;
  const miss = found ? null
    : `no ${chosen} "${query}" under the roots searched: ${listed}. Folders named ${skippedText} are skipped. `
      + 'Pass --root <folder under Engine> (for example --root Engine/Plugins/PCG) to search another folder, or one of the skipped folders itself.';
  return { kind: chosen, query, found, results, more, notes, roots: { searched: walked.present, absent: walked.absent }, miss, stats, engineVersion: engineVersion(engineDir) };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Output and command line

export function formatResult(r) {
  if (r.kind === 'file') return r.path;
  if (r.kind === 'module') return `${r.build} | module ${r.name}\n${r.plugin ? `${r.plugin} | plugin ${r.pluginName}` : 'engine module (no plugin descriptor above it)'}`;
  if (r.kind === 'symbol') return `${r.path}:${r.line} | ${r.rank}${r.forward ? ' (forward)' : ''}${r.string ? ' (string)' : ''} | ${r.text}`;
  const loc = `${r.path}:${r.first === r.last ? r.first : `${r.first}-${r.last}`}`;
  if (r.unparsed) return `${loc} | ${r.name} | unparsed (${r.form}); read the lines at this location`;
  const parts = [loc, r.name, r.anchor, r.type];
  if (r.default !== null) parts.push(r.default.startsWith('ref ') ? r.default : `default ${r.default}`);
  if (r.flags !== null) parts.push(`flags ${r.flags}`);
  if (r.help) parts.push(r.help);
  return parts.join(' | ');
}

const USAGE = 'usage: node engine_source.mjs --engine "<UE folder>" <query> [--kind cvar|symbol|module|file] [--root <folder under Engine>]... [--max N] [--json]';

export function parseArgs(argv) {
  const o = { roots: [], json: false, kind: 'auto' };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => { if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`); return argv[++i]; };
    if (a === '--engine') o.engine = value();
    else if (a === '--kind') o.kind = value();
    else if (a === '--root') o.roots.push(value());
    else if (a === '--max') { const v = value(); if (!/^[1-9]\d*$/.test(v)) throw new UsageError('--max must be a positive whole number'); o.max = Number(v); }
    else if (a === '--json') o.json = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a.startsWith('--')) throw new UsageError(`unknown option ${a}`);
    else positional.push(a);
  }
  if (positional.length > 1) throw new UsageError(`one query at a time (got ${positional.length}); quote a query that contains a *`);
  o.query = positional[0];
  return o;
}

export async function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
    if (o.help) { console.error(USAGE); return 0; }
    const r = await run(o);
    if (o.json) console.log(JSON.stringify(r, null, 2));
    else {
      for (const item of r.results) console.log(formatResult(item));
      if (r.more) console.log(`... ${r.more} more (raise --max)`);
    }
    for (const n of r.notes) console.error(n);
    if (r.miss) console.error(r.miss);
    const mb = (r.stats.bytes / 1048576).toFixed(1);
    console.error(`${r.engineVersion ? `UE ${r.engineVersion} | ` : ''}${r.kind} | walked ${r.stats.walked} files in ${r.roots.searched.length} roots, read ${r.stats.read} files (${mb} MB) | ${r.stats.seconds.toFixed(1)} s`);
    return r.found ? 0 : 1;
  } catch (err) {
    if (err instanceof UsageError) { console.error(`engine_source: ${err.message}\n${USAGE}`); return 2; }
    console.error(`engine_source: unexpected failure: ${err.stack || err}`);
    return 3;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.env.UV_THREADPOOL_SIZE ||= '16'; // before the first async file read, so the pooled reader has threads to use
  process.exitCode = await main(process.argv.slice(2));
}
