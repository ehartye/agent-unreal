import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [mode, output, ...args] = process.argv.slice(2);
writeFileSync(output, JSON.stringify({ pid: process.pid, args, started: new Date().toISOString() }));
if (mode === 'exit') process.exit(7);
const child = spawn(process.execPath, ['-e', `setTimeout(()=>{},${mode === 'normal' ? 300 : mode === 'exclusion' ? 5000 : 60000})`], { windowsHide: true, stdio: 'ignore' });
await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
