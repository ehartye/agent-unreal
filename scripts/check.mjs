// The same dependency-free merge checks run locally and in CI. Native-engine
// acceptance (building, cooking and running Unreal) is separate and needs its documented engine setup.
//
//   node scripts/check.mjs                 the Node tests, then the lint of every folder under skills/
//   node scripts/check.mjs --no-tests      the lints only
//   node scripts/check.mjs --skill <name>  only the named skills' lints, with the flags the gate uses (repeat the
//                                          option or separate names with commas); the test step is skipped
//   node scripts/check.mjs --file <name>   only the findings in the named file (a reference's name with or without .md, or
//                                          SKILL.md), from the skills that have it, with the gate's flags; repeatable; the
//                                          test step is skipped. Combine with --skill to name the skill.
//   node scripts/check.mjs --allow-orphan <file>
//                                          do not report that reference as an orphan before its SKILL.md row exists (repeatable)
//   node scripts/check.mjs --labels-since <ref>
//                                          compare against this git ref instead of the merge base with origin/main (or main)
// The gate also prints each skill's listing length and headroom and the trigger words two skills share (warnings only), and, in a
// run over every skill, scans every text file for invisible Unicode.
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
const UNICODE = join(SCRIPTS, 'scan-unicode.mjs');
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

// Skills whose label rule is still "any text" because of old unlabelled bullets. In these, a bullet added or changed since the base
// ref must carry a real label (--labels-since), so the backlog cannot grow while it is being cleared.
export const DIFF_AWARE = new Set(['unreal-effects', 'unreal-rendering']);

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

const USAGE = `usage: node scripts/check.mjs [--no-tests] [--skill <name>[,<name>...]]... [--file <name>]... [--allow-orphan <file>]... [--labels-since <ref>]
  (no options)           run the Node tests, then lint every folder under skills/ and scan every text file for invisible Unicode
  --no-tests             skip the Node tests
  --skill <name>         lint only the named skills with the gate's flags (repeatable, comma-separated); skips the tests and the scan
  --file <name>          show only the findings in this file (a reference's name with or without .md, or SKILL.md), from the skills
                         that have it (repeatable); skips the tests and the scan
  --allow-orphan <file>  do not report this reference as an orphan before its SKILL.md row exists (repeatable)
  --labels-since <ref>   bullets added or changed since this git ref need a real label in unreal-effects and unreal-rendering
                         (default: the merge base with origin/main, else main)
  --help                 print this text`;

/**
 * { skills: null | string[], files, allowOrphans, labelsSince: null | string, noTests, help }, or { error }. skills is null when no
 * --skill was given.
 */
export function parseArgs(argv) {
  const parsed = { skills: null, files: [], allowOrphans: [], labelsSince: null, noTests: false, help: false };
  // The value of --name <value> or --name=<value>; null when it is missing or is the next option.
  const valueOf = (arg, name, i) => {
    const value = arg === name ? argv[i + 1] : arg.slice(name.length + 1);
    return value === undefined || value.startsWith('--') ? null : value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const option = ['--skill', '--file', '--allow-orphan', '--labels-since'].find((name) => arg === name || arg.startsWith(`${name}=`));
    if (arg === '--no-tests') parsed.noTests = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (option) {
      const value = valueOf(arg, option, i);
      if (arg === option) i++;
      const names = (value ?? '').split(option === '--labels-since' ? '\0' : ',').map((name) => name.trim()).filter(Boolean);
      if (names.length === 0) return { error: `${option} needs a ${option === '--skill' ? 'skill name' : option === '--labels-since' ? 'git ref' : 'file name'}` };
      if (option === '--skill') parsed.skills = [...(parsed.skills ?? []), ...names];
      else if (option === '--file') parsed.files.push(...names);
      else if (option === '--allow-orphan') parsed.allowOrphans.push(...names);
      else parsed.labelsSince = names[0];
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

const git = (root, args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });

/**
 * The git ref the label rule compares with: the one asked for (it must resolve to a commit, or the answer is { error }), else the
 * merge base of HEAD with origin/main, else with main. { ref: null, note } when the root is not a git checkout or neither branch
 * exists, so a shallow clone or an exported tree keeps the any-text rule instead of failing.
 */
export function resolveLabelsRef(root, requested) {
  if (!existsSync(join(root, '.git'))) return { ref: null, note: 'not a git checkout' };
  if (requested) {
    const r = git(root, ['rev-parse', '--verify', '--quiet', `${requested}^{commit}`]);
    return r.status === 0 ? { ref: requested } : { error: `--labels-since ${requested} is not a commit in this checkout` };
  }
  for (const base of ['origin/main', 'main']) {
    if (git(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]).status !== 0) continue;
    const mergeBase = git(root, ['merge-base', 'HEAD', base]);
    if (mergeBase.status === 0 && mergeBase.stdout.trim()) return { ref: mergeBase.stdout.trim() };
  }
  return { ref: null, note: 'neither origin/main nor main exists here' };
}

/** Whether a skill folder has the named file: SKILL.md, or references/<name> with or without .md. */
function hasFile(dir, name) {
  const base = basename(name.replace(/\\/g, '/'));
  if (base === 'SKILL.md') return true;
  return existsSync(join(dir, 'references', base)) || existsSync(join(dir, 'references', `${base}.md`));
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
  if (args.files.length > 0) {
    // A file name picks the skills that have it, among those already selected; SKILL.md is in every skill, so name the skill too.
    const missing = args.files.filter((name) => !selected.some((p) => hasFile(p.dir, name)));
    if (missing.length > 0) {
      console.error(`check: no ${args.skills ? 'selected ' : ''}skill has the file ${missing.map((name) => `"${name}"`).join(', ')}`);
      return 2;
    }
    selected = selected.filter((p) => args.files.some((name) => hasFile(p.dir, name)));
  }
  const orphanless = args.allowOrphans.filter((name) => !selected.some((p) => hasFile(p.dir, name) && basename(name) !== 'SKILL.md'));
  if (orphanless.length > 0) {
    console.error(`check: --allow-orphan ${orphanless.map((name) => `"${name}"`).join(', ')} names no reference in the selected skills`);
    return 2;
  }

  // Bullets added or changed since the base need a real label in the diff-aware skills.
  let labelsRef = null;
  if (selected.some((p) => DIFF_AWARE.has(p.name))) {
    const resolved = resolveLabelsRef(root, args.labelsSince);
    if (resolved.error) { console.error(`check: ${resolved.error}`); return 2; }
    labelsRef = resolved.ref;
    if (!labelsRef) console.error(`check: label rule: ${resolved.note}, so ${[...DIFF_AWARE].join(' and ')} keep the any-text label rule here`);
  }

  const selection = args.skills !== null || args.files.length > 0;
  const runTests = !selection && !args.noTests;
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
    const extra = [
      ...(labelsRef && DIFF_AWARE.has(name) ? ['--labels-since', labelsRef] : []),
      ...args.files.flatMap((file) => ['--file', file]),
      ...args.allowOrphans.flatMap((file) => ['--allow-orphan', file]),
    ];
    if (!step(name, [LINT, dir, ...flags, ...extra], { cwd: root, env })) failed.push(name);
  }
  // Listing lengths and shared trigger words (warnings only), then the whole-checkout scan.
  if (args.files.length === 0 && !step('listing', [LINT, '--listing', ...selected.map((p) => p.dir)], { cwd: root, env })) failed.push('listing');
  if (!selection && !step('unicode', [UNICODE, '--quiet', root], { cwd: root, env })) failed.push('unicode');

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
