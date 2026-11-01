#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { action } from './lib/unreal-remote/client.mjs';

export function parseArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const [verb, ...rest] = args;
  if (!['start', 'status', 'cancel', 'fetch'].includes(verb)) throw Error('Expected start|status|cancel|fetch');
  const options = { action: verb }, allowed = ['config', 'job', ...(verb === 'start' ? ['commit', 'manifest', 'suite'] : []), ...(verb === 'fetch' ? ['output', 'diagnostic'] : [])];
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i].startsWith('--') ? rest[i].slice(2) : '';
    if (!allowed.includes(key) || Object.hasOwn(options, key)) throw Error(`Unknown or repeated option: ${rest[i]}`);
    if (key === 'diagnostic') options[key] = true;
    else { if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw Error(`Missing value: ${rest[i]}`); options[key] = rest[++i]; }
  }
  for (const key of allowed.filter(k => k !== 'diagnostic')) if (!options[key]) throw Error(`Missing --${key}`);
  return options;
}
export async function main(args = process.argv.slice(2), print = value => console.log(JSON.stringify(value, null, 2))) {
  const options = parseArguments(args);
  if (options.help) { print({ usage: 'node scripts/unreal-remote.mjs start|status|cancel|fetch --config ignored-local.json --job id; start: --commit exact-sha --manifest tracked.json --suite name; fetch: --output fresh-ignored-folder [--diagnostic]', version: 1 }); return 0; }
  const result = await action(options); print(result);
  return result.uncertain || result.state?.phase === 'unknown' || result.phase === 'unknown' ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 2; });
