// Lifetime host only. Native ownership, permits and drain remain in helper.ps1.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const [request, action] = process.argv.slice(2);
if (!request || !['run', 'status', 'clear-stale'].includes(action)) throw Error('Invalid helper host arguments');
const directory = dirname(fileURLToPath(import.meta.url));
const helper = spawn('pwsh', ['-NoProfile', '-NonInteractive', '-File', join(directory, 'helper.ps1'), '-Request', request, '-Action', action, '-SupervisorPid', String(process.pid)], { windowsHide: true, stdio: 'inherit' });
helper.once('error', error => { console.error(`Helper startup failed: ${error.message}`); process.exitCode = 74; });
helper.once('exit', code => { process.exitCode = code ?? 74; });
