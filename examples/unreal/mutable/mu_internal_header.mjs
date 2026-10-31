// A separate throwaway build: deliberately include the public node header whose
// dependencies reach an Internal header. Never changes the delivered module.
import { mkdtempSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverToolchain, writeCodeProject, buildEditor } from '../native-build.mjs';
import { MODULE_BUILD_TIMEOUT_S, summarizeBuildLog } from './mu-probe-checks.mjs';

const engine = process.argv[2];
if (!engine || process.argv.length !== 3) throw new Error('usage: node mu_internal_header.mjs <engine folder>');
const root = mkdtempSync(join(tmpdir(), 'mu-internal-'));
const name = 'MuInternal';
writeCodeProject({ root, name, plugins: ['Mutable'], modules: [{ name: 'MutableBridge', type: 'Editor', sourceDir: join(import.meta.dirname, 'module', 'MutableBridge') }] });
appendFileSync(join(root, 'Source', 'MutableBridge', 'MutableBridgeLibrary.cpp'), '\n#include "MuCOE/Nodes/CustomizableObjectNode.h"\n');
const logPath = join(root, 'internal-build.log');
console.log(`Internal-header experiment: ${root}`);
const built = await buildEditor({ engine, uproject: join(root, `${name}.uproject`), name, toolchain: discoverToolchain({}), logPath, timeoutMs: MODULE_BUILD_TIMEOUT_S * 1000 });
const report = { ...built, include: 'MuCOE/Nodes/CustomizableObjectNode.h', log: summarizeBuildLog(readFileSync(logPath, 'utf8')), root };
writeFileSync(join(root, 'internal-build.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
// The expected compiler refusal is evidence, not a runner failure.
