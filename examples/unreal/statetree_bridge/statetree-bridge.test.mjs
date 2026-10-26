// node --test examples/unreal/statetree_bridge/statetree-bridge.test.mjs  (no Unreal, no dependencies)
// The reports below have the shape statetree_probe.py writes. The parts for the AI schema were taken from Unreal 5.8.2 runs. The parts for
// rows S1 (component schema) and S2 (tree parameter) are hand-made from the engine source: no engine has run them yet. Each test changes
// one fact and expects the matching check to fail, so the judge cannot pass by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize, judgePlay, ticksPerSecond } from './statetree-bridge-checks.mjs';

const CONTEXT_MESSAGE = "Work  Task 'Probe Needs Component':  Could not find matching Context object for Context property 'Component' on 'Task 'Root/Work/Probe Needs Component''. Property must have manual binding.";
const aiInfo = { schema_class: 'StateTreeAIComponentSchema', context_objects: ['Actor:Pawn', 'AIController:AIController'], root_parameters: [], allows_ai_task_base: true, allows_probe_task: true, allows_evaluators: true, allows_global_parameters: true };
const compInfo = { schema_class: 'StateTreeComponentSchema', context_objects: ['Actor:Actor'], root_parameters: [], allows_ai_task_base: false, allows_probe_task: true, allows_evaluators: true, allows_global_parameters: true };
const compiled = (name, info = aiInfo) => ({ created: true, path: `/Game/StateTreeProbe/${name}.${name}`, class: 'StateTree', compiled: true, messages: [], ready: true, needs_recompile: false, info });
const RUNNING = '<StateTreeRunStatus.RUNNING: 0>';
const done = { t: 100, work_ticks: 3, events: ['started', 'enter:Work', 'exit:Work', 'enter:Done'], controller: 'StateTreeProbeController', component: 'StateTreeAIComponent', running: true, run_status: RUNNING };
const stuck = (ticks, t = 100) => ({ t, work_ticks: ticks, events: ['started', 'enter:Work'], controller: 'StateTreeProbeController', component: 'StateTreeAIComponent', running: true, run_status: RUNNING });
const compDone = { ...done, controller: null, component: 'StateTreeComponent' };
const compStuck = (ticks, t = 100) => ({ ...stuck(ticks, t), controller: null, component: 'StateTreeComponent' });
const structure = (enterOnDone = 1) => ({ sub_trees: 1, root: 'Root', states: [{ name: 'Work', tasks: 1, enter_conditions: 0, transitions: 1 }, { name: 'Done', tasks: 1, enter_conditions: enterOnDone, transitions: 0 }],
  transition_trigger: '<StateTreeTransitionTrigger.ON_TICK: 4>', transition_conditions: 1 });
const reloadedTree = (info, host) => ({ loaded: true, host, ready: true, needs_recompile: false, info });
// A JSON round trip gives every test its own copy: the info objects are shared inside one report and a test mutates them.
const makeGood = () => ({
  build: { exit: 0, log: 'Result: Succeeded' },
  buildLog: [
    "LogStateTreeEditor: Error: Failed to compile 'StateTree /Game/StateTreeProbe/ST_Broken.ST_Broken', errors follow.",
    `LogStateTreeEditor: Error: State 'Work': Task 'Probe Needs Component': Could not find matching Context object for Context property 'Component' on 'Task 'Root/Work/Probe Needs Component''.`,
    `LogStateTreeBridge: Error: State 'Work': Task 'Probe Needs Component': Could not find matching Context object for Context property 'Component' on 'Task 'Root/Work/Probe Needs Component''.`,
    "LogStateTreeEditor: Error: Failed to compile 'StateTree /Game/StateTreeProbe/ST_Comp_Broken.ST_Comp_Broken', errors follow.",
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
          StateTreeComponentSchema: true, StateTreeComponent: true, StateTreeEditingSubsystem: false, StateTreeCompilerLog: false, StateTreeTaskBase: false },
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
      // Rows S1 and S2: hand-made from the engine source, not from a run.
      comp_probe: compiled('ST_Comp_Probe', compInfo),
      comp_gated: compiled('ST_Comp_Gated', compInfo),
      comp_broken: { created: true, compiled: false, messages: [`Error: ${CONTEXT_MESSAGE}`], ready: false, needs_recompile: true, info: compInfo },
      structure_comp: structure(),
      param: compiled('ST_Param', { ...aiInfo, root_parameters: ['Threshold:EPropertyBagPropertyType::Int32=5'] }),
      structure_param: structure(0),
      saved_extra: { ST_Comp_Probe: true, ST_Comp_Gated: true, ST_Param: true },
    },
  },
  runReport: {
    errors: [],
    steps: {
      loaded: {
        ST_Probe: reloadedTree(aiInfo, 'ai'), ST_Gated: reloadedTree(aiInfo, 'ai'), ST_Comp_Probe: reloadedTree(compInfo, 'component'),
        ST_Comp_Gated: reloadedTree(compInfo, 'component'), ST_Param: reloadedTree({ ...aiInfo, root_parameters: ['Threshold:EPropertyBagPropertyType::Int32=5'] }, 'ai'),
      },
      play: {
        ST_Probe: [done, done, done, done],
        ST_Gated: [stuck(368, 100), stuck(399, 100.5), stuck(430, 101), stuck(461, 101.5)],
        ST_Comp_Probe: [compDone, compDone, compDone, compDone],
        ST_Comp_Gated: [compStuck(300, 100), compStuck(320, 100.5), compStuck(340, 101), compStuck(360, 101.5)],
        ST_Param: [{ ...done, work_ticks: 5 }, { ...done, work_ticks: 5 }, { ...done, work_ticks: 5 }, { ...done, work_ticks: 5 }],
      },
    },
  },
});
const good = () => JSON.parse(JSON.stringify(makeGood()));
const failing = (mutate) => { const g = good(); mutate(g); return evaluate(g).filter((c) => !c.pass && !c.observe).map((c) => c.name); };
const failingAll = (mutate) => { const g = good(); mutate(g); return evaluate(g).filter((c) => !c.pass).map((c) => c.name); };

test('the real shape passes every check', () => {
  const checks = evaluate(good());
  assert.deepEqual(checks.filter((c) => !c.pass), []);
  const sum = summarize(checks);
  assert.equal(sum.passed, sum.total);
  assert.equal(sum.observedRecorded, sum.observed);
  assert.equal(sum.total, 21);
  assert.equal(sum.observed, 3);
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
  assert.deepEqual(failing((g) => { g.buildLog = g.buildLog.replace(/LogStateTreeBridge/g, 'LogOther'); }), ['compile log read back', 'S1 component schema broken control']);
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

// ---- row S1 -----------------------------------------------------------------------------------------------------------------------
test('S1: a component schema tree that does not compile, or carries the wrong schema, fails the build check', () => {
  assert.deepEqual(failing((g) => { g.buildReport.steps.comp_probe.compiled = false; }), ['S1 component schema builds and compiles']);
  assert.deepEqual(failing((g) => { g.buildReport.steps.comp_probe.messages = ['Warning: x']; }), ['S1 component schema builds and compiles']);
  assert.deepEqual(failing((g) => { g.buildReport.steps.comp_gated.info = aiInfo; }), ['S1 component schema builds and compiles']);
  assert.deepEqual(failing((g) => { g.buildReport.steps.structure_comp.states.pop(); }), ['S1 component schema builds and compiles']);
});

test('S1: a missing info block (a wrong Python field name) fails the schema checks instead of passing', () => {
  assert.deepEqual(failing((g) => { g.buildReport.steps.comp_probe.info = { error: "AttributeError: 'StateTreeBridgeTreeInfo' has no attribute" }; }),
    ['S1 component schema builds and compiles', 'S1 schema context objects and node bases']);
});

test('S1: context objects and node bases are asserted for both schemas', () => {
  assert.deepEqual(failing((g) => { g.buildReport.steps.comp_probe.info.context_objects = ['Actor:Pawn']; }), ['S1 schema context objects and node bases']);
  assert.deepEqual(failing((g) => { g.buildReport.steps.probe.info.context_objects = ['Actor:Pawn']; }), ['S1 schema context objects and node bases']);
  assert.deepEqual(failing((g) => { g.buildReport.steps.comp_probe.info.allows_ai_task_base = true; }), ['S1 schema context objects and node bases']);
  assert.deepEqual(failing((g) => { g.buildReport.steps.probe.info.allows_ai_task_base = false; }), ['S1 schema context objects and node bases']);
  assert.deepEqual(failing((g) => { g.buildReport.steps.comp_probe.info.allows_evaluators = false; }), ['S1 schema context objects and node bases']);
});

test('S1: the broken control needs this tree to fail, with the message and both log lines', () => {
  assert.deepEqual(failing((g) => { g.buildReport.steps.comp_broken.compiled = true; }), ['S1 component schema broken control']);
  assert.deepEqual(failing((g) => { g.buildReport.steps.comp_broken.messages = []; }), ['S1 component schema broken control']);
  assert.deepEqual(failing((g) => { g.buildLog = g.buildLog.replace(/ST_Comp_Broken/g, 'ST_Other'); }), ['S1 component schema broken control']);
  // Only one tree's worth of log lines (the AI-schema tree's) is not enough.
  assert.deepEqual(failing((g) => { g.buildLog = g.buildLog.split('\n').slice(0, 3).join('\n'); }), ['S1 component schema broken control']);
});

test('S1: the saved component trees must reload ready with the component schema', () => {
  assert.deepEqual(failing((g) => { g.runReport.steps.loaded.ST_Comp_Probe.needs_recompile = true; }), ['S1 saved component trees load ready']);
  assert.deepEqual(failing((g) => { g.runReport.steps.loaded.ST_Comp_Probe.info.schema_class = 'StateTreeAIComponentSchema'; }), ['S1 saved component trees load ready']);
  assert.deepEqual(failing((g) => { g.buildReport.steps.saved_extra.ST_Comp_Gated = false; }), ['S1 saved component trees load ready']);
  assert.deepEqual(failing((g) => { delete g.runReport.steps.loaded.ST_Comp_Gated; }), ['S1 saved component trees load ready']);
});

test('S1: the component pawn must run the tree with no controller', () => {
  assert.deepEqual(failing((g) => { g.runReport.steps.play.ST_Comp_Probe = [compStuck(50), compStuck(90)]; }), ['S1 component pawn runs the tree']);
  assert.deepEqual(failing((g) => { g.runReport.steps.play.ST_Comp_Probe = [{ ...compDone, controller: 'AIController' }, { ...compDone, controller: 'AIController' }]; }), ['S1 component pawn runs the tree']);
  assert.deepEqual(failing((g) => { g.runReport.steps.play.ST_Comp_Probe = [{ ...compDone, component: 'StateTreeAIComponent' }, { ...compDone, component: 'StateTreeAIComponent' }]; }), ['S1 component pawn runs the tree']);
  assert.deepEqual(failing((g) => { g.runReport.steps.play.ST_Comp_Probe = [{ ...compDone, running: false }, { ...compDone, running: false }]; }), ['S1 component pawn runs the tree']);
  assert.deepEqual(failing((g) => { g.runReport.steps.play.ST_Comp_Probe = [{ error: "AttributeError: 'StateTreeComponentProbePawn' has no attribute 'work_ticks'" }, compDone]; }), ['S1 component pawn runs the tree']);
  assert.deepEqual(failing((g) => { delete g.runReport.steps.play.ST_Comp_Probe; }), ['S1 component pawn runs the tree']);
});

test('S1: the gated component pawn must stay in Work and keep counting', () => {
  assert.deepEqual(failing((g) => { g.runReport.steps.play.ST_Comp_Gated = [compDone, compDone]; }), ['S1 component pawn: condition gates the transition']);
  assert.deepEqual(failing((g) => { g.runReport.steps.play.ST_Comp_Gated = [compStuck(400), compStuck(400)]; }), ['S1 component pawn: condition gates the transition']);
});

test('S1: observations are recorded, never judged', () => {
  // A slow or fast tick rate cannot fail anything; a missing sample time only leaves the observation unrecorded.
  const slow = good();
  slow.runReport.steps.play.ST_Comp_Gated = [compStuck(400, 100), compStuck(401, 130), compStuck(402, 160), compStuck(403, 190)];
  assert.deepEqual(evaluate(slow).filter((c) => !c.pass), []);
  assert.deepEqual(failingAll((g) => { g.runReport.steps.play.ST_Comp_Gated = g.runReport.steps.play.ST_Comp_Gated.map(({ t, ...rest }) => rest); }), ['S1 observe: counter ticks per second on each host']);
  assert.deepEqual(failingAll((g) => { delete g.buildReport.steps.python_reach.classes.StateTreeComponent; }), ['S1 observe: Python names for the component classes']);
});

test('ticksPerSecond reads the counter over the sample times', () => {
  assert.equal(ticksPerSecond([stuck(0, 10), stuck(50, 11)]), 50);
  assert.equal(ticksPerSecond([stuck(0, 10), stuck(5, 10)]), undefined);
  assert.equal(ticksPerSecond([stuck(0)]), undefined);
});

// ---- row S2 -----------------------------------------------------------------------------------------------------------------------
test('S2: the parameter tree must compile with the parameter and no enter condition on Done', () => {
  assert.deepEqual(failing((g) => { g.buildReport.steps.param.compiled = false; }), ['S2 tree parameter builds and compiles']);
  assert.deepEqual(failing((g) => { g.buildReport.steps.param.info.root_parameters = []; }), ['S2 tree parameter builds and compiles']);
  assert.deepEqual(failing((g) => { g.buildReport.steps.param.info.root_parameters = ['Threshold:EPropertyBagPropertyType::Int32=7']; }), ['S2 tree parameter builds and compiles']);
  assert.deepEqual(failing((g) => { g.buildReport.steps.structure_param = structure(1); }), ['S2 tree parameter builds and compiles']);
});

test('S2: the binding must reach the condition, which a tree stuck in Work shows it did not', () => {
  assert.deepEqual(failing((g) => { g.runReport.steps.play.ST_Param = [stuck(400), stuck(430)]; }), ['S2 tree parameter reaches the condition']);
  assert.deepEqual(failing((g) => { g.runReport.steps.play.ST_Param = [{ ...done, work_ticks: 2 }, { ...done, work_ticks: 2 }, { ...done, work_ticks: 2 }]; }), ['S2 tree parameter reaches the condition']);
  assert.deepEqual(failing((g) => { g.buildReport.steps.saved_extra.ST_Param = false; }), ['S2 tree parameter reaches the condition']);
  assert.deepEqual(failing((g) => { g.runReport.steps.loaded.ST_Param.needs_recompile = true; }), ['S2 tree parameter reaches the condition']);
});

test('S2: the counter observation is recorded when a number comes back', () => {
  assert.deepEqual(failingAll((g) => { g.runReport.steps.play.ST_Param = [{ error: 'x' }, { error: 'x' }]; }), ['S2 tree parameter reaches the condition', 'S2 observe: counter when the parameter-bound tree stops']);
});
