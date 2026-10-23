// Pure logic shared by probe.mjs and its node test: no Unreal, no file system, no dependencies.
//   - which script each probe runs and which environment variable carries its inputs
//   - the command line and environment the launcher starts the editor with
//   - the shape every report must have (one object keyed by the callable, system or asset, each entry with an explicit status)
//   - the message the launcher fails with when the editor wrote no report

export const STATUSES = ['found', 'missing', 'unavailable'];

/** One entry per probe: the Python file, the environment variable that carries the names, and optional extra inputs. */
export const PROBES = {
  doc: { script: 'doc_probe.py', input: 'PROBE_CALLABLES', flag: '--callables', extras: [] },
  system: { script: 'inspect_system.py', input: 'PROBE_SYSTEMS', flag: '--systems', extras: [{ env: 'PROBE_MODULES', flag: '--modules' }] },
  asset: { script: 'asset_probe.py', input: 'PROBE_ASSETS', flag: '--assets', extras: [] },
};

/** Names separated by commas, semicolons or white space; empty entries and repeats are dropped, order is kept. */
export function splitNames(text) {
  const seen = new Set();
  for (const part of String(text ?? '').split(/[,;\s]+/)) if (part) seen.add(part);
  return [...seen];
}

/** The editor executable inside an engine folder. Only the Windows path was run in this work. */
export function editorPath(engine, platform = process.platform) {
  const bin = `${String(engine).replace(/[\\/]+$/, '')}/Engine/Binaries`;
  if (platform === 'win32') return `${bin}/Win64/UnrealEditor.exe`;
  if (platform === 'darwin') return `${bin}/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor`;
  return `${bin}/Linux/UnrealEditor`;
}

/**
 * Everything the launcher needs to start one probe: the script, the editor arguments, the extra environment and the names it asked for.
 * Throws a readable Error for an unknown probe or when the probe has no names to look at.
 */
export function buildLaunch({ probe, project, report, logPath, scriptDir, names, extras = {} }) {
  const spec = PROBES[probe];
  if (!spec) throw new Error(`unknown probe "${probe}"; use one of ${Object.keys(PROBES).join(', ')}`);
  const requested = splitNames(names);
  if (!requested.length) throw new Error(`probe "${probe}" needs at least one name in ${spec.flag} (or ${spec.input})`);
  if (!project) throw new Error('--project <path to .uproject> is required');
  if (!report) throw new Error('--report <path of the JSON file to write> is required');
  const script = `${String(scriptDir).replace(/[\\/]+$/, '')}/${spec.script}`;
  const env = { PROBE_REPORT: report, [spec.input]: requested.join(',') };
  for (const { env: name } of spec.extras) if (extras[name]) env[name] = splitNames(extras[name]).join(',');
  const args = [project, `-ExecutePythonScript=${script}`, `-abslog=${logPath}`, '-nullrhi', '-unattended', '-nosplash', '-nosound', '-notraceserver'];
  return { script, args, env, requested };
}

/** The text the launcher fails with when the editor ended without writing the report. */
export function missingReportMessage({ probe, report, logPath, exit, timedOut, error }) {
  const how = timedOut ? 'did not finish before the time limit' : error ? `could not be started (${error})` : `exited with code ${exit}`;
  return `probe "${probe}" wrote no report: the editor ${how} and ${report} does not exist. Editor log: ${logPath}`;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const present = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// Fields a found asset must carry. A field the editor could not read holds the string "unavailable" instead of being left out.
const ASSET_FIELDS = {
  StaticMesh: ['material_slots', 'bounds', 'nanite_enabled'],
  Material: ['blend_mode', 'shading_model', 'two_sided', 'used_with_nanite', 'used_with_niagara_sprites', 'used_with_niagara_ribbons'],
  MaterialInstanceConstant: ['parent', 'scalar_parameters'],
};

function checkEntry(probe, key, entry, problems) {
  if (!isObject(entry)) return problems.push(`${key}: entry is not an object`);
  if (!STATUSES.includes(entry.status)) return problems.push(`${key}: status is ${JSON.stringify(entry.status)}, expected one of ${STATUSES.join(', ')}`);
  if (entry.status !== 'found') {
    if (typeof entry.reason !== 'string' || !entry.reason) problems.push(`${key}: ${entry.status} without a reason`);
    return;
  }
  if (probe === 'doc') {
    if (typeof entry.kind !== 'string' || !entry.kind) problems.push(`${key}: found without a kind`);
    if (typeof entry.doc !== 'string' || !entry.doc.trim()) problems.push(`${key}: found with an empty doc (it should be unavailable)`);
  } else if (probe === 'system') {
    if (!isObject(entry.summary)) problems.push(`${key}: found without a summary`);
    if (!isObject(entry.emitters)) problems.push(`${key}: found without emitters`);
    if (!isObject(entry.modules)) problems.push(`${key}: found without modules`);
    else for (const [mod, value] of Object.entries(entry.modules)) checkEntry('module', `${key} / ${mod}`, value, problems);
  } else if (probe === 'module') {
    if (!Array.isArray(entry.inputs)) problems.push(`${key}: found without inputs`);
  } else if (probe === 'asset') {
    if (typeof entry.class !== 'string' || !entry.class) return problems.push(`${key}: found without a class`);
    const fields = ASSET_FIELDS[entry.class];
    if (!fields) return problems.push(`${key}: class ${entry.class} has no description; it should be unavailable`);
    for (const f of fields) if (!present(entry, f)) problems.push(`${key}: ${entry.class} entry lacks ${f}`);
  }
}

/**
 * Problems in a report, as an array of strings (empty when the report is sound). Every requested name must be a key, no key may be
 * silent, and each entry must say found, missing or unavailable with the fields that status requires.
 */
export function checkReport(probe, requested, report) {
  const problems = [];
  if (!isObject(report)) return ['the report is not a JSON object'];
  for (const name of requested) if (!present(report, name)) problems.push(`${name}: no entry in the report`);
  for (const [key, entry] of Object.entries(report)) checkEntry(probe, key, entry, problems);
  return problems;
}

/** One line per key for the launcher's console output. */
export function summarizeReport(report) {
  return Object.entries(report ?? {}).map(([key, entry]) => `${entry?.status ?? '?'}  ${key}${entry?.reason ? `  (${entry.reason})` : ''}`);
}
