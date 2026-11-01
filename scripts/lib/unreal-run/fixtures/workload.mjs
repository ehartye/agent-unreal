import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [mode, output, ...args] = process.argv.slice(2);
writeFileSync(output, JSON.stringify({ pid: process.pid, args, started: new Date().toISOString() }));
if (mode === 'exit') process.exit(7);
if (mode === 'rapid') {
  for (let batch = 0; batch < 8; batch++) await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['-e', 'const {spawn}=require("node:child_process");const c=spawn(process.execPath,["-e","process.exit(0)"],{windowsHide:true,stdio:"ignore"});c.once("exit",()=>process.exit(0));'], { windowsHide: true, stdio: 'ignore' });
    p.once('exit', code => code === 0 ? resolve() : reject(Error(`Rapid child exit ${code}`))); p.once('error', reject);
  })));
  process.exit(0);
}
const child = spawn(process.execPath, ['-e', `setTimeout(()=>{},${mode === 'normal' ? 300 : mode === 'exclusion' ? 5000 : 60000})`], { windowsHide: true, stdio: 'ignore' });
await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
