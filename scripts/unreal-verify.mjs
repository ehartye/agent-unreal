#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepare } from './lib/unreal-verify/manifest.mjs';
import { execute, verifyReceipt } from './lib/unreal-verify/runner.mjs';

export function parseArguments(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--project', '--manifest', '--suite', '--output', '--validate-only', '--verify-receipt', '--help'].includes(key) || Object.hasOwn(options, key)) throw Error(`Unknown or repeated option: ${key}`);
    if (['--validate-only', '--help'].includes(key)) options[key] = true;
    else { if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Missing value: ${key}`); options[key] = args[++i]; }
  }
  if (options['--help']) { if (args.length !== 1) throw Error('--help accepts no other options'); return options; }
  if (options['--verify-receipt']) { if (Object.keys(options).length !== 1) throw Error('--verify-receipt accepts only a receipt path'); return options; }
  if (!options['--project'] || !options['--manifest'] || !options['--suite'] || (!options['--validate-only'] && !options['--output'])) throw Error('Required: --project --manifest --suite and --output (or --validate-only)');
  if (options['--validate-only'] && options['--output']) throw Error('--validate-only does not create output');
  return options;
}
export async function main(args = process.argv.slice(2), print = value => console.log(JSON.stringify(value, null, 2))) {
  const options = parseArguments(args);
  if (options['--help']) { print({ usage: 'node scripts/unreal-verify.mjs --project project.json --manifest manifest.json --suite name --output fresh-folder | --validate-only; --verify-receipt regression.json', schema_version: 1 }); return 0; }
  if (options['--verify-receipt']) { const checked = verifyReceipt(options['--verify-receipt']); print(checked); return checked.qualified ? 0 : 1; }
  const prepared = prepare({ project: options['--project'], manifest: options['--manifest'], suite: options['--suite'] });
  if (options['--validate-only']) { print(prepared); return 0; }
  if (process.platform !== 'win32') throw Error('Execution requires Windows; validation and receipt verification are engine-free');
  const control = new AbortController(), cancel = () => control.abort();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  try { const result = await execute(prepared, options['--output'], { signal: control.signal }); print(result); return result.qualified ? 0 : 1; }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 2; });
