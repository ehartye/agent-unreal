import { createHash, randomUUID } from 'node:crypto';
import { openSync, closeSync, readSync, writeSync, readFileSync, writeFileSync, statSync, lstatSync, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, dirname, basename } from 'node:path';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = file => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
export const canonical = value => JSON.stringify(value);
export const digest = value => hash(canonical(value));
export const now = () => new Date().toISOString();
export function write(file, value) { writeFileSync(file, canonical(value) + '\n', { flag: 'wx' }); }
export function atomic(file, value) { const temp = `${file}.${randomUUID()}.tmp`; write(temp, value); renameSync(temp, file); }
export function logical(name) {
  if (typeof name !== 'string' || !name || name.length > 240 || /[\\:\x00-\x1f<>"|?*]/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))) throw Error(`Unsafe member path: ${name}`);
  return name;
}
export function safe(path, root) {
  const full = resolve(path);
  if (root) { const rel = relative(resolve(root), full); if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('Path escapes owned root'); }
  for (let p = full; ; p = dirname(p)) { if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw Error('Symlink or junction path refused'); if (dirname(p) === p) break; }
  return full;
}
export function fileIdentity(file) {
  safe(file); const fd = openSync(file, 'r'), sha = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024); let bytes = 0;
  try { let n; while ((n = readSync(fd, buffer)) > 0) { sha.update(buffer.subarray(0, n)); bytes += n; } } finally { closeSync(fd); }
  return { bytes, sha256: sha.digest('hex') };
}
export function inventory(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1).flatMap(entry => {
    const path = logical(prefix ? `${prefix}/${entry.name}` : entry.name), full = safe(join(root, path), root);
    if (entry.isSymbolicLink()) throw Error('Archive symlink refused');
    if (entry.isDirectory()) return inventory(root, path);
    if (!entry.isFile()) throw Error('Archive non-file refused');
    return [{ path, ...fileIdentity(full) }];
  });
}
export function validateInventory(members) {
  if (!Array.isArray(members) || members.length > 100000) throw Error('Invalid archive inventory');
  const names = new Set();
  for (const m of members) {
    logical(m.path); const key = m.path.toLowerCase();
    if (names.has(key) || [...names].some(n => key.startsWith(n + '/') || n.startsWith(key + '/'))) throw Error('Duplicate or conflicting archive member');
    names.add(key);
    if (!Number.isSafeInteger(m.bytes) || m.bytes < 0 || !/^[a-f0-9]{64}$/.test(m.sha256)) throw Error('Invalid archive member identity');
  }
}
// Versioned length-delimited archive. No shell extraction, links, hidden members or metadata restoration.
export function pack(file, members) {
  const list = members.map(({ path, source }) => ({ path, ...fileIdentity(source) })); validateInventory(list);
  const header = Buffer.from(canonical({ version: 1, kind: 'unreal-remote/archive', members: list })), length = Buffer.alloc(8);
  if (header.length > 16 * 1024 * 1024) throw Error('Archive header exceeds bound');
  length.writeBigUInt64BE(BigInt(header.length)); const out = openSync(file, 'wx');
  try {
    writeSync(out, length); writeSync(out, header);
    for (let i = 0; i < members.length; i++) {
      const fd = openSync(members[i].source, 'r'), buffer = Buffer.alloc(1024 * 1024), sha = createHash('sha256'); let bytes = 0;
      try { let n; while ((n = readSync(fd, buffer)) > 0) { writeSync(out, buffer, 0, n); sha.update(buffer.subarray(0, n)); bytes += n; } } finally { closeSync(fd); }
      if (bytes !== list[i].bytes || sha.digest('hex') !== list[i].sha256) throw Error('Archive input changed');
    }
  } finally { closeSync(out); }
  return { ...fileIdentity(file), members: list };
}
export function unpack(file, destination, expected) {
  safe(destination); if (existsSync(destination)) throw Error('Archive destination already exists');
  const fd = openSync(file, 'r');
  const exact = length => { const b = Buffer.alloc(length); let n = 0; while (n < length) { const got = readSync(fd, b, n, length - n); if (!got) throw Error('Truncated archive'); n += got; } return b; };
  try {
    const length = Number(exact(8).readBigUInt64BE()); if (!Number.isSafeInteger(length) || length > 16 * 1024 * 1024) throw Error('Invalid archive header bound');
    const header = JSON.parse(exact(length));
    if (header.version !== 1 || header.kind !== 'unreal-remote/archive') throw Error('Unsupported archive version');
    validateInventory(header.members);
    if (expected && canonical(header.members) !== canonical(expected)) throw Error('Archive member set differs');
    mkdirSync(destination);
    for (const m of header.members) {
      const target = safe(join(destination, m.path), destination); mkdirSync(dirname(target), { recursive: true });
      const out = openSync(target, 'wx'), sha = createHash('sha256'); let remaining = m.bytes;
      try { while (remaining) { const b = exact(Math.min(remaining, 1024 * 1024)); sha.update(b); writeSync(out, b); remaining -= b.length; } } finally { closeSync(out); }
      if (sha.digest('hex') !== m.sha256) throw Error(`Archive bytes changed: ${m.path}`);
    }
    if (readSync(fd, Buffer.alloc(1))) throw Error('Unexpected archive trailing member or bytes');
    return header.members;
  } finally { closeSync(fd); }
}
