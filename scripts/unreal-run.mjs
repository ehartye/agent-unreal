#!/usr/bin/env node
import { OPERATIONS, verifyIdentity } from './lib/unreal-run/contracts.mjs';
import { runContainedProcess, loadConfiguration, operationCommand, temporaryEvidence, writeJson } from './lib/unreal-run/controller.mjs';
import { sourceIdentity, collectIdentity, verifyArtifactFiles } from './lib/unreal-run/identity.mjs';
import { join, dirname } from 'node:path';

export function parseArguments(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') return { help: true };
  const operation = argv.shift();
  if (!OPERATIONS.includes(operation)) throw Error(`Unsupported operation: ${operation}`);
  const options = { operation, arguments: [] };
  const flags = { '--config': 'config', '--evidence': 'evidence', '--timeout': 'timeout', '--wait': 'wait' };
  while (argv.length) {
    const flag = argv.shift();
    if (flag === '--') { options.arguments = argv; break; }
    if (!flags[flag] || !argv.length || options[flags[flag]] !== undefined) throw Error(`Unknown, missing or repeated option: ${flag}`);
    options[flags[flag]] = argv.shift();
  }
  for (const key of ['timeout', 'wait']) if (options[key] !== undefined && (!/^\d+$/.test(options[key]) || Number(options[key]) < 1 || Number(options[key]) > 86400)) throw Error(`${key} must be 1..86400 seconds`);
  if (!['status', 'doctor', 'clear-stale'].includes(operation) && (!options.config || !options.evidence || !options.timeout)) throw Error('Launch requires --config, --evidence and --timeout');
  if (['status', 'clear-stale'].includes(operation) && options.arguments.length) throw Error('Administrative operations accept no workload arguments');
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const o = parseArguments([...argv]);
  if (o.help) { console.log(`Usage: node scripts/unreal-run.mjs <${OPERATIONS.join('|')}> [--config project.json --evidence directory --timeout seconds] [--wait seconds] [-- exact engine arguments]\nWindows and PowerShell 7 required. Launches use one machine-wide lock and owned Job.\nstatus reads ownership; doctor launches inert children only; clear-stale requires proven recovery evidence.`); return 0; }
  if (process.platform !== 'win32') throw Error('Unreal launcher process control requires Windows and PowerShell 7');
  const config = o.config ? loadConfiguration(o.config) : null;
  const admin = ['status', 'clear-stale'].includes(o.operation);
  const command = admin ? {} : operationCommand(o.operation, config, o.arguments);
  const evidence = o.evidence ?? temporaryEvidence(o.operation);
  const source = ['build', 'package'].includes(o.operation) ? sourceIdentity(config) : null;
  const result = await runContainedProcess({ ...command, operation: o.operation, action: admin ? o.operation : 'run', evidence, timeoutMs: Number(o.timeout ?? 30) * 1000, waitMs: Number(o.wait ?? 60) * 1000, cwd: config ? dirname(config.project) : process.cwd(), onDiagnostic: text => process.stderr.write(text) });
  let code = result.exitCode;
  if (source) {
    const identity = collectIdentity(config, source, result);
    writeJson(join(evidence, 'identity.json'), identity);
    const verification = verifyIdentity(identity, result.lifecycle);
    const artifactVerification = verifyArtifactFiles(identity);
    verification.errors.push(...artifactVerification.errors); verification.valid &&= artifactVerification.valid;
    if (!verification.valid) { console.error(verification.errors.join('; ')); code = 74; }
  }
  if (admin) process.stdout.write(result.output);
  else console.log(JSON.stringify({ operation: o.operation, exitCode: code, evidence: result.evidence, validation: result.validation }));
  return code;
}
if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/').replace(/^\//, '')}`).href) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 2; });
}
