// node --test examples/unreal/native-build.test.mjs  (no Unreal, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { highestVersion, compilerFlagVersion, buildArguments, writeCodeProject } from './native-build.mjs';

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
