// node --test examples/unreal/statetree_bridge/statetree-bridge.test.mjs  (no Unreal, no dependencies)
// The reports below have the shape statetree_probe.py wrote on Unreal 5.8.2. Each test changes one fact and expects the matching check
// to fail, so the judge cannot pass by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize, judgePlay } from './statetree-bridge-checks.mjs';

const CONTEXT_MESSAGE = "Work  Task 'Probe Needs Component':  Could not find matching Context object for Context property 'Component' on 'Task 'Root/Work/Probe Needs Component''. Property must have manual binding.";
const compiled = (name) => ({ created: true, path: `/Game/StateTreeProbe/${name}.${name}`, class: 'StateTree', compiled: true, messages: [], ready: true, needs_recompile: false });
const done = { work_ticks: 3, events: ['started', 'enter:Work', 'exit:Work', 'enter:Done'], controller: 'StateTreeProbeController', running: true, run_status: '<StateTreeRunStatus.RUNNING: 0>' };
const stuck = (ticks) => ({ work_ticks: ticks, events: ['started', 'enter:Work'], controller: 'StateTreeProbeController', running: true, run_status: '<StateTreeRunStatus.RUNNING: 0>' });
const good = () => ({
  build: { exit: 0, log: 'Result: Succeeded' },
  buildLog: [
    "LogStateTreeEditor: Error: Failed to compile 'StateTree /Game/StateTreeProbe/ST_Broken.ST_Broken', errors follow.",
    `LogStateTreeEditor: Error: State 'Work': Task 'Probe Needs Component': Could not find matching Context object for Context property 'Component' on 'Task 'Root/Work/Probe Needs Component''.`,
    `LogStateTreeBridge: Error: State 'Work': Task 'Probe Needs Component': Could not find matching Context object for Context property 'Component' on 'Task 'Root/Work/Probe Needs Component''.`,
  ].join('\n'),
  runLog: 'LogStateTree: Log: started',
  buildReport: {
    errors: [],
    steps: {
      probe: compiled('ST_Probe'),
      gated: compiled('ST_Gated'),
      broken: { created: true, compiled: false, messages: [`Error: ${CONTEXT_MESSAGE}`], ready: false, needs_recompile: true },
      structure_probe: { sub_trees: 1, root: 'Root', states: [{ name: 'Work', tasks: 1, enter_conditions: 0, transitions: 1 }, { name: 'Done', tasks: 1, enter_conditions: 1, transitions: 0 }],
        transition_trigger: '<StateTreeTransitionTrigger.ON_TICK: 4>', transition_conditions: 1 },
      saved: { ST_Probe: true, ST_Gated: true },
      python_reach: {
        classes: { StateTree: true, StateTreeFactory: true, StateTreeEditorData: true, StateTreeState: true, StateTreeEditorNode: true, StateTreeTransition: true, StateTreeAIComponentSchema: true,
          StateTreeEditingSubsystem: false, StateTreeCompilerLog: false, StateTreeTaskBase: false },
        factory_schema_set: { ok: false, error: "StateTreeFactory: Failed to find property 'state_tree_schema_class' for attribute 'state_tree_schema_class' on 'StateTreeFactory'" },
        python_only_create_asset: { ok: true, created: false, error: null },
        state_has_builders: { add_child_state: false, add_task: false, add_transition: false, add_enter_condition: false },
        python_names_for_compile: ['StateTreeBridgeCompileResult'], editor_data_compile_members: [],
        schema_property: { ok: true, value: "<Object '/Game/StateTreeProbe/ST_PythonProbe.ST_PythonProbe:StateTreeEditorData_0.StateTreeAIComponentSchema_0' Class 'StateTreeAIComponentSchema'>" },
        rename_state: { ok: true, after: 'Renamed' },
        add_child_state: { ok: true, after: { sub_trees: 1, children: ['Renamed', 'Done', 'PythonState'], work_tasks: 1 } },
        add_task_node: { ok: true, after: { sub_trees: 1, children: ['Renamed', 'Done', 'PythonState'], work_tasks: 2 } },
        remove_tasks: { ok: true, after: { sub_trees: 1, children: ['Renamed', 'Done', 'PythonState'], work_tasks: 0 } },
        clear_sub_trees: { ok: true, after: { sub_trees: 0, children: [], work_tasks: null } },
        custom_task_struct_in_python: false,
      },
    },
  },
  runReport: {
    errors: [],
    steps: {
      loaded: { ST_Probe: { loaded: true, ready: true, needs_recompile: false }, ST_Gated: { loaded: true, ready: true, needs_recompile: false } },
      play: { ST_Probe: [done, done, done, done], ST_Gated: [stuck(368), stuck(399), stuck(430), stuck(461)] },
    },
  },
});
const failing = (mutate) => { const g = good(); mutate(g); return evaluate(g).filter((c) => !c.pass).map((c) => c.name); };

test('the real shape passes every check', () => {
  const checks = evaluate(good());
  assert.deepEqual(checks.filter((c) => !c.pass), []);
  assert.equal(summarize(checks).passed, summarize(checks).total);
});

test('a failed build fails the first check', () => {
  assert.deepEqual(failing((g) => { g.build.exit = 6; g.build.log = 'Result: Failed'; }), ['modules compile']);
});

test('a script error fails the run', () => {
  assert.deepEqual(failing((g) => { g.runReport.errors.push({ step: 'script' }); }), ['no script errors']);
});

test('a tree with a missing transition condition fails the builder check', () => {
  assert.deepEqual(failing((g) => { g.buildReport.steps.structure_probe.transition_conditions = 0; }), ['factory and builder']);
});

test('a compile that leaves the tree needing a recompile fails', () => {
  assert.deepEqual(failing((g) => { g.buildReport.steps.probe.needs_recompile = true; }), ['compile succeeds']);
});

test('a compile error that does not reach the caller or the log fails', () => {
  assert.deepEqual(failing((g) => { g.buildReport.steps.broken.messages = []; }), ['compile log read back']);
  assert.deepEqual(failing((g) => { g.buildLog = g.buildLog.replace(/LogStateTreeBridge/g, 'LogOther'); }), ['compile log read back']);
  assert.deepEqual(failing((g) => { g.buildReport.steps.broken.compiled = true; }), ['compile log read back']);
});

test('Python reach claims fail when Python gains a builder, a compile class or a schema property', () => {
  assert.deepEqual(failing((g) => { g.buildReport.steps.python_reach.state_has_builders.add_task = true; }), ['Python reach: no create, no builders, no compile']);
  assert.deepEqual(failing((g) => { g.buildReport.steps.python_reach.classes.StateTreeEditingSubsystem = true; }), ['Python reach: no create, no builders, no compile']);
  assert.deepEqual(failing((g) => { g.buildReport.steps.python_reach.factory_schema_set = { ok: true }; }), ['Python reach: no create, no builders, no compile']);
  assert.deepEqual(failing((g) => { g.buildReport.steps.python_reach.add_task_node.after.work_tasks = 1; }), ['Python reach: raw property writes']);
});

test('a tree that did not transition fails', () => {
  assert.deepEqual(failing((g) => { g.runReport.steps.play.ST_Probe = [stuck(50), stuck(90)]; }), ['tree runs and transitions']);
});

test('a tree that keeps counting after the transition fails', () => {
  assert.deepEqual(failing((g) => { g.runReport.steps.play.ST_Probe = [done, { ...done, work_ticks: 9 }]; }), ['tree runs and transitions']);
});

test('a gated tree that enters Done or stops counting fails', () => {
  assert.deepEqual(failing((g) => { g.runReport.steps.play.ST_Gated = [done, done]; }), ['condition gates the transition']);
  assert.deepEqual(failing((g) => { g.runReport.steps.play.ST_Gated = [stuck(400), stuck(400)]; }), ['condition gates the transition']);
});

test('a tree run by something other than the probe controller fails', () => {
  assert.deepEqual(failing((g) => { g.runReport.steps.play.ST_Probe = [{ ...done, controller: 'AIController' }, { ...done, controller: 'AIController' }]; }), ['tree runs and transitions']);
});

test('a StateTree warning at run time fails', () => {
  assert.deepEqual(failing((g) => { g.runLog = 'LogStateTree: Warning: Context Requirements failed'; }), ['no StateTree errors at run time']);
});

test('judgePlay rejects too few samples', () => {
  assert.equal(judgePlay([done], true).ok, false);
  assert.equal(judgePlay(undefined, false).ok, false);
});
