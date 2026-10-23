// Judges the reports that statetree_bridge.mjs collects. Pure functions, no Unreal and no dependencies; the node test feeds them reports
// shaped like the ones statetree_probe.py wrote on Unreal 5.8.2.
//   build = report of the first editor session (mode build); run = report of the second session (mode run, Play-In-Editor).

const CONTEXT_ERROR = /Could not find matching Context object for Context property 'Component'/;
const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

/** Judges one pawn's samples. `expectDone` true: the tree must reach Done and then stay; false: it must stay in Work and keep counting. */
export function judgePlay(samples, expectDone, minTicks = 3) {
  if (!Array.isArray(samples) || samples.length < 2) return { ok: false, detail: 'fewer than two samples' };
  const first = samples[0];
  const last = samples[samples.length - 1];
  const running = samples.every((s) => s.running === true && /RUNNING/.test(s.run_status ?? ''));
  const controller = samples.every((s) => s.controller === 'StateTreeProbeController');
  if (expectDone) {
    const steady = samples.every((s) => s.work_ticks === first.work_ticks && sameList(s.events, first.events));
    const events = sameList(last.events, ['started', 'enter:Work', 'exit:Work', 'enter:Done']);
    return { ok: running && controller && steady && events && last.work_ticks >= minTicks,
      detail: `events ${JSON.stringify(last.events)}; ticks ${first.work_ticks} to ${last.work_ticks}; running ${running}; controller ${last.controller}` };
  }
  const grows = last.work_ticks > first.work_ticks && first.work_ticks > minTicks;
  const events = samples.every((s) => sameList(s.events, ['started', 'enter:Work']));
  return { ok: running && controller && grows && events, detail: `events ${JSON.stringify(last.events)}; ticks ${first.work_ticks} to ${last.work_ticks}; running ${running}` };
}

export function evaluate({ build, buildReport, runReport, buildLog = '', runLog = '' }) {
  const s = buildReport?.steps ?? {};
  const checks = [];
  const add = (name, claim, pass, detail) => checks.push({ name, claim, pass: !!pass, detail });

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
  return checks;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}
