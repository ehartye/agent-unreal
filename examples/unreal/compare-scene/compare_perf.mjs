// node compare_perf.mjs <compare.json | folder holding it> [--shape-only]
// Judges the perf blocks of a compare.json receipt written by the comparison scene (AECompare.cpp). By default it expects the receipt of the `perf` set
// (compare.ps1 -Set perf) and checks that the GPU's own frame time moves with a GPU-side change and not with a CPU-side one; --shape-only checks only that every
// candidate's perf block is well formed, which is what any other set can be held to. Exit code 0 when every check passes, 1 when one fails, 2 for a usage error.
// No Unreal, no dependencies. The logic is in compare-perf-checks.mjs and tested without Unreal.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { evaluatePerf, notes, shapeProblems, summarize } from './compare-perf-checks.mjs';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
if (!target || !existsSync(target)) { console.error('usage: node compare_perf.mjs <compare.json | folder holding it> [--shape-only]'); process.exit(2); }
const file = statSync(target).isDirectory() ? join(target, 'compare.json') : target;
if (!existsSync(file)) { console.error(`not found: ${file}`); process.exit(2); }
let receipt;
try { receipt = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { console.error(`${file} is not JSON: ${error.message}`); process.exit(1); }

if (args.includes('--shape-only')) {
  const problems = shapeProblems(receipt);
  for (const p of problems) console.log(`FAIL  ${p}`);
  console.log(problems.length ? `${problems.length} problem(s)` : 'every perf block is well formed');
  process.exit(problems.length ? 1 : 0);
}
const checks = evaluatePerf(receipt);
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
for (const n of notes(receipt)) console.log(`NOTE  ${n}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
process.exit(passed === total ? 0 : 1);
