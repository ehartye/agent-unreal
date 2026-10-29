// node mh_probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--phase run|prepare|judge] [--only create,assemble,drive,repeat] [--keep] [--plan] [--names]
//                    [--project <folder>] [--out <folder>] [--preset <name>] [--camera-flip] [--timeout-minutes <n>] [--skip-core-data-check]
// The MetaHuman probe: can a script create a MetaHuman Character from a preset, rig it and fetch its textures (the Epic cloud calls, with a sign-in a person does in the editor),
// assemble it with build_meta_human, spawn it in a level and move its face. Prepared 2026-10-29; four engine runs (see README.md) found and fixed faults in the probe, then tested the
// engine. Not part of node scripts/check.mjs; the pure checks are tested there (mh-probe.test.mjs).
//   create    a MetaHuman Character asset from a preset, edited and committed, auto-rigged and textured with blocking=True, read back
//   assemble  build_meta_human (the optimized pipeline first, the Cine one if it leaves no Blueprint), the Blueprint spawned in a level, a frame with the actor hidden and a frame with it shown
//   drive     face control curves for neutral, jaw open and smile, one frame each, and the route that moved the face
//   repeat    the create stage again in a closed and reopened editor, started with nobody at the editor: does the sign-in come back
// Phases. run (default) builds a throwaway project in the OS temp folder, starts a WINDOWED rendering editor (no -nullrhi, no -RenderOffScreen, no -unattended, so the editor's
// sign-in prompt can show) for the create, assemble and drive groups together and a second one for repeat, judges the reports and screenshots and deletes the project when every check
// passes (--keep leaves it). prepare builds the same project and prints numbered INTERACTIVE steps: open the project yourself, sign in when the prompt appears; judge --project <folder>
// reads the saved reports, as the editor toggle of rendering_probes does. --names is a headless check (UnrealEditor-Cmd, -nullrhi, no cloud, no sign-in) that the names the editor
// script uses exist in the install. --plan prints what would run and starts nothing. --out <folder> copies the screenshots and reports there before the project is deleted.
// The run keeps no MetaHuman asset: the project is deleted on a clean run, and nothing is written to the repository.
// Exit code 0 when every check passes, 1 when a check fails, 2 on a usage error or a missing engine or core data folder.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { decodePng } from '../niagara_toolsets/nts-probe-assets.mjs';
import { flushLine, planCleanup } from '../rendering_probes/rp-validate-checks.mjs';
import { USAGE, buildPlan, engineIni, evaluateNames, evaluateProbes, launchMinutes, launchesFor, ownerSteps, parseOptions, progressLine, repeatMayRun, shotNames, summarize } from './mh-probe-checks.mjs';

const say = (text) => flushLine(text), complain = (text) => flushLine(text, { fd: 2 });
const options = parseOptions(process.argv.slice(2), process.env);
if (options.error) { complain(`${options.error}\n${USAGE}`); process.exit(2); }
const here = import.meta.dirname;
const script = resolve(here, 'mh_probe_editor.py');
const forward = (p) => String(p).replaceAll('\\', '/');
const readJson = (path) => { try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined; } catch { return undefined; } };
const PLUGINS = ['PythonScriptPlugin', 'EditorScriptingUtilities', 'MetaHumanCharacter'];

/** The plugin's Optional content ("MetaHuman Creator Core Data" from the Epic Games Launcher): presets, the texture synthesis model and body textures. The editor warns and limits itself without it. */
function coreDataFolder(engine) { return join(engine, 'Engine', 'Plugins', 'MetaHuman', 'MetaHumanCharacter', 'Content', 'Optional'); }
function coreDataPresent(engine) {
  const dir = coreDataFolder(engine);
  return existsSync(join(dir, 'TextureSynthesis')) && existsSync(join(dir, 'BodyTextures'));
}

function makeProject(root, plan, { startup }) {
  mkdirSync(join(root, 'Config'), { recursive: true });
  mkdirSync(join(root, 'Saved', 'Logs'), { recursive: true });
  const uproject = join(root, 'MhProbe.uproject');
  writeFileSync(uproject, JSON.stringify({ FileVersion: 3, EngineAssociation: '5.8', Plugins: PLUGINS.map((Name) => ({ Name, Enabled: true })) }, null, 2));
  // the start-up script runs the probe when the project opens, so a person only has to open it; the headless names mode runs the script itself and needs none.
  // The MetaHuman project settings go in either way: they need an editor restart, so they must be in the file before the first launch.
  writeFileSync(join(root, 'Config', 'DefaultEngine.ini'), engineIni({ script: forward(script), startup }));
  writeFileSync(join(root, 'Saved', 'mh-plan.json'), JSON.stringify(plan, null, 2));
  return uproject;
}

function stopProjectProcesses(root) {
  if (process.platform !== 'win32') return;
  const needle = root.replace(/'/g, "''");
  spawnSync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle}') -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],
  { stdio: 'ignore', windowsHide: true });
}

/** A screenshot's file: the engine adds a number to the name it was asked for, so mh_neutral matches mh_neutral00000.png and not mh_neutral_again00000.png. */
function findShot(root, name) {
  const pattern = new RegExp(`^${name}\\d*\\.png$`);
  const walk = (dir) => {
    if (!existsSync(dir)) return undefined;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { const hit = walk(full); if (hit) return hit; } else if (pattern.test(entry)) return full;
    }
    return undefined;
  };
  return walk(join(root, 'Saved', 'Screenshots'));
}

function loadImages(root, groups) {
  const images = {}, notes = [];
  for (const name of shotNames(groups)) {
    const file = findShot(root, name);
    if (!file) { notes.push(`screenshot ${name} not found under ${join(root, 'Saved', 'Screenshots')}`); continue; }
    try { images[name] = decodePng(readFileSync(file)); images[name].file = file; } catch (error) { notes.push(`screenshot ${name}: ${error.message}`); }
  }
  return { images, notes };
}

function copyOut(root, out, images) {
  mkdirSync(out, { recursive: true });
  const saved = join(root, 'Saved');
  for (const name of existsSync(saved) ? readdirSync(saved) : []) if (/^mh-(launch-\d+|plan)\.json$/.test(name)) copyFileSync(join(saved, name), join(out, name));
  for (const [name, image] of Object.entries(images)) if (image.file) copyFileSync(image.file, join(out, `${name}.png`));
  say(`copied reports and screenshots to ${out}`);
}

function printChecks(checks) {
  for (const c of checks) say(`${c.pass ? 'PASS' : 'FAIL'}  [${c.group}] ${c.name}\n      claim: ${c.claim}\n      ${c.detail}`);
  const { passed, total } = summarize(checks);
  say(`${passed} of ${total} probe checks passed`);
  return passed === total;
}

function finish({ checks, anyReport, root, logPath, keep, out, images }) {
  const clean = printChecks(checks);
  if (out) copyOut(root, resolve(out), images || {});
  const cleanup = planCleanup({ keep, report: anyReport ? {} : undefined, checks, root, logPath });
  if (cleanup.message) say(cleanup.message);
  if (cleanup.remove) rmSync(root, { recursive: true, force: true });
  process.exit(clean ? 0 : 1);
}

// ---------------------------------------------------------------- judge needs no engine
if (options.phase === 'judge') {
  const root = resolve(options.project);
  const plan = readJson(join(root, 'Saved', 'mh-plan.json'));
  if (!plan) { complain(`no ${join(root, 'Saved', 'mh-plan.json')}: is --project the folder prepare printed?`); process.exit(2); }
  const launches = plan.launches.map((_, i) => {
    const report = readJson(join(root, 'Saved', `mh-launch-${i + 1}.json`));
    return { report, timedOut: report ? report.done !== true : false };   // a report that never reached done means the editor was closed or stopped before the launch finished
  });
  const { images, notes } = loadImages(root, plan.groups);
  for (const note of notes) say(note);
  finish({ checks: evaluateProbes({ groups: plan.groups, plan, launches, images }), anyReport: launches.some((l) => l.report), root, logPath: join(root, 'Saved', 'Logs'), keep: options.keep, out: options.out, images });
}

const { engine, groups, keep, phase } = options;
const editor = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
const cmd = join(engine, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe');
const plan = buildPlan({ groups, preset: options.preset, cameraFlip: options.cameraFlip, timeoutMinutes: options.timeoutMinutes });
const launches = launchesFor(groups);

if (options.plan) {
  say(`plan: ${options.names ? 'names (headless)' : `${phase}: ${groups.join(', ')}`} on ${engine}`);
  if (options.names) say(`  UnrealEditor-Cmd <project> -run=pythonscript -script=${script} -unattended -nullrhi   (MH_MODE=names; no cloud call, no sign-in)`);
  else {
    launches.forEach((l, i) => say(`  launch ${i + 1} (${l.join(', ')}): UnrealEditor <project> -nosplash -nosound -notraceserver   windowed; the project's start-up script is ${script}; timeout ${launchMinutes(l, options.timeoutMinutes)} min`));
    say(`  core data folder: ${coreDataFolder(engine)} (${coreDataPresent(engine) ? 'present' : 'MISSING'})`);
    say('  owner steps:');
    ownerSteps({ uproject: '<project>/MhProbe.uproject', root: '<project>', launches, interactive: phase === 'prepare' }).forEach((s, i) => say(`    ${i + 1}. ${s}`));
  }
  process.exit(0);
}
if (!existsSync(editor)) { complain(`not found: ${editor}`); process.exit(2); }
if (!existsSync(cmd)) { complain(`not found: ${cmd}`); process.exit(2); }

// ---------------------------------------------------------------- names: headless, no cloud
if (options.names) {
  const root = mkdtempSync(join(tmpdir(), 'mh-names-'));
  const uproject = makeProject(root, plan, { startup: false });
  const report = join(root, 'Saved', 'mh-names.json'), log = join(root, 'Saved', 'Logs', 'names.log');
  say(`MetaHuman names check in ${root} (headless; no cloud request, no sign-in)`);
  const result = spawnSync(cmd, [uproject, '-run=pythonscript', `-script=${script}`, `-abslog=${log}`, '-unattended', '-nullrhi', '-nosplash', '-nopause', '-nosound', '-notraceserver'],
    { env: { ...process.env, MH_MODE: 'names', MH_REPORT: report }, stdio: 'ignore', timeout: 900000, windowsHide: true });
  say(`  exit ${result.status}${result.error ? ` (${result.error.message})` : ''}`);
  stopProjectProcesses(root);
  const parsed = readJson(report);
  finish({ checks: evaluateNames(parsed), anyReport: Boolean(parsed), root, logPath: log, keep });
}

// ---------------------------------------------------------------- prepare and run need the core data folder
if (!options.skipCoreDataCheck && !coreDataPresent(engine)) {
  complain(`MetaHuman Creator core data is not installed: ${coreDataFolder(engine)} has no TextureSynthesis and BodyTextures folders.\n`
    + 'The plugin ships its presets, texture synthesis model and body textures in that Optional folder, and the editor limits itself without it. Install "MetaHuman Creator Core Data" for this engine in the Epic Games Launcher\n'
    + '(Library, the engine version, Options) and rerun. A stop here is before the engine starts and does not count toward a question\'s cap. Pass --skip-core-data-check to try without it.');
  process.exit(2);
}

const root = options.project ? resolve(options.project) : mkdtempSync(join(tmpdir(), 'mh-probe-'));
const uproject = makeProject(root, plan, { startup: true });
if (phase === 'prepare') {
  say(`MetaHuman probe project: ${root}`);
  say('INTERACTIVE. Do these steps yourself:');
  ownerSteps({ uproject, root, launches, interactive: true }).forEach((s, i) => say(`  ${i + 1}. ${s}`));
  process.exit(0);
}

say(`MetaHuman probe in ${root} (${groups.join(', ')})`);
say('INTERACTIVE for the first launch. Owner steps:');
ownerSteps({ uproject, root, launches, interactive: false }).forEach((s, i) => say(`  ${i + 1}. ${s}`));

/** Starts the editor and waits for it to exit or for `minutes` to pass, printing a progress line from the launch report every 30 s so a long quiet stage does not look stuck. */
function runEditor(args, env, minutes, report) {
  return new Promise((resolveRun) => {
    const began = Date.now();
    let settled = false, timedOut = false, last = '', quiet = 0;
    const child = spawn(editor, args, { env, stdio: 'ignore' });
    const done = (result) => { if (settled) return; settled = true; clearTimeout(limit); clearInterval(beat); resolveRun({ timedOut, ...result }); };
    const limit = setTimeout(() => { timedOut = true; child.kill(); stopProjectProcesses(root); }, minutes * 60000);
    const beat = setInterval(() => {
      const line = progressLine(readJson(report));
      quiet = line === last ? quiet + 1 : 0;
      last = line;
      if (quiet === 0 || quiet % 4 === 0) say(`    ${Math.round((Date.now() - began) / 1000)} s: ${line}`);
    }, 30000);
    child.on('error', (error) => done({ status: null, error }));
    child.on('exit', (status) => done({ status }));
  });
}

const results = [];
for (let i = 0; i < launches.length; i++) {
  const stages = launches[i], isRepeat = stages.includes('repeat');
  // the repeat launch needs a sign-in to exist, not a clean first launch: a first launch that ended with errors (or was closed after its create stage passed) still lets it run
  if (isRepeat && i > 0 && !repeatMayRun(results[0])) {
    say('  repeat: skipped, the first launch left no finished report and its create stage did not pass (the question stays not run)');
    results.push({});
    continue;
  }
  const report = join(root, 'Saved', `mh-launch-${i + 1}.json`), log = join(root, 'Saved', 'Logs', `launch-${i + 1}.log`);
  rmSync(report, { force: true });
  const minutes = launchMinutes(stages, options.timeoutMinutes);
  say(`  launch ${i + 1} (${stages.join(', ')}): started${isRepeat ? '; step away from the editor now' : '; keep the editor window in front and leave it open, it closes itself'}`);
  const started = Date.now();
  const result = await runEditor([uproject, `-abslog=${log}`, '-nosplash', '-nosound', '-notraceserver'], { ...process.env, MH_REPORT: report, MH_LAUNCH: String(i + 1) }, minutes, report);
  const timedOut = result.timedOut;
  say(`  launch ${i + 1}: exit ${result.status}${timedOut ? ' (timed out)' : ''}${result.error ? ` (${result.error.message})` : ''}, ${Math.round((Date.now() - started) / 1000)} s, report ${existsSync(report) ? 'written' : 'NOT written'}`);
  stopProjectProcesses(root);
  results.push({ report: readJson(report), timedOut, exit: result.status });
}

const { images, notes } = loadImages(root, groups);
for (const note of notes) say(note);
finish({ checks: evaluateProbes({ groups, plan, launches: results, images }), anyReport: results.some((r) => r.report), root, logPath: join(root, 'Saved', 'Logs'), keep, out: options.out, images });
