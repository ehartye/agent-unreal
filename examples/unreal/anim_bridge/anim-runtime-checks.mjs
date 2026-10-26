// Judges the reports that anim_runtime.mjs collects. Pure functions, no Unreal and no dependencies.
// The report shapes are those anim_runtime_probe.py writes. No engine run has produced one yet, so the node test builds them by hand
// (the pose series copy the shape of anim_probe.py's, which ran on 5.8.2); the first run confirms the shape (see README.md).
//   build = report of the first editor session (anim_runtime_probe.py, mode build); play = report of the second session (mode play).

const sub = (a, b) => a.map((v, i) => v - b[i]);
const len = (v) => Math.hypot(...v);
const axisOf = (v) => v.map(Math.abs).indexOf(Math.max(...v.map(Math.abs)));
const hasLine = (lines, re) => (lines ?? []).some((l) => re.test(l));
const clean = (info) => !!info && /BS_UP_TO_DATE/.test(info.status ?? '') && info.nodes_with_errors === 0;

/** The farthest sample of a series from the reference pose: { ok, distance, axis, delta }. */
export function peak(samples, rest) {
  const located = (samples ?? []).filter((s) => s.loc);
  if (!rest || located.length === 0) return { ok: false, detail: 'no samples' };
  let far = located[0];
  for (const s of located) if (len(sub(s.loc, rest)) > len(sub(far.loc, rest))) far = s;
  const delta = sub(far.loc, rest);
  return { ok: true, distance: len(delta), axis: axisOf(delta), delta };
}

/** The last `count` samples of one phase: the part of the phase after a crossfade or a layer switch has finished. */
export function settled(samples, phase, count = 5) {
  return (samples ?? []).filter((s) => s.phase === phase).slice(-count);
}

/** The state names of a series in order, repeated names folded: "Idle > Walk > Idle". */
export function stateTrail(samples) {
  const trail = [];
  for (const s of samples ?? []) if (s.state !== undefined && trail[trail.length - 1] !== s.state) trail.push(s.state);
  return trail.join(' > ');
}

const restOf = (play) => play?.series?.ABP_Ref?.[0]?.loc;

export function evaluate({ build, buildReport, playReport, buildLog = '' }) {
  const b = buildReport;
  const s = b?.steps ?? {};
  const p = playReport;
  const series = p?.series ?? {};
  const rest = restOf(p);
  const checks = [];
  const add = (name, claim, pass, detail, info = false) => checks.push({ name, claim, pass: !!pass, detail, info });

  add('modules compile', 'UBT builds the editor target with the AnimBridge, AnimMachineBridge, SlotClip and AnimMachine modules',
    build?.exit === 0 && /Result: Succeeded/.test(build?.log ?? ''), `exit ${build?.exit}`);
  add('no script errors', 'every step of anim_runtime_probe.py ran in both sessions',
    !!b && (b.errors ?? []).length === 0 && !!p && (p.errors ?? []).length === 0, JSON.stringify([...(b?.errors ?? []), ...(p?.errors ?? [])].map((e) => e.step)));
  const needed = ['MachineAnimInstance', 'AnimMachineBridgeLibrary', 'AnimBridgeLibrary', 'BlendSpace', 'BlendSpaceFactoryNew', 'AnimGraphNode_LinkedAnimLayer'];
  add('classes are visible in Python', 'unreal exposes the runtime parent class, both bridge libraries, the 2D Blend Space and its factory, and the Linked Anim Layer node',
    !!b?.classes && needed.every((n) => b.classes[n] === true), JSON.stringify(b?.classes));

  // controls: where each clip moves the bone
  const peaks = {};
  for (const [key, name] of [['a', 'ABP_CtrlA'], ['b', 'ABP_CtrlB'], ['c', 'ABP_CtrlC']]) peaks[key] = peak(series[name], rest);
  const controlsOk = Object.values(peaks).every((x) => x.ok && x.distance >= 50) && new Set(Object.values(peaks).map((x) => x.axis)).size === 3;
  add('controls: each clip moves the bone along its own axis', 'a Sequence Player on each clip moves the bone at least 50 cm from the reference pose, along three different axes',
    controlsOk, Object.entries(peaks).map(([k, x]) => (x.ok ? `${k}: ${x.distance.toFixed(1)} cm axis ${x.axis}` : `${k}: ${x.detail}`)).join('; '));

  // state machine
  const m = s.machine;
  const machineBuilt = !!m && ['idle', 'walk', 'idle_sequence', 'walk_sequence', 'rule_idle_to_walk', 'rule_walk_to_idle', 'machine_linked'].every((k) => m[k] === true)
    && hasLine(m.graph, /AnimStateNode \| Idle$/) && hasLine(m.graph, /AnimStateNode \| Walk$/)
    && hasLine(m.graph, /AnimStateTransitionNode \| Idle to Walk$/) && hasLine(m.graph, /AnimStateTransitionNode \| Walk to Idle$/) && clean(m);
  add('state machine builds', 'AddState, SetStateSequence and AddTransitionOnVariable build Idle and Walk with content and a Boolean rule on each transition; the Blueprint compiles with no node errors',
    machineBuilt, m ? `status ${m.status}, errors ${m.nodes_with_errors}` : 'no result');
  add('no empty-rule warning', 'neither transition keeps the empty Can Enter Transition pin the compiler warns about (the default run records that warning)',
    !/ABP_Machine.*will never be taken/.test(buildLog), 'from the editor log');

  const machine = series.ABP_Machine ?? [];
  const trail = stateTrail(machine);
  const axisA = peaks.a.axis, axisB = peaks.b.axis;
  const phasePeak = (phase) => peak(settled(machine, phase), rest);
  const base = phasePeak('baseline'), second = phasePeak('second'), third = phasePeak('third');
  const allState = (phase, name) => settled(machine, phase).length > 0 && settled(machine, phase).every((x) => x.state === name);
  add('state machine plays', 'the current state name is Idle, then Walk after bGoWalk is set, then Idle after bGoIdle is set',
    machine.length > 0 && machine[0].state === 'Idle' && allState('baseline', 'Idle') && allState('second', 'Walk') && allState('third', 'Idle'),
    `${machine.length} samples; machine names ${JSON.stringify(p?.machine_names)}; states ${trail || 'none'}`);
  const poseFollows = controlsOk && base.ok && second.ok && third.ok && base.axis === axisA && second.axis === axisB && third.axis === axisA
    && Math.abs(second.delta[axisA]) < 0.25 * Math.abs(second.delta[axisB]) && Math.abs(third.delta[axisB]) < 0.25 * Math.abs(third.delta[axisA]);
  add('the pose follows the state', 'while the state is Idle the bone moves along the axis of clip A; once Walk has taken over it moves along the axis of clip B and not clip A\'s; after Walk to Idle it is back on clip A\'s axis',
    poseFollows, controlsOk && base.ok && second.ok && third.ok ? `axes ${base.axis} > ${second.axis} > ${third.axis}; clip A axis ${axisA}, clip B axis ${axisB}` : 'no samples or no controls');

  // 2D blend space
  const bs = s.blend2d;
  const players = bs?.players ?? {};
  const pk = (suffix) => peak(series[`ABP_B2D_${suffix}`], rest);
  const axesOk = (bs?.axes_read_back ?? []).length === 2 && bs.axes_read_back.every((a, i) => a[0] === ['X', 'Y'][i] && Number(a[1]) === 0 && Number(a[2]) === 1 && Number(a[3]) === 2);
  add('2D Blend Space builds', 'a BlendSpace written from Python keeps two axes and three samples, the bridge resamples it, and four Blend Space Player graphs link and compile clean',
    !!bs && bs.resampled === true && bs.samples_read_back === 3 && bs.play_length > 0.9 && axesOk
      && ['00', '10', '01', 'mid'].every((k) => players[k]?.linked === true && clean(players[k]) && (players[k].pins ?? []).includes('X') && (players[k].pins ?? []).includes('Y')),
    bs ? `resampled ${bs.resampled}, ${bs.samples_read_back} samples, length ${bs.play_length}, axes ${JSON.stringify(bs.axes_read_back)}` : 'no result');
  const corner = (suffix, key) => { const x = pk(suffix); return x.ok && peaks[key].ok && x.axis === peaks[key].axis && x.distance >= 0.8 * peaks[key].distance && x.distance <= 1.2 * peaks[key].distance; };
  add('2D corners play one clip each', 'at (0, 0), (1, 0) and (0, 1) the bone moves as it does under the control for clip A, B and C: same axis, within 20 percent of the distance',
    corner('00', 'a') && corner('10', 'b') && corner('01', 'c'),
    ['00:a', '10:b', '01:c'].map((e) => { const [suffix, key] = e.split(':'); const x = pk(suffix); return x.ok ? `${suffix} ${x.distance.toFixed(1)} cm axis ${x.axis} (control ${peaks[key].ok ? `${peaks[key].distance.toFixed(1)} cm axis ${peaks[key].axis}` : 'none'})` : `${suffix} ${x.detail}`; }).join('; '));
  const mid = pk('mid');
  const ratios = mid.ok && controlsOk ? [peaks.a, peaks.b, peaks.c].map((c) => Math.abs(mid.delta[c.axis]) / c.distance) : [];
  add('2D interior blends all three clips', 'at (1/3, 1/3) the bone moves along all three clip axes, each by 20 to 50 percent of that clip\'s own distance',
    ratios.length === 3 && ratios.every((r) => r >= 0.2 && r <= 0.5), ratios.length ? `ratios ${ratios.map((r) => r.toFixed(2)).join(', ')}` : 'no samples');

  // linked layers
  const l = s.layers;
  const layerBuilt = !!l && l.layer_added === true && /BS_UP_TO_DATE/.test(l.interface_status ?? '')
    && l.host?.implemented === true && l.guest?.implemented === true && l.host?.layer_sequence === true && l.guest?.layer_sequence === true
    && l.host?.node_class === 'AnimGraphNode_LinkedAnimLayer' && l.host?.linked === true && clean(l.host) && clean(l.guest)
    && hasLine(l.host?.layers, /linked-layer .*layer Locomotion/);
  add('linked layers build', 'an interface with one layer, a host and a guest that implement it with different content, and a Linked Anim Layer node in the host that is linked and compiles clean',
    layerBuilt, l ? `interface via ${l.interface_route}; host node ${l.host?.node_class}, linked ${l.host?.linked}, candidates ${JSON.stringify(l.host?.candidates)}` : 'no result');
  const host = series.ABP_LayerHost ?? [];
  const hb = peak(settled(host, 'baseline'), rest), h2 = peak(settled(host, 'second'), rest), h3 = peak(settled(host, 'third'), rest);
  add('linked layers swap at runtime', 'the host plays its own layer (clip A), plays the guest\'s layer (clip B) after LinkAnimClassLayers, and its own again after LinkAnimClassLayers with no class',
    controlsOk && hb.ok && h2.ok && h3.ok && hb.axis === axisA && h2.axis === axisB && h3.axis === axisA && Math.abs(h2.delta[axisA]) < 0.25 * Math.abs(h2.delta[axisB]),
    controlsOk && hb.ok && h2.ok && h3.ok ? `axes ${hb.axis} > ${h2.axis} > ${h3.axis}; linked instance ${p?.notes?.linked_instance}` : 'no samples or no controls');

  // observations
  add('observation: layer actions', 'the Blueprint action names the host offers for the layer (the node route is chosen from them)', true,
    JSON.stringify(l?.host?.available_layer_actions ?? 'none'), true);
  add('observation: interface route', 'how the layer interface asset was created', true, `${l?.interface_route ?? 'none'}; classes ${JSON.stringify(b?.classes ?? {})}`, true);
  return checks;
}

export function summarize(checks) {
  const counted = checks.filter((c) => !c.info);
  return { passed: counted.filter((c) => c.pass).length, total: counted.length };
}
