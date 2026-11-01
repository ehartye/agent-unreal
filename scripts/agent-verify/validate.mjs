import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDocument, validateReceipt, validateSourceManifest, verifySourceFiles, sha256 } from './contracts.mjs';
import { readArtifact, collectSourceFiles } from './artifacts.mjs';

export function main(args, print = (value) => console.log(JSON.stringify(value, null, 2))) {
  try {
    const [mode, file, ...rest] = args;
    if (!['document', 'receipt'].includes(mode) || !file) throw new Error('usage: validate.mjs document <file> | receipt <file> --request <file> [--source <AgentVerify-directory>] [--evidence <directory>]');
    const options = {};
    for (let i = 0; i < rest.length; i += 2) {
      if (!['--request', '--source', '--evidence'].includes(rest[i]) || !rest[i + 1] || rest[i + 1].startsWith('--') || options[rest[i]]) throw new Error('unknown, duplicate or missing option');
      options[rest[i]] = rest[i + 1];
    }
    if (mode === 'document' && rest.length) throw new Error('document mode accepts no options');
    const document = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (mode === 'document') { const checked = validateDocument(document); print(checked); return checked.valid ? 0 : 1; }
    if (!options['--request']) throw new Error('receipt mode requires --request');
    const requestBytes = readFileSync(options['--request']);
    let request;
    try { request = JSON.parse(requestBytes.toString('utf8').replace(/^\uFEFF/, '')); }
    catch { request = null; } // A syntax refusal uses the null/root-type structural issue and the exact byte digest.
    const sourceRoot = options['--source'] ?? fileURLToPath(new URL('../../runtime/AgentVerify/', import.meta.url));
    const manifestBytes = readArtifact(sourceRoot, 'source-version.json');
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const manifestCheck = validateSourceManifest(manifest);
    if (!manifestCheck.valid) { print(manifestCheck); return 1; }
    const sourceFiles = collectSourceFiles(sourceRoot, manifest);
    const sourceCheck = verifySourceFiles(manifest, sourceFiles);
    const expectedSource = { plugin_version: manifest.plugin_version, manifest_sha256: sha256(manifestBytes), state: sourceCheck.state, modified_files: sourceCheck.modified_files };
    const evidence = options['--evidence'] ?? dirname(resolve(file));
    const artifacts = Object.fromEntries((Array.isArray(document.artifacts) ? document.artifacts : []).filter((entry) => typeof entry?.path === 'string').map((entry) => { try { return [entry.path, readArtifact(evidence, entry.path)]; } catch { return [entry.path, null]; } }));
    const checked = validateReceipt(document, request, { requestSha256: sha256(requestBytes), expectedSource, artifacts });
    print(checked); return checked.valid ? 0 : 1;
  } catch (error) {
    print({ valid: false, outcome: 'invalid', issues: [{ code: 'io_or_usage', path: '$', message: error.message }] }); return 1;
  }
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
