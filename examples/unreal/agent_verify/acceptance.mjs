import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, cpSync, openSync, closeSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateDocument, validateReceipt, verifySourceFiles, sha256 } from '../../../scripts/agent-verify/contracts.mjs';
import { collectSourceFiles, readArtifact, readWav, rmsDb } from '../../../scripts/agent-verify/artifacts.mjs';
import { validateRequest, verifyLifecycle, verifyIdentity } from '../../../scripts/lib/unreal-run/contracts.mjs';
import { sourceIdentity, verifyArtifactFiles, observeToolchain } from '../../../scripts/lib/unreal-run/identity.mjs';
import { loadConfiguration, operationCommand } from '../../../scripts/lib/unreal-run/controller.mjs';
import { parseReport, verdict } from '../automation_test/automation_report.mjs';
import { scenarios } from './scenarios.mjs';
import { verifyComparison } from './comparison.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const json = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const write = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const expectedTests = ['AgentVerify.A2.LiveNamesBeforeActions', 'AgentVerify.A2.RefusalReceiptHasZeroActions', 'AgentVerify.A2.StructuralPrevalidation', 'AgentVerify.A3.EligibilityAndUnavailableMetrics', 'AgentVerify.A3.NearestRankStatistics', 'AgentVerify.A4.FullPhaseAudioRequired', 'AgentVerify.A4.RealFrameHoldAndCompileRestart', 'ObservationSample.Domain.Travel.ReleasedAxisStopsMovement'].sort();

const buildArguments = (local) => [`-CompilerVersion=${local.compiler}`, `-WindowsSDKVersion=${local.sdk}`, '-NoUBTMakefiles'];

// A retained build remains evidence only while its exact inputs and products still exist.
export function validateBuildEvidence(directory, config, local) {
  const requestBytes = readArtifact(directory, 'request.json'), request = JSON.parse(requestBytes);
  const lifecycle = JSON.parse(readArtifact(directory, 'lifecycle.json')), identity = JSON.parse(readArtifact(directory, 'identity.json'));
  const current = sourceIdentity(config), expected = operationCommand('build', config, buildArguments(local));
  const errors = [...validateRequest(request)];
  const lifecycleResult = verifyLifecycle(lifecycle, { requestId: request.id, requestHash: sha256(requestBytes) });
  const identityResult = verifyIdentity(identity, lifecycle, { source: current, operation: 'build' });
  const artifacts = verifyArtifactFiles(identity);
  errors.push(...lifecycleResult.errors, ...identityResult.errors, ...artifacts.errors);
  if (current.dirty || identity.source?.dirty !== false) errors.push('Build source must be clean and unchanged');
  if (request.operation !== 'build' || resolve(request.cwd) !== resolve(config.sourceRoot) || resolve(request.executable) !== resolve(expected.executable) || JSON.stringify(request.arguments) !== JSON.stringify(expected.arguments)) errors.push('Build request does not match current project, engine, target or configuration');
  if (identity.target?.name !== config.editorTarget || identity.target?.platform !== config.platform || identity.target?.configuration !== config.configuration) errors.push('Build target does not match current configuration');
  if (sha256(readFileSync(join(config.engine, 'Engine/Build/Build.version'))) !== identity.engine?.buildVersionSha256 || sha256(readFileSync(join(config.engine, 'Engine/Binaries/Win64/UnrealEditor.exe'))) !== identity.engine?.executableSha256) errors.push('Observed engine bytes changed');
  const toolchain = observeToolchain(readArtifact(directory, 'stdout.log').toString('utf8') + '\n' + readArtifact(directory, 'stderr.log').toString('utf8'));
  if (toolchain.compiler !== identity.toolchain?.compiler || toolchain.sdk !== identity.toolchain?.sdk || toolchain.logSha256 !== identity.toolchain?.logSha256 || toolchain.sdk !== local.sdk) errors.push('Actual toolchain log binding failed');
  if (errors.length) throw new Error(`Build evidence refused: ${errors.join('; ')}`);
  return { valid: true, source: current, lifecycle: lifecycleResult, identity: identityResult, artifacts, toolchain };
}

function reuseBuild(directory, destination, config, local) {
  const validation = validateBuildEvidence(directory, config, local), inventory = fileInventory(directory);
  mkdirSync(destination, { recursive: true });
  const evidence = join(destination, 'launcher'); cpSync(directory, evidence, { recursive: true });
  const copied = validateBuildEvidence(evidence, config, local);
  if (JSON.stringify(fileInventory(evidence)) !== JSON.stringify(inventory)) throw new Error('Reused build evidence changed while copying');
  write(join(destination, 'reused-build.json'), { schema_version: 1, kind: 'validated_prior_build', original_directory: resolve(directory), inventory, validation, copied });
  return { evidence, lifecycle: json(join(evidence, 'lifecycle.json')) };
}

export function shortenRecording(bytes) {
  const wav = readWav(bytes), frames = Math.max(1, Math.floor(wav.frame_count / 4));
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    if (bytes.toString('ascii', offset, offset + 4) === 'data') {
      const newSize = size / wav.frame_count * frames, output = Buffer.from(bytes.subarray(0, offset + 8 + newSize));
      output.writeUInt32LE(output.length - 8, 4); output.writeUInt32LE(newSize, offset + 4);
      return output;
    }
    offset += 8 + size + size % 2;
  }
  throw new Error('Recording has no data chunk');
}

export function observation(directory, requestFile, source) {
  const receipt = json(join(directory, 'receipt.json')), requestBytes = readFileSync(requestFile), request = JSON.parse(requestBytes);
  const manifestBytes = readArtifact(source, 'source-version.json'), manifest = JSON.parse(manifestBytes);
  const state = verifySourceFiles(manifest, collectSourceFiles(source, manifest));
  const expectedSource = { plugin_version: manifest.plugin_version, manifest_sha256: sha256(manifestBytes), state: state.state, modified_files: state.modified_files };
  const artifacts = Object.fromEntries((receipt.artifacts ?? []).map((entry) => { try { return [entry.path, readArtifact(directory, entry.path)]; } catch { return [entry.path, null]; } }));
  return { receipt, request, artifacts, options: { requestSha256: sha256(requestBytes), expectedSource, artifacts }, validation: validateReceipt(receipt, request, { requestSha256: sha256(requestBytes), expectedSource, artifacts }) };
}

export function judgeScenario(scenario, observed, adapter) {
  const errors = [];
  const { receipt, validation } = observed;
  if (!validation.valid || validation.outcome !== scenario.outcome) errors.push('Unexpected independent observation verdict');
  if (scenario.refusal && (!validation.refusal?.some((issue) => issue.code === scenario.refusal.code && issue.path === scenario.refusal.path) || receipt.execution.actions_executed !== 0 || adapter.commands !== 0 || adapter.presses !== 0)) errors.push('Expected exact zero-action validation refusal was not observed');
  if (!adapter.pawn_available || adapter.post_completion_frames < 4 || adapter.axis_after_release !== 0 || adapter.key_held_after_release !== false) errors.push('Actual mapped input release was not observed after completion');
  if (scenario.mapped && (!(adapter.position_x > 0) || adapter.presses !== 1 || adapter.releases < 1 || receipt.execution.actions_executed < 2)) errors.push('Production mapping did not move the pawn and release its marked key');
  if (scenario.id === 'absent-audio' && !receipt.audio.every((audio) => !audio.available && audio.reason === 'audio_tap_unavailable')) errors.push('Missing audio tap did not fail distinctly');
  if (scenario.id === 'cancelled' && receipt.reason !== 'sample_cancelled') errors.push('Cancellation reason missing');
  return { passed: errors.length === 0, errors, outcome: validation.outcome, validation };
}

function launch(operation, configFile, directory, timeout, args = []) {
  mkdirSync(directory, { recursive: true });
  const evidence = join(directory, 'launcher');
  const command = [join(root, 'scripts/unreal-run.mjs'), operation, '--config', configFile, '--evidence', evidence, '--timeout', String(timeout), '--wait', '60', '--', ...args];
  write(join(directory, 'command.json'), { executable: process.execPath, arguments: command, shell: false });
  const out = openSync(join(directory, 'controller.stdout.log'), 'wx'), err = openSync(join(directory, 'controller.stderr.log'), 'wx');
  const run = spawnSync(process.execPath, command, { shell: false, windowsHide: true, stdio: ['ignore', out, err] }); closeSync(out); closeSync(err);
  const bytes = readFileSync(join(evidence, 'request.json')), request = JSON.parse(bytes), lifecycle = json(join(evidence, 'lifecycle.json'));
  const validation = verifyLifecycle(lifecycle, { requestId: request.id, requestHash: sha256(bytes) });
  const result = { exitCode: run.status, validation, lifecycle };
  write(join(directory, 'launch-result.json'), result);
  if (run.status !== 0 || !validation.valid) throw new Error(`${operation} lifecycle failed; see ${directory}`);
  return { ...result, evidence };
}

function fileInventory(directory, relative = '') {
  return readdirSync(join(directory, relative), { withFileTypes: true }).flatMap((entry) => {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error('Evidence symlink refused');
    if (entry.isDirectory()) return fileInventory(directory, path);
    const bytes = readFileSync(join(directory, path)); return [{ path, bytes: bytes.length, sha256: sha256(bytes) }];
  });
}

export function acceptance({ project, evidence }) {
  const sample = resolve(project), output = resolve(evidence);
  if (existsSync(output)) throw new Error('Fresh evidence directory required');
  mkdirSync(output, { recursive: true });
  const report = { schema_version: 1, passed: false, started: new Date().toISOString(), criteria: { A1: false, A2: false, A4: false, A6: false }, scenarios: [], errors: [] };
  try {
    const configFile = join(sample, 'launcher.local.json'), config = loadConfiguration(configFile), local = json(join(sample, 'acceptance.local.json'));
    const before = sourceIdentity(config); report.source = before;
    if (before.dirty) throw new Error('Disposable sample source must be committed and clean before acceptance');
    const supplied = join(sample, 'Plugins/AgentVerify'), source = join(output, 'source'); cpSync(supplied, source, { recursive: true, filter: (path) => !/[\\/](Binaries|Intermediate|Saved)([\\/]|$)/.test(path) });
    const manifest = json(join(source, 'source-version.json'));
    if (verifySourceFiles(manifest, collectSourceFiles(source, manifest)).state !== 'pristine') throw new Error('Sample must begin with pristine supplied AgentVerify source');
    const build = local.prior_build
      ? reuseBuild(resolve(sample, local.prior_build), join(output, 'build'), config, local)
      : launch('build', configFile, join(output, 'build'), 600, buildArguments(local));
    const buildIdentity = json(join(build.evidence, 'identity.json'));
    const identity = verifyIdentity(buildIdentity, build.lifecycle, { source: before, operation: 'build' }), artifacts = verifyArtifactFiles(buildIdentity);
    write(join(output, 'build/identity-validation.json'), { identity, artifacts });
    if (!identity.valid || !artifacts.valid) throw new Error('Build source/product identity failed');
    const automationRoot = join(output, 'automation');
    launch('test', configFile, automationRoot, 180, ['-nullrhi', '-nosound', '-unattended', '-notraceserver', '-stdout', '-FullStdOutLogOutput', '-ExecCmds=Automation RunTests AgentVerify+ObservationSample.Domain; Quit', `-ReportExportPath=${join(automationRoot, 'report')}`]);
    const automation = verdict(parseReport(readFileSync(join(automationRoot, 'report/index.json'), 'utf8')), { minTests: 8 });
    write(join(automationRoot, 'validation.json'), automation);
    if (!automation.ok || automation.counts.succeeded !== 8 || automation.counts.succeededWithWarnings !== 0 || JSON.stringify(automation.tests.map((test) => test.path).sort()) !== JSON.stringify(expectedTests) || automation.tests.some((test) => test.errors !== 0 || test.warnings !== 0)) throw new Error('Expected the exact eight successful native rule tests');
    for (const scenario of scenarios()) {
      const dir = join(output, scenario.id); mkdirSync(dir);
      const requestFile = join(dir, 'request.json'); write(requestFile, scenario.document);
      const prevalidation = validateDocument(scenario.document); write(join(dir, 'prevalidation.json'), prevalidation);
      if (!prevalidation.valid && scenario.refusal?.code !== 'schema.const') throw new Error(`Unexpected prelaunch rejection: ${scenario.id}`);
      const observationDir = join(dir, 'observation');
      const args = ['-RenderOffScreen', '-unattended', '-nosplash', '-notraceserver', '-NoGamepad', '-windowed', '-ResX=640', '-ResY=360', '-ForceRes', '-stdout', '-FullStdOutLogOutput', '-ExecCmds=t.MaxFPS 60', `-AVRequest=${requestFile}`, `-AVOutput=${observationDir}`,
        ...(scenario.audio ? ['-AudioMixer', '-ini:Engine:[Audio]:UnfocusedVolumeMultiplier=1.0'] : ['-nosound']), ...(scenario.cancelAfter ? [`-AVCancelAfter=${scenario.cancelAfter}`] : [])];
      launch('game', configFile, join(dir, 'run'), 180, args);
      const observed = observation(observationDir, requestFile, source), adapter = json(join(observationDir, 'adapter.json'));
      const judged = judgeScenario(scenario, observed, adapter); write(join(dir, 'validation.json'), judged);
      report.scenarios.push({ id: scenario.id, ...judged });
      if (!judged.passed) throw new Error(`Native scenario failed: ${scenario.id}`);
    }
    const modified = join(output, 'modified-source'); cpSync(source, modified, { recursive: true });
    const changed = 'Source/AgentVerify/Public/IAgentVerifyProbe.h', original = readFileSync(join(modified, changed));
    writeFileSync(join(modified, changed), Buffer.concat([original, Buffer.from('\n// Local consumer edit retained by source verification.\n')]));
    const modifiedResult = verifySourceFiles(manifest, collectSourceFiles(modified, manifest));
    write(join(output, 'modified-source-result.json'), modifiedResult);
    report.criteria.A1 = modifiedResult.state === 'modified' && modifiedResult.modified_files.includes(changed);
    report.criteria.A2 = true;
    const shot = observation(join(output, 'shot/observation'), join(output, 'shot/request.json'), source);
    const missing = validateReceipt(shot.receipt, shot.request, { ...shot.options, artifacts: {} });
    const audio = observation(join(output, 'audio/observation'), join(output, 'audio/request.json'), source);
    const shortened = { ...audio.artifacts }, shortReceipt = structuredClone(audio.receipt);
    const tone = shortReceipt.audio.find((item) => item.phase === 'tone'); shortened[tone.artifact] = shortenRecording(shortened[tone.artifact]);
    const shortWav = readWav(shortened[tone.artifact]); tone.frame_count = shortWav.frame_count; tone.rms_db = rmsDb(shortWav, 0, shortWav.frame_count);
    const shortArtifact = shortReceipt.artifacts.find((item) => item.path === tone.artifact); shortArtifact.bytes = shortened[tone.artifact].length; shortArtifact.sha256 = sha256(shortened[tone.artifact]);
    const shortResult = validateReceipt(shortReceipt, audio.request, { ...audio.options, artifacts: shortened });
    mkdirSync(join(output, 'short-recording-mutation')); writeFileSync(join(output, 'short-recording-mutation', tone.artifact), shortened[tone.artifact]); write(join(output, 'short-recording-mutation/receipt.json'), shortReceipt);
    write(join(output, 'artifact-negative-checks.json'), { kind: 'external_artifact_mutations', missingShot: missing, shortRecording: shortResult });
    report.criteria.A4 = missing.issues.some((issue) => issue.code === 'receipt.artifact_missing_or_tampered') && shortResult.issues.some((issue) => issue.code === 'receipt.audio_truncated') && shot.receipt.captures[0].hold_frames >= 90;
    report.comparison = local.comparison ? verifyComparison(resolve(sample, local.comparison)) : { passed: false, errors: ['Comparison evidence is required; A6 is pending'] };
    report.criteria.A6 = report.comparison.passed;
    report.sourceAfter = sourceIdentity(config);
    if (JSON.stringify(before) !== JSON.stringify(report.sourceAfter)) throw new Error('Source changed during acceptance');
    report.passed = Object.values(report.criteria).every((value) => value === true);
  } catch (error) { report.errors.push(error.message); }
  report.finished = new Date().toISOString();
  write(join(output, 'acceptance.json'), report);
  write(join(output, 'inventory.json'), fileInventory(output));
  return report;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--project', '--evidence'].includes(args[i]) || !args[i + 1] || options[args[i].slice(2)]) throw new Error('usage: acceptance.mjs --project <disposable-project> --evidence <fresh-directory>');
      options[args[i].slice(2)] = args[i + 1];
    }
    const result = acceptance(options); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.passed ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
