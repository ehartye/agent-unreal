"""Build a StateTree from C++, compile it, read the compile log back and run it on a pawn (Unreal 5.8, editor, no rendering).

  UnrealEditor.exe Project.uproject -nullrhi -ExecCmds="py <absolute-path-to-this-file>" -unattended -nosplash -nosound -notraceserver
Environment: ST_REPORT (JSON path), ST_MODE (build or run). The StateTreeNodes and StateTreeBridge modules must be built first
(statetree_bridge.mjs does that).
Mode build:
  1. Creates three trees with StateTreeBridgeLibrary.create_tree and compiles them: ST_Probe (the transition fires after 3 ticks),
     ST_Gated (the same tree with a threshold the pawn cannot reach, as a control) and ST_Broken (one task whose Context property no
     context object can satisfy, so the compile fails and the messages come back).
  2. Reads the structure back with the Python API and saves ST_Probe and ST_Gated.
  3. Probes what Python reaches for authoring: the factory, the schema, the state and node properties.
Mode run (a fresh editor session): loads the saved trees, places one probe pawn per tree, starts Play-In-Editor, and samples each pawn's
tick counter and event list while its AI controller runs the tree.
Writes a JSON report and quits the editor. A failure in a step is recorded and the editor still quits.
"""
import json
import os
import traceback

import unreal

REPORT = os.environ.get("ST_REPORT", "statetree-bridge.json").replace("\\", "/")
MODE = os.environ.get("ST_MODE", "build")
FOLDER = "/Game/StateTreeProbe"
LIB = unreal.StateTreeBridgeLibrary
report = {"engine": unreal.SystemLibrary.get_engine_version(), "mode": MODE, "steps": {}, "errors": []}
state = {"gen": None, "wait": 3.0, "done": False}


def step(name, fn):
    """Run one step; record its result or its error, and carry on."""
    try:
        report["steps"][name] = fn()
    except Exception as exc:
        report["steps"][name] = None
        report["errors"].append({"step": name, "error": repr(exc)[:500], "trace": traceback.format_exc()[-900:]})


def attempt(fn):
    """Run something that may fail; return {'ok': True, 'value': ...} or {'ok': False, 'error': ...}."""
    try:
        return {"ok": True, "value": fn()}
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:300]}


# ---- build ----------------------------------------------------------------------------------------------------------------------
def make_tree(name, min_ticks, broken):
    tree = LIB.create_tree(FOLDER, name, min_ticks, broken)
    if not tree:
        return {"created": False}
    result = LIB.compile_tree(tree)
    return {"created": True, "path": tree.get_path_name(), "class": tree.get_class().get_name(), "compiled": bool(result.compiled), "messages": [str(m) for m in result.messages],
            "ready": LIB.is_ready_to_run(tree), "needs_recompile": LIB.needs_recompile(tree)}


def read_structure(name):
    tree = unreal.load_asset("%s/%s" % (FOLDER, name))
    data = unreal.StateTreeEditorData.get_editor_data(tree)
    roots = list(data.sub_trees)
    root = roots[0]
    states = []
    for child in root.children:
        states.append({"name": str(child.name), "tasks": len(child.tasks), "enter_conditions": len(child.enter_conditions), "transitions": len(child.transitions)})
    work = root.children[0]
    transition = work.transitions[0] if len(work.transitions) else None
    return {"sub_trees": len(roots), "root": str(root.name), "states": states,
            "transition_trigger": str(transition.trigger) if transition else None, "transition_conditions": len(transition.conditions) if transition else 0}


def python_reach():
    """What Python does with authoring. Each attempt records the engine's own error text."""
    out = {}
    out["classes"] = {n: hasattr(unreal, n) for n in ("StateTree", "StateTreeFactory", "StateTreeEditorData", "StateTreeState", "StateTreeEditorNode", "StateTreeTransition",
                                                    "StateTreeAIComponentSchema", "StateTreeEditingSubsystem", "StateTreeCompilerLog", "StateTreeTaskBase")}
    factory = unreal.StateTreeFactory()
    out["factory_members"] = sorted(m for m in dir(factory) if not m.startswith("_") and m not in set(dir(unreal.Object)))
    out["factory_schema_property"] = attempt(lambda: factory.get_editor_property("state_tree_schema_class"))
    out["factory_schema_set"] = attempt(lambda: factory.set_editor_property("state_tree_schema_class", unreal.StateTreeAIComponentSchema))
    created = attempt(lambda: unreal.AssetToolsHelpers.get_asset_tools().create_asset("ST_PythonOnly", FOLDER, unreal.StateTree, unreal.StateTreeFactory()))
    out["python_only_create_asset"] = {"ok": created["ok"], "created": bool(created.get("value")), "error": created.get("error")}

    # Every write below goes to a throwaway tree, never to the saved ones. The counts after each attempt show whether it changed anything.
    tree = LIB.create_tree(FOLDER, "ST_PythonProbe", 3, False)
    data = unreal.StateTreeEditorData.get_editor_data(tree)

    def counts():
        roots = list(data.sub_trees)
        root = roots[0] if roots else None
        return {"sub_trees": len(roots), "children": [str(c.name) for c in root.children] if root else [],
                "work_tasks": len(root.children[0].tasks) if root and len(root.children) else None}

    root = data.sub_trees[0]
    out["state_members"] = sorted(m for m in dir(root) if not m.startswith("_") and m not in set(dir(unreal.Object)))
    out["state_has_builders"] = {n: hasattr(root, n) for n in ("add_child_state", "add_task", "add_transition", "add_enter_condition")}
    out["python_names_for_compile"] = [n for n in dir(unreal) if "statetree" in n.lower() and ("compil" in n.lower() or "subsystem" in n.lower())]
    out["editor_data_compile_members"] = [m for m in dir(data) if "compil" in m.lower()]
    out["schema_property"] = attempt(lambda: str(data.get_editor_property("schema")))
    out["node_class"] = hasattr(unreal, "StateTreeEditorNode")
    node = unreal.StateTreeEditorNode() if out["node_class"] else None
    out["node_members"] = sorted(m for m in dir(node) if not m.startswith("_"))[:40] if node is not None else None
    out["instanced_struct_class"] = hasattr(unreal, "InstancedStruct")
    out["instanced_struct_members"] = sorted(m for m in dir(unreal.InstancedStruct) if not m.startswith("_"))[:30] if hasattr(unreal, "InstancedStruct") else None
    out["custom_task_struct_in_python"] = hasattr(unreal, "ProbeWorkTask")
    out["before"] = counts()
    out["rename_state"] = attempt(lambda: root.children[0].set_editor_property("name", "Renamed"))
    out["rename_state"]["after"] = str(root.children[0].name)
    new_state = unreal.new_object(unreal.StateTreeState, outer=data)
    out["new_object_state"] = {"made": new_state is not None}
    out["new_object_state"]["name_set"] = attempt(lambda: new_state.set_editor_property("name", "PythonState"))
    out["add_child_state"] = attempt(lambda: root.set_editor_property("children", list(root.children) + [new_state]))
    out["add_child_state"]["after"] = counts()
    if node is not None:
        out["add_task_node"] = attempt(lambda: root.children[0].set_editor_property("tasks", list(root.children[0].tasks) + [node]))
        out["add_task_node"]["after"] = counts()
    out["remove_tasks"] = attempt(lambda: root.children[0].set_editor_property("tasks", []))
    out["remove_tasks"]["after"] = counts()
    out["clear_sub_trees"] = attempt(lambda: data.set_editor_property("sub_trees", []))
    out["clear_sub_trees"]["after"] = counts()
    return out


def script_build():
    step("probe", lambda: make_tree("ST_Probe", 3, False))
    step("gated", lambda: make_tree("ST_Gated", 1000000, False))
    step("broken", lambda: make_tree("ST_Broken", 3, True))
    step("structure_probe", lambda: read_structure("ST_Probe"))
    step("structure_broken", lambda: read_structure("ST_Broken"))
    step("saved", lambda: {n: bool(unreal.EditorAssetLibrary.save_asset("%s/%s" % (FOLDER, n), only_if_is_dirty=False)) for n in ("ST_Probe", "ST_Gated")})
    step("python_reach", python_reach)
    yield 0.5


# ---- run ------------------------------------------------------------------------------------------------------------------------
def game_world():
    return unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_game_world()


def sample(pawn):
    controller = pawn.get_controller()
    comp = controller.state_tree_component if controller else None
    return {"work_ticks": pawn.work_ticks, "events": [str(e) for e in pawn.events],
            "controller": controller.get_class().get_name() if controller else None,
            "running": bool(comp.is_running()) if comp else None, "run_status": str(comp.get_state_tree_run_status()) if comp else None}


def script_run():
    loaded = {}
    for i, name in enumerate(("ST_Probe", "ST_Gated")):
        tree = unreal.load_asset("%s/%s" % (FOLDER, name))
        loaded[name] = {"loaded": bool(tree), "ready": LIB.is_ready_to_run(tree), "needs_recompile": LIB.needs_recompile(tree)}
        pawn = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.StateTreeProbePawn, unreal.Vector(0.0, 400.0 * i, 100.0))
        pawn.set_editor_property("tree", tree)
        pawn.tags = [name]
    report["steps"]["loaded"] = loaded
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_begin_play()
    yield 8.0
    found = {}
    for actor in unreal.GameplayStatics.get_all_actors_of_class(game_world(), unreal.StateTreeProbePawn):
        for name in loaded:
            if name in [str(t) for t in actor.tags]:
                found[name] = actor
    report["steps"]["play_actors"] = sorted(found)
    series = {name: [] for name in found}
    report["steps"]["play"] = series
    for _ in range(4):
        for name in found:
            series[name].append(sample(found[name]))
        yield 0.5
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_end_play()
    yield 2.0


def script():
    if MODE == "run":
        yield from script_run()
    else:
        yield from script_build()


def finish():
    state["done"] = True
    os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=2, default=str)
    unreal.log("[statetree] report written")
    unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")


def tick(dt):
    if state["done"] or state.get("busy"):   # a long step can run nested ticks; do not re-enter the generator
        return
    state["wait"] -= dt
    if state["wait"] > 0:
        return
    state["busy"] = True
    try:
        if state["gen"] is None:
            state["gen"] = script()
        state["wait"] = next(state["gen"])
    except StopIteration:
        finish()
    except Exception as exc:
        report["errors"].append({"step": "script", "error": repr(exc)[:500], "trace": traceback.format_exc()[-1200:]})
        finish()
    finally:
        state["busy"] = False


handle = unreal.register_slate_post_tick_callback(tick)
