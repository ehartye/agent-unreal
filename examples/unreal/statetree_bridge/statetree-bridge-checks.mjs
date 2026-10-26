// Judges the reports that statetree_bridge.mjs collects. Pure functions, no Unreal and no dependencies; the node test feeds them reports
// shaped like the ones statetree_probe.py writes. The first 13 checks were written against Unreal 5.8.2 runs; all 21 passed on 5.8.3, including
// "S1" (the component schema on a plain pawn) and "S2" (a tree parameter bound to a condition), whose expectations came from reading the engine source.
//   build = report of the first editor session (mode build); run = report of the second session (mode run, Play-In-Editor).
// A check with observe: true records a value and never fails on it; it passes when the value was recorded.

const CONTEXT_ERROR = /Could not find matching Context object for Context property 'Component'/;
const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
const COMPONENT_SCHEMA = 'StateTreeComponentSchema';
// The context objects each schema offers (GameplayStateTree plugin source, the schema constructors): the component schema offers one Actor;
// the AI schema narrows the Actor to the pawn and adds the controller.
const COMPONENT_CONTEXT = ['Actor:Actor'];
const AI_CONTEXT = ['Actor:Pawn', 'AIController:AIController'];

/**
 * Judges one pawn's samples. `expectDone` true: the tree must reach Done and then stay; false: it must stay in Work and keep counting.
 * `host` 'ai': an AI controller (StateTreeProbeController) owns a StateTreeAIComponent. 'component': a plain pawn with no controller
 * owns a StateTreeComponent.
 */
export function judgePlay(samples, expectDone, minTicks = 3, host = 'ai') {
  if (!Array.isArray(samples) || samples.length < 2) return { ok: false, detail: 'fewer than two samples' };
  const failed = samples.find((s) => s?.error);
  if (failed) return { ok: false, detail: `a sample failed: ${failed.error}` };
  const first = samples[0];
  const last = samples[samples.length - 1];
  const running = samples.every((s) => s.running === true && /RUNNING/.test(s.run_status ?? ''));
  const controller = host === 'component'
    ? samples.every((s) => s.controller === null && s.component === 'StateTreeComponent')
    : samples.every((s) => s.controller === 'StateTreeProbeController' && (s.component === undefined || s.component === 'StateTreeAIComponent'));
  const where = `host ${host}; controller ${last.controller}; component ${last.component}`;
  if (expectDone) {
    const steady = samples.every((s) => s.work_ticks === first.work_ticks && sameList(s.events, first.events));
    const events = sameList(last.events, ['started', 'enter:Work', 'exit:Work', 'enter:Done']);
    return { ok: running && controller && steady && events && last.work_ticks >= minTicks,
      detail: `events ${JSON.stringify(last.events)}; ticks ${first.work_ticks} to ${last.work_ticks}; running ${running}; ${where}` };
  }
  const grows = last.work_ticks > first.work_ticks && first.work_ticks > minTicks;
  const events = samples.every((s) => sameList(s.events, ['started', 'enter:Work']));
  return { ok: running && controller && grows && events, detail: `events ${JSON.stringify(last.events)}; ticks ${first.work_ticks} to ${last.work_ticks}; running ${running}; ${where}` };
}

/** Counter ticks per second between the first and last sample (the samples carry wall-clock seconds in t), or undefined. */
export function ticksPerSecond(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return undefined;
  const seconds = samples[samples.length - 1].t - samples[0].t;
  return seconds > 0 ? Math.round(((samples[samples.length - 1].work_ticks - samples[0].work_ticks) / seconds) * 10) / 10 : undefined;
}

export function evaluate({ build, buildReport, runReport, buildLog = '', runLog = '' }) {
  const s = buildReport?.steps ?? {};
  const checks = [];
  const add = (name, claim, pass, detail, observe = false) => checks.push({ name, claim, pass: !!pass, detail, ...(observe ? { observe: true } : {}) });

  add('modules compile', 'UBT builds the editor target with the StateTreeNodes (runtime) and StateTreeBridge (editor) modules',
    build?.exit === 0 && /Result: Succeeded/.test(build?.log ?? ''), `exit ${build?.exit}`);
  add('no script errors', 'every step of statetree_probe.py ran in both sessions',
    !!buildReport && (buildReport.errors ?? []).length === 0 && !!runReport && (runReport.errors ?? []).length === 0,
    JSON.stringify([...(buildReport?.errors ?? []), ...(runReport?.errors ?? [])].map((e) => e.step)));

  const st = s.structure_probe;
  add('factory and builder', 'the factory with the AI component schema makes a tree whose single sub tree is the "Root" state; the builder adds two states, a task on each, an enter condition and a tick transition with one condition',
    s.probe?.created === true && st?.sub_trees === 1 && st?.root === 'Root' && sameList((st?.states ?? []).map((x) => x.name), ['Work', 'Done'])
      && st.states[0].tasks === 1 && st.states[0].transitions === 1 && st.states[1].tasks === 1 && st.states[1].enter_conditions === 1
      && /ON_TICK/.test(st.transition_trigger ?? '') && st.transition_conditions === 1, JSON.stringify(st));

  const ok = (t) => t?.compiled === true && t.ready === true && t.needs_recompile === false && (t.messages ?? []).length === 0;
  add('compile succeeds', 'CompileStateTree returns true with no messages, and the tree is ready to run and needs no recompile',
    ok(s.probe) && ok(s.gated), `probe ${JSON.stringify({ ...s.probe, messages: undefined })}; gated compiled ${s.gated?.compiled}`);
  add('compile log read back', 'a tree with an unsatisfiable Context property fails to compile; the messages come back to the caller naming state, task and property, and reach the log under the engine category and under the caller category',
    s.broken?.compiled === false && s.broken.ready === false && s.broken.needs_recompile === true && (s.broken.messages ?? []).some((m) => /^Error:/.test(m) && CONTEXT_ERROR.test(m))
      && /LogStateTreeEditor: Error: Failed to compile/.test(buildLog) && new RegExp(`LogStateTreeEditor: Error: .*${CONTEXT_ERROR.source}`).test(buildLog)
      && new RegExp(`LogStateTreeBridge: Error: .*${CONTEXT_ERROR.source}`).test(buildLog), JSON.stringify(s.broken?.messages));
  add('saved', 'the compiled trees save to disk', s.saved?.ST_Probe === true && s.saved?.ST_Gated === true, JSON.stringify(s.saved));

  const r = s.python_reach;
  const cls = r?.classes ?? {};
  add('Python reach: read', 'Python reads the structure of a built tree: the editor data, its sub trees, the states, tasks, enter conditions and transitions',
    !!st && cls.StateTree && cls.StateTreeEditorData && cls.StateTreeState && cls.StateTreeEditorNode && cls.StateTreeTransition && cls.StateTreeAIComponentSchema
      && r?.schema_property?.ok === true && /StateTreeAIComponentSchema/.test(r.schema_property.value ?? ''), JSON.stringify(cls));
  add('Python reach: no create, no builders, no compile', 'Python cannot set the factory schema, so create_asset returns None; the state has no AddTask or AddTransition builders; no compile class is exposed',
    r?.factory_schema_set?.ok === false && /Failed to find property/.test(r.factory_schema_set.error ?? '') && r.python_only_create_asset?.created === false
      && Object.values(r.state_has_builders ?? { x: true }).every((v) => v === false) && cls.StateTreeEditingSubsystem === false && cls.StateTreeCompilerLog === false
      && (r.editor_data_compile_members ?? ['x']).length === 0, JSON.stringify({ factory: r?.factory_schema_set?.error, builders: r?.state_has_builders, compile: r?.python_names_for_compile }));
  add('Python reach: raw property writes', 'Python can write the state properties: rename a state, append a state object to children, replace tasks or sub_trees; none of this compiles or links a node struct',
    r?.rename_state?.ok === true && r.rename_state.after === 'Renamed' && r.add_child_state?.ok === true && (r.add_child_state.after?.children ?? []).includes('PythonState')
      && r.add_task_node?.ok === true && r.add_task_node.after?.work_tasks === 2 && r.remove_tasks?.after?.work_tasks === 0 && r.clear_sub_trees?.after?.sub_trees === 0
      && r.custom_task_struct_in_python === false, JSON.stringify({ rename: r?.rename_state, child: r?.add_child_state?.after, task: r?.add_task_node?.after, struct: r?.custom_task_struct_in_python }));

  const loaded = runReport?.steps?.loaded ?? {};
  add('saved trees load ready', 'a fresh editor session loads both saved trees ready to run and not needing a recompile',
    ['ST_Probe', 'ST_Gated'].every((n) => loaded[n]?.loaded === true && loaded[n].ready === true && loaded[n].needs_recompile === false), JSON.stringify(loaded));
  const play = runReport?.steps?.play ?? {};
  const probe = judgePlay(play.ST_Probe, true);
  add('tree runs and transitions', 'on a pawn with an AI controller the task executes and the tick transition fires once its condition passes: events started, enter:Work, exit:Work, enter:Done; the counter stops at the threshold and the run status stays Running',
    probe.ok, probe.detail);
  const gated = judgePlay(play.ST_Gated, false);
  add('condition gates the transition', 'with a threshold the pawn cannot reach, the same tree stays in Work, keeps counting and never enters Done',
    gated.ok, gated.detail);
  add('no StateTree errors at run time', 'the play session logs no LogStateTree warnings or errors',
    !!runLog && !/LogStateTree(Editor)?: (Warning|Error)/.test(runLog), 'run log scanned');

  // ---- row S1: the component schema on a plain pawn (run on 5.8.3) ----------------------------------------
  const cp = s.comp_probe;
  const cg = s.comp_gated;
  const cst = s.structure_comp;
  const compOk = (t) => ok(t) && t.info?.schema_class === COMPONENT_SCHEMA;
  add('S1 component schema builds and compiles', 'the factory accepts StateTreeComponentSchema as its schema class; the same builder and the same node structs compile under it with no messages; the tree is ready to run and the schema read back is the component schema',
    compOk(cp) && compOk(cg) && cst?.sub_trees === 1 && cst?.root === 'Root' && sameList((cst?.states ?? []).map((x) => x.name), ['Work', 'Done'])
      && cst.states[0].tasks === 1 && cst.states[0].transitions === 1 && cst.states[1].enter_conditions === 1 && /ON_TICK/.test(cst.transition_trigger ?? ''),
    JSON.stringify({ probe: { ...cp, messages: undefined }, gated: cg?.compiled, structure: cst }));
  const aiInfo = s.probe?.info;
  add('S1 schema context objects and node bases', 'the component schema offers one context object, Actor of class Actor; the AI component schema offers Actor narrowed to Pawn plus AIController; both accept the probe task (a common-base struct); only the AI schema accepts a task that derives from the AI task base; both allow evaluators and global parameters',
    sameList(cp?.info?.context_objects, COMPONENT_CONTEXT) && sameList(aiInfo?.context_objects, AI_CONTEXT)
      && cp.info.allows_probe_task === true && aiInfo.allows_probe_task === true && cp.info.allows_ai_task_base === false && aiInfo.allows_ai_task_base === true
      && cp.info.allows_evaluators === true && aiInfo.allows_evaluators === true && cp.info.allows_global_parameters === true && aiInfo.allows_global_parameters === true,
    JSON.stringify({ component: cp?.info, ai: aiInfo }));
  const cb = s.comp_broken;
  const failedToCompile = (buildLog.match(/LogStateTreeEditor: Error: Failed to compile '[^\n]*ST_Comp_Broken/g) ?? []).length;
  const editorLines = (buildLog.match(new RegExp(`LogStateTreeEditor: Error: .*${CONTEXT_ERROR.source}`, 'g')) ?? []).length;
  const bridgeLines = (buildLog.match(new RegExp(`LogStateTreeBridge: Error: .*${CONTEXT_ERROR.source}`, 'g')) ?? []).length;
  add('S1 component schema broken control', 'under the component schema a task whose Context property no context object satisfies (a component) fails to compile with the same message as under the AI schema; the message reaches the caller, the engine category and the caller category, once more than for the AI-schema tree alone',
    cb?.compiled === false && cb.ready === false && cb.needs_recompile === true && (cb.messages ?? []).some((m) => /^Error:/.test(m) && CONTEXT_ERROR.test(m))
      && failedToCompile >= 1 && editorLines >= 2 && bridgeLines >= 2, JSON.stringify({ messages: cb?.messages, failedToCompile, editorLines, bridgeLines }));
  const reloaded = (n) => loaded[n]?.loaded === true && loaded[n].ready === true && loaded[n].needs_recompile === false;
  const savedExtra = s.saved_extra;
  add('S1 saved component trees load ready', 'a fresh editor session loads the saved component-schema trees ready to run, not needing a recompile, with the component schema and its context objects still on the tree',
    savedExtra?.ST_Comp_Probe === true && savedExtra?.ST_Comp_Gated === true && reloaded('ST_Comp_Probe') && reloaded('ST_Comp_Gated')
      && loaded.ST_Comp_Probe.info?.schema_class === COMPONENT_SCHEMA && sameList(loaded.ST_Comp_Probe.info?.context_objects, COMPONENT_CONTEXT),
    JSON.stringify({ saved: savedExtra, probe: loaded.ST_Comp_Probe, gated: loaded.ST_Comp_Gated }));
  const compProbe = judgePlay(play.ST_Comp_Probe, true, 3, 'component');
  add('S1 component pawn runs the tree', 'on a plain pawn with no AI controller whose StateTreeComponent runs the tree, the Actor context binds to the pawn itself and the events are started, enter:Work, exit:Work, enter:Done; the counter stops at the threshold and the run status stays Running',
    compProbe.ok, compProbe.detail);
  const compGated = judgePlay(play.ST_Comp_Gated, false, 3, 'component');
  add('S1 component pawn: condition gates the transition', 'with a threshold the pawn cannot reach, the same tree on the component host stays in Work, keeps counting and never enters Done',
    compGated.ok, compGated.detail);
  const aiRate = ticksPerSecond(play.ST_Gated);
  const compRate = ticksPerSecond(play.ST_Comp_Gated);
  add('S1 observe: counter ticks per second on each host', 'recorded, not asserted: how fast a tree that never finishes counts under the AI controller host and under the plain pawn host',
    aiRate !== undefined && compRate !== undefined, `AI component host ${aiRate} per second; StateTreeComponent host ${compRate} per second`, true);
  add('S1 observe: Python names for the component classes', 'recorded, not asserted: whether the component schema and the component class are visible to Python',
    r?.classes?.StateTreeComponentSchema !== undefined && r?.classes?.StateTreeComponent !== undefined,
    `StateTreeComponentSchema ${r?.classes?.StateTreeComponentSchema}; StateTreeComponent ${r?.classes?.StateTreeComponent}`, true);

  // ---- row S2: a root parameter bound to a condition property (run on 5.8.3) ------------------------------
  const pr = s.param;
  const pst = s.structure_param;
  add('S2 tree parameter builds and compiles', 'a root parameter "Threshold" (integer, 5) added through the editor data compiles with a binding to a transition condition property; the parameter reads back from the editor data; no compiler messages',
    ok(pr) && (pr.info?.root_parameters ?? []).length === 1 && /^Threshold:.*Int32=5$/.test(pr.info.root_parameters[0])
      && pst?.root === 'Root' && sameList((pst?.states ?? []).map((x) => x.name), ['Work', 'Done']) && pst.states[0].transitions === 1 && pst.transition_conditions === 1 && pst.states[1].enter_conditions === 0,
    JSON.stringify({ param: { ...pr, messages: undefined }, structure: pst }));
  const paramPlay = judgePlay(play.ST_Param, true, 5, 'ai');
  add('S2 tree parameter reaches the condition', 'the condition keeps its own threshold of 1000000, so the transition can fire only if the root parameter (5) reaches the condition through the binding: events started, enter:Work, exit:Work, enter:Done',
    s.saved_extra?.ST_Param === true && reloaded('ST_Param') && paramPlay.ok, `${paramPlay.detail}; reloaded ${JSON.stringify(loaded.ST_Param)}`);
  const paramTicks = play.ST_Param?.[play.ST_Param.length - 1]?.work_ticks;
  add('S2 observe: counter when the parameter-bound tree stops', 'recorded, not asserted: the counter at the end of the run (the root parameter is 5)',
    typeof paramTicks === 'number', `ST_Param counter ${paramTicks}`, true);
  return checks;
}

export function summarize(checks) {
  const asserted = checks.filter((c) => !c.observe);
  const observed = checks.filter((c) => c.observe);
  return { passed: asserted.filter((c) => c.pass).length, total: asserted.length, observed: observed.length, observedRecorded: observed.filter((c) => c.pass).length };
}
