import { spawn } from 'node:child_process';
import { realpathSync, readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runContainedProcess, temporaryEvidence } from '../../../scripts/lib/unreal-run/controller.mjs';

const scan = fileURLToPath(new URL('../engine_plugins.mjs', import.meta.url));
export function scanAllowed(command, args) {
  if (!/^node(?:\.exe)?$/i.test(basename(command))) return false;
  if (args.length === 1 && ['--version', '-v'].includes(args[0])) return true;
  try { return args.length > 0 && realpathSync(resolve(args[0])) === realpathSync(scan); } catch { return false; }
}
function bounded(value, fallback, factor, name) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(n) || n <= 0 || n * factor > 86400000) throw Error(`Invalid bounded ${name}`);
  return Math.ceil(n * factor);
}
export async function main(argv = process.argv.slice(2)) {
  let noLock = false;
  if (argv[0] === '--no-lock') { noLock = true; argv = argv.slice(1); }
  const [executable, ...args] = argv;
  if (!executable) throw Error('usage: with-engine-lock.ps1 [--no-lock] <executable> [args...]');
  if (process.env.ENGINE_LOCK_NAME) throw Error('ENGINE_LOCK_NAME cannot override the production lock; use the isolated inert test harness');
  if (noLock) {
    if (!scanAllowed(executable, args)) throw Error('--no-lock accepts only node --version or the bundled engine_plugins.mjs filesystem scan');
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: 'inherit' });
    return await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('exit', code => resolveExit(code ?? 74)); });
  }
  // Explicitly marked test input; these receipts cannot qualify production runs.
  const fixtureIsolation = process.env.AGENT_UNREAL_TEST_ISOLATION ? JSON.parse(readFileSync(process.env.AGENT_UNREAL_TEST_ISOLATION, 'utf8')) : undefined;
  const evidence = process.env.ENGINE_LOCK_EVIDENCE || temporaryEvidence('compat');
  const result = await runContainedProcess({ executable, arguments: args, evidence, operation: 'compat',
    timeoutMs: bounded(process.env.ENGINE_RUN_TIMEOUT_SECONDS, 14400, 1000, 'workload timeout'),
    waitMs: bounded(process.env.ENGINE_LOCK_TIMEOUT_MIN, 240, 60000, 'lock timeout'), fixtureIsolation,
    onStdout: value => process.stdout.write(value), onStderr: value => process.stderr.write(value), onDiagnostic: value => process.stderr.write(value) });
  console.error(`Engine launcher evidence: ${result.evidence}`);
  if (!existsSync(resolve(result.evidence, 'workload-permit.json')) && readFileSync(resolve(result.evidence, 'helper.stderr.log'), 'utf8').includes('Bounded lock wait expired')) return 3;
  return result.exitCode;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 2; });
