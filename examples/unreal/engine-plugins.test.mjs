import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseUplugin, readPlugins, select, format } from './engine_plugins.mjs';

const descriptor = (extra = {}) => JSON.stringify({ FriendlyName: 'Example', Description: 'An  example\n plugin.', Category: 'Other', EnabledByDefault: false,
  Modules: [{ Name: 'ExampleRuntime', Type: 'Runtime' }, { Name: 'ExampleEditor', Type: 'Editor' }], Plugins: [{ Name: 'Niagara', Enabled: true }, { Name: 'Off', Enabled: false }], ...extra });

test('parseUplugin reads the fields the skills quote and tolerates a byte-order mark', () => {
  const p = parseUplugin('\uFEFF' + descriptor({ IsBetaVersion: true }), 'C:/x/Example.uplugin');
  assert.deepEqual([p.name, p.category, p.description, p.beta, p.experimental, p.editorOnly], ['Example', 'Other', 'An example plugin.', true, false, false]);
  assert.deepEqual(p.moduleTypes, ['Runtime', 'Editor']);
  assert.deepEqual(p.dependencies, ['Niagara']);
});

test('a plugin whose modules are all editor modules is editor-only', () => {
  assert.equal(parseUplugin(descriptor({ Modules: [{ Name: 'A', Type: 'Editor' }, { Name: 'B', Type: 'UncookedOnly' }] }), 'A.uplugin').editorOnly, true);
  assert.equal(parseUplugin(descriptor({ Modules: [] }), 'A.uplugin').editorOnly, false);
});

test('readPlugins walks nested folders, sorts by name and reports unreadable descriptors instead of throwing', () => {
  const root = mkdtempSync(join(tmpdir(), 'engine-plugins-'));
  try {
    mkdirSync(join(root, 'FX', 'Zed'), { recursive: true });
    mkdirSync(join(root, 'Runtime', 'Alpha'), { recursive: true });
    writeFileSync(join(root, 'FX', 'Zed', 'Zed.uplugin'), descriptor());
    writeFileSync(join(root, 'Runtime', 'Alpha', 'Alpha.uplugin'), descriptor({ Category: 'Audio' }));
    writeFileSync(join(root, 'Runtime', 'Alpha', 'Broken.uplugin'), '{ not json');
    const { plugins, errors } = readPlugins(root);
    assert.deepEqual(plugins.map((p) => [p.name, p.path]), [['Alpha', 'Runtime/Alpha/Alpha.uplugin'], ['Zed', 'FX/Zed/Zed.uplugin']]);
    assert.equal(errors.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('select filters by exact name or by regex over name, category and description', () => {
  const all = [{ name: 'PCG', category: 'Procedural', description: 'rules' }, { name: 'Metasound', category: 'Audio', description: 'graph' }, { name: 'Other', category: 'x', description: 'procedural things' }];
  assert.deepEqual(select(all, { names: ['pcg'] }).map((p) => p.name), ['PCG']);
  assert.deepEqual(select(all, { match: 'procedural' }).map((p) => p.name), ['PCG', 'Other']);
  assert.equal(select(all).length, 3);
});

test('format prints name, category, flags and description on one line', () => {
  const line = format({ name: 'A', category: 'C', description: 'D', enabledByDefault: true, beta: true, experimental: false, editorOnly: true });
  assert.equal(line, 'A | C | on,beta,editor-only | D');
});
