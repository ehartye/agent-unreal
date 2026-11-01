import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { validateDocument, sha256, verifySourceFiles } from '../../agent-verify/contracts.mjs';
import { readArtifact, collectSourceFiles } from '../../agent-verify/artifacts.mjs';
import { loadConfiguration, operationCommand } from '../unreal-run/controller.mjs';
import { sourceIdentity } from '../unreal-run/identity.mjs';

export const KINDS = ['build', 'automation', 'replay', 'rejected_replay', 'audio', 'package', 'smoke', 'capture'];
export const OBSERVATIONS = ['replay', 'rejected_replay', 'audio', 'smoke', 'capture'];
export const json = bytes => JSON.parse(String(bytes).replace(/^\uFEFF/, ''));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const id = v => typeof v === 'string' && /^[a-z0-9][a-z0-9.-]{0,95}$/.test(v) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(v);
const positive = v => Number.isSafeInteger(v) && v > 0;
function fields(value, allowed, where) {
  if (!object(value)) throw Error(`${where} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw Error(`Unknown ${where} field: ${key}`);
}
export function observationCount(doc) {
  return doc.phases.reduce((n, p) => n + p.checks.length + Number(Boolean(p.capture)) + Number(Boolean(p.audio)), 0);
}
export function validateManifest(m, suite) {
  fields(m, ['schema_version', 'steps', 'suites'], 'manifest');
  if (m.schema_version !== 1 || !Array.isArray(m.steps) || !m.steps.length) throw Error('Unsupported or empty manifest');
  if (!object(m.suites) || !Object.keys(m.suites).length) throw Error('Nonempty suites object required');
  const byId = new Map();
  for (const s of m.steps) {
    fields(s, ['id', 'kind', 'required', 'depends_on', 'timeout_seconds', 'arguments', 'input', 'expected_count', 'expected_tests', 'filter', 'requested', 'expected_refusal', 'expected_exit_code'], 'step');
    if (!id(s.id) || byId.has(s.id)) throw Error('Invalid or duplicate step ID');
    if (!KINDS.includes(s.kind)) throw Error(`Unsupported step kind: ${s.kind}`);
    if (typeof s.required !== 'boolean') throw Error('Step required must be boolean');
    if (!positive(s.timeout_seconds) || s.timeout_seconds > 86400) throw Error('Bounded timeout_seconds required');
    if (!positive(s.expected_count)) throw Error('Positive expected_count required');
    if (!Array.isArray(s.depends_on) || s.depends_on.some(d => !id(d)) || new Set(s.depends_on).size !== s.depends_on.length) throw Error('Invalid dependencies');
    if (!Array.isArray(s.arguments) || s.arguments.some(a => typeof a !== 'string' || /[\0\r\n]/.test(a))) throw Error('arguments must be exact strings without NUL/newlines');
    if (s.arguments.some(a => /^--?(?:AVRequest|AVOutput|ReportExportPath)(?:=|$)/i.test(a))) throw Error('Evidence arguments are owned by the suite runner');
    if (s.kind === 'automation') {
      if (typeof s.filter !== 'string' || !/^[A-Za-z0-9_.+]+$/.test(s.filter)) throw Error('Automation filter required');
      if (!Array.isArray(s.expected_tests) || s.expected_tests.length !== s.expected_count || s.expected_tests.some(t => typeof t !== 'string' || !t) || new Set(s.expected_tests).size !== s.expected_tests.length) throw Error('Exact unique expected automation tests required');
      if (s.arguments.some(a => /^--?ExecCmds(?:=|$)/i.test(a))) throw Error('Automation command is owned by the suite runner');
    } else if (s.filter !== undefined || s.expected_tests !== undefined) throw Error('Automation fields on another kind');
    if (OBSERVATIONS.includes(s.kind)) {
      if (typeof s.input !== 'string' || !s.input) throw Error('Observation input required');
      fields(s.requested, ['engine', 'configuration', 'map', 'rhi', 'gpu', 'hardware_id', 'profile', 'resolution'], 'requested');
      for (const [k, v] of Object.entries(s.requested)) {
        if (k === 'resolution') {
          fields(v, ['width', 'height'], 'resolution');
          if (!positive(v.width) || !positive(v.height)) throw Error('Invalid requested resolution');
        } else if (typeof v !== 'string' || !v.trim()) throw Error(`Invalid requested ${k}`);
      }
    } else if (s.input !== undefined || s.requested !== undefined) throw Error('Observation fields on another kind');
    if (['build', 'package'].includes(s.kind) && s.expected_count !== 1) throw Error('Build/package expected_count is one qualified identity');
    if (s.kind === 'rejected_replay') {
      if (!Array.isArray(s.expected_refusal) || !s.expected_refusal.length || !Number.isSafeInteger(s.expected_exit_code) || s.expected_exit_code < 0 || s.expected_exit_code > 255) throw Error('Exact refusal and expected engine exit required');
      for (const r of s.expected_refusal) { fields(r, ['code', 'path'], 'refusal'); if (typeof r.code !== 'string' || !r.code || typeof r.path !== 'string' || !r.path.startsWith('$')) throw Error('Invalid refusal'); }
      if (new Set(s.expected_refusal.map(r => `${r.code}:${r.path}`)).size !== s.expected_refusal.length || s.expected_count !== s.expected_refusal.length) throw Error('Refusal count mismatch');
    } else if (s.expected_refusal !== undefined || s.expected_exit_code !== undefined) throw Error('Refusal fields on another kind');
    byId.set(s.id, s);
  }
  const ordered = [], active = new Set(), visited = new Set();
  function visit(name) {
    if (!byId.has(name)) throw Error(`Missing dependency: ${name}`);
    if (active.has(name)) throw Error(`Dependency cycle: ${name}`);
    if (visited.has(name)) return;
    active.add(name); for (const dependency of byId.get(name).depends_on) visit(dependency);
    active.delete(name); visited.add(name); ordered.push(byId.get(name));
  }
  // Validate even unselected steps and suites before dispatch.
  for (const name of byId.keys()) visit(name);
  for (const [name, selection] of Object.entries(m.suites)) {
    if (!id(name) || !Array.isArray(selection) || !selection.length || new Set(selection).size !== selection.length || selection.some(s => !byId.has(s))) throw Error(`Invalid suite: ${name}`);
  }
  if (!Object.hasOwn(m.suites, suite)) throw Error(`Unknown suite: ${suite}`);
  const selected = new Set();
  function include(name) { if (selected.has(name)) return; selected.add(name); for (const dep of byId.get(name).depends_on) include(dep); }
  m.suites[suite].forEach(include);
  const plan = ordered.filter(s => selected.has(s.id));
  if (!plan.some(s => s.required)) throw Error('A suite needs at least one required step');
  return structuredClone(plan);
}

export function sourceAnchor(root) {
  const bytes = readArtifact(root, 'source-version.json'), manifest = json(bytes);
  const checked = verifySourceFiles(manifest, collectSourceFiles(root, manifest));
  if (!checked.valid || checked.state !== 'pristine') throw Error('AgentVerify source must be independently verified pristine');
  return { plugin_version: manifest.plugin_version, manifest_sha256: sha256(bytes), state: checked.state, modified_files: checked.modified_files };
}
export function fileAnchor(path) { const bytes = readFileSync(path); return { path: resolve(path), bytes: bytes.length, sha256: sha256(bytes) }; }
export function prepare({ project, manifest, suite }) {
  const config = loadConfiguration(project), m = json(readFileSync(manifest)), plan = validateManifest(m, suite);
  for (const s of m.steps) operationCommand(['build', 'package'].includes(s.kind) ? s.kind : s.kind === 'automation' ? 'test' : 'game', config, s.arguments);
  const inputs = {};
  for (const s of m.steps.filter(s => OBSERVATIONS.includes(s.kind))) {
    const bytes = readArtifact(dirname(resolve(manifest)), s.input);
    let doc; try { doc = json(bytes); } catch { doc = null; }
    const validation = validateDocument(doc);
    if (!validation.valid && s.kind !== 'rejected_replay') throw Error(`Invalid input ${s.id}: ${JSON.stringify(validation.issues)}`);
    if (s.kind === 'rejected_replay' && !validation.valid && !same(validation.issues.map(({ code, path }) => ({ code, path })), s.expected_refusal)) throw Error(`Structural refusal differs from declared refusal: ${s.id}`);
    if (validation.valid) {
      if (s.kind === 'rejected_replay') for (const refusal of s.expected_refusal) {
        const patterns = { unknown_metric: /^\$\.phases\[(\d+)\]\.checks\[(\d+)\]\.metric$/, unknown_command: /^\$\.phases\[(\d+)\]\.actions\[(\d+)\]\.token$/, unknown_key: /^\$\.phases\[(\d+)\]\.actions\[(\d+)\]\.key$/ };
        const match = patterns[refusal.code]?.exec(refusal.path);
        const value = match ? (refusal.code === 'unknown_metric' ? doc.phases[Number(match[1])]?.checks[Number(match[2])]?.metric : doc.phases[Number(match[1])]?.actions[Number(match[2])]?.[refusal.code === 'unknown_command' ? 'token' : 'key']) : null;
        if (!(refusal.code === 'sandbox_unavailable' && refusal.path === '$.save_sandbox' && doc.save_sandbox === true) && (typeof value !== 'string' || !value)) throw Error(`Live refusal is not justified by input: ${s.id}`);
      }
      if (s.kind === 'replay' && doc.kind !== 'replay' || s.kind === 'capture' && doc.kind !== 'shot' || ['smoke', 'audio'].includes(s.kind) && doc.kind !== 'observation') throw Error(`Request kind mismatch: ${s.id}`);
      if (s.kind !== 'rejected_replay' && observationCount(doc) !== s.expected_count) throw Error(`Input/expected count mismatch: ${s.id}`);
      if (s.kind === 'audio' && !doc.phases.some(p => p.audio) || s.kind === 'capture' && !doc.phases.some(p => p.capture)) throw Error(`Missing required media request: ${s.id}`);
    }
    inputs[s.id] = fileAnchor(resolve(dirname(manifest), s.input));
  }
  const source = sourceIdentity(config), pluginRoot = join(dirname(config.project), 'Plugins/AgentVerify');
  if (source.dirty) throw Error('Source must be committed and clean');
  return { schema_version: 1, suite, config, project: fileAnchor(project), manifest: fileAnchor(manifest), plan, inputs, source, observation_source: plan.some(s => OBSERVATIONS.includes(s.kind)) ? { path: pluginRoot, identity: sourceAnchor(pluginRoot) } : null };
}
export function assertUnchanged(prepared) {
  for (const anchor of [prepared.project, prepared.manifest, ...Object.values(prepared.inputs)]) if (!same(fileAnchor(anchor.path), anchor)) throw Error(`Input changed after planning: ${anchor.path}`);
  if (!same(sourceIdentity(prepared.config), prepared.source)) throw Error('Source changed after planning');
  if (prepared.observation_source && !same(sourceAnchor(prepared.observation_source.path), prepared.observation_source.identity)) throw Error('AgentVerify source changed after planning');
}
