import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setup } from '../agent_verify/setup.mjs';
import { fixture } from './fixture.mjs';
import { prepare } from '../../../scripts/lib/unreal-verify/manifest.mjs';
import { execute, verifyReceipt } from '../../../scripts/lib/unreal-verify/runner.mjs';

// Separately invoked native acceptance; never discovered by the dependency-free merge lane.
export async function acceptance({ project, evidence, engine, compiler, sdk }) {
  if (process.platform !== 'win32') throw Error('Native suite acceptance requires Windows');
  project = resolve(project); evidence = resolve(evidence); mkdirSync(evidence);
  setup({ project, engine, compiler, sdk });
  const definition = fixture({ compiler, sdk });
  const manifest = join(evidence, 'manifest.json');
  const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  write(manifest, definition.manifest);
  for (const [name, doc] of Object.entries(definition.inputs)) write(join(evidence, name), doc);
  const prepared = prepare({ project: join(project, 'launcher.local.json'), manifest, suite: 'acceptance' });
  write(join(evidence, 'plan.json'), prepared);
  const control = new AbortController(), cancel = () => control.abort();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  try {
    const result = await execute(prepared, join(evidence, 'run'), { signal: control.signal });
    const verified = verifyReceipt(join(evidence, 'run/regression.json'));
    write(join(evidence, 'verification.json'), verified);
    return { passed: result.qualified && verified.qualified, planned_steps: prepared.plan.length, observed_steps: result.steps.filter(s => s.started).length, steps: result.steps.map(({ id, status, checks_run }) => ({ id, status, checks_run })), verification: verified, evidence };
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i].slice(2);
      if (!['project', 'evidence', 'engine', 'compiler', 'sdk'].includes(key) || options[key] || !process.argv[i + 1]) throw Error('usage: acceptance.mjs --project fresh-project --evidence fresh-directory --engine engine --compiler version --sdk version');
      options[key] = process.argv[i + 1];
    }
    if (Object.keys(options).length !== 5) throw Error('All five options are required');
    const result = await acceptance(options); writeFileSync(join(options.evidence, 'acceptance.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.passed ? 0 : 1;
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
