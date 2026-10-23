// node unity_build.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
// Validates skills/unreal-native/references/unreal-native-unity-builds.md against a real Unreal 5.8 install. It writes a throwaway code
// project in the OS temp folder with one runtime module (module/UnityProbe: two source files whose file-scope names clash only when they
// share a unity file, plus the module file) and builds the Editor target with Unreal Build Tool several times, each with a different
// grouping of the files. Project one has no git repository: small module, adaptive unity left on, adaptive unity off (the clash), unity off,
// the fixed sources (variants/fixed), a smaller chunk size. Project two is a git repository: clean, one file edited, committed, rewritten.
// After every build it runs a follow-on step (it reads the module binary's timestamp) through runIfBuilt from ../native-build.mjs, which
// skips the step after a failed build and says so. The compiler and Windows SDK are discovered from the installed Visual Studio.
// Takes about six minutes (two first builds of about a minute each, then short ones). Exit code 0 when every check passes. Not part of
// node scripts/check.mjs; the checks are tested there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, cpSync, readdirSync, statSync, appendFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverToolchain, writeCodeProject, buildEditor, runIfBuilt } from '../native-build.mjs';
import { evaluate, summarize, compilerDiagnostics } from './unity-build-checks.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = args.includes('--keep');
const engine = flag('--engine') || process.env.UE_ROOT;
if (!engine) { console.error('usage: node unity_build.mjs --engine <UE_5.8 folder> [--keep] [--compiler <x.y.z>] [--sdk <10.0.n.n>]'); process.exit(2); }
if (!existsSync(join(engine, 'Engine', 'Build', 'BatchFiles', 'Build.bat'))) { console.error(`not found: ${join(engine, 'Engine', 'Build', 'BatchFiles', 'Build.bat')}`); process.exit(2); }

const here = import.meta.dirname;
const name = 'UnityProbeProject';
const moduleDir = join(here, 'module', 'UnityProbe');
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const toolchain = discoverToolchain({ compiler: flag('--compiler'), sdk: flag('--sdk') });
console.log(`Unity build validation; toolchain: compiler ${toolchain.compiler}, SDK ${toolchain.sdk} (${toolchain.notes.join('; ')})`);

/** One throwaway project: write sources and rules, build, and record what the build did. */
function makeProject(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, 'Saved'), { recursive: true });
  const uproject = writeCodeProject({ root, name, modules: [{ name: 'UnityProbe', type: 'Runtime', sourceDir: moduleDir }] });
  const source = join(root, 'Source', 'UnityProbe');
  const unityDir = join(root, 'Intermediate', 'Build', 'Win64', 'x64', 'UnrealEditor', 'Development', 'UnityProbe');
  const dll = join(root, 'Binaries', 'Win64', 'UnrealEditor-UnityProbe.dll');
  const dllTime = () => (existsSync(dll) ? statSync(dll).mtimeMs : 0);

  /** The module rules with `settings` in place of the marked line; the phase label keeps the file's text, and so its timestamp, new. */
  const writeRules = (label, settings) => {
    const text = readText(join(moduleDir, 'UnityProbe.Build.cs'))
      .replace(/^[ \t]*MinSourceFilesForUnityBuildOverride = 1;.*$/m, settings.map((s) => `\t\t${s}`).join('\n'));
    writeFileSync(join(source, 'UnityProbe.Build.cs'), `${text}\n// phase ${label}\n`);
  };
  const writeSources = (fixed) => {
    for (const f of ['ProbeAlpha.cpp', 'ProbeBeta.cpp']) cpSync(join(fixed ? join(here, 'variants', 'fixed') : moduleDir, f), join(source, f));
  };
  const unityFiles = () => {
    const out = {};
    if (existsSync(unityDir)) for (const f of readdirSync(unityDir)) if (/^Module\.UnityProbe(\.\d+)?\.cpp$/.test(f)) out[f] = readText(join(unityDir, f));
    return out;
  };
  const clearUnityFiles = () => { for (const f of Object.keys(unityFiles())) rmSync(join(unityDir, f)); };

  /** Builds the Editor target, then the guarded follow-on step. `regenerates`: the rules or sources changed, so stale unity files are cleared first. */
  const build = async (label, { extraArgs = [], regenerates = true } = {}) => {
    if (regenerates) clearUnityFiles();
    const logPath = join(root, 'Saved', `${label}.log`);
    const before = dllTime();
    const result = await buildEditor({ engine, uproject, name, toolchain, logPath, extraArgs });
    const log = readText(logPath);
    const errors = compilerDiagnostics(log).filter((d) => d.kind === 'error');
    console.log(`  ${label}: exit ${result.exit}, ${result.seconds} s${result.timedOut ? ' (timed out)' : ''}${errors.length ? `; errors ${[...new Set(errors.map((e) => e.code))].join(', ')}` : ''}`);
    const followOn = await runIfBuilt(result, () => `module binary built ${new Date(dllTime()).toISOString()}`, { label: `  ${label}: replay stand-in`, log: (l) => console.log(l) });
    return { exit: result.exit, timedOut: result.timedOut, log, unity: unityFiles(), dllChanged: dllTime() !== before, followOn: { ran: followOn.ran, reason: followOn.reason } };
  };
  return { root, source, writeRules, writeSources, build };
}

const phases = {};
const roots = [];

// Project one: no git repository. The installed engine treats every writable source file as the working set (SourceFileWorkingSet.cs).
const one = makeProject('unity-build-');
roots.push(one.root);
console.log(`project one (no git) in ${one.root}`);
one.writeSources(false);
one.writeRules('small', []);
phases.small = await one.build('small');
one.writeRules('adaptive', ['MinSourceFilesForUnityBuildOverride = 1;']);
phases.adaptive = await one.build('adaptive');
phases.clash = await one.build('clash', { extraArgs: ['-DisableAdaptiveUnity'] });
one.writeRules('off', ['bUseUnity = false;']);
phases.off = await one.build('off', { extraArgs: ['-DisableAdaptiveUnity'] });
one.writeSources(true);
one.writeRules('fixed', ['MinSourceFilesForUnityBuildOverride = 1;']);
phases.fixed = await one.build('fixed', { extraArgs: ['-DisableAdaptiveUnity'] });
one.writeSources(false);
one.writeRules('chunks', ['MinSourceFilesForUnityBuildOverride = 1;', 'NumIncludedBytesPerUnityCPPOverride = 1;']);
phases.chunks = await one.build('chunks', { extraArgs: ['-DisableAdaptiveUnity'] });

// Project two: a git repository, so the working set is what `git status` lists.
const gitAvailable = spawnSync('git', ['--version'], { windowsHide: true }).status === 0;
if (!gitAvailable) {
  console.log('git not found: the four git phases are skipped and their checks fail');
} else {
  const two = makeProject('unity-build-git-');
  roots.push(two.root);
  console.log(`project two (git) in ${two.root}`);
  const git = (...a) => spawnSync('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', ...a], { cwd: two.root, encoding: 'utf8', windowsHide: true });
  two.writeSources(false);
  two.writeRules('git-clean', ['MinSourceFilesForUnityBuildOverride = 1;']);
  writeFileSync(join(two.root, '.gitignore'), 'Intermediate/\nBinaries/\nSaved/\nDerivedDataCache/\n');
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'probe sources');
  phases.gitClean = await two.build('git-clean');
  appendFileSync(join(two.source, 'ProbeBeta.cpp'), '\n// edited\n');
  phases.gitDirty = await two.build('git-dirty', { regenerates: false });
  git('add', '-A'); git('commit', '-q', '-m', 'edit');
  phases.gitCommitted = await two.build('git-committed', { regenerates: false });
  const now = new Date();
  utimesSync(join(two.source, 'ProbeBeta.cpp'), now, now);   // what a checkout or a rebase does to a committed file
  phases.gitRewritten = await two.build('git-rewritten', { regenerates: false });
}

const checks = evaluate(phases);
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
const { passed, total } = summarize(checks);
console.log(`${passed} of ${total} checks passed`);
for (const r of roots) { if (keep) console.log(`kept ${r}`); else rmSync(r, { recursive: true, force: true }); }
process.exit(passed === total ? 0 : 1);
