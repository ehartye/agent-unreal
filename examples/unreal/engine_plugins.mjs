#!/usr/bin/env node
// List the plugins an Unreal engine install ships, from their .uplugin descriptors. No Unreal run, no dependencies; Node 20+.
//
//   node engine_plugins.mjs --engine "<UE_5.8 folder>" [--name Niagara,PCG] [--match <regex>] [--json]
//
// Prints one line per plugin: name, category, whether it is enabled by default, its flags (beta, experimental, editor-only) and
// the descriptor's own description. `--name` picks exact plugin names, `--match` filters name, category and description.
// The skills and references that choose an Unreal feature quote these descriptors, so rerun it after an engine update.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

/** Parse the text of a .uplugin file (JSON, sometimes with a byte-order mark) into the fields worth quoting. */
export function parseUplugin(text, file = '') {
  const data = JSON.parse(text.replace(/^\uFEFF/, ''));
  const modules = Array.isArray(data.Modules) ? data.Modules : [];
  const types = [...new Set(modules.map((m) => m.Type).filter(Boolean))];
  const editorOnly = modules.length > 0 && modules.every((m) => /^(Editor|UncookedOnly|Program|Developer)/.test(m.Type || ''));
  return {
    name: basename(file).replace(/\.uplugin$/, ''),
    friendlyName: data.FriendlyName || '',
    category: data.Category || '',
    description: (data.Description || '').replace(/\s+/g, ' ').trim(),
    enabledByDefault: data.EnabledByDefault === true,
    beta: data.IsBetaVersion === true,
    experimental: data.IsExperimentalVersion === true,
    editorOnly,
    moduleTypes: types,
    dependencies: (Array.isArray(data.Plugins) ? data.Plugins : []).filter((p) => p.Enabled !== false).map((p) => p.Name),
  };
}

/** Every .uplugin under `root`, parsed. A descriptor that does not parse is reported in `errors`, not thrown. */
export function readPlugins(root) {
  const plugins = [], errors = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.uplugin')) {
        try { plugins.push({ ...parseUplugin(readFileSync(full, 'utf8'), full), path: full.slice(root.length + 1).split('\\').join('/') }); }
        catch (err) { errors.push({ path: full, error: String(err.message || err) }); }
      }
    }
  };
  walk(root);
  plugins.sort((a, b) => a.name.localeCompare(b.name));
  return { plugins, errors };
}

export function select(plugins, { names = [], match = null } = {}) {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const re = match ? new RegExp(match, 'i') : null;
  return plugins.filter((p) => (wanted.size === 0 && !re) || wanted.has(p.name.toLowerCase()) || (re && re.test(`${p.name} ${p.category} ${p.description}`)));
}

export function format(p) {
  const flags = [p.enabledByDefault ? 'on' : 'off', p.beta && 'beta', p.experimental && 'experimental', p.editorOnly && 'editor-only'].filter(Boolean).join(',');
  return `${p.name} | ${p.category} | ${flags} | ${p.description}`;
}

if (import.meta.url === new URL(process.argv[1], 'file:///').href || process.argv[1]?.endsWith('engine_plugins.mjs')) {
  const args = process.argv.slice(2);
  const opt = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const engine = opt('--engine');
  if (!engine) { console.error('usage: node engine_plugins.mjs --engine "<UE folder>" [--name A,B] [--match <regex>] [--json]'); process.exit(2); }
  const root = join(engine, 'Engine', 'Plugins');
  if (!existsSync(root)) { console.error(`no Engine/Plugins under ${engine}`); process.exit(2); }
  const { plugins, errors } = readPlugins(root);
  const picked = select(plugins, { names: (opt('--name') || '').split(',').filter(Boolean), match: opt('--match') });
  if (args.includes('--json')) console.log(JSON.stringify({ engine, count: plugins.length, plugins: picked, errors }, null, 2));
  else { for (const p of picked) console.log(format(p)); console.error(`${picked.length} of ${plugins.length} plugins, ${errors.length} unreadable`); }
}
