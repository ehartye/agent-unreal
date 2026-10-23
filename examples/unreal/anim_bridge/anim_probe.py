"""Build slot-only Animation Blueprints two ways, play clips through the slot and read the pose back (Unreal 5.8, editor).

  UnrealEditor.exe Project.uproject -nullrhi -ExecCmds="py <absolute-path-to-this-file>" -unattended -nosplash -nosound -notraceserver
Environment: AB_REPORT (JSON path). The AnimBridge and SlotClip modules must be built first (anim_bridge.mjs does that).
What it does, in order, inside a Slate tick so the editor is fully started:
  1. Probes what Python reaches for AnimGraph editing (classes, the protected Nodes property, the Blueprint action list of a state
     machine graph) and what a BlendSpace asset accepts.
  2. Makes two animation clips for an engine skeleton: clip A moves one bone along +X, clip B along +Y (AnimDataController).
  3. ABP_Python: an Animation Blueprint created from Python alone (AnimBlueprintFactory, then unreal.BlueprintGraphEditor adds a
     Slot node, links it to the Root node and the Blueprint is compiled).
  4. ABP_Bridge: the same graph made by the C++ bridge (AnimBridgeLibrary.add_slot_to_anim_blueprint).
  5. ABP_Machine: a State Machine node added from Python, then two states and a transition added by the bridge.
  6. ABP_Blend: a BlendSpace 1D asset filled from Python and a Blend Space Player node linked to the Root node.
  7. Spawns one skeletal mesh actor per Animation Blueprint, starts Play-In-Editor and, for the two slot Animation Blueprints, plays clip A
     and then clip B through the slot with SlotClipAnimInstance.play_clip, sampling the montage state and the bone position.
Writes a JSON report and quits the editor. A failure at any step is recorded in the report and the editor still quits.
"""
import json
import os
import time
import traceback

import unreal

REPORT = os.environ.get("AB_REPORT", "anim-bridge.json").replace("\\", "/")
MODE = os.environ.get("AB_MODE", "build")   # build = steps 1 to 7; blend = play the saved ABP_Blend in a fresh editor session
SKELETON = "/Engine/EngineMeshes/SkeletalCube_Skeleton"
MESH = "/Engine/EngineMeshes/SkeletalCube"
FOLDER = "/Game/Anim"
SLOT = "DefaultSlot"
CLIP_FRAMES = 30            # 30 fps, so a clip lasts one second
MOVE_CM = 100.0
report = {"engine": unreal.SystemLibrary.get_engine_version(), "steps": {}, "errors": []}
state = {"gen": None, "wait": 3.0, "done": False}


def step(name, fn):
    """Run one step; record its result or its error, and carry on."""
    try:
        report["steps"][name] = fn()
    except Exception as exc:
        report["steps"][name] = None
        report["errors"].append({"step": name, "error": repr(exc)[:500], "trace": traceback.format_exc()[-900:]})


def members(obj, keep=None):
    base = set(dir(unreal.Object))
    return sorted(m for m in dir(obj) if not m.startswith("_") and m not in base and (keep is None or keep(m)))


def make_clip(name, skeleton, bone, axis):
    factory = unreal.AnimSequenceFactory()
    factory.set_editor_property("target_skeleton", skeleton)
    seq = unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, FOLDER, unreal.AnimSequence, factory)
    ctl = seq.controller
    ctl.open_bracket("make " + name)
    ctl.set_frame_rate(unreal.FrameRate(30, 1))
    ctl.set_number_of_frames(unreal.FrameNumber(CLIP_FRAMES))
    ctl.add_bone_curve(bone)
    positions = [unreal.Vector(MOVE_CM * i / CLIP_FRAMES * axis[0], MOVE_CM * i / CLIP_FRAMES * axis[1], 0.0) for i in range(CLIP_FRAMES + 1)]
    ctl.set_bone_track_keys(bone, positions, [unreal.Quat(0, 0, 0, 1)] * (CLIP_FRAMES + 1), [unreal.Vector(1, 1, 1)] * (CLIP_FRAMES + 1))
    ctl.close_bracket()
    unreal.EditorAssetLibrary.save_loaded_asset(seq)
    return seq


def new_anim_bp(name, skeleton):
    factory = unreal.AnimBlueprintFactory()
    factory.set_editor_property("target_skeleton", skeleton)
    factory.set_editor_property("parent_class", unreal.SlotClipAnimInstance)
    return unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, FOLDER, unreal.AnimBlueprint, factory)


def anim_graph(bp):
    return unreal.AnimationLibrary.get_animation_graphs(bp)[0]


def root_node(ge):
    return [n for n in ge.list_all_nodes() if n.get_class().get_name() == "AnimGraphNode_Root"][0]


def compile_info(bp, ge):
    unreal.BlueprintEditorLibrary.compile_blueprint(bp)
    return {"status": str(bp.get_editor_property("status")), "nodes_with_errors": len(ge.list_nodes_with_errors()), "nodes_with_warnings": len(ge.list_nodes_with_warnings())}


# ---- 1. what Python reaches --------------------------------------------------------------------------------------------------
def probe_reach(skeleton):
    bp = new_anim_bp("ABP_Reach", skeleton)
    graph = anim_graph(bp)
    out = {"classes": {n: hasattr(unreal, n) for n in ("AnimGraphNode_Slot", "AnimGraphNode_StateMachine", "AnimGraphNode_BlendSpacePlayer", "AnimStateNode",
                                                       "AnimStateTransitionNode", "AnimStateEntryNode", "BlueprintGraphEditor", "BlendSpace", "BlendSpaceFactory1D")}}
    out["graph_class"] = graph.get_class().get_name()
    out["graph_members"] = members(graph)
    for verb, fn in (("read", lambda: graph.get_editor_property("nodes")), ("write", lambda: graph.set_editor_property("nodes", []))):
        try:
            fn()
            out["nodes_property_" + verb] = "allowed"
        except Exception as exc:
            out["nodes_property_" + verb] = str(exc)[:200]
    ge = unreal.BlueprintGraphEditor.get_graph_editor(graph)
    sm_node = ge.create_node_from_name("Animation|StateMachines|StateMachine", unreal.Vector2D(-600, 200), [])
    out["state_machine_node_created"] = sm_node is not None
    sm_graph = [g for g in unreal.BlueprintEditorLibrary.list_graphs(bp) if g.get_class().get_name() == "AnimationStateMachineGraph"][0]
    sge = unreal.BlueprintGraphEditor.get_graph_editor(sm_graph)
    available = [str(n) for n in sge.list_available_nodes([])]
    out["state_machine_graph_actions"] = available
    out["state_machine_graph_nodes_before"] = len(list(sge.list_all_nodes()))
    out["state_names_tried"] = {}
    for candidate in ("Add State...", "State", "AnimationStates|State", "StateMachines|State", "Transition"):
        out["state_names_tried"][candidate] = sge.create_node_from_name(candidate, unreal.Vector2D(0, 0), []) is not None
    stray = unreal.new_object(unreal.AnimStateNode, outer=sm_graph)
    out["new_object_state_node_made"] = stray is not None
    out["state_machine_graph_nodes_after"] = len(list(sge.list_all_nodes()))
    out["blueprint_editor_library_state_functions"] = [m for m in dir(unreal.BlueprintEditorLibrary) if "state" in m.lower() or "transition" in m.lower()]
    return out


# ---- 3. to 6. Animation Blueprints -------------------------------------------------------------------------------------------
def build_python_slot(skeleton):
    bp = new_anim_bp("ABP_Python", skeleton)
    ge = unreal.BlueprintGraphEditor.get_graph_editor(anim_graph(bp))
    slot = ge.create_node_from_name("Animation|Montage|Slot'%s'" % SLOT, unreal.Vector2D(-300, 0), [])
    linked = slot.list_output_pins()[0].try_create_connection(root_node(ge).list_input_pins()[0])
    info = compile_info(bp, ge)
    unreal.EditorAssetLibrary.save_loaded_asset(bp)
    return {"slot_class": slot.get_class().get_name(), "linked": linked, "nodes": [n.get_class().get_name() for n in ge.list_all_nodes()], **info}


def build_bridge_slot(skeleton):
    bp = new_anim_bp("ABP_Bridge", skeleton)
    result = unreal.AnimBridgeLibrary.add_slot_to_anim_blueprint(bp, SLOT)
    unreal.EditorAssetLibrary.save_loaded_asset(bp)
    return {"linked": result.get_editor_property("slot_linked_to_root"), "compiled": result.get_editor_property("compiled"),
            "errors": result.get_editor_property("num_errors"), "warnings": result.get_editor_property("num_warnings"),
            "blueprint_status": result.get_editor_property("blueprint_status"), "messages": [str(m) for m in result.get_editor_property("messages")],
            "graph": [str(line) for line in unreal.AnimBridgeLibrary.describe_anim_graph(bp)]}


def build_machine(skeleton):
    bp = new_anim_bp("ABP_Machine", skeleton)
    ge = unreal.BlueprintGraphEditor.get_graph_editor(anim_graph(bp))
    sm_node = ge.create_node_from_name("Animation|StateMachines|StateMachine", unreal.Vector2D(-400, 0), [])
    sm_graph = [g for g in unreal.BlueprintEditorLibrary.list_graphs(bp) if g.get_class().get_name() == "AnimationStateMachineGraph"][0]
    idle = unreal.AnimBridgeLibrary.add_state(sm_graph, "Idle", unreal.Vector2D(200, 0))
    walk = unreal.AnimBridgeLibrary.add_state(sm_graph, "Walk", unreal.Vector2D(500, 0))
    transition = unreal.AnimBridgeLibrary.add_transition(idle, walk)
    sm_node.list_output_pins()[0].try_create_connection(root_node(ge).list_input_pins()[0])
    info = compile_info(bp, ge)
    unreal.EditorAssetLibrary.save_loaded_asset(bp)
    lines = [str(line) for line in unreal.AnimBridgeLibrary.describe_anim_graph(bp)]
    return {"idle": idle is not None, "walk": walk is not None, "transition": transition, "graph": lines, **info}


def build_blend(skeleton, clip_a, clip_b, suffix, resample):
    factory = unreal.BlendSpaceFactory1D()
    factory.set_editor_property("target_skeleton", skeleton)
    bs = unreal.AssetToolsHelpers.get_asset_tools().create_asset("BS_" + suffix, FOLDER, unreal.BlendSpace1D, factory)
    out = {"asset_class": bs.get_class().get_name()}
    params = list(bs.get_editor_property("blend_parameters"))
    axis = params[0]
    axis.set_editor_property("display_name", "Speed")
    axis.set_editor_property("min", 0.0)
    axis.set_editor_property("max", 1.0)
    axis.set_editor_property("grid_num", 2)
    params[0] = axis
    bs.set_editor_property("blend_parameters", params)
    samples = []
    for clip, x in ((clip_a, 0.0), (clip_b, 1.0)):
        sample = unreal.BlendSample()
        sample.set_editor_property("animation", clip)
        sample.set_editor_property("sample_value", unreal.Vector(x, 0.0, 0.0))
        sample.set_editor_property("rate_scale", 1.0)
        samples.append(sample)
    bs.set_editor_property("sample_data", samples)
    if resample:
        out["resampled"] = unreal.AnimBridgeLibrary.resample_blend_space(bs)
    unreal.EditorAssetLibrary.save_loaded_asset(bs)
    out["play_length"] = bs.get_play_length()
    out["samples_read_back"] = len(bs.get_editor_property("sample_data"))
    out["axis_read_back"] = [str(bs.get_editor_property("blend_parameters")[0].get_editor_property(k)) for k in ("display_name", "min", "max", "grid_num")]

    bp = new_anim_bp("ABP_Blend" + suffix, skeleton)
    ge = unreal.BlueprintGraphEditor.get_graph_editor(anim_graph(bp))
    player = ge.create_node_from_name("Animation|BlendSpaces|BlendspacePlayer", unreal.Vector2D(-300, 0), [])
    node = player.get_editor_property("node")
    node.set_editor_property("blend_space", bs)
    player.set_editor_property("node", node)
    out["x_pin_names"] = [str(p.get_pin_name()) for p in player.list_input_pins()]
    player.find_input_pin("X").set_pin_value("0.5")
    out["linked"] = player.list_output_pins()[0].try_create_connection(root_node(ge).list_input_pins()[0])
    out.update(compile_info(bp, ge))
    unreal.EditorAssetLibrary.save_loaded_asset(bp)
    return out


def build_player(skeleton, clip_a):
    """A Sequence Player node: another asset player node made from Python, as a control for the Blend Space Player."""
    bp = new_anim_bp("ABP_Player", skeleton)
    ge = unreal.BlueprintGraphEditor.get_graph_editor(anim_graph(bp))
    player = ge.create_node_from_name("Animation|Sequences|SequencePlayer", unreal.Vector2D(-300, 0), [])
    node = player.get_editor_property("node")
    node.set_editor_property("sequence", clip_a)
    player.set_editor_property("node", node)
    linked = player.list_output_pins()[0].try_create_connection(root_node(ge).list_input_pins()[0])
    out = {"linked": linked, **compile_info(bp, ge)}
    unreal.EditorAssetLibrary.save_loaded_asset(bp)
    return out


# ---- 7. play ------------------------------------------------------------------------------------------------------------------
def game_world():
    return unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_game_world()


def bone_location(comp, bone):
    v = comp.get_socket_transform(bone, unreal.RelativeTransformSpace.RTS_COMPONENT).translation   # a bone is a socket name
    return [round(v.x, 2), round(v.y, 2), round(v.z, 2)]


def spawn_actor(mesh, name, index):
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.SkeletalMeshActor, unreal.Vector(0.0, 400.0 * index, 0.0))
    comp = actor.skeletal_mesh_component
    comp.set_skeletal_mesh_asset(mesh)
    comp.set_editor_property("animation_mode", unreal.AnimationMode.ANIMATION_BLUEPRINT)
    comp.set_editor_property("anim_class", unreal.load_asset("%s/%s" % (FOLDER, name)).generated_class())
    comp.set_editor_property("visibility_based_anim_tick_option", unreal.VisibilityBasedAnimTickOption.ALWAYS_TICK_POSE_AND_REFRESH_BONES)
    actor.tags = [name]
    return actor


def find_play_actors(names):
    world = game_world()
    report["play_world"] = world.get_path_name() if world else None
    found = {}
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.SkeletalMeshActor):
        for name in names:
            if name in [str(t) for t in actor.tags]:
                found[name] = actor
    report["play_actors"] = sorted(found)
    return found


def script_blend():
    """A fresh editor session: the Blend Space and its Animation Blueprint load from disk, then play."""
    mesh = unreal.load_asset(MESH)
    bone = os.environ.get("AB_BONE", "Bone02")
    report["bone_keyed"] = bone
    for i, name in enumerate(("ABP_BlendRaw", "ABP_BlendResampled", "ABP_Player")):
        spawn_actor(mesh, name, i)
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_begin_play()
    yield 8.0
    found = find_play_actors(["ABP_BlendRaw", "ABP_BlendResampled", "ABP_Player"])
    series = {name: [] for name in found}
    report["series"] = series
    for _ in range(12):
        for name in found:
            series[name].append({"phase": "play", "loc": bone_location(found[name].skeletal_mesh_component, bone)})
        yield 0.1
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_end_play()
    yield 2.0


def script():
    if MODE == "blend":
        yield from script_blend()
        return
    skeleton = unreal.load_asset(SKELETON)
    mesh = unreal.load_asset(MESH)
    report["skeleton"] = skeleton.get_path_name()
    step("reach", lambda: probe_reach(skeleton))

    # a temporary actor names the bones, so the clips can key one of them
    probe_actor = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.SkeletalMeshActor, unreal.Vector(0, 0, 0))
    probe_actor.skeletal_mesh_component.set_skeletal_mesh_asset(mesh)
    names = [str(probe_actor.skeletal_mesh_component.get_bone_name(i)) for i in range(probe_actor.skeletal_mesh_component.get_num_bones())]
    unreal.get_editor_subsystem(unreal.EditorActorSubsystem).destroy_actor(probe_actor)
    bone = names[-1]
    report["bones"] = names
    report["bone_keyed"] = bone
    try:
        clip_a = make_clip("Clip_A", skeleton, bone, (1.0, 0.0))
        clip_b = make_clip("Clip_B", skeleton, bone, (0.0, 1.0))
        report["clips"] = {"a": clip_a.get_path_name(), "a_length": clip_a.get_play_length(), "b": clip_b.get_path_name(), "b_length": clip_b.get_play_length()}
    except Exception as exc:
        report["errors"].append({"step": "clips", "error": repr(exc)[:500], "trace": traceback.format_exc()[-900:]})
        return
    step("python_slot", lambda: build_python_slot(skeleton))
    step("bridge_slot", lambda: build_bridge_slot(skeleton))
    step("machine", lambda: build_machine(skeleton))
    step("blend_raw", lambda: build_blend(skeleton, clip_a, clip_b, "Raw", False))
    step("blend_resampled", lambda: build_blend(skeleton, clip_a, clip_b, "Resampled", True))
    step("player", lambda: build_player(skeleton, clip_a))

    for i, name in enumerate(("ABP_Python", "ABP_Bridge")):
        spawn_actor(mesh, name, i)
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_begin_play()
    yield 8.0

    found = find_play_actors(("ABP_Python", "ABP_Bridge"))
    series = {name: [] for name in found}
    report["series"] = series
    for name in found:
        comp = found[name].skeletal_mesh_component
        inst = comp.get_anim_instance()
        series[name].append({"phase": "rest", "instance_class": inst.get_class().get_name() if inst else None, "loc": bone_location(comp, bone)})
    for label, clip in (("clip_a", clip_a), ("clip_b", clip_b)):
        for name in found:
            inst = found[name].skeletal_mesh_component.get_anim_instance()
            montage = inst.play_clip(clip, SLOT, 0.0, 0.0, 1.0, 1)
            series[name].append({"phase": label + "_started", "montage": montage.get_path_name() if montage else None, "playing": inst.is_clip_playing(), "position": round(inst.get_clip_position(), 3)})
        for _ in range(10):
            yield 0.1
            for name in found:
                comp = found[name].skeletal_mesh_component
                inst = comp.get_anim_instance()
                series[name].append({"phase": label, "playing": inst.is_clip_playing(), "position": round(inst.get_clip_position(), 3), "loc": bone_location(comp, bone)})
        yield 1.0
        for name in found:
            comp = found[name].skeletal_mesh_component
            inst = comp.get_anim_instance()
            series[name].append({"phase": label + "_after", "playing": inst.is_clip_playing(), "position": round(inst.get_clip_position(), 3), "loc": bone_location(comp, bone)})
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_end_play()
    yield 2.0


def finish():
    state["done"] = True
    os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=2, default=str)
    unreal.log("[anim] report written")
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
