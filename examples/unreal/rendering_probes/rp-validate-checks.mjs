// Pure checks for rp_validate.mjs: turn the JSON report and log text of rp_probe.py into pass or fail results, one per claim in
// skills/unreal-rendering/references/unreal-directional-lights.md that a headless run can back. No Unreal, no files:
// rp-validate.test.mjs feeds it a canned report, and rp_validate.mjs the real one. Also the two small pure helpers the runner needs:
// planCleanup (keep the folder when a check failed or no report was written) and flushLine (one line per phase, written at once).
import { writeSync } from 'node:fs';

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Lines of the log that report a console variable lookup by this exact name as failed (the name is quoted, so a longer name does not match). */
export function countMissingCvarLines(log, name) {
  return (String(log || '').match(new RegExp(`Failed to find console variable '${escape(name)}'`, 'g')) || []).length;
}

/**
 * Write one line now. spawnSync blocks the event loop, so a console.log to a redirected stream can sit unwritten until the whole run ends;
 * a synchronous write does not. Returns false when the stream is gone (EPIPE and the like); never throws.
 * @param {string} text
 * @param {{ fd?: number, write?: Function, sleep?: Function }} [io]  injected by the test
 */
export function flushLine(text, { fd = 1, write = writeSync, sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } = {}) {
  const data = Buffer.from(`${text}\n`, 'utf8');
  let offset = 0, waits = 0;
  while (offset < data.length) {
    try { offset += write(fd, data, offset, data.length - offset); waits = 0; } catch (error) {
      if (error && error.code === 'EAGAIN' && ++waits <= 2000) { sleep(2); continue; }
      return false;
    }
  }
  return true;
}

/**
 * What to do with the throwaway project folder once the checks ran: delete it only when the run was clean and --keep was not passed.
 * A failed check or a missing report keeps the folder, because the log in it is the evidence.
 * @returns {{ remove: boolean, message: string }}  message is empty when the folder is removed
 */
export function planCleanup({ keep, report, checks, root, logPath }) {
  if (!report) return { remove: false, message: `no report was written; kept ${root}; editor log: ${logPath}` };
  const failed = (checks || []).filter((c) => !c.pass).length;
  if (failed > 0) return { remove: false, message: `${failed} check${failed === 1 ? '' : 's'} failed; kept ${root}; editor log: ${logPath}` };
  if (keep) return { remove: false, message: `kept ${root}` };
  return { remove: true, message: '' };
}

const ROUTES = ['set_editor_property', 'attribute_assignment', 'setter_negative', 'setter_on_static'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// A route is recorded when it kept the whole error text or a numeric read-back; which one it kept is not judged.
const recorded = (route) => Boolean(route) && (route.ok === false ? typeof route.error === 'string' && route.error.length > 0 : route.ok === true && Number.isInteger(route.value));

// Texts that Python writes for a mistake in the probe itself (a wrong attribute or name), not for something the engine did. The engine's own
// read-only message says "for attribute 'x'", which does not match.
const PROBE_BUG = /\bAttributeError\b|\bNameError\b|has no attribute|\bname '[^']*' is not defined/;
const strings = (value) => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);

/** Every text in the report that reads as a bug in the probe. */
export function probeBugTexts(report) {
  return strings(report).filter((text) => PROBE_BUG.test(text));
}

// The outcomes the [tested] lines of unreal-directional-lights.md state for the other routes, one rule per route.
const OUTCOMES = [
  ['set_editor_property stores 2', 'set_editor_property', (r) => r.ok === true && r.value === 2],
  ['attribute assignment raises the read-only error', 'attribute_assignment', (r) => r.ok === false && /'ForwardShadingPriority'.*is read-only and cannot be set/.test(r.error)],
  ['the setter with -3 after 2 reads back 0', 'setter_negative', (r) => r.ok === true && r.before === 2 && r.value === 0],
  ['a Static component keeps 4 after the setter is called with 5', 'setter_on_static', (r) => r.ok === true && r.before === 4 && r.value === 4 && /STATIC/.test(String(r.mobility))],
];

/** Why check 2 fails: a route not recorded, a recorded text that is a probe bug, or an outcome the reference states that did not happen. */
export function routeProblems(report) {
  const routes = (report || {}).routes || {}, lights = (report || {}).lights || {}, problems = [];
  for (const k of ROUTES) if (!recorded(routes[k])) problems.push(`${k} recorded neither an error nor a read-back`);
  for (const [say, key, ok] of OUTCOMES) if (recorded(routes[key]) && !ok(routes[key])) problems.push(`${say}: got ${JSON.stringify(routes[key])}`);
  if (!lights.attribute_before || lights.attribute_before.ok !== true) problems.push(`reading the attribute works: got ${JSON.stringify(lights.attribute_before)}`);
  if (!/STATIONARY/.test(String(lights.mobility))) problems.push(`a spawned light's mobility reads STATIONARY: got ${JSON.stringify(lights.mobility)}`);
  for (const text of probeBugTexts(report)) problems.push(`probe bug, not an engine result: ${text}`);
  return problems;
}

/**
 * @param {{ report?: object, log?: string }} r  the parsed rp_probe.py report and the text of the editor log of the same run
 * @returns {{ name: string, claim: string, pass: boolean, detail: string }[]}
 */
export function evaluate(r) {
  const report = r.report || {}, lights = report.lights || {}, routes = report.routes || {}, cvars = report.cvars || {}, log = r.log || '';
  const out = [];
  const check = (name, claim, pass, detail = '') => out.push({ name, claim, pass: Boolean(pass), detail: String(detail) });

  check('two directional lights read 0 and 0, then 1 and 0 after set_forward_shading_priority(1) on one',
    'ForwardShadingPriority defaults to 0; the BlueprintCallable setter, called from Python as set_forward_shading_priority, raises it on one light only',
    same(lights.before, [0, 0]) && same(lights.after, [1, 0]),
    `before ${JSON.stringify(lights.before)}, after ${JSON.stringify(lights.after)}`);

  const problems = routeProblems(report);
  check('every other route recorded the outcome the reference states, and none recorded a bug in the probe',
    'set_editor_property stores the value, attribute assignment raises the read-only error, the setter with a negative value reads back 0 and the setter on a Static component keeps its value; no recorded text is a Python AttributeError or NameError',
    problems.length === 0,
    problems.length ? problems.join(' | ') : ROUTES.map((k) => `${k}: ${JSON.stringify(routes[k])}`).join(' | '));

  const missingAllow = countMissingCvarLines(log, 'r.MegaLights.Allow');
  const missingAllowed = countMissingCvarLines(log, 'r.MegaLights.Allowed');
  const lookups = cvars.allow === 0 && cvars.allowed === 1 && missingAllow >= 1 && missingAllowed === 0;
  const untestable = typeof cvars.not_testable === 'string' && cvars.not_testable.length > 0;
  check('the console variable lookups tell a registered name from an unknown one',
    'get_console_variable_int_value returns 0 and logs "Failed to find console variable" for r.MegaLights.Allow, and returns 1 without a warning for r.MegaLights.Allowed; or the probe says why this cannot be tested',
    lookups || untestable,
    untestable ? `not testable: ${cvars.not_testable}` : `Allow ${cvars.allow} (${missingAllow} warning lines), Allowed ${cvars.allowed} (${missingAllowed} warning lines)`);
  return out;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}
