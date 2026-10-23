// Judges the reports that landscape_bridge.mjs collects. Pure functions, no Unreal and no dependencies; the node test feeds them
// reports shaped like the ones bridge_probe.py wrote on Unreal 5.8.2.

/** True when every sample was found and sits within half a height step (plus a small allowance) of the input height. */
export function heightsMatch(report) {
  const samples = report?.samples ?? [];
  const step = report?.height_step_cm;
  if (samples.length === 0 || !(step > 0)) return { ok: false, detail: 'no samples or no height step' };
  const tolerance = step / 2 + 0.1;
  const bad = [];
  let worst = 0;
  for (const s of samples) {
    const got = Number(s.call_result);
    if (s.call_result === 'None' || !Number.isFinite(got)) { bad.push(`${s.vertex} not found`); continue; }
    const error = Math.abs(got - s.expected_cm);
    worst = Math.max(worst, error);
    if (error > tolerance) bad.push(`${s.vertex} expected ${s.expected_cm} got ${got}`);
  }
  return { ok: bad.length === 0, detail: bad.length ? bad.join('; ') : `${samples.length} vertices, worst error ${worst.toFixed(3)} cm, tolerance ${tolerance.toFixed(3)} cm` };
}

function scenarioChecks(label, r, { proxies }) {
  const out = [];
  const rb = r?.readback;
  out.push({ name: `${label}: Landscape created`, claim: 'the bridge function returns a Landscape actor in a new map',
    pass: !!(r && r.created && r.new_level_ok && !r.error), detail: r ? `created=${r.created} new_level_ok=${r.new_level_ok} ${r.error ? `error=${r.error.slice(-200)}` : ''}` : 'no report' });
  out.push({ name: `${label}: component count`, claim: 'the Landscape has (size - 1) / quads per component, per side, squared components',
    pass: !!rb && rb.components_total === r.expected_components, detail: rb ? `components_total=${rb.components_total} expected=${r.expected_components}` : 'no readback' });
  out.push({ name: `${label}: quad size and component size`, claim: 'actor scale X/Y is the requested quad size and components are 126 quads apart',
    pass: !!rb && rb.quad_size_cm[0] === 100 && rb.quad_size_cm[1] === 100 && rb.component_step_quads === 126,
    detail: rb ? `quad_size_cm=${rb.quad_size_cm} component_step_quads=${rb.component_step_quads}` : 'no readback' });
  const h = heightsMatch(r);
  out.push({ name: `${label}: sampled heights`, claim: 'the height at sampled vertices equals the input height array within half a height step', pass: h.ok, detail: h.detail });
  if (proxies !== undefined) {
    out.push({ name: `${label}: streaming proxies`, claim: `the map holds ${proxies} landscape streaming proxies`,
      pass: !!rb && rb.streaming_proxies === proxies, detail: rb ? `streaming_proxies=${rb.streaming_proxies} components_per_holder=${rb.components_per_holder}` : 'no readback' });
  }
  return out;
}

/**
 * input: { build: {exit, log}, scenarios: { plain, wp0, wp2 }, externalFiles }.
 * plain = non-partitioned map; wp0 = partitioned map, grid size 0; wp2 = partitioned map, grid size 2 components.
 */
export function evaluate({ build, scenarios, externalFiles }) {
  const { plain, wp0, wp2 } = scenarios;
  const checks = [];
  checks.push({ name: 'module compiles', claim: 'UBT builds the editor target with the LandscapeBridge module',
    pass: build?.exit === 0 && /Result: Succeeded/.test(build?.log ?? ''), detail: `exit ${build?.exit}, ${/Result: Succeeded/.test(build?.log ?? '') ? 'Result: Succeeded' : 'no success line'}` });
  const members = plain?.bridge_members ?? [];
  checks.push({ name: 'functions visible in Python', claim: 'dir(unreal.LandscapeBridgeLibrary) lists create_landscape_from_heights and get_landscape_height_at',
    pass: !!plain?.bridge_class_found && members.includes('create_landscape_from_heights') && members.includes('get_landscape_height_at'), detail: `members: ${members.join(', ') || 'none'}` });
  checks.push(...scenarioChecks('non-partitioned map', plain, { proxies: 0 }));
  checks.push(...scenarioChecks('partitioned map, grid size 0', wp0, { proxies: 0 }));
  checks.push({ name: 'partitioned map, grid size 0: partitioned', claim: 'new_level(path, True) makes a World Partition map (actor descriptors exist after the save)',
    pass: !!wp0?.partitioned_after_save && wp0.save_level_ok === true, detail: `actor_descs=${wp0?.actor_descs} classes=${wp0?.actor_desc_classes}` });
  checks.push(...scenarioChecks('partitioned map, grid size 2', wp2, { proxies: 4 }));
  checks.push({ name: 'partitioned map, grid size 2: streamed', claim: 'the four streaming proxies are saved as external actors, one file per actor descriptor',
    pass: !!wp2?.partitioned_after_save && (wp2.actor_desc_classes ?? []).includes('LandscapeStreamingProxy') && externalFiles > 0 && externalFiles === wp2.actor_descs,
    detail: `actor_descs=${wp2?.actor_descs} classes=${wp2?.actor_desc_classes} external actor files=${externalFiles}` });
  return checks;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}
