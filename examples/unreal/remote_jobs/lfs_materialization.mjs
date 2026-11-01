// Separate manual integration lane: installed Git + Git LFS, no engine or network.
import assert from 'node:assert/strict';
import { mkdirSync, existsSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { git, snapshot, createBundle, materialize } from '../../../scripts/lib/unreal-remote/source.mjs';
import { sourceIdentity } from '../../../scripts/lib/unreal-run/identity.mjs';
import { json, fileIdentity, hash } from '../../../scripts/lib/unreal-remote/files.mjs';

const script = fileURLToPath(import.meta.url);
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const quote = value => "'" + value.replaceAll('\\', '/').replaceAll("'", "'\\''") + "'";

async function runCase(specFile) {
  const spec = json(specFile), worktree = join(spec.base, 'repository-worktrees', spec.request.job);
  let result;
  try {
    const implementation = spec.baseline ? (await import(pathToFileURL(spec.baseline).href)).materialize : materialize;
    implementation(spec.base, spec.request, spec.payload);
    result = { verdict: 'accepted', refusal: null };
  } catch (error) {
    // Only the parent decides whether this exact refusal was expected.
    result = { verdict: 'refused', refusal: error.message, stack: error.stack };
  }
  result.observed = {};
  if (existsSync(worktree)) {
    // Capture bytes before status can itself invoke a clean filter.
    result.observed.files = spec.request.source.lfs.map(m => ({ path: m.path, ...fileIdentity(join(worktree, m.path)) }));
    for (const [key, args] of Object.entries({ commit: ['rev-parse', 'HEAD'], head_tree: ['rev-parse', 'HEAD^{tree}'], index_tree: ['write-tree'], porcelain: ['status', '--porcelain=v1', '-z'] })) {
      result.observed[key] = git(worktree, args).toString();
    }
    result.observed.source = sourceIdentity({ sourceRoot: worktree });
  }
  save(join(dirname(specFile), 'result.json'), result);
}

async function main(args) {
  if (args.length !== 2 || args[0] !== '--output') throw Error('Usage: node examples/unreal/remote_jobs/lfs_materialization.mjs --output <fresh-directory>');
  const output = resolve(args[1]);
  if (existsSync(output)) throw Error('Output must be a fresh nonexistent directory');
  mkdirSync(output, { recursive: true });
  const cases = [
    { name: 'hydrated', expected: null },
    { name: 'corrupt-payload', expected: 'Transferred LFS object differs' },
    { name: 'ineffective-filter', expected: 'Remote indexed tree differs after LFS normalization' },
    { name: 'content-tamper', expected: 'Hydrated LFS object differs' },
  ];
  const summary = { version: 1, kind: 'unreal-remote/lfs-materialization-check', output, passed: false, prerequisites: null, cases: cases.map(entry => ({ name: entry.name, expected: entry.expected ?? 'accepted', actual: 'unavailable', passed: false, evidence: join(output, entry.name) })), baseline: null };
  // Expectations precede prerequisites and execution; missing tooling cannot erase required cases.
  save(join(output, 'required-cases.json'), cases);
  let sequence = 0;
  const command = (root, args) => {
    const record = { root, executable: 'git', arguments: args };
    try {
      const run = spawnSync('git', ['--no-optional-locks', '-C', root, ...args], { windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
      record.exit = run.status; record.stdout = run.stdout?.toString() ?? ''; record.stderr = run.stderr?.toString() ?? ''; record.error = run.error?.message ?? null;
      if (run.error || run.status !== 0) throw Error(`Fixture Git command failed: ${args.join(' ')} (${run.error?.message ?? run.status})`);
      return run.stdout;
    }
    finally { save(join(output, `command-${String(++sequence).padStart(3, '0')}.json`), record); }
  };
  try {
    summary.prerequisites = { git: command(output, ['--version']).toString().trim(), lfs: command(output, ['lfs', 'version']).toString().trim(), node: process.version };
    const source = join(output, 'source'); mkdirSync(source);
    command(source, ['init']);
    command(source, ['config', 'core.autocrlf', 'false']); command(source, ['config', 'core.eol', 'lf']);
    command(source, ['lfs', 'install', '--local']); command(source, ['config', 'lfs.repositoryformatversion', '0']);
    const configureFilter = repo => {
      command(repo, ['config', 'filter.fixtureLfs.clean', 'git-lfs clean -- %f']);
      command(repo, ['config', 'filter.fixtureLfs.smudge', 'git-lfs smudge -- %f']);
      command(repo, ['config', 'filter.fixtureLfs.required', 'true']);
    };
    configureFilter(source);
    writeFileSync(join(source, '.gitattributes'), '*.bin filter=fixtureLfs diff=lfs merge=lfs -text\n');
    save(join(source, 'Sample.uproject'), {});
    save(join(source, 'manifest.json'), { schema_version: 1, steps: [{ id: 'build', kind: 'build', required: true, depends_on: [], timeout_seconds: 10, arguments: [], expected_count: 1 }], suites: { small: ['build'] } });
    const data = Buffer.from('deterministic shared LFS fixture object\n');
    for (const name of ['asset[1] space.bin', 'asset1 space.bin', 'second.bin']) writeFileSync(join(source, name), data);
    command(source, ['add', '.']); command(source, ['-c', 'user.name=LFS fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Actual LFS fixture']);
    const commit = command(source, ['rev-parse', 'HEAD']).toString().trim(), accepted = snapshot(source, commit, 'manifest.json', 'small');
    assert.equal(accepted.identity.lfs.length, 3); assert.equal(new Set(accepted.identity.lfs.map(m => m.oid)).size, 1);
    save(join(output, 'accepted-source.json'), accepted.identity);
    const payload = join(output, 'payload'); mkdirSync(join(payload, 'lfs'), { recursive: true });
    createBundle(source, commit, join(payload, 'source.bundle'));
    for (const m of accepted.identity.lfs) if (!existsSync(join(payload, 'lfs', m.oid))) cpSync(join(source, m.path), join(payload, 'lfs', m.oid));
    const filter = join(output, 'fixture-filter.cjs');
    writeFileSync(filter, `const fs = require('node:fs'), cp = require('node:child_process');
const bytes = fs.readFileSync(0), mode = process.argv[2], file = process.argv[3];
if (mode === 'identity') process.stdout.write(bytes);
else { const pointer = cp.execFileSync('git', ['lfs', 'clean', '--', file], { input: bytes, windowsHide: true, timeout: 30000 }); process.stdout.write(pointer); fs.writeFileSync(file, 'tampered after clean'); }
`);
    const setup = name => {
      const folder = join(output, name), base = join(folder, 'remote'), repo = join(base, 'repository.git'); mkdirSync(repo, { recursive: true });
      command(repo, ['init', '--bare']); command(repo, ['config', 'core.autocrlf', 'false']); command(repo, ['config', 'core.eol', 'lf']);
      command(repo, ['lfs', 'install', '--local']); command(repo, ['config', 'lfs.repositoryformatversion', '0']);
      configureFilter(repo);
      return { folder, base, repo, request: { job: name, source: accepted.identity }, payload };
    };
    const execute = spec => {
      const specFile = join(spec.folder, 'case.json'); save(specFile, spec);
      const run = spawnSync(process.execPath, [script, '--fixture-case', specFile], { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TRACE: '1' } });
      writeFileSync(join(spec.folder, 'stdout.log'), run.stdout ?? ''); writeFileSync(join(spec.folder, 'stderr.log'), run.stderr ?? '');
      save(join(spec.folder, 'process.json'), { status: run.status, signal: run.signal, error: run.error?.message ?? null });
      if (run.error || run.status !== 0) throw Error(`Fixture process failed: ${spec.request.job} (${run.error?.message ?? run.status})`);
      return json(join(spec.folder, 'result.json'));
    };
    for (const entry of cases) {
      const row = summary.cases.find(row => row.name === entry.name);
      try {
        const spec = setup(entry.name);
        if (entry.name === 'corrupt-payload') {
          spec.payload = join(spec.folder, 'payload'); cpSync(payload, spec.payload, { recursive: true });
          writeFileSync(join(spec.payload, 'lfs', accepted.identity.lfs[0].oid), 'corrupt payload');
        }
        if (entry.name === 'ineffective-filter' || entry.name === 'content-tamper') {
          command(spec.repo, ['config', 'filter.fixtureLfs.clean', `${quote(process.execPath)} ${quote(filter)} ${entry.name === 'ineffective-filter' ? 'identity' : 'tamper'} %f`]);
        }
        const result = execute(spec); row.actual = result.refusal ?? result.verdict;
        assert.equal(result.refusal, entry.expected);
        if (entry.expected === null) {
          assert.equal(result.verdict, 'accepted'); assert.equal(result.observed.porcelain, '');
          assert.equal(result.observed.commit.trim(), commit); assert.equal(result.observed.head_tree.trim(), accepted.identity.tree); assert.equal(result.observed.index_tree.trim(), accepted.identity.tree);
          assert.deepEqual(result.observed.source, { commit, dirty: false, snapshot: accepted.identity.snapshot, files: accepted.identity.files });
          assert.deepEqual(result.observed.files, accepted.identity.lfs.map(m => ({ path: m.path, bytes: m.bytes, sha256: m.oid })));
        } else assert.equal(result.verdict, 'refused');
        row.passed = true;
      } catch (error) { row.error = error.message; }
    }
    // Preserve a fresh old-candidate observation without touching historical worktrees.
    const moduleUrl = new URL('../../../scripts/lib/unreal-remote/source.mjs', import.meta.url);
    const current = readFileSync(moduleUrl, 'utf8'), call = '    normalizeHydratedLfs(worktree, request.source.tree, actualPointers);';
    assert.equal(current.split(call).length, 2);
    const oldCandidate = current.replace(call, '').replace(/from '([^']+)'/g, (match, value) => value.startsWith('.') ? `from '${new URL(value, moduleUrl).href}'` : match);
    const baseline = setup('old-candidate'); baseline.baseline = join(output, 'old-candidate-source.mjs');
    writeFileSync(baseline.baseline, oldCandidate);
    const observed = execute(baseline);
    summary.baseline = { evidence: baseline.folder, source_sha256: hash(oldCandidate), transformation: 'Removed only the normalization call; imports resolved to original modules.', verdict: observed.verdict, refusal: observed.refusal, historical_refusal_reproduced: observed.refusal === 'Remote source commit/tree/snapshot differs' };
    if (observed.refusal !== null && observed.refusal !== 'Remote source commit/tree/snapshot differs') throw Error('Old candidate failed at an unrelated boundary');
    summary.passed = summary.cases.length === cases.length && summary.cases.every(row => row.passed);
  } catch (error) { summary.error = error.message; }
  save(join(output, 'summary.json'), summary);
  console.log(JSON.stringify({ passed: summary.passed, summary: join(output, 'summary.json') }));
  if (!summary.passed) process.exitCode = 1;
}

try {
  if (process.argv[2] === '--fixture-case' && process.argv.length === 4) await runCase(process.argv[3]);
  else await main(process.argv.slice(2));
} catch (error) { console.error(error.stack); process.exitCode = 1; }
