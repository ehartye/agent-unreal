// node --test examples/unreal/anim_bridge/anim-runtime.test.mjs  (no Unreal, no dependencies)
// The reports below are built by hand from what anim_runtime_probe.py writes. No engine run has produced one yet, so the report shape is an
// assumption (the pose series copy the shape of anim_probe.py's, which ran on 5.8.2); the first run confirms it. Each test changes one fact and
// expects the matching check to change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize, peak, settled, stateTrail } from './anim-runtime-checks.mjs';

const REST = [0, 0, 50];
const unit = (axis, amount) => { const v = [...REST]; v[axis] += amount; return v; };
const phaseOf = (tick) => (tick < 12 ? 'baseline' : tick < 32 ? 'second' : 'third');
const sawtooth = (tick) => 100 * (((tick + 1) % 10) / 10);   // a clip of one second sampled every 0.1 s, looping
/** A series whose bone moves along `axisAt(tick)` by `amountAt(tick)`; `extra` adds a per-tick field. */
const motion = (axisAt, amountAt = sawtooth, extra = () => ({})) => Array.from({ length: 52 }, (_, tick) => ({ phase: phaseOf(tick), tick, loc: unit(axisAt(tick), amountAt(tick)), ...extra(tick) }));
const AX = { a: 0, b: 1, c: 2 };

const clean = { status: 'BlueprintStatus.BS_UP_TO_DATE: 3', nodes_with_errors: 0, nodes_with_warnings: 0 };
const machineStep = { idle: true, walk: true, idle_sequence: true, walk_sequence: true, rule_idle_to_walk: true, rule_walk_to_idle: true, machine_linked: true, ...clean,
  graph: ['node AnimGraph | AnimGraphNode_Root | Output Pose', 'node New State Machine | AnimStateNode | Idle', 'node New State Machine | AnimStateNode | Walk',
    'node New State Machine | AnimStateTransitionNode | Idle to Walk', 'node New State Machine | AnimStateTransitionNode | Walk to Idle'] };
const player = (extra = {}) => ({ pins: ['Pose', 'X', 'Y', 'Z'], linked: true, ...clean, ...extra });
const buildReport = (override = {}) => ({
  engine: '5.8.2-0+++UE5+Release-5.8', mode: 'build', errors: [], bone_keyed: 'Bone02',
  classes: { MachineAnimInstance: true, AnimMachineBridgeLibrary: true, AnimBridgeLibrary: true, BlendSpace: true, BlendSpaceFactoryNew: true, AnimLayerInterfaceFactory: true, AnimGraphNode_LinkedAnimLayer: true },
  steps: {
    control_A: { linked: true, ...clean }, control_B: { linked: true, ...clean }, control_C: { linked: true, ...clean },
    machine: machineStep,
    blend2d: { asset_class: 'BlendSpace', resampled: true, play_length: 1.0, samples_read_back: 3, axes_read_back: [['X', '0.0', '1.0', '2'], ['Y', '0.0', '1.0', '2']],
      players: { '00': player(), '10': player(), '01': player(), mid: player() } },
    layers: { interface_route: 'AnimLayerInterfaceFactory', interface_class: 'AnimBlueprint', layer_added: true, interface_status: 'BlueprintStatus.BS_UP_TO_DATE: 3', interface_layers: ['animation-graph Locomotion | interface guid no'],
      host: { implemented: true, layer_sequence: true, available_layer_actions: ['Animation|LinkedAnimLayers|Locomotion-LinkedAnimLayer'], candidates: ['Animation|LinkedAnimLayers|Locomotion-LinkedAnimLayer'],
        node_class: 'AnimGraphNode_LinkedAnimLayer', linked: true, ...clean, layers: ['interface ABI_Locomotion_C | graphs Locomotion ', 'linked-layer AnimGraph | layer Locomotion | interface ABI_Locomotion_C'] },
      guest: { implemented: true, layer_sequence: true, ...clean, layers: ['interface ABI_Locomotion_C | graphs Locomotion '] } },
  },
  ...override,
});
const stateAt = (tick) => (tick < 14 ? 'Idle' : tick < 34 ? 'Walk' : 'Idle');   // the crossfade takes two ticks
const playReport = (override = {}) => ({
  mode: 'play', errors: [], machine_names: ['New State Machine'], notes: { linked_instance: 'ABP_LayerGuest_C_0' },
  series: {
    ABP_Ref: [{ phase: 'baseline', tick: 0, loc: REST }],
    ABP_CtrlA: motion(() => AX.a), ABP_CtrlB: motion(() => AX.b), ABP_CtrlC: motion(() => AX.c),
    ABP_Machine: motion((t) => (stateAt(t) === 'Walk' ? AX.b : AX.a), sawtooth, (t) => ({ state: stateAt(t) })),
    ABP_B2D_00: motion(() => AX.a), ABP_B2D_10: motion(() => AX.b), ABP_B2D_01: motion(() => AX.c),
    ABP_B2D_mid: Array.from({ length: 52 }, (_, tick) => ({ phase: phaseOf(tick), tick, loc: [sawtooth(tick) / 3, sawtooth(tick) / 3, 50 + sawtooth(tick) / 3] })),
    ABP_LayerHost: motion((t) => (t >= 13 && t < 33 ? AX.b : AX.a)),
  },
  ...override,
});
const good = { build: { exit: 0, log: 'Result: Succeeded\n' }, buildReport: buildReport(), playReport: playReport(), buildLog: 'LogBlueprint: nothing to say' };
const run = (patch = {}) => evaluate({ ...good, ...patch });
const failing = (checks) => checks.filter((c) => !c.pass && !c.info).map((c) => c.name);

test('a good set of reports passes every counted check', () => {
  const checks = run();
  assert.deepEqual(failing(checks), []);
  const { passed, total } = summarize(checks);
  assert.equal(passed, total);
  assert.ok(total >= 12);
  assert.ok(checks.some((c) => c.info && /layer actions/.test(c.name)));
});

test('peak, settled and stateTrail read a series the way the checks need', () => {
  const series = motion(() => AX.b);
  const far = peak(series, REST);
  assert.equal(far.axis, 1);
  assert.equal(Math.round(far.distance), 90);   // the sawtooth peaks at nine tenths of the clip at this sampling
  assert.equal(peak([], REST).ok, false);
  assert.equal(peak(series, undefined).ok, false);
  assert.equal(settled(series, 'second').length, 5);
  assert.equal(settled(series, 'second', 3)[2].tick, 31);
  assert.equal(stateTrail([{ state: 'Idle' }, { state: 'Idle' }, { state: 'Walk' }, { state: 'Idle' }, {}]), 'Idle > Walk > Idle');
});

test('a missing build report or play report fails the checks that need them instead of throwing', () => {
  const none = evaluate({ build: undefined, buildReport: undefined, playReport: undefined });
  for (const name of ['modules compile', 'no script errors', 'state machine builds', 'state machine plays', '2D Blend Space builds', 'linked layers build', 'linked layers swap at runtime']) {
    assert.ok(failing(none).includes(name), name);
  }
  assert.ok(failing(run({ playReport: undefined })).includes('state machine plays'));
});

test('each build fact turns its own check red', () => {
  const withStep = (name, patch) => { const r = buildReport(); r.steps[name] = { ...r.steps[name], ...patch }; return run({ buildReport: r }); };
  assert.ok(failing(run({ build: { exit: 1, log: 'error C2065' } })).includes('modules compile'));
  assert.ok(failing(run({ buildReport: buildReport({ errors: [{ step: 'blend2d' }] }) })).includes('no script errors'));
  assert.ok(failing(run({ buildReport: buildReport({ classes: { MachineAnimInstance: false } }) })).includes('classes are visible in Python'));
  assert.ok(failing(withStep('machine', { rule_walk_to_idle: false })).includes('state machine builds'));
  assert.ok(failing(withStep('machine', { nodes_with_errors: 1 })).includes('state machine builds'));
  assert.ok(failing(withStep('machine', { graph: ['node x | AnimStateNode | Idle'] })).includes('state machine builds'));
  assert.ok(failing(run({ buildLog: 'LogBlueprint: Warning: [AssetLog] ABP_Machine: Idle to Walk  will never be taken' })).includes('no empty-rule warning'));
  assert.ok(failing(withStep('blend2d', { resampled: false })).includes('2D Blend Space builds'));
  assert.ok(failing(withStep('blend2d', { samples_read_back: 2 })).includes('2D Blend Space builds'));
  assert.ok(failing(withStep('blend2d', { players: { '00': player(), '10': player(), '01': player({ pins: ['Pose', 'X'] }), mid: player() } })).includes('2D Blend Space builds'));
  assert.ok(failing(withStep('layers', { host: { ...buildReport().steps.layers.host, node_class: null, linked: false, candidates: [] } })).includes('linked layers build'));
  assert.ok(failing(withStep('layers', { layer_added: false })).includes('linked layers build'));
});

test('each play fact turns its own check red', () => {
  const withSeries = (name, series) => run({ playReport: playReport({ series: { ...playReport().series, [name]: series } }) });
  assert.ok(failing(withSeries('ABP_CtrlB', motion(() => AX.a))).includes('controls: each clip moves the bone along its own axis'));
  assert.ok(failing(withSeries('ABP_CtrlC', motion(() => AX.c, () => 10))).includes('controls: each clip moves the bone along its own axis'));
  // the state never leaves Idle
  assert.ok(failing(withSeries('ABP_Machine', motion(() => AX.a, sawtooth, () => ({ state: 'Idle' })))).includes('state machine plays'));
  // the state name changes but the pose does not follow
  assert.ok(failing(withSeries('ABP_Machine', motion(() => AX.a, sawtooth, (t) => ({ state: stateAt(t) })))).includes('the pose follows the state'));
  // the state name is not reported
  assert.ok(failing(withSeries('ABP_Machine', motion((t) => (stateAt(t) === 'Walk' ? AX.b : AX.a)))).includes('state machine plays'));
  assert.ok(failing(withSeries('ABP_B2D_10', motion(() => AX.c))).includes('2D corners play one clip each'));
  assert.ok(failing(withSeries('ABP_B2D_01', motion(() => AX.c, () => 40))).includes('2D corners play one clip each'));
  // the interior point plays one clip only
  assert.ok(failing(withSeries('ABP_B2D_mid', motion(() => AX.a))).includes('2D interior blends all three clips'));
  // the guest's layer never takes over, or the host does not return
  assert.ok(failing(withSeries('ABP_LayerHost', motion(() => AX.a))).includes('linked layers swap at runtime'));
  assert.ok(failing(withSeries('ABP_LayerHost', motion((t) => (t >= 13 ? AX.b : AX.a)))).includes('linked layers swap at runtime'));
});

test('observations never fail and the summary counts only the counted checks', () => {
  const checks = run({ buildReport: buildReport({ classes: { ...buildReport().classes, AnimLayerInterfaceFactory: false } }) });
  assert.deepEqual(failing(checks), []);
  assert.equal(summarize(checks).total, checks.filter((c) => !c.info).length);
});
