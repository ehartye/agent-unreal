// The same dependency-free merge checks run locally and in CI. Native-engine
// acceptance (building, cooking and running Unreal) is separate and needs its documented engine setup.
//
//   node scripts/check.mjs                 the Node tests, then the lint of every folder under skills/
//   node scripts/check.mjs --no-tests      the lints only
//   node scripts/check.mjs --skill <name>  only the named skills' lints, with the flags the gate uses (repeat the
//                                          option or separate names with commas); the test step is skipped
// Every step runs even after one fails, so a single run shows every finding. The last line names what failed.
// Exit code 0 when everything passed, 1 when any step failed, 2 on a usage error.
// AGENT_UNREAL_ROOT points the run at another root for skills/ and the tests (lint-skills.mjs still comes from
// this folder, so a fixture root needs no copy of the scripts).
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { discoverSkills } from './lint-skills.mjs';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const LINT = join(SCRIPTS, 'lint-skills.mjs');
const DEFAULT_ROOT = resolve(SCRIPTS, '..');

// unreal-native passes the strict rules and uefn passes the default rules (labels, size, structure). the six domain skills and
// unreal-import state plain practices backed by Epic documentation, so they are checked for structure and size only.
// Every folder under skills/ with a SKILL.md is linted. A folder that is not in this table gets the default rules ([]),
// so a new skill fails its label rules until it complies or earns an entry here. An entry with no folder is an error,
// so a renamed skill cannot silently lose its strictness.
export const STRICTNESS = {
  'unreal-native': ['--require-claims', '--skill-md-labels'],
  uefn: [],
  'unreal-effects': ['--label-pattern', '.'],
  'unreal-animation': ['--label-pattern', '.'],
  'unreal-gameplay': ['--label-pattern', '.'],
  'unreal-procedural': ['--label-pattern', '.'],
  'unreal-rendering': ['--label-pattern', '.'],
  'unreal-editor-scripting': ['--label-pattern', '.'],
  'unreal-import': ['--label-pattern', '.'],
};

/**
 * The lints to run: [{ name, dir, flags }] for every folder under skillsDir that has a SKILL.md, sorted by folder.
 * Flags come from the table (copied), or [] for a folder the table does not name. With requireAll (the default) a table
 * entry that matches no skill folder throws an Error naming it.
 */
export function lintPlan(skillsDir, table = STRICTNESS, { requireAll = true } = {}) {
  const plan = discoverSkills(skillsDir).map((dir) => {
    const name = basename(dir);
    return { name, dir, flags: Object.hasOwn(table, name) ? [...table[name]] : [] };
  });
  if (requireAll) {
    const missing = Object.keys(table).filter((name) => !plan.some((p) => p.name === name));
    if (missing.length > 0) {
      throw new Error(`the strictness table names ${missing.join(', ')}, but ${skillsDir} has no such skill folder with a SKILL.md; rename the table entry with the skill`);
    }
  }
  return plan;
}

/**
 * The test files, root-relative with forward slashes: scripts/*.test.mjs, then every *.test.mjs under examples/, so a
 * new example scene adds its test by existing. A missing scripts/ or examples/ folder contributes nothing.
 */
export function discoverTests(root) {
  const list = (dir) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).sort() : []);
  const walk = (dir) => list(dir).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) return walk(rel);
    return name.endsWith('.test.mjs') ? [rel] : [];
  });
  return [...list('scripts').filter((name) => name.endsWith('.test.mjs')).map((name) => `scripts/${name}`), ...walk('examples')];
}

const USAGE = `usage: node scripts/check.mjs [--no-tests] [--skill <name>[,<name>...]]...
  (no options)    run the Node tests, then lint every folder under skills/
  --no-tests      skip the Node tests
  --skill <name>  lint only the named skills with the gate's flags (repeatable, comma-separated); skips the tests
  --help          print this text`;

/** { skills: null | string[], noTests, help }, or { error }. skills is null when no --skill was given. */
export function parseArgs(argv) {
  const parsed = { skills: null, noTests: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-tests') parsed.noTests = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--skill' || arg.startsWith('--skill=')) {
      const value = arg === '--skill' ? argv[++i] : arg.slice('--skill='.length);
      const names = (value ?? '').startsWith('--') ? [] : (value ?? '').split(',').map((name) => name.trim()).filter(Boolean);
      if (names.length === 0) return { error: '--skill needs a skill name' };
      parsed.skills = [...(parsed.skills ?? []), ...names];
    } else return { error: arg.startsWith('-') ? `unknown option ${arg}` : `unexpected argument ${arg}` };
  }
  return parsed;
}

/** Run one node child with its output inherited, so everything prints in order. True when it exited 0. */
function step(label, args, { cwd, env }) {
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
  if (result.error) console.error(`check: ${label}: ${result.error.message}`);
  return result.status === 0;
}

/** Runs the gate and returns the exit code. */
export function main(argv, env = process.env) {
  const args = parseArgs(argv);
  if (args.error) { console.error(`check: ${args.error}\n${USAGE}`); return 2; }
  if (args.help) { console.log(USAGE); return 0; }

  const override = env.AGENT_UNREAL_ROOT;
  const root = resolve(override || DEFAULT_ROOT);
  const skillsDir = join(root, 'skills');
  let plan;
  try {
    // A fixture root has only the skills it needs, so a table entry without a folder is an error on the real tree only.
    plan = lintPlan(skillsDir, STRICTNESS, { requireAll: !override });
  } catch (error) {
    console.error(`check: ${error.message}`);
    console.log('check: FAILED strictness table');
    return 1;
  }
  if (plan.length === 0) { console.error(`check: no skills found under ${skillsDir}`); return 2; }

  let selected = plan;
  if (args.skills) {
    const known = plan.map((p) => p.name);
    const unknown = [...new Set(args.skills.filter((name) => !known.includes(name)))];
    if (unknown.length > 0) {
      console.error(`check: unknown skill ${unknown.map((name) => `"${name}"`).join(', ')}; known skills: ${known.join(', ')}`);
      return 2;
    }
    selected = plan.filter((p) => args.skills.includes(p.name));
  }

  const runTests = args.skills === null && !args.noTests;
  const failed = [];
  if (runTests) {
    const tests = discoverTests(root);
    if (tests.length === 0) {
      console.error(`check: no *.test.mjs files under ${join(root, 'scripts')} or ${join(root, 'examples')}`);
      failed.push('tests');
    } else {
      // Node sets NODE_TEST_CONTEXT in the environment of a running test. A node --test child that inherits it
      // behaves differently by version: on Node 24 it exits 0 without running the files, so the step would pass with
      // nothing run; on Node 20.11 it runs the files but writes a serialized binary report instead of readable text.
      // Removing the variable gives a real, readable run on both.
      const testEnv = { ...env };
      delete testEnv.NODE_TEST_CONTEXT;
      if (!step('tests', ['--test', ...tests], { cwd: root, env: testEnv })) failed.push('tests');
    }
  }
  for (const { name, dir, flags } of selected) {
    if (!step(name, [LINT, dir, ...flags], { cwd: root, env })) failed.push(name);
  }

  const lints = `${selected.length} lint${selected.length === 1 ? '' : 's'}`;
  console.log(failed.length === 0 ? `check: ok (${runTests ? 'tests + ' : ''}${lints})` : `check: FAILED ${failed.join(', ')}`);
  return failed.length === 0 ? 0 : 1;
}

// Run only when started as the script, not when imported. The paths are compared after realpath, so starting the
// script through a symlink or a different letter case still runs the gate instead of silently doing nothing.
function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  const here = fileURLToPath(import.meta.url);
  try {
    return realpathSync.native(here) === realpathSync.native(resolve(entry));
  } catch {
    return here === resolve(entry);
  }
}

if (isEntryPoint()) process.exitCode = main(process.argv.slice(2));
