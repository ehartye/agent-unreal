// Judges the reports that anim_bridge.mjs collects. Pure functions, no Unreal and no dependencies; the node test feeds them reports
// shaped like the ones anim_probe.py wrote on Unreal 5.8.2.
//   build = report of the first editor session (anim_probe.py, mode build); play = report of the second session (mode blend).

const norm = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The pose metrics of one phase of a played series: samples while the montage played, farthest distance from the rest pose, dominant axis. */
export function phaseMotion(series, phase) {
  const rest = (series ?? []).find((e) => e.phase === 'rest')?.loc;
  const samples = (series ?? []).filter((e) => e.phase === phase && e.loc);
  if (!rest || samples.length === 0) return { ok: false, detail: `no ${phase} samples` };
  let far = samples[0];
  for (const s of samples) if (norm(s.loc, rest) > norm(far.loc, rest)) far = s;
  const delta = far.loc.map((v, i) => Math.abs(v - rest[i]));
  const axis = delta.indexOf(Math.max(...delta));
  const playing = samples.filter((s) => s.playing === true);
  const positions = playing.map((s) => s.position);
  const rising = positions.length >= 5 && positions.every((p, i) => i === 0 || p >= positions[i - 1]);
  return { ok: true, rest, maxDistance: norm(far.loc, rest), axis, playingSamples: playing.length, rising };
}

/** True when the pose returned to the rest pose after the montage ended, and the montage reports it stopped. */
export function returnedToRest(series, phase) {
  const rest = (series ?? []).find((e) => e.phase === 'rest')?.loc;
  const after = (series ?? []).find((e) => e.phase === `${phase}_after`);
  return !!rest && !!after?.loc && after.playing === false && norm(after.loc, rest) < 0.5;
}

/** Distance from the rest pose of every sample, for a series with a continuously evaluated pose. */
export function distances(series) {
  const locs = (series ?? []).filter((e) => e.loc).map((e) => e.loc);
  if (locs.length === 0) return [];
  return locs.map((l) => norm(l, locs[0]));
}

const hasLine = (lines, re) => (lines ?? []).some((l) => re.test(l));

function slotChecks(label, series, build) {
  const a = phaseMotion(series, 'clip_a');
  const b = phaseMotion(series, 'clip_b');
  const started = (series ?? []).filter((e) => e.phase.endsWith('_started'));
  return [
    { name: `${label}: montage plays`, claim: 'play_clip returns a dynamic montage, the instance reports it playing, and its position rises',
      pass: started.length === 2 && started.every((e) => e.playing === true && /AnimMontage/.test(e.montage ?? '')) && a.ok && a.rising && b.ok && b.rising,
      detail: `started ${started.map((e) => `${e.montage}`).join(', ')}; clip A rising=${a.rising}; clip B rising=${b.rising}` },
    { name: `${label}: pose changes`, claim: 'while a clip plays the keyed bone moves at least 50 cm from rest, along a different axis for each clip',
      pass: a.ok && b.ok && a.maxDistance >= 50 && b.maxDistance >= 50 && a.axis !== b.axis,
      detail: a.ok && b.ok ? `clip A ${a.maxDistance.toFixed(1)} cm on axis ${a.axis}; clip B ${b.maxDistance.toFixed(1)} cm on axis ${b.axis}` : 'no samples' },
    { name: `${label}: pose returns to rest`, claim: 'after each clip the montage stops and the bone is back at its rest position',
      pass: returnedToRest(series, 'clip_a') && returnedToRest(series, 'clip_b'), detail: 'compared with the rest sample' },
    { name: `${label}: parent class`, claim: 'the running anim instance is the generated class of the Animation Blueprint (ABP_..._C), so play_clip came from its SlotClipAnimInstance parent',
      pass: /_C$/.test((series ?? []).find((e) => e.phase === 'rest')?.instance_class ?? ''), detail: (series ?? []).find((e) => e.phase === 'rest')?.instance_class ?? 'none' },
  ];
}

export function evaluate({ build, buildReport, playReport, buildLog = '' }) {
  const r = buildReport;
  const s = r?.steps ?? {};
  const reach = s.reach;
  const checks = [];
  checks.push({ name: 'modules compile', claim: 'UBT builds the editor target with the AnimBridge and SlotClip modules',
    pass: build?.exit === 0 && /Result: Succeeded/.test(build?.log ?? ''), detail: `exit ${build?.exit}` });
  checks.push({ name: 'no script errors', claim: 'every step of anim_probe.py ran', pass: !!r && (r.errors ?? []).length === 0 && !!playReport && (playReport.errors ?? []).length === 0,
    detail: JSON.stringify([...(r?.errors ?? []), ...(playReport?.errors ?? [])].map((e) => e.step)) });
  checks.push({ name: 'Python reach: classes', claim: 'unreal exposes the AnimGraph node classes, the state classes and BlueprintGraphEditor',
    pass: !!reach && Object.values(reach.classes ?? {}).length >= 9 && Object.values(reach.classes).every(Boolean), detail: JSON.stringify(reach?.classes) });
  checks.push({ name: 'Python reach: Nodes is protected', claim: 'the Nodes property of an AnimationGraph cannot be read or written from Python',
    pass: /protected and cannot be read/.test(reach?.nodes_property_read ?? '') && /protected and cannot be set/.test(reach?.nodes_property_write ?? ''), detail: `${reach?.nodes_property_read} | ${reach?.nodes_property_write}` });
  const actions = reach?.state_machine_graph_actions ?? [];
  checks.push({ name: 'Python reach: no state or transition', claim: 'a state machine graph offers no state or transition to BlueprintGraphEditor, and a state node made with new_object is not placed',
    pass: !!reach && reach.state_machine_node_created === true && actions.length > 0 && !actions.some((a) => /state|transition/i.test(a)) && Object.values(reach.state_names_tried ?? {}).every((v) => v === false)
      && reach.new_object_state_node_made === true && reach.state_machine_graph_nodes_after === 0,
    detail: `actions ${JSON.stringify(actions)}; nodes after ${reach?.state_machine_graph_nodes_after}` });
  const py = s.python_slot;
  checks.push({ name: 'Python slot Animation Blueprint', claim: 'BlueprintGraphEditor adds a Slot node, links it to the Root node and the Blueprint compiles clean (status BS_UP_TO_DATE)',
    pass: !!py && py.linked === true && /BS_UP_TO_DATE: 3/.test(py.status ?? '') && py.nodes_with_errors === 0 && py.nodes_with_warnings === 0 && (py.nodes ?? []).includes('AnimGraphNode_Slot'),
    detail: py ? `linked=${py.linked} status=${py.status} nodes=${py.nodes}` : 'no result' });
  const br = s.bridge_slot;
  checks.push({ name: 'bridge slot Animation Blueprint', claim: 'AddSlotToAnimBlueprint links a Slot node to the Root node and compiles with 0 errors and 0 warnings',
    pass: !!br && br.linked === true && br.compiled === true && br.errors === 0 && br.warnings === 0 && hasLine(br.graph, /^slot DefaultSlot$/) && hasLine(br.graph, /^link AnimGraph \| AnimGraphNode_Slot\.Pose -> AnimGraphNode_Root\.Result$/),
    detail: br ? `status ${br.blueprint_status}, errors ${br.errors}, warnings ${br.warnings}` : 'no result' });
  const ser = r?.series ?? {};
  checks.push(...slotChecks('Python slot', ser.ABP_Python, r));
  checks.push(...slotChecks('bridge slot', ser.ABP_Bridge, r));
  const pa = phaseMotion(ser.ABP_Python, 'clip_a'), ba = phaseMotion(ser.ABP_Bridge, 'clip_a');
  checks.push({ name: 'both routes give one pose', claim: 'the Python-made and the bridge-made Animation Blueprint move the bone to the same place (within 5 cm)',
    pass: pa.ok && ba.ok && Math.abs(pa.maxDistance - ba.maxDistance) < 5 && pa.axis === ba.axis, detail: pa.ok && ba.ok ? `${pa.maxDistance.toFixed(1)} vs ${ba.maxDistance.toFixed(1)} cm` : 'no samples' });
  const m = s.machine;
  checks.push({ name: 'bridge state machine', claim: 'AddState and AddTransition build two states and a transition, linked from the Entry node; the Blueprint compiles with no node errors',
    pass: !!m && m.idle === true && m.walk === true && m.transition === true && hasLine(m.graph, /AnimStateNode \| Idle$/) && hasLine(m.graph, /AnimStateNode \| Walk$/)
      && hasLine(m.graph, /AnimStateTransitionNode \| Idle to Walk$/) && hasLine(m.graph, /AnimStateEntryNode\.Entry -> AnimStateNode\.In$/) && m.nodes_with_errors === 0 && /BS_UP_TO_DATE/.test(m.status ?? ''),
    detail: m ? `status ${m.status}` : 'no result' });
  checks.push({ name: 'compiler warning for an empty transition', claim: 'the compiler reports that the new transition will never be taken until its Can Enter Transition pin is connected',
    pass: /ABP_Machine.*Idle to Walk\s+will never be taken/.test(buildLog), detail: 'from the editor log' });
  const raw = s.blend_raw, res = s.blend_resampled;
  checks.push({ name: 'blend space written from Python', claim: 'a BlendSpace1D made from Python keeps blend_parameters and two samples, and reports a play length of 1 s after saving',
    pass: [raw, res].every((b) => !!b && b.samples_read_back === 2 && b.play_length === 1 && (b.axis_read_back ?? []).join() === 'Speed,0.0,1.0,2' && b.linked === true && /BS_UP_TO_DATE: 3/.test(b.status ?? '') && b.nodes_with_errors === 0),
    detail: `raw ${raw?.samples_read_back} samples; resampled ${res?.samples_read_back} samples` });
  const pm = play => distances(playReport?.series?.[play]);
  const rawD = pm('ABP_BlendRaw'), resD = pm('ABP_BlendResampled'), seqD = pm('ABP_Player');
  checks.push({ name: 'blend space without resampling is inert', claim: 'a Blend Space Player on a Python-written Blend Space, in a fresh session, holds the reference pose',
    pass: rawD.length >= 10 && Math.max(...rawD) < 0.5, detail: `max distance ${rawD.length ? Math.max(...rawD).toFixed(2) : 'no samples'} cm over ${rawD.length} samples` });
  const resSeries = (playReport?.series?.ABP_BlendResampled ?? []).filter((e) => e.loc);
  const bMove = phaseMotion(ser.ABP_Python, 'clip_b'), aMove = phaseMotion(ser.ABP_Python, 'clip_a');
  const balanced = bMove.ok && aMove.ok && resSeries.length > 0
    && resSeries.every((e) => Math.abs(e.loc[aMove.axis] - e.loc[bMove.axis]) < 4);   // each clip keys its axis from 0, so equal weights give equal values
  checks.push({ name: 'blend space after ResampleBlendSpace', claim: 'after the bridge resamples it, the player blends both clips at X = 0.5: the bone moves along both axes by similar amounts',
    pass: resD.length >= 10 && Math.max(...resD) > 20 && balanced && res?.resampled === true, detail: `max distance ${resD.length ? Math.max(...resD).toFixed(1) : 'no samples'} cm; balanced=${balanced}` });
  checks.push({ name: 'Sequence Player from Python', claim: 'a Sequence Player node made and set from Python plays its clip (control for the Blend Space Player)',
    pass: seqD.length >= 10 && Math.max(...seqD) > 40 && s.player?.linked === true, detail: `max distance ${seqD.length ? Math.max(...seqD).toFixed(1) : 'no samples'} cm` });
  return checks;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}
