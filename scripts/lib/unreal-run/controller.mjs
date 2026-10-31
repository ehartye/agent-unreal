import { spawn, execFileSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync, readSync, writeFileSync, mkdirSync, existsSync, openSync, closeSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { LOCK, VERSION, hash, validateRequest, verifyLifecycle } from './contracts.mjs';
const directory = dirname(fileURLToPath(import.meta.url));
export const readJson = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
export const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

function creationIdentity(pid) {
  // A fixed, inert native observation binds the controller before the request is hashed.
  return execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', join(directory, 'observe.ps1'), '-Kind', 'process', '-ProcessId', String(pid)], { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
}

/** Internal embedding API for the compatibility adapter. No second lock in its caller.
 * fixtureIsolation is reserved for the standalone inert harness and produces receipts
 * rejected by production validators. The public CLI cannot select it.
 */
export async function runContainedProcess(options) {
  if (process.platform !== 'win32') throw Error('Unreal launcher process control requires Windows and PowerShell 7');
  const { fixtureIsolation, action = 'run', operation = 'compat', signal } = options;
  const evidence = resolve(options.evidence);
  mkdirSync(evidence, { recursive: true });
  if (readdirSync(evidence).length) throw Error('Evidence directory must be empty; retained receipts cannot be overwritten');
  const r = {
    version: VERSION, kind: 'unreal-run/request', id: randomUUID(), nonce: randomBytes(32).toString('hex'),
    purpose: fixtureIsolation ? 'fixture' : 'production', operation,
    lock: fixtureIsolation?.lock ?? LOCK,
    state: fixtureIsolation?.state ?? join(process.env.ProgramData ?? '', 'agent-unreal', 'engine-runs'),
    executable: options.executable ?? process.execPath, arguments: options.arguments ?? [], cwd: options.cwd ?? process.cwd(),
    evidence, node: process.execPath, timeoutMs: options.timeoutMs ?? 30000, waitMs: options.waitMs ?? 60000,
    controllerPid: process.pid, controllerCreated: creationIdentity(process.pid),
    ...(fixtureIsolation?.fault ? { fault: fixtureIsolation.fault } : {}),
  };
  const errors = validateRequest(r);
  if (errors.length) throw Error(errors.join('; '));
  const request = join(evidence, 'request.json'); writeJson(request, r);
  const requestHash = hash(readFileSync(request));
  const stdout = openSync(join(evidence, 'helper.stdout.log'), 'wx');
  const stderr = openSync(join(evidence, 'helper.stderr.log'), 'wx');
  // The supervisor must outlive abrupt controller death to prove owned Job drain.
  // On Windows a non-detached Node child can be killed with its parent's libuv
  // Job. A tiny detached Node host starts PowerShell normally: PowerShell can
  // exit before script execution when started with DETACHED_PROCESS itself.
  // Keep file stdio and await the host. The workload Job has no breakaway flags.
  const helper = spawn(process.execPath, [join(directory, 'helper-host.mjs'), request, action], { detached: true, windowsHide: true, stdio: ['ignore', stdout, stderr] });
  closeSync(stdout); closeSync(stderr);
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    writeJson(join(evidence, 'cancel.json'), { id: r.id, requestHash });
  };
  const onSignal = () => cancel();
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const cursors = new Map();
  function tail(name, callback) {
    if (!callback || !existsSync(join(evidence, name))) return;
    const cursor = cursors.get(name) ?? { offset: 0, decoder: new StringDecoder('utf8') }; cursors.set(name, cursor);
    const fd = openSync(join(evidence, name), 'r');
    try {
      const buffer = Buffer.allocUnsafe(65536); let count;
      while ((count = readSync(fd, buffer, 0, buffer.length, cursor.offset)) > 0) { cursor.offset += count; const text = cursor.decoder.write(buffer.subarray(0, count)); if (text) callback(text); }
    } finally { closeSync(fd); }
  }
  const pump = () => { tail('helper.stderr.log', options.onDiagnostic); tail('stdout.log', options.onStdout); tail('stderr.log', options.onStderr); };
  const poll = setInterval(pump, 250);
  try {
    const exitCode = await new Promise((resolveExit, reject) => { helper.once('error', reject); helper.once('exit', code => resolveExit(code ?? 74)); });
    pump();
    const lifecyclePath = join(evidence, 'lifecycle.json');
    const lifecycle = existsSync(lifecyclePath) ? readJson(lifecyclePath) : null;
    const validation = action === 'run' ? verifyLifecycle(lifecycle, { purpose: r.purpose, requestId: r.id, requestHash }) : null;
    const output = readFileSync(join(evidence, 'helper.stdout.log'), 'utf8');
    return { exitCode: exitCode === 0 && validation && !validation.valid ? 74 : exitCode, lifecycle, validation, request: r, requestHash, output, evidence };
  } finally {
    clearInterval(poll); process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal); signal?.removeEventListener('abort', cancel);
  }
}

export function loadConfiguration(file) {
  const absolute = resolve(file); const c = readJson(absolute);
  if (c.version !== 1) throw Error('Unsupported project configuration version');
  const allowed = new Set(['version', 'project', 'engine', 'sourceRoot', 'editorTarget', 'gameTarget', 'configuration', 'platform', 'dotnet', 'packageDirectory', 'gameExecutable']);
  for (const key of Object.keys(c)) if (!allowed.has(key)) throw Error(`Unknown configuration field: ${key}`);
  for (const key of ['project', 'engine', 'sourceRoot']) {
    if (typeof c[key] !== 'string' || !c[key] || c[key].includes('\0')) throw Error(`Missing configuration ${key}`);
    c[key] = resolve(dirname(absolute), c[key]);
    if (!existsSync(c[key])) throw Error(`Configuration path does not exist: ${key}`);
  }
  if (!c.project.toLowerCase().endsWith('.uproject') || !statSync(c.project).isFile()) throw Error('project must name a .uproject file');
  for (const key of ['editorTarget', 'gameTarget']) if (typeof c[key] !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(c[key])) throw Error(`Invalid configuration ${key}`);
  c.platform ??= 'Win64'; c.configuration ??= 'Development';
  if (c.platform !== 'Win64' || !['Debug', 'DebugGame', 'Development', 'Shipping', 'Test'].includes(c.configuration)) throw Error('Unsupported target platform or configuration');
  for (const key of ['dotnet', 'packageDirectory', 'gameExecutable']) if (c[key] !== undefined) { if (typeof c[key] !== 'string' || !c[key] || c[key].includes('\0')) throw Error(`Invalid configuration ${key}`); c[key] = resolve(dirname(absolute), c[key]); }
  return c;
}

export function operationCommand(operation, c, args) {
  if (!Array.isArray(args) || args.some(a => typeof a !== 'string' || a.includes('\0'))) throw Error('Invalid engine arguments');
  let executable, arguments_;
  if (operation === 'build' || operation === 'package') {
    let dotnet = c.dotnet;
    if (!dotnet) {
      const root = join(c.engine, 'Engine/Binaries/ThirdParty/DotNet');
      const candidates = readdirSync(root).map(v => join(root, v, 'win-x64/dotnet.exe')).filter(existsSync);
      if (candidates.length !== 1) throw Error('Set dotnet to the engine-bundled runtime when discovery is ambiguous');
      dotnet = candidates[0];
    }
    executable = dotnet;
    if (operation === 'build') arguments_ = [join(c.engine, 'Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.dll'), c.editorTarget, c.platform, c.configuration, `-Project=${c.project}`, '-WaitMutex', ...args];
    else {
      if (!c.packageDirectory) throw Error('packageDirectory is required for package');
      arguments_ = [join(c.engine, 'Engine/Binaries/DotNET/AutomationTool/AutomationTool.dll'), 'BuildCookRun', `-project=${c.project}`, `-target=${c.gameTarget}`, `-platform=${c.platform}`, `-clientconfig=${c.configuration}`, '-build', '-cook', '-stage', '-pak', '-archive', `-archivedirectory=${c.packageDirectory}`, ...args];
    }
    if (!existsSync(arguments_[0])) throw Error('Engine tool assembly is missing');
  } else if (operation === 'game' && c.gameExecutable) { executable = c.gameExecutable; arguments_ = [...args]; }
  else {
    if (!['editor', 'game', 'commandlet', 'test', 'doctor'].includes(operation)) throw Error('Unsupported launch operation');
    if (operation === 'doctor') return { executable: process.execPath, arguments: ['-e', 'process.stdout.write("inert capability probe complete\\n")'] };
    executable = join(c.engine, 'Engine/Binaries/Win64', ['commandlet', 'test'].includes(operation) ? 'UnrealEditor-Cmd.exe' : 'UnrealEditor.exe');
    arguments_ = [c.project, ...(operation === 'game' ? ['-game'] : []), ...args];
  }
  if (!isAbsolute(executable) || !existsSync(executable)) throw Error('Launch executable is missing');
  return { executable, arguments: arguments_ };
}
export const temporaryEvidence = operation => mkdtempSync(join(tmpdir(), `unreal-run-${operation}-`));
