// Pure checks for rp_validate.mjs: turn the JSON report and log text of rp_probe.py into pass or fail results, one per claim in
// skills/unreal-rendering/references/unreal-directional-lights.md that a headless run can back. No Unreal, no files:
// rp-validate.test.mjs feeds it a canned report, and rp_validate.mjs the real one.

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Lines of the log that report a console variable lookup by this exact name as failed (the name is quoted, so a longer name does not match). */
export function countMissingCvarLines(log, name) {
  return (String(log || '').match(new RegExp(`Failed to find console variable '${escape(name)}'`, 'g')) || []).length;
}

const ROUTES = ['set_editor_property', 'attribute_assignment', 'setter_negative', 'setter_on_static'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// A route is recorded when it kept the whole error text or a numeric read-back; which one it kept is not judged.
const recorded = (route) => Boolean(route) && (route.ok === false ? typeof route.error === 'string' && route.error.length > 0 : route.ok === true && Number.isInteger(route.value));

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

  check('every other route to the property recorded an error or a read-back',
    'set_editor_property, attribute assignment, the setter with a negative value and the setter on a Static component each ended in an error or a value (the reference states which)',
    ROUTES.every((k) => recorded(routes[k])),
    ROUTES.map((k) => `${k}: ${JSON.stringify(routes[k])}`).join(' | '));

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
