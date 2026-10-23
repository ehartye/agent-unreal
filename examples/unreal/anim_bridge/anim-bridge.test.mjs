// node --test examples/unreal/anim_bridge/anim-bridge.test.mjs  (no Unreal, no dependencies)
// The reports below have the shape anim_probe.py wrote on Unreal 5.8.2. Each test changes one fact and expects the matching check to fail,
// so the judge cannot pass by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize, phaseMotion, returnedToRest, distances } from './anim-bridge-checks.mjs';

const REST = [-0.03, 0, 14.33];
// Clip A moves the keyed bone along component Z, clip B along component X, both up to 100 cm over one second.
const slotSeries = (cls) => {
  const out = [{ phase: 'rest', instance_class: cls, loc: REST }];
  for (const [label, axis] of [['clip_a', 2], ['clip_b', 0]]) {
    out.push({ phase: `${label}_started`, montage: '/Engine/Transient.AnimMontage_0', playing: true, position: 0 });
    for (let i = 1; i <= 9; i++) {
      const loc = [...REST]; loc[axis] = 12 * i;
      out.push({ phase: label, playing: true, position: i / 10, loc });
    }
    out.push({ phase: label, playing: false, position: -1, loc: REST });
    out.push({ phase: `${label}_after`, playing: false, position: -1, loc: REST });
  }
  return out;
};
const blendSeries = (f) => Array.from({ length: 12 }, (_, i) => ({ phase: 'play', loc: f(i) }));
const blendStep = (resampled) => ({ asset_class: 'BlendSpace1D', play_length: 1.0, samples_read_back: 2, axis_read_back: ['Speed', '0.0', '1.0', '2'], linked: true, status: '<BlueprintStatus.BS_UP_TO_DATE: 3>', nodes_with_errors: 0, ...(resampled ? { resampled: true } : {}) });
const machineGraph = ['node New State Machine | AnimStateEntryNode | New State Machine', 'link New State Machine | AnimStateEntryNode.Entry -> AnimStateNode.In',
  'node New State Machine | AnimStateNode | Idle', 'node New State Machine | AnimStateNode | Walk', 'node New State Machine | AnimStateTransitionNode | Idle to Walk'];
const good = () => ({
  build: { exit: 0, log: 'Result: Succeeded' },
  buildLog: 'LogBlueprint: Warning: [AssetLog] /Game/Anim/ABP_Machine.ABP_Machine: [Compiler] Idle to Walk  will never be taken, please connect something to  Can Enter Transition',
  buildReport: {
    errors: [],
    steps: {
      reach: {
        classes: { AnimGraphNode_Slot: true, AnimGraphNode_StateMachine: true, AnimGraphNode_BlendSpacePlayer: true, AnimStateNode: true, AnimStateTransitionNode: true, AnimStateEntryNode: true, BlueprintGraphEditor: true, BlendSpace: true, BlendSpaceFactory1D: true },
        nodes_property_read: "AnimationGraph: Property 'Nodes' for attribute 'nodes' on 'AnimationGraph' is protected and cannot be read",
        nodes_property_write: "AnimationGraph: Property 'Nodes' for attribute 'nodes' on 'AnimationGraph' is protected and cannot be set",
        state_machine_node_created: true, state_machine_graph_actions: ['|AddComment...', 'Documentation|AddDocumentationNode...'],
        state_names_tried: { 'Add State...': false, State: false }, new_object_state_node_made: true, state_machine_graph_nodes_after: 0,
      },
      python_slot: { linked: true, status: '<BlueprintStatus.BS_UP_TO_DATE: 3>', nodes_with_errors: 0, nodes_with_warnings: 0, nodes: ['AnimGraphNode_Root', 'AnimGraphNode_Slot'] },
      bridge_slot: { linked: true, compiled: true, errors: 0, warnings: 0, blueprint_status: 3, graph: ['slot DefaultSlot', 'link AnimGraph | AnimGraphNode_Slot.Pose -> AnimGraphNode_Root.Result'] },
      machine: { idle: true, walk: true, transition: true, graph: machineGraph, status: '<BlueprintStatus.BS_UP_TO_DATE_WITH_WARNINGS: 5>', nodes_with_errors: 0 },
      blend_raw: blendStep(false), blend_resampled: blendStep(true), player: { linked: true },
    },
    series: { ABP_Python: slotSeries('ABP_Python_C'), ABP_Bridge: slotSeries('ABP_Bridge_C') },
  },
  playReport: {
    errors: [],
    series: {
      ABP_BlendRaw: blendSeries(() => REST),
      ABP_BlendResampled: blendSeries((i) => [5 * (i + 1), 0, 5 * (i + 1)]),
      ABP_Player: blendSeries((i) => [-0.1, 0, 8 * (i + 1)]),
    },
  },
});
const failedNames = (input) => evaluate(input).filter((c) => !c.pass).map((c) => c.name);

test('every check passes on the 5.8.2 shaped reports', () => {
  assert.deepEqual(failedNames(good()), []);
  assert.deepEqual(summarize(evaluate(good())), { passed: 22, total: 22 });
});

test('pose helpers measure distance, dominant axis, rising position and the return to rest', () => {
  const s = slotSeries('x');
  const a = phaseMotion(s, 'clip_a');
  assert.equal(a.axis, 2);
  assert.equal(a.rising, true);
  assert.ok(Math.abs(a.maxDistance - (90 - 14.33)) < 0.01 || a.maxDistance > 70);
  assert.equal(returnedToRest(s, 'clip_a'), true);
  s.find((e) => e.phase === 'clip_a_after').loc = [0, 0, 60];
  assert.equal(returnedToRest(s, 'clip_a'), false);
  assert.equal(phaseMotion([], 'clip_a').ok, false);
  assert.deepEqual(distances([]), []);
});

test('each check fails when its fact changes', () => {
  let g = good(); g.build.exit = 1;
  assert.deepEqual(failedNames(g), ['modules compile']);
  g = good(); g.buildReport.steps.reach.nodes_property_write = 'allowed';
  assert.deepEqual(failedNames(g), ['Python reach: Nodes is protected']);
  g = good(); g.buildReport.steps.reach.state_machine_graph_actions.push('Animation|States|AddState');
  assert.deepEqual(failedNames(g), ['Python reach: no state or transition']);
  g = good(); g.buildReport.steps.python_slot.linked = false;
  assert.deepEqual(failedNames(g), ['Python slot Animation Blueprint']);
  g = good(); g.buildReport.steps.bridge_slot.warnings = 1;
  assert.deepEqual(failedNames(g), ['bridge slot Animation Blueprint']);
  g = good(); g.buildReport.series.ABP_Bridge = g.buildReport.series.ABP_Bridge.map((e) => (e.phase === 'clip_a' ? { ...e, loc: REST } : e));
  assert.ok(failedNames(g).includes('bridge slot: pose changes'));
  assert.ok(failedNames(g).includes('both routes give one pose'));
  g = good(); g.buildReport.series.ABP_Python.find((e) => e.phase === 'clip_b_started').playing = false;
  assert.deepEqual(failedNames(g), ['Python slot: montage plays']);
  g = good(); g.buildReport.series.ABP_Python.find((e) => e.phase === 'clip_b_after').loc = [0, 0, 50];
  assert.deepEqual(failedNames(g), ['Python slot: pose returns to rest']);
  g = good(); g.buildReport.steps.machine.transition = false;
  assert.deepEqual(failedNames(g), ['bridge state machine']);
  g = good(); g.buildLog = '';
  assert.deepEqual(failedNames(g), ['compiler warning for an empty transition']);
  g = good(); g.buildReport.steps.blend_raw.samples_read_back = 0;
  assert.deepEqual(failedNames(g), ['blend space written from Python']);
  g = good(); g.playReport.series.ABP_BlendRaw = blendSeries((i) => [3 * i, 0, 14.33]);
  assert.deepEqual(failedNames(g), ['blend space without resampling is inert']);
  g = good(); g.playReport.series.ABP_BlendResampled = blendSeries(() => REST);
  assert.deepEqual(failedNames(g), ['blend space after ResampleBlendSpace']);
  g = good(); g.playReport.series.ABP_BlendResampled = blendSeries((i) => [5 * (i + 1), 0, 20 * (i + 1)]);
  assert.deepEqual(failedNames(g), ['blend space after ResampleBlendSpace']);
  g = good(); g.playReport.series.ABP_Player = blendSeries(() => REST);
  assert.deepEqual(failedNames(g), ['Sequence Player from Python']);
});

test('missing reports fail their checks instead of throwing', () => {
  assert.doesNotThrow(() => evaluate({}));
  const g = good(); g.playReport = undefined;
  assert.ok(failedNames(g).length >= 3);
});
