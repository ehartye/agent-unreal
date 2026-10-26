// node --test examples/unreal/automation_test/headless-routes.test.mjs  (no Unreal, no dependencies)
// Runs the route logic on fake install trees. The module text below is a cut of the registration code in the 5.8 Asset Manager editor module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assetManagerCommands, routes, diskFs } from './headless_routes.mjs';

const MODULE = 'Engine/Plugins/Editor/AssetManagerEditor/Source/AssetManagerEditor/Private/AssetManagerEditorModule.cpp';
const source = (gated = true) => `
	${gated ? 'if (GIsEditor && !IsRunningCommandlet())' : 'if (true)'}
	{
		AuditCmds.Add(IConsoleManager::Get().RegisterConsoleCommand(
			TEXT("AssetManager.AssetAudit"),
			TEXT("Dumps statistics about assets to the log."),
			FConsoleCommandWithArgsDelegate::CreateRaw(this, &FAssetManagerEditorModule::PerformAuditConsoleCommand),
			ECVF_Default
			));
		AuditCmds.Add(IConsoleManager::Get().RegisterConsoleCommand(
			TEXT("AssetManager.FindDepChain"),
			FindDepChainHelpText,
			FConsoleCommandWithArgsDelegate::CreateRaw(this, &FAssetManagerEditorModule::PerformDependencyChainConsoleCommand),
			ECVF_Default
			));
	}`;
const fakeFs = (files) => ({ exists: (rel) => [...Object.keys(files)].some((f) => f === rel || f.startsWith(`${rel}/`)), read: (rel) => files[rel] });
const launcher = { 'Engine/Build/InstalledBuild.txt': '', 'Engine/Build/BatchFiles/RunUAT.bat': '', 'Engine/Binaries/DotNET/AutomationTool/AutomationScripts/LowLevelTests/x.dll': '',
  'Engine/Source/Developer/LowLevelTestsRunner/LowLevelTestsRunner.Build.cs': '', [MODULE]: source() };
const sourceBuilt = { ...launcher, 'Engine/Build/LowLevelTests.xml': '<BuildGraph/>', 'Engine/Build/LowLevelTests/Foundation.xml': '<Include/>' };
delete sourceBuilt['Engine/Build/InstalledBuild.txt'];

test('assetManagerCommands lists the registered console commands and the commandlet gate', () => {
  assert.deepEqual(assetManagerCommands(source()), { names: ['AssetManager.AssetAudit', 'AssetManager.FindDepChain'], outsideCommandletsOnly: true });
  assert.equal(assetManagerCommands(source(false)).outsideCommandletsOnly, false);
  assert.equal(assetManagerCommands(undefined), undefined);
  assert.deepEqual(assetManagerCommands('nothing here').names, []);
});

test('an installed build without LowLevelTests.xml has no BuildGraph route and says it needs a source-built engine', () => {
  const r = routes(fakeFs(launcher));
  assert.equal(r.lowLevelTests.route, 'absent');
  assert.match(r.lowLevelTests.why, /LowLevelTests\.xml/);
  assert.match(r.lowLevelTests.why, /source-built engine/);
});

test('an engine with the script, its metadata folder and RunUAT has the route', () => {
  assert.equal(routes(fakeFs(sourceBuilt)).lowLevelTests.route, 'present');
  const noMetadata = { ...sourceBuilt }; delete noMetadata['Engine/Build/LowLevelTests/Foundation.xml'];
  assert.equal(routes(fakeFs(noMetadata)).lowLevelTests.route, 'absent');
  const noUat = { ...sourceBuilt }; delete noUat['Engine/Build/BatchFiles/RunUAT.bat'];
  assert.match(routes(fakeFs(noUat)).lowLevelTests.why, /RunUAT\.bat/);
  assert.doesNotMatch(routes(fakeFs(noMetadata)).lowLevelTests.why, /source-built engine/);
});

test('the content tools: Reference Viewer and Size Map have no command, Audit Assets has a statistics command that is not the window', () => {
  const r = routes(fakeFs(launcher)).contentTools;
  assert.equal(r.referenceViewer.route, 'ui-only');
  assert.equal(r.sizeMap.route, 'ui-only');
  assert.equal(r.assetAudit.route, 'console');
  assert.deepEqual(r.assetAudit.commands, ['AssetManager.AssetAudit']);
  assert.match(r.assetAudit.why, /not the Asset Audit window/);
  assert.match(r.assetAudit.why, /only when the editor is not running a commandlet/);
});

test('a command named for a tool turns its route into a console route; a missing module source is unknown, not a guess', () => {
  const withViewer = source().replace('AssetManager.FindDepChain', 'AssetManager.ReferenceViewer');
  assert.equal(routes(fakeFs({ ...launcher, [MODULE]: withViewer })).contentTools.referenceViewer.route, 'console');
  const noSource = { ...launcher }; delete noSource[MODULE];
  const r = routes(fakeFs(noSource)).contentTools;
  assert.deepEqual([r.referenceViewer.route, r.sizeMap.route, r.assetAudit.route], ['unknown', 'unknown', 'unknown']);
});

test('the command line reads a real folder tree and exits 2 without an engine', () => {
  const root = mkdtempSync(join(tmpdir(), 'headless-routes-'));
  try {
    for (const [rel, text] of Object.entries(launcher)) { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); }
    assert.equal(routes(diskFs(root)).lowLevelTests.route, 'absent');
    const run = spawnSync(process.execPath, [join(import.meta.dirname, 'headless_routes.mjs'), '--engine', root, '--json'], { encoding: 'utf8' });
    assert.equal(run.status, 0);
    assert.equal(JSON.parse(run.stdout).contentTools.sizeMap.route, 'ui-only');
    assert.equal(spawnSync(process.execPath, [join(import.meta.dirname, 'headless_routes.mjs')], { encoding: 'utf8' }).status, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
