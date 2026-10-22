// The same dependency-free merge checks run locally and in CI. Native-engine
// acceptance (building, cooking and running Unreal) is separate and needs its documented engine setup.
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tests = readdirSync(join(root, 'scripts'))
  .filter(name => name.endsWith('.test.mjs'))
  .sort()
  .map(name => `scripts/${name}`);
// Every *.test.mjs under examples/ runs, so a new example scene adds its test by existing.
const walk = dir => readdirSync(join(root, dir)).sort().flatMap(name => {
  const rel = `${dir}/${name}`;
  if (statSync(join(root, rel)).isDirectory()) return walk(rel);
  return name.endsWith('.test.mjs') ? [rel] : [];
});
tests.push(...walk('examples'));

// unreal-native passes the strict rules and uefn passes the default rules (labels, size, structure). unreal-features and
// unreal-import state plain practices backed by Epic documentation, so they are checked for structure and size only.
for (const args of [
  ['--test', ...tests],
  ['scripts/lint-skills.mjs', 'skills/unreal-native', '--require-claims', '--skill-md-labels'],
  ['scripts/lint-skills.mjs', 'skills/unreal-features', '--label-pattern', '.'],
  ['scripts/lint-skills.mjs', 'skills/uefn'],
  ['scripts/lint-skills.mjs', 'skills/unreal-import', '--label-pattern', '.'],
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) console.error(result.error);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
