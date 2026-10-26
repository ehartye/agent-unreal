// Pure checks for rp_viewport.mjs, the opt-in directional-light probes behind skills/unreal-rendering/references/unreal-directional-lights.md. No Unreal, no files, no
// dependencies; rp-viewport.test.mjs feeds them canned reports and observations.
// Prepared 2026-10-26, not yet run on an engine. Two parts:
//   evaluateExtras(report)             headless (-nullrhi), judges rp_viewport_probe.py in RP_MODE=extras: the existing-level form and a setter on an unregistered component
//   evaluateViewport({report, observed})  INTERACTIVE: a person watches a rendering editor viewport through the phases of RP_MODE=interactive and records, per phase, whether the
//                                      renderer's orange message is on screen; the script cannot see the screen, so the observations are the evidence for the message checks
// The expectations marked "source" come from reading LightGridInjection.cpp (the message and the tie rule) and DirectionalLightComponent.cpp (the setter), not from a run.

/** The first words of the message (LightGridInjection.cpp 1904-1905); a person records what they saw, and this is what it should start with. */
export const MESSAGE_START = 'Multiple directional lights are competing';

/**
 * The phases of the interactive run, in order. `priorities` is what the script should read back from the sun and the moon at the start of the phase; `expect` is what the source
 * predicts for the message ('visible', 'hidden') or null where the source does not settle it and the run is the first observation.
 */
export const PHASES = [
  { name: 'tie', action: 'sun and moon both at ForwardShadingPriority 0', priorities: [0, 0], expect: 'visible' },
  { name: 'raise_setter', action: 'sun.set_forward_shading_priority(1)', priorities: [1, 0], expect: 'hidden' },
  { name: 'back_to_tie', action: 'sun.set_forward_shading_priority(0)', priorities: [0, 0], expect: 'visible' },
  { name: 'raise_property', action: "sun.set_editor_property('forward_shading_priority', 1)", priorities: [1, 0], expect: null },
  { name: 'back_property', action: "sun.set_editor_property('forward_shading_priority', 0)", priorities: [0, 0], expect: null },
  { name: 'moon_component_hidden', action: 'both at 0, the moon component set invisible with set_visibility(False)', priorities: [0, 0], expect: null },
  { name: 'moon_zero_intensity', action: 'both at 0, the moon visible again with intensity 0', priorities: [0, 0], expect: null },
  { name: 'moon_actor_hidden_in_editor', action: 'both at 0, the moon at intensity 1 with its actor hidden in the editor', priorities: [0, 0], expect: null },
];

// Equal as JSON, with object keys in sorted order, so a dict built in another order still matches.
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const isBool = (v) => typeof v === 'boolean';

// Texts that Python writes for a mistake in the probe itself, as rp-validate-checks.mjs treats them.
const PROBE_BUG = /\bAttributeError\b|\bNameError\b|has no attribute|\bname '[^']*' is not defined/;
const strings = (value) => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);

/**
 * The headless checks, for a report written with RP_MODE=extras.
 * @returns {{ name: string, claim: string, pass: boolean, detail: string }[]}
 */
export function evaluateExtras(report) {
  const r = report ?? {}, level = r.existing_level ?? {}, unreg = r.unregistered ?? {};
  const out = [];
  const check = (name, claim, pass, detail = '') => out.push({ name, claim, pass: Boolean(pass), detail: String(detail) });

  check('the existing-level form finds both lights and sets each component',
    'EditorActorSubsystem.get_all_level_actors, filtered to DirectionalLight, finds the sun and the moon; set_forward_shading_priority on the sun component reads back 1 and the moon stays 0',
    same(level.found, ['RpMoon', 'RpSun']) && same(level.before, { RpSun: 0, RpMoon: 0 }) && same(level.after, { RpSun: 1, RpMoon: 0 }),
    `found ${JSON.stringify(level.found)} of ${level.found_total} directional lights; before ${JSON.stringify(level.before)}; after ${JSON.stringify(level.after)}`);

  const recorded = unreg.ok === true ? Number.isInteger(unreg.value) : unreg.ok === false && typeof unreg.error === 'string' && unreg.error.length > 0;
  const bugs = strings(r).filter((t) => PROBE_BUG.test(t));
  check('the setter on a component the world has not registered records an outcome',
    'A DirectionalLightComponent made with new_object (never registered) either stores the value or raises; source predicts it stores it (AreDynamicDataChangesAllowed is true when the component is not registered). The outcome is recorded, not asserted; a Python AttributeError or NameError in the report is a bug in the probe',
    recorded && bugs.length === 0,
    bugs.length ? `probe bug: ${bugs[0]}` : `outcome ${JSON.stringify(unreg.ok === true ? { value: unreg.value } : { error: unreg.error })}`);

  check('the renderer setting is read',
    'r.ForwardShading reads as an integer, so the interactive run can say which renderer its observations are for',
    Number.isInteger(r.renderer?.forward_shading), `r.ForwardShading ${JSON.stringify(r.renderer?.forward_shading)}`);
  return out;
}

/** A blank observation sheet for a person to fill in during the interactive run. */
export function observationTemplate() {
  return Object.fromEntries(PHASES.map((p) => [p.name, { message_visible: null, text_seen: '', colour: '', screenshot: '' }]));
}

/**
 * The interactive checks. `report` is the rp_viewport_probe.py report of RP_MODE=interactive; `observed` is a person's sheet keyed by phase name, each entry
 * { message_visible: true|false, text_seen?, colour?, screenshot? }.
 * @returns {{ name: string, claim: string, pass: boolean, detail: string }[]}
 */
export function evaluateViewport({ report, observed } = {}) {
  const r = report ?? {}, seen = observed ?? {}, phases = Array.isArray(r.phases) ? r.phases : [];
  const out = [];
  const check = (name, claim, pass, detail = '') => out.push({ name, claim, pass: Boolean(pass), detail: String(detail) });

  const wrong = [];
  for (const p of PHASES) {
    const got = phases.find((x) => x?.name === p.name);
    const priorities = got?.lights?.map((l) => l.priority);
    if (!got) wrong.push(`${p.name}: not run`);
    else if (!same(priorities, p.priorities)) wrong.push(`${p.name}: priorities ${JSON.stringify(priorities)}, scripted ${JSON.stringify(p.priorities)}`);
  }
  check('the script ran every phase and the lights read back as scripted',
    'Each phase recorded the sun and the moon with the ForwardShadingPriority the phase sets; a phase that is missing or reads differently means the observation for it is not about the state it names',
    wrong.length === 0 && r.done === true, wrong.length ? wrong.join(' | ') : `${phases.length} phases; done ${r.done}`);

  check('the observations are for a deferred renderer',
    'r.ForwardShading reads 0, so a message seen in the tie phase was drawn by a project that is not using the forward renderer',
    r.renderer?.forward_shading === 0, `r.ForwardShading ${JSON.stringify(r.renderer?.forward_shading)}`);

  for (const p of PHASES) {
    const o = seen[p.name];
    const answered = isBool(o?.message_visible);
    if (p.expect) {
      const want = p.expect === 'visible';
      check(`${p.name}: the message is ${p.expect}`,
        `${p.action}. Source: ${want ? 'two lights tie for the highest priority, so the renderer draws the orange message' : 'one light holds the highest priority, so the renderer draws nothing'}`,
        answered && o.message_visible === want, answered ? `message visible: ${o.message_visible}` : 'no observation recorded');
    } else {
      check(`${p.name}: the outcome is recorded`,
        `${p.action}. The source does not settle whether the message shows; the observation is the result`,
        answered, answered ? `message visible: ${o.message_visible}` : 'no observation recorded');
    }
  }

  const tie = seen.tie;
  const text = typeof tie?.text_seen === 'string' ? tie.text_seen : '';
  const colour = typeof tie?.colour === 'string' ? tie.colour : '';
  check('the tie message starts with the expected words and is orange',
    `The text a person read in the tie phase starts "${MESSAGE_START}" and its colour is orange (LightGridInjection.cpp draws it with FColor::Orange); both fields must be filled in`,
    text.startsWith(MESSAGE_START) && /orange/i.test(colour), `text ${JSON.stringify(text.slice(0, 60))}; colour ${JSON.stringify(colour)}`);
  return out;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}
