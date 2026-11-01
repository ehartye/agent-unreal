import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hash, validateRequest, verifyLifecycle, verifyIdentity } from './contracts.mjs';
import { readJson, loadConfiguration } from './controller.mjs';
import { sourceIdentity, verifyArtifactFiles } from './identity.mjs';
try {
  const [directory, flag, configFile, ...extra] = process.argv.slice(2);
  if (!directory || (flag && flag !== '--config') || (flag && !configFile) || extra.length) throw Error('Usage: node scripts/lib/unreal-run/verify-receipt.mjs <evidence-directory> [--config project.json]');
  const root = resolve(directory), bytes = readFileSync(join(root, 'request.json')), request = JSON.parse(bytes.toString('utf8'));
  const life = readJson(join(root, 'lifecycle.json'));
  const errors = [...validateRequest(request), ...verifyLifecycle(life, { requestId: request.id, requestHash: hash(bytes) }).errors];
  if (life.operation !== request.operation) errors.push('request/lifecycle operation mismatch');
  if (['build', 'package'].includes(request.operation)) {
    if (!configFile) errors.push('Build/package verification requires --config to compare current source identity');
    const identity = existsSync(join(root, 'identity.json')) ? readJson(join(root, 'identity.json')) : null;
    const source = configFile ? sourceIdentity(loadConfiguration(configFile)) : undefined;
    errors.push(...verifyIdentity(identity, life, { source, operation: request.operation }).errors, ...verifyArtifactFiles(identity).errors);
  }
  console.log(JSON.stringify({ version: 1, valid: errors.length === 0, errors }, null, 2)); process.exitCode = errors.length ? 1 : 0;
} catch (error) { console.error(error.message); process.exitCode = 2; }
