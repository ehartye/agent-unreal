import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { inventory, pack, fileIdentity, write, digest, now } from './files.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../../..');
export function runtimePackage(directory) {
  const members = ['scripts', 'examples/unreal/automation_test'].flatMap(sub => inventory(join(root, sub)).map(m => ({ path: `${sub}/${m.path}`, source: join(root, sub, m.path) })));
  const file = join(directory, 'runtime.uar'); pack(file, members); return { file, identity: fileIdentity(file) };
}
export function native(executable, args, { timeout, logs, onProgress = value => process.stderr.write(value + '\n') }) {
  const id = randomUUID(), started = now();
  mkdirSync(logs, { recursive: true });
  onProgress(`${started} transport ${executable} started (${timeout}s bound)`);
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [], stderr = []; let bytes = 0, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout * 1000);
    const heartbeat = setInterval(() => onProgress(`${now()} transport ${executable} awaiting response`), 10000);
    const capture = target => b => { bytes += b.length; if (bytes > 16 * 1024 * 1024) { timedOut = true; child.kill(); } else target.push(b); };
    child.stdout.on('data', capture(stdout)); child.stderr.on('data', capture(stderr));
    child.once('error', error => { clearTimeout(timer); clearInterval(heartbeat); reject(error); });
    child.once('close', code => {
      clearTimeout(timer); clearInterval(heartbeat);
      const out = Buffer.concat(stdout), err = Buffer.concat(stderr);
      writeFileSync(join(logs, `${id}.stdout`), out, { flag: 'wx' }); writeFileSync(join(logs, `${id}.stderr`), err, { flag: 'wx' });
      write(join(logs, `${id}.json`), { version: 1, executable, started, finished: now(), exit_code: code, timed_out: timedOut });
      onProgress(`${now()} transport ${executable} ${timedOut ? 'timed out; dispatch may have occurred' : `exit ${code}`}`);
      if (timedOut || code !== 0) reject(Error(`Transport ${executable} ${timedOut ? 'timeout (dispatch is uncertain)' : `exit ${code}`}; diagnostics: ${logs}`));
      else resolveRun(out.toString('utf8').trim());
    });
  });
}
const literal = value => `'${value.replaceAll("'", "''")}'`;
export function encoded(script) {
  const result = ['pwsh', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
  if (result.join(' ').length > 7800) throw Error('Fixed SSH bootstrap exceeds bounded envelope');
  return result;
}
export function sshTransport(config, local, runtime) {
  const timeout = config.remote.timeouts.transport_seconds, logs = join(local, 'transport'), common = ['-o', 'BatchMode=yes', '-o', `ConnectTimeout=${Math.min(timeout, 30)}`, '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2'];
  const run = (exe, args) => native(exe, args, { timeout, logs });
  async function call(action, job, data = {}) {
    const id = randomUUID(), remote = win32.join(config.remote.root, '.transport', id).replaceAll('\\', '/'), directory = join(local, `message-${id}`); mkdirSync(directory);
    const message = { version: 1, action, job, remote: config.remote, runtime: runtime.identity, ...data }; write(join(directory, 'message.json'), message);
    // Only fixed setup plus bounded paths cross the shell boundary; requests and inventories are files.
    const stage = `$ErrorActionPreference='Stop';$r=${literal(config.remote.root)};$d=${literal(remote)};foreach($p in @($r,$d)){$c=$p;while($c){if(Test-Path -LiteralPath $c){if(((Get-Item -Force -LiteralPath $c).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse point refused'}};$c=[IO.Path]::GetDirectoryName($c)}};if(!(Test-Path -LiteralPath $r)){[IO.Directory]::CreateDirectory($r)|Out-Null;@{version=1;kind='unreal-remote/root';root=$r}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $r 'owner.json') -NoNewline};$o=Get-Content -Raw -LiteralPath (Join-Path $r 'owner.json')|ConvertFrom-Json;if($o.version -ne 1 -or $o.kind -cne 'unreal-remote/root' -or $o.root -cne $r){throw 'Unowned remote root'};[IO.Directory]::CreateDirectory((Join-Path $r '.transport'))|Out-Null;New-Item -ItemType Directory -Path $d -ErrorAction Stop|Out-Null`;
    await run('ssh', [...common, config.ssh_target, ...encoded(stage)]);
    const files = [[join(here, 'bootstrap.mjs'), 'bootstrap.mjs'], [join(here, 'files.mjs'), 'bootstrap-files.mjs'], [runtime.file, 'runtime.uar'], [join(directory, 'message.json'), 'message.json']];
    if (action === 'start') files.push([data.payload_file, 'payload.uar']);
    for (const [file, name] of files) await run('scp', [...common, '--', file, `${config.ssh_target}:${remote}/${name}`]);
    return JSON.parse(await run('ssh', [...common, config.ssh_target, ...encoded(`$ErrorActionPreference='Stop';& ${literal(config.remote.node)} ${literal(`${remote}/bootstrap.mjs`)} ${literal(`${remote}/message.json`)};exit $LASTEXITCODE`)]));
  }
  return {
    start: (request, payload) => call('start', request.job, { request, payload_file: payload }),
    status: (job, request) => call('status', job, { request_sha256: request ? digest(request) : null }),
    cancel: request => call('cancel', request.job, { request_sha256: digest(request) }),
    fetch: (request, diagnostic) => call('fetch', request.job, { request_sha256: digest(request), diagnostic }),
    qualify: (request, archive, binding) => call('fetch', request.job, { request_sha256: digest(request), finalize: { archive, binding } }),
    download: (remote, localFile) => {
      const normalized = win32.normalize(remote), within = win32.join(config.remote.root, 'jobs') + win32.sep;
      if (!normalized.toLowerCase().startsWith(within.toLowerCase()) || !/return-[a-f0-9-]{36}[\\/]evidence\.uar$/.test(normalized) || /[\r\n"*?\[\]{}]/.test(normalized)) throw Error('Download source outside owned return snapshot');
      if (existsSync(localFile)) throw Error('Download destination exists');
      return run('scp', [...common, '--', `${config.ssh_target}:${normalized.replaceAll('\\', '/')}`, localFile]);
    },
  };
}
