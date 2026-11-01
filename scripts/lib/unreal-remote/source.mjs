import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, lstatSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { sourceIdentity } from '../unreal-run/identity.mjs';
import { validateManifest, OBSERVATIONS } from '../unreal-verify/manifest.mjs';
import { logical, safe, fileIdentity, canonical, json, digest } from './files.mjs';

export function git(root, args, options = {}) {
  for (const name of ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) if (process.env[name]) throw Error('Ambient Git metadata override refused');
  return execFileSync('git', ['--no-optional-locks', '-C', root, ...args], { windowsHide: true, timeout: 120000, maxBuffer: 64 * 1024 * 1024, ...options });
}
export function ignored(root, path) {
  const full = safe(resolve(root, path), root), rel = relative(root, full).replaceAll('\\', '/');
  if (git(root, ['ls-files', '-z', '--', rel]).length) throw Error('Local configuration, state and output must not be tracked');
  try { git(root, ['check-ignore', '--no-index', '--', existsSync(full) ? rel : rel + '/']); } catch { throw Error('Local configuration, state and output must be Git-ignored'); }
  return full;
}
export function pointers(root, commit) {
  const entries = git(root, ['ls-tree', '-r', '-l', '-z', commit]).toString().split('\0').filter(Boolean).map(row => {
    const match = /^(\d+) blob ([a-f0-9]+)\s+(\d+)\t(.+)$/.exec(row);
    if (!match || !['100644', '100755'].includes(match[1])) throw Error('Remote source requires regular tracked files; submodules and symlinks are unsupported');
    logical(match[4]); return { oid: match[2], bytes: Number(match[3]), path: match[4] };
  });
  const small = entries.filter(e => e.bytes <= 1024), input = small.map(e => e.oid + '\n').join('');
  if (!small.length) return [];
  const output = git(root, ['cat-file', '--batch'], { input }); let offset = 0; const lfs = [];
  for (const entry of small) {
    const end = output.indexOf(10, offset); if (end < 0) throw Error('Malformed Git object stream');
    const header = output.subarray(offset, end).toString().split(' '); offset = end + 1;
    if (header[0] !== entry.oid || header[1] !== 'blob' || Number(header[2]) !== entry.bytes) throw Error('Git object binding differs');
    const content = output.subarray(offset, offset + entry.bytes).toString(); offset += entry.bytes + 1;
    if (content.startsWith('version https://git-lfs.github.com/spec/v1')) {
      const match = /^version https:\/\/git-lfs.github.com\/spec\/v1\noid sha256:([a-f0-9]{64})\nsize (\d+)\n?$/.exec(content);
      if (!match || !Number.isSafeInteger(Number(match[2]))) throw Error('Unsupported LFS pointer');
      lfs.push({ path: entry.path, oid: match[1], bytes: Number(match[2]) });
    }
  }
  return lfs;
}
export function lfsStorage(root) {
  let version; try { version = git(root, ['config', '--includes', '--local', '--null', '--get-all', 'lfs.repositoryformatversion']); } catch { throw Error('Existing local lfs.repositoryformatversion=0 required; source configuration was not changed'); }
  if (!version.equals(Buffer.from('0\0'))) throw Error('Exactly one existing local lfs.repositoryformatversion=0 required');
  // Endpoint output can contain credentials. Never retain or print it.
  let output; try { output = git(root, ['lfs', 'env']).toString(); } catch { throw Error('Cannot determine effective LFS storage (output withheld)'); }
  const matches = output.split(/\r?\n/).filter(s => s.startsWith('LocalMediaDir='));
  if (matches.length !== 1) throw Error('Unknown effective LFS storage');
  return safe(matches[0].slice(14));
}
export function snapshot(root, commit, manifest, suite, { storage = lfsStorage } = {}) {
  root = safe(root);
  if (resolve(git(root, ['rev-parse', '--show-toplevel']).toString().trim()) !== root) throw Error('Source must be the exact repository root');
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Start requires a full exact commit');
  // Raw object reads precede status: LFS filters can otherwise initialize shared source configuration.
  const lfs = pointers(root, commit);
  const media = lfs.length ? storage(root) : undefined;
  const source = sourceIdentity({ sourceRoot: root });
  if (source.dirty || source.commit !== commit) throw Error('Source must be clean and checked out at the exact requested commit');
  const tree = git(root, ['rev-parse', `${commit}^{tree}`]).toString().trim();
  const tracked = new Set(git(root, ['ls-files', '-z']).toString().split('\0').filter(Boolean));
  logical(manifest); if (!tracked.has(manifest)) throw Error('Manifest must be committed source');
  const document = json(safe(join(root, manifest), root)), plan = validateManifest(document, suite);
  const inputs = [manifest, ...document.steps.filter(s => OBSERVATIONS.includes(s.kind)).map(s => relative(root, resolve(root, dirname(manifest), s.input)).replaceAll('\\', '/'))].map(path => {
    logical(path); if (!tracked.has(path)) throw Error('Suite inputs must be committed source');
    return { path, ...fileIdentity(safe(join(root, path), root)) };
  });
  if (lfs.length) {
    for (const object of lfs) {
      const file = join(media, object.oid.slice(0, 2), object.oid.slice(2, 4), object.oid);
      if (!existsSync(file)) throw Error(`Required LFS object is missing: ${object.oid}`);
      const cached = fileIdentity(file), checkedOut = fileIdentity(join(root, object.path));
      if (cached.bytes !== object.bytes || cached.sha256 !== object.oid || canonical(cached) !== canonical(checkedOut)) throw Error('Required LFS object is corrupt or source is not hydrated');
    }
  }
  const config = name => { try { return git(root, ['config', '--get', name]).toString().trim(); } catch { return null; } };
  return { identity: { ...source, tree, lfs, inputs, checkout: { autocrlf: config('core.autocrlf') ?? 'false', eol: config('core.eol') ?? 'native' } }, media, plan };
}
export function createBundle(root, commit, destination) {
  // HEAD is a named ref in the bundle, unlike a bare unadvertised object ID.
  git(root, ['bundle', 'create', destination, 'HEAD']);
  const heads = git(root, ['bundle', 'list-heads', destination]).toString().trim();
  if (heads !== `${commit} HEAD`) throw Error('Bundle advertised revision differs');
}
// Internal filesystem boundary for newly owned, hydrated worktrees only.
export function normalizeHydratedLfs(worktree, tree, accepted) {
  if (!accepted.length) return;
  const requireTree = phase => {
    if (git(worktree, ['write-tree']).toString().trim() !== tree) throw Error(`Remote indexed tree differs ${phase} LFS normalization`);
  };
  const requireBytes = () => {
    for (const m of accepted) {
      const destination = safe(join(worktree, logical(m.path)), worktree);
      if (!lstatSync(destination).isFile()) throw Error('Hydrated LFS destination is not a regular file');
      const identity = fileIdentity(destination);
      if (identity.bytes !== m.bytes || identity.sha256 !== m.oid) throw Error('Hydrated LFS object differs');
    }
  };
  requireTree('before'); requireBytes();
  git(worktree, ['--literal-pathspecs', 'add', '--renormalize', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: Buffer.from(accepted.map(m => m.path + '\0').join(''), 'utf8') });
  requireTree('after'); requireBytes();
}
export function materialize(base, request, payload) {
  const repo = join(base, 'repository.git'), worktree = join(base, 'repository-worktrees', request.job);
  if (!existsSync(repo)) { mkdirSync(repo); git(repo, ['init', '--bare']); git(repo, ['config', 'lfs.repositoryformatversion', '0']); }
  if (existsSync(worktree)) throw Error('Owned worktree already exists without accepted request');
  git(repo, ['bundle', 'verify', join(payload, 'source.bundle')]);
  const heads = git(repo, ['bundle', 'list-heads', join(payload, 'source.bundle')]).toString().trim();
  if (heads !== `${request.source.commit} HEAD`) throw Error('Bundle advertised revision differs');
  git(repo, ['fetch', '--no-tags', join(payload, 'source.bundle'), `HEAD:refs/remote-jobs/${request.job}`]);
  for (const [key, expected] of Object.entries({ 'core.autocrlf': request.source.checkout.autocrlf, 'core.eol': request.source.checkout.eol })) if (git(repo, ['config', '--get', key]).toString().trim() !== expected) throw Error('Owned repository checkout policy differs; use a fresh remote root without changing retained jobs');
  mkdirSync(dirname(worktree), { recursive: true });
  git(repo, ['worktree', 'add', '--detach', worktree, request.source.commit], { env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' } });
  const actualPointers = pointers(worktree, request.source.commit);
  if (canonical(actualPointers) !== canonical(request.source.lfs)) throw Error('Remote LFS pointer set differs');
  if (actualPointers.length) {
    const media = lfsStorage(worktree);
    for (const m of actualPointers) {
      const source = safe(join(payload, 'lfs', m.oid), payload), identity = fileIdentity(source);
      if (identity.bytes !== m.bytes || identity.sha256 !== m.oid) throw Error('Transferred LFS object differs');
      const object = safe(join(media, m.oid.slice(0, 2), m.oid.slice(2, 4), m.oid), media); mkdirSync(dirname(object), { recursive: true });
      if (existsSync(object)) { if (canonical(fileIdentity(object)) !== canonical(identity)) throw Error('Existing owned LFS cache differs'); }
      else cpSync(source, object, { errorOnExist: true, force: false });
      cpSync(source, safe(join(worktree, m.path), worktree));
    }
    normalizeHydratedLfs(worktree, request.source.tree, actualPointers);
  }
  const observed = sourceIdentity({ sourceRoot: worktree });
  if (observed.dirty || observed.commit !== request.source.commit || observed.snapshot !== request.source.snapshot || git(worktree, ['rev-parse', 'HEAD^{tree}']).toString().trim() !== request.source.tree) throw Error('Remote source commit/tree/snapshot differs');
  for (const m of request.source.inputs) if (canonical(fileIdentity(join(worktree, m.path))) !== canonical({ bytes: m.bytes, sha256: m.sha256 })) throw Error('Remote input differs');
  return worktree;
}
