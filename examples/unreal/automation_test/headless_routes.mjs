#!/usr/bin/env node
// node headless_routes.mjs --engine "<UE folder>" [--json]
// Decides from an engine install, with no Unreal run, whether a headless route exists for the commands in the unreal-quality and unreal-architecture
// references that are not an Automation RunTest or a stat command:
//   - the Low-Level Tests build: RunUAT BuildGraph -Script="Engine/Build/LowLevelTests.xml" -Target="..."
//   - the content tools: Reference Viewer, Size Map and Audit Assets.
// It reads files on disk only. A route is "present" only when the file the command needs is there; otherwise the answer says what is missing.
// Exit 0 always when the install is readable; 2 on a usage error.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const ASSET_MANAGER_MODULE = 'Engine/Plugins/Editor/AssetManagerEditor/Source/AssetManagerEditor/Private/AssetManagerEditorModule.cpp';

/** The console command names the Asset Manager editor module registers, and whether they are registered only outside commandlets. */
export function assetManagerCommands(source) {
  if (typeof source !== 'string') return undefined;
  const names = [...source.matchAll(/RegisterConsoleCommand\(\s*TEXT\("([^"]+)"\)/g)].map((m) => m[1]);
  const gated = /if\s*\(\s*GIsEditor\s*&&\s*!IsRunningCommandlet\(\)\s*\)/.test(source);
  return { names, outsideCommandletsOnly: gated };
}

/**
 * `fs` is { exists(installRelativePath), read(installRelativePath) -> string|undefined }, so the logic runs on a fake tree in a test.
 * Returns { lowLevelTests, contentTools } with a `route` of 'present', 'absent', 'ui-only' or 'unknown' and the evidence for each.
 */
export function routes(fs) {
  const have = {
    buildGraphScript: fs.exists('Engine/Build/LowLevelTests.xml'),
    metadataFolder: fs.exists('Engine/Build/LowLevelTests'),
    runnerSource: fs.exists('Engine/Source/Developer/LowLevelTestsRunner/LowLevelTestsRunner.Build.cs'),
    uatCommand: fs.exists('Engine/Binaries/DotNET/AutomationTool/AutomationScripts/LowLevelTests'),
    runUat: fs.exists('Engine/Build/BatchFiles/RunUAT.bat'),
    installedBuild: fs.exists('Engine/Build/InstalledBuild.txt'),
  };
  const missing = [];
  if (!have.buildGraphScript) missing.push('Engine/Build/LowLevelTests.xml');
  if (!have.metadataFolder) missing.push('Engine/Build/LowLevelTests (the generated test metadata)');
  if (!have.runUat) missing.push('Engine/Build/BatchFiles/RunUAT.bat');
  const lowLevelTests = missing.length === 0
    ? { route: 'present', why: 'Engine/Build/LowLevelTests.xml and its metadata folder are in the install' }
    : { route: 'absent', why: `${missing.join(', ')} not in the install; ${have.installedBuild ? 'the install is an installed (Launcher) build, so the command needs a source-built engine' : 'the command needs an engine that carries these files'}` };

  const commands = assetManagerCommands(fs.read(ASSET_MANAGER_MODULE));
  const named = (re) => (commands?.names ?? []).filter((n) => re.test(n));
  const tool = (label, re, hint) => {
    if (!commands) return { route: 'unknown', why: 'the Asset Manager editor source is not in the install' };
    const hits = named(re);
    return hits.length ? { route: 'console', commands: hits, why: `${hits.join(', ')} ${commands.outsideCommandletsOnly ? '(registered only when the editor is not running a commandlet) ' : ''}${hint}` }
      : { route: 'ui-only', why: `${label}: the Asset Manager editor module registers ${commands.names.length} console commands (${commands.names.join(', ')}) and none is ${label}` };
  };
  const contentTools = {
    referenceViewer: tool('Reference Viewer', /reference.?viewer/i, ''),
    sizeMap: tool('Size Map', /size.?map/i, ''),
    // AssetManager.AssetAudit logs statistics; the Asset Audit window and its CSV export are separate.
    assetAudit: tool('Audit Assets', /^AssetManager\.AssetAudit$/i, 'logs statistics about assets; it is not the Asset Audit window and does not write its CSV export'),
  };
  return { have, lowLevelTests, contentTools, assetManagerCommands: commands };
}

export function diskFs(engine) {
  const at = (rel) => join(engine, rel);
  return { exists: (rel) => existsSync(at(rel)), read: (rel) => (existsSync(at(rel)) ? readFileSync(at(rel), 'utf8') : undefined) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const engine = flag('--engine') || process.env.UE_ROOT;
  if (!engine || !existsSync(join(engine, 'Engine'))) { console.error('usage: node headless_routes.mjs --engine <UE folder> [--json]'); process.exit(2); }
  const result = routes(diskFs(engine));
  if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Low-Level Tests BuildGraph: ${result.lowLevelTests.route} - ${result.lowLevelTests.why}`);
    for (const [name, r] of Object.entries(result.contentTools)) console.log(`${name}: ${r.route} - ${r.why}`);
  }
}
