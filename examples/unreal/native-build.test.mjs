// node --test examples/unreal/native-build.test.mjs  (no Unreal, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { highestVersion, compilerFlagVersion, buildArguments, writeCodeProject, runIfBuilt, buildSucceeded } from './native-build.mjs';

test('highestVersion compares numerically, not as text, and ignores other entries', () => {
  assert.equal(highestVersion(['14.9.1', '14.44.35207', 'Hostx64', '14.44.9']), '14.44.35207');
  assert.equal(highestVersion(['10.0.22621.0', '10.0.26100.0', '10.0.9.0']), '10.0.26100.0');
  assert.equal(highestVersion(['x', 'y']), undefined);
  assert.equal(highestVersion([]), undefined);
});

test('compilerFlagVersion keeps three parts of the compiler ProductVersion', () => {
  assert.equal(compilerFlagVersion('14.44.35228.0\r\n'), '14.44.35228');
  assert.equal(compilerFlagVersion(''), undefined);
  assert.equal(compilerFlagVersion(undefined), undefined);
});

test('buildArguments names the editor target and passes only the versions it was given', () => {
  assert.deepEqual(buildArguments({ target: 'DemoEditor', uproject: 'C:\\p\\Demo.uproject', compiler: '14.1.2', sdk: '10.0.1.0' }),
    ['DemoEditor', 'Win64', 'Development', '-Project=C:\\p\\Demo.uproject', '-WaitMutex', '-NoHotReloadFromIDE', '-2022', '-CompilerVersion=14.1.2', '-WindowsSDKVersion=10.0.1.0']);
  assert.ok(!buildArguments({ target: 'DemoEditor', uproject: 'x' }).some((a) => a.startsWith('-CompilerVersion')));
});

test('writeCodeProject writes the descriptor, both targets and the module folders', () => {
  const root = mkdtempSync(join(tmpdir(), 'native-build-'));
  try {
    const src = join(root, 'src', 'Mod'); mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'Mod.Build.cs'), '// module');
    const project = join(root, 'proj');
    const uproject = writeCodeProject({ root: project, name: 'Demo', plugins: ['PythonScriptPlugin'], modules: [{ name: 'Mod', type: 'Editor', sourceDir: src }] });
    const descriptor = JSON.parse(readFileSync(uproject, 'utf8'));
    assert.deepEqual(descriptor.Modules, [{ Name: 'Mod', Type: 'Editor', LoadingPhase: 'Default' }]);
    assert.deepEqual(descriptor.Plugins, [{ Name: 'PythonScriptPlugin', Enabled: true }]);
    assert.match(readFileSync(join(project, 'Source', 'DemoEditor.Target.cs'), 'utf8'), /class DemoEditorTarget[\s\S]*TargetType\.Editor[\s\S]*"Mod"/);
    assert.match(readFileSync(join(project, 'Source', 'Demo.Target.cs'), 'utf8'), /TargetType\.Game/);
    assert.equal(readFileSync(join(project, 'Source', 'Mod', 'Mod.Build.cs'), 'utf8'), '// module');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('buildArguments appends extra arguments after the version flags and leaves the default list unchanged', () => {
  const base = buildArguments({ target: 'DemoEditor', uproject: 'x', compiler: '14.1.2' });
  assert.deepEqual(buildArguments({ target: 'DemoEditor', uproject: 'x', compiler: '14.1.2', extraArgs: ['-ForceUnity'] }), [...base, '-ForceUnity']);
});

test('runIfBuilt runs the step after a successful build and returns its result', async () => {
  const lines = [];
  const out = await runIfBuilt({ exit: 0, seconds: 3, timedOut: false }, async () => 'tests passed', { log: (l) => lines.push(l) });
  assert.deepEqual(out, { ran: true, result: 'tests passed' });
  assert.deepEqual(lines, []);
});

test('runIfBuilt skips the step and says why after a failed, killed or timed-out build', async () => {
  for (const [build, text] of [[{ exit: 1, timedOut: false }, 'failed (exit 1)'], [{ exit: null, timedOut: false }, 'failed (exit unknown)'], [{ exit: 0, timedOut: true }, 'timed out'], [undefined, 'failed (exit unknown)']]) {
    const lines = []; let ran = false;
    const out = await runIfBuilt(build, () => { ran = true; }, { label: 'replay', log: (l) => lines.push(l) });
    assert.equal(ran, false);
    assert.equal(out.ran, false);
    assert.equal(out.reason, 'build ' + text);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^replay skipped: build .*previous binary/);
  }
});

test('buildSucceeded needs exit 0 and no timeout', () => {
  assert.equal(buildSucceeded({ exit: 0, timedOut: false }), true);
  assert.equal(buildSucceeded({ exit: 0 }), true);
  assert.equal(buildSucceeded({ exit: 2 }), false);
  assert.equal(buildSucceeded({ exit: 0, timedOut: true }), false);
});
