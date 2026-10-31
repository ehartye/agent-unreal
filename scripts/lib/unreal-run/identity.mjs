import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, relative, resolve, isAbsolute, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hash } from './contracts.mjs';
import { readJson } from './controller.mjs';

export function sourceIdentity(config) {
  const git = args => execFileSync('git', ['-C', config.sourceRoot, ...args], { maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 30000 });
  const commit = git(['rev-parse', 'HEAD']).toString().trim();
  const status = git(['status', '--porcelain=v1', '-z']);
  const paths = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).toString().split('\0').filter(Boolean))].sort();
  const digest = createHash('sha256').update(commit).update(status);
  for (const path of paths) {
    const full = resolve(config.sourceRoot, path);
    if (relative(config.sourceRoot, full).startsWith('..') || isAbsolute(relative(config.sourceRoot, full))) throw Error('Source file escapes source root');
    digest.update(path).update('\0');
    if (existsSync(full) && statSync(full).isFile()) digest.update(hash(readFileSync(full)));
    else digest.update('<missing>');
  }
  return { commit, dirty: status.length !== 0, snapshot: digest.digest('hex'), files: paths.length };
}

function artifact(file) {
  const bytes = readFileSync(file);
  if (!bytes.length) throw Error('Empty produced artifact');
  return { path: resolve(file), bytes: bytes.length, sha256: hash(bytes) };
}

export function verifyArtifactFiles(receipt, { resolveArtifact = path => path } = {}) {
  const errors = [];
  if (!Array.isArray(receipt?.artifacts) || !receipt.artifacts.length) return { valid: false, errors: ['missing artifact inventory'] };
  for (const expected of receipt.artifacts) {
    try {
      if (!expected || typeof expected.path !== 'string') throw Error('malformed artifact entry');
      const observed = artifact(resolveArtifact(expected.path));
      if (observed.bytes !== expected.bytes || observed.sha256 !== expected.sha256) throw Error('artifact bytes or hash mismatch');
    } catch (error) { errors.push(`${expected?.path ?? '<missing path>'}: ${error.message}`); }
  }
  return { valid: errors.length === 0, errors };
}

export function collectIdentity(config, source, result) {
  const receipt = { version: 1, kind: 'unreal-run/identity', operation: result.request.operation, id: result.request.id, requestHash: result.requestHash, source, engine: null, toolchain: null, artifacts: [], complete: false, errors: [] };
  try {
    if (sourceIdentity(config).snapshot !== source.snapshot) throw Error('Source changed during workload');
    const versionPath = join(config.engine, 'Engine/Build/Build.version');
    const executable = join(config.engine, 'Engine/Binaries/Win64/UnrealEditor.exe');
    const version = readJson(versionPath);
    // Preserve installed-file and observed target values separately; Build.version is not assumed authoritative.
    const actualVersion = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./observe.ps1', import.meta.url)), '-Kind', 'file', '-Path', executable], { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
    receipt.engine = { buildVersion: version, buildVersionSha256: hash(readFileSync(versionPath)), executableSha256: hash(readFileSync(executable)), observedVersion: actualVersion };
    const stdout = readFileSync(join(result.evidence, 'stdout.log'), 'utf8');
    const stderr = readFileSync(join(result.evidence, 'stderr.log'), 'utf8');
    const log = stdout + '\n' + stderr;
    const match = log.match(/Using Visual Studio[^\r\n]*?([0-9]+\.[0-9]+\.[0-9]+)[^\r\n]*?toolchain[^\r\n]*?and\s+([0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?)\s+Windows[^\r\n]*SDK/i);
    if (!match) throw Error('Actual compiler and SDK were not observed in workload logs');
    receipt.toolchain = { compiler: match[1], sdk: match[2], observation: match[0], logSha256: hash(log) };
    const target = result.request.operation === 'build' ? config.editorTarget : config.gameTarget;
    const binaryRoot = join(dirname(config.project), 'Binaries', config.platform);
    const names = [`${target}.target`, `${target}-${config.platform}-${config.configuration}.target`];
    const targetFile = names.map(name => join(binaryRoot, name)).find(existsSync);
    if (!targetFile) throw Error('Produced target receipt is absent');
    const produced = readJson(targetFile);
    if (produced.TargetName !== target || produced.Platform !== config.platform || produced.Configuration !== config.configuration || !Array.isArray(produced.BuildProducts) || !produced.BuildProducts.length) throw Error('Produced target receipt does not match requested target');
    receipt.target = { name: produced.TargetName, platform: produced.Platform, configuration: produced.Configuration, version: produced.Version, buildId: produced.BuildId ?? null };
    receipt.artifacts.push(artifact(targetFile));
    for (const product of produced.BuildProducts) {
      const file = String(product.Path ?? '').replaceAll('$(ProjectDir)', dirname(config.project)).replaceAll('$(EngineDir)', join(config.engine, 'Engine'));
      if (!isAbsolute(file) || file.includes('$(')) throw Error('Unresolved produced artifact path');
      receipt.artifacts.push(artifact(file));
    }
    if (result.request.operation === 'package') {
      const walk = folder => readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(folder, entry.name)) : [join(folder, entry.name)]);
      const files = walk(config.packageDirectory);
      if (!files.some(file => file.toLowerCase().endsWith('.exe'))) throw Error('Packaged executable is absent');
      for (const file of files) receipt.artifacts.push(artifact(file));
    }
    receipt.artifacts = [...new Map(receipt.artifacts.map(a => [a.path, a])).values()];
    receipt.complete = true;
  } catch (error) { receipt.errors.push(error.message); }
  return receipt;
}
