"""Build a played state machine, 2D Blend Space Animation Blueprints and linked layers, then play them in Play-In-Editor (Unreal 5.8, editor).

Prepared, not yet run on an engine. Opt-in: anim_runtime.mjs starts it; anim_probe.py and the default anim_bridge.mjs run are unchanged.

  UnrealEditor.exe Project.uproject -nullrhi -ExecCmds="py <absolute-path-to-this-file>" -unattended -nosplash -nosound -notraceserver
Environment: AR_REPORT (JSON path), AR_MODE (build or play), AR_BONE (the keyed bone; default Bone02).
The AnimBridge, AnimMachineBridge and AnimMachine modules must be built first (anim_runtime.mjs does that).

Session build (a fresh project): three clips that move the last bone along +X, +Y and +Z (A, B, C) and, from them:
  ABP_CtrlA, ABP_CtrlB, ABP_CtrlC  Sequence Player controls: they say where each clip moves the bone.
  ABP_Machine                      a state machine: Idle plays clip A, Walk plays clip B; Idle to Walk when bGoWalk, Walk to Idle when bGoIdle.
  BS_2D, ABP_B2D_00 / _10 / _01 / _mid
                                   a 2D Blend Space with clip A at (0, 0), B at (1, 0), C at (0, 1) and four Blend Space Player graphs at
                                   (0, 0), (1, 0), (0, 1) and (1/3, 1/3).
  ABI_Locomotion, ABP_LayerHost, ABP_LayerGuest
                                   a layer interface with one layer, Locomotion; the host and the guest implement it (clip A and clip B); the host
                                   has a Linked Anim Layer node for it in its AnimGraph.
Session play (a fresh editor): loads the saved assets, spawns one skeletal mesh actor per Animation Blueprint, starts Play-In-Editor and samples the
bone every 0.1 s for 5.2 s. At 1.2 s the machine is given bGoWalk and the host links the guest's layers; at 3.2 s the machine is given bGoIdle and the
host unlinks them. The state name is read through unreal.MachineAnimInstance.get_machine_state.
A failure at any step is recorded in the report and the editor still quits.
"""
import json
import os
import traceback

import unreal

REPORT = os.environ.get("AR_REPORT", "anim-runtime.json").replace("\\", "/")
MODE = os.environ.get("AR_MODE", "build")
SKELETON = "/Engine/EngineMeshes/SkeletalCube_Skeleton"
MESH = "/Engine/EngineMeshes/SkeletalCube"
FOLDER = "/Game/AnimRt"
CLIP_FRAMES = 30            # 30 fps, so a clip lasts one second
MOVE_CM = 100.0
LAYER = "Locomotion"
report = {"engine": unreal.SystemLibrary.get_engine_version(), "mode": MODE, "steps": {}, "errors": []}
state = {"gen": None, "wait": 3.0, "done": False}


def step(name, fn):
    """Run one step; record its result or its error, and carry on."""
    try:
        report["steps"][name] = fn()
    except Exception as exc:
        report["steps"][name] = None
        report["errors"].append({"step": name, "error": repr(exc)[:500], "trace": traceback.format_exc()[-900:]})


def note(name, fn):
    """Run an optional diagnostic; a failure is a note in the report, not a script error."""
    try:
        report.setdefault("notes", {})[name] = fn()
    except Exception as exc:
        report.setdefault("notes", {})[name] = "unavailable: " + repr(exc)[:200]


def asset_path(name):
    return "%s/%s" % (FOLDER, name)


def tools():
    return unreal.AssetToolsHelpers.get_asset_tools()


def make_clip(name, skeleton, bone, axis):
    factory = unreal.AnimSequenceFactory()
    factory.set_editor_property("target_skeleton", skeleton)
    seq = tools().create_asset(name, FOLDER, unreal.AnimSequence, factory)
    ctl = seq.controller
    ctl.open_bracket("make " + name)
    ctl.set_frame_rate(unreal.FrameRate(30, 1))
    ctl.set_number_of_frames(unreal.FrameNumber(CLIP_FRAMES))
    ctl.add_bone_curve(bone)
    positions = [unreal.Vector(MOVE_CM * i / CLIP_FRAMES * axis[0], MOVE_CM * i / CLIP_FRAMES * axis[1], MOVE_CM * i / CLIP_FRAMES * axis[2]) for i in range(CLIP_FRAMES + 1)]
    ctl.set_bone_track_keys(bone, positions, [unreal.Quat(0, 0, 0, 1)] * (CLIP_FRAMES + 1), [unreal.Vector(1, 1, 1)] * (CLIP_FRAMES + 1))
    ctl.close_bracket()
    unreal.EditorAssetLibrary.save_loaded_asset(seq)
    return seq


def new_anim_bp(name, skeleton, parent=None):
    factory = unreal.AnimBlueprintFactory()
    factory.set_editor_property("target_skeleton", skeleton)
    factory.set_editor_property("parent_class", parent or unreal.MachineAnimInstance)
    return tools().create_asset(name, FOLDER, unreal.AnimBlueprint, factory)


def anim_graph(bp):
    return unreal.AnimationLibrary.get_animation_graphs(bp)[0]


def root_node(ge):
    return [n for n in ge.list_all_nodes() if n.get_class().get_name() == "AnimGraphNode_Root"][0]


def compile_info(bp, ge):
    unreal.BlueprintEditorLibrary.compile_blueprint(bp)
    return {"status": str(bp.get_editor_property("status")), "nodes_with_errors": len(ge.list_nodes_with_errors()), "nodes_with_warnings": len(ge.list_nodes_with_warnings())}


# ---- build ---------------------------------------------------------------------------------------------------------------------
def build_control(skeleton, name, clip):
    """A Sequence Player Animation Blueprint: where the clip moves the bone (the reference the other series are judged against)."""
    bp = new_anim_bp(name, skeleton)
    ge = unreal.BlueprintGraphEditor.get_graph_editor(anim_graph(bp))
    player = ge.create_node_from_name("Animation|Sequences|SequencePlayer", unreal.Vector2D(-300, 0), [])
    node = player.get_editor_property("node")
    node.set_editor_property("sequence", clip)
    player.set_editor_property("node", node)
    linked = player.list_output_pins()[0].try_create_connection(root_node(ge).list_input_pins()[0])
    out = {"linked": linked, **compile_info(bp, ge)}
    unreal.EditorAssetLibrary.save_loaded_asset(bp)
    return out


def build_machine(skeleton, clip_a, clip_b):
    bp = new_anim_bp("ABP_Machine", skeleton)
    ge = unreal.BlueprintGraphEditor.get_graph_editor(anim_graph(bp))
    sm_node = ge.create_node_from_name("Animation|StateMachines|StateMachine", unreal.Vector2D(-400, 0), [])
    sm_graph = [g for g in unreal.BlueprintEditorLibrary.list_graphs(bp) if g.get_class().get_name() == "AnimationStateMachineGraph"][0]
    idle = unreal.AnimBridgeLibrary.add_state(sm_graph, "Idle", unreal.Vector2D(200, 0))                                  # source: AnimBridgeLibrary.h AddState
    walk = unreal.AnimBridgeLibrary.add_state(sm_graph, "Walk", unreal.Vector2D(500, 0))
    out = {"idle": idle is not None, "walk": walk is not None}
    out["idle_sequence"] = unreal.AnimMachineBridgeLibrary.set_state_sequence(idle, clip_a)                                # source: AnimMachineBridgeLibrary.h
    out["walk_sequence"] = unreal.AnimMachineBridgeLibrary.set_state_sequence(walk, clip_b)
    out["rule_idle_to_walk"] = unreal.AnimMachineBridgeLibrary.add_transition_on_variable(idle, walk, "bGoWalk", 0.2)
    out["rule_walk_to_idle"] = unreal.AnimMachineBridgeLibrary.add_transition_on_variable(walk, idle, "bGoIdle", 0.2)
    out["machine_linked"] = sm_node.list_output_pins()[0].try_create_connection(root_node(ge).list_input_pins()[0])
    out.update(compile_info(bp, ge))
    unreal.EditorAssetLibrary.save_loaded_asset(bp)
    out["graph"] = [str(line) for line in unreal.AnimBridgeLibrary.describe_anim_graph(bp)]
    return out


def build_blend2d(skeleton, clip_a, clip_b, clip_c):
    factory = unreal.BlendSpaceFactoryNew()                                                                                # source: Factories/BlendSpaceFactoryNew.h
    factory.set_editor_property("target_skeleton", skeleton)
    bs = tools().create_asset("BS_2D", FOLDER, unreal.BlendSpace, factory)
    out = {"asset_class": bs.get_class().get_name()}
    params = list(bs.get_editor_property("blend_parameters"))
    for index, label in ((0, "X"), (1, "Y")):
        axis = params[index]
        axis.set_editor_property("display_name", label)
        axis.set_editor_property("min", 0.0)
        axis.set_editor_property("max", 1.0)
        axis.set_editor_property("grid_num", 2)
        params[index] = axis
    bs.set_editor_property("blend_parameters", params)
    samples = []
    for clip, x, y in ((clip_a, 0.0, 0.0), (clip_b, 1.0, 0.0), (clip_c, 0.0, 1.0)):
        sample = unreal.BlendSample()
        sample.set_editor_property("animation", clip)
        sample.set_editor_property("sample_value", unreal.Vector(x, y, 0.0))
        sample.set_editor_property("rate_scale", 1.0)
        samples.append(sample)
    bs.set_editor_property("sample_data", samples)
    out["resampled"] = unreal.AnimBridgeLibrary.resample_blend_space(bs)                                                   # source: AnimBridgeLibrary.h ResampleBlendSpace
    unreal.EditorAssetLibrary.save_loaded_asset(bs)
    out["play_length"] = bs.get_play_length()
    out["samples_read_back"] = len(bs.get_editor_property("sample_data"))
    out["axes_read_back"] = [[str(blend.get_editor_property(k)) for k in ("display_name", "min", "max", "grid_num")] for blend in list(bs.get_editor_property("blend_parameters"))[:2]]
    out["players"] = {}
    for suffix, x, y in (("00", 0.0, 0.0), ("10", 1.0, 0.0), ("01", 0.0, 1.0), ("mid", 1.0 / 3.0, 1.0 / 3.0)):
        bp = new_anim_bp("ABP_B2D_" + suffix, skeleton)
        ge = unreal.BlueprintGraphEditor.get_graph_editor(anim_graph(bp))
        player = ge.create_node_from_name("Animation|BlendSpaces|BlendspacePlayer", unreal.Vector2D(-300, 0), [])
        node = player.get_editor_property("node")
        node.set_editor_property("blend_space", bs)
        player.set_editor_property("node", node)
        info = {"pins": [str(p.get_pin_name()) for p in player.list_input_pins()]}
        player.find_input_pin("X").set_pin_value("%.5f" % x)
        player.find_input_pin("Y").set_pin_value("%.5f" % y)
        info["linked"] = player.list_output_pins()[0].try_create_connection(root_node(ge).list_input_pins()[0])
        info.update(compile_info(bp, ge))
        unreal.EditorAssetLibrary.save_loaded_asset(bp)
        out["players"][suffix] = info
    return out


def new_layer_interface(skeleton):
    """An Animation Layer Interface asset: unreal.AnimLayerInterfaceFactory when Python exposes it, else AnimBlueprintFactory with the Interface type."""
    route = "AnimLayerInterfaceFactory"
    if hasattr(unreal, "AnimLayerInterfaceFactory"):
        factory = unreal.AnimLayerInterfaceFactory()                                                                       # source: Factories/AnimBlueprintFactory.h
    else:
        route = "AnimBlueprintFactory.blueprint_type"
        factory = unreal.AnimBlueprintFactory()
        factory.set_editor_property("blueprint_type", unreal.BlueprintType.BPTYPE_INTERFACE)
    factory.set_editor_property("target_skeleton", skeleton)
    return tools().create_asset("ABI_Locomotion", FOLDER, unreal.AnimBlueprint, factory), route


def linked_layer_candidates(ge):
    names = [str(n) for n in ge.list_available_nodes([])]
    return names, [n for n in names if LAYER.lower() in n.lower() and "linked" in n.lower() and "layer" in n.lower()]


def build_layers(skeleton, clip_a, clip_b):
    out = {}
    iface, out["interface_route"] = new_layer_interface(skeleton)
    out["interface_class"] = iface.get_class().get_name()
    out["layer_added"] = unreal.AnimMachineBridgeLibrary.add_animation_layer(iface, LAYER)
    unreal.BlueprintEditorLibrary.compile_blueprint(iface)
    out["interface_status"] = str(iface.get_editor_property("status"))
    unreal.EditorAssetLibrary.save_loaded_asset(iface)
    out["interface_layers"] = [str(line) for line in unreal.AnimMachineBridgeLibrary.describe_layers(iface)]

    sides = {}
    for name, clip in (("ABP_LayerHost", clip_a), ("ABP_LayerGuest", clip_b)):
        bp = new_anim_bp(name, skeleton)
        info = {"implemented": unreal.AnimMachineBridgeLibrary.implement_layer_interface(bp, iface)}
        info["layer_sequence"] = unreal.AnimMachineBridgeLibrary.set_layer_sequence(bp, LAYER, clip)
        unreal.BlueprintEditorLibrary.compile_blueprint(bp)                                      # the layer function must exist before the node's action does
        ge = unreal.BlueprintGraphEditor.get_graph_editor(anim_graph(bp))
        if name == "ABP_LayerHost":
            names, candidates = linked_layer_candidates(ge)
            info["available_layer_actions"] = [n for n in names if LAYER.lower() in n.lower()][:20]
            info["candidates"] = candidates
            if candidates:
                node = ge.create_node_from_name(candidates[0], unreal.Vector2D(-300, 0), [])
                info["node_class"] = node.get_class().get_name() if node else None
                info["linked"] = bool(node) and node.list_output_pins()[0].try_create_connection(root_node(ge).list_input_pins()[0])
            else:
                info["node_class"] = None
                info["linked"] = False
        info.update(compile_info(bp, ge))
        unreal.EditorAssetLibrary.save_loaded_asset(bp)
        info["layers"] = [str(line) for line in unreal.AnimMachineBridgeLibrary.describe_layers(bp)]
        sides[name] = info
    out["host"] = sides["ABP_LayerHost"]
    out["guest"] = sides["ABP_LayerGuest"]
    return out


def script_build():
    skeleton = unreal.load_asset(SKELETON)
    mesh = unreal.load_asset(MESH)
    report["skeleton"] = skeleton.get_path_name()
    probe_actor = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.SkeletalMeshActor, unreal.Vector(0, 0, 0))
    probe_actor.skeletal_mesh_component.set_skeletal_mesh_asset(mesh)
    names = [str(probe_actor.skeletal_mesh_component.get_bone_name(i)) for i in range(probe_actor.skeletal_mesh_component.get_num_bones())]
    unreal.get_editor_subsystem(unreal.EditorActorSubsystem).destroy_actor(probe_actor)
    bone = names[-1]
    report["bones"] = names
    report["bone_keyed"] = bone
    report["classes"] = {n: hasattr(unreal, n) for n in ("MachineAnimInstance", "AnimMachineBridgeLibrary", "AnimBridgeLibrary", "BlendSpace", "BlendSpaceFactoryNew",
                                                          "AnimLayerInterfaceFactory", "AnimGraphNode_LinkedAnimLayer")}
    try:
        clip_a = make_clip("Clip_A", skeleton, bone, (1.0, 0.0, 0.0))
        clip_b = make_clip("Clip_B", skeleton, bone, (0.0, 1.0, 0.0))
        clip_c = make_clip("Clip_C", skeleton, bone, (0.0, 0.0, 1.0))
        report["clips"] = {"a": clip_a.get_play_length(), "b": clip_b.get_play_length(), "c": clip_c.get_play_length()}
    except Exception as exc:
        report["errors"].append({"step": "clips", "error": repr(exc)[:500], "trace": traceback.format_exc()[-900:]})
        return
    for suffix, clip in (("A", clip_a), ("B", clip_b), ("C", clip_c)):
        step("control_" + suffix, lambda suffix=suffix, clip=clip: build_control(skeleton, "ABP_Ctrl" + suffix, clip))
    step("machine", lambda: build_machine(skeleton, clip_a, clip_b))
    step("blend2d", lambda: build_blend2d(skeleton, clip_a, clip_b, clip_c))
    step("layers", lambda: build_layers(skeleton, clip_a, clip_b))
    yield 0.5


# ---- play ----------------------------------------------------------------------------------------------------------------------
def bone_location(comp, bone):
    v = comp.get_socket_transform(bone, unreal.RelativeTransformSpace.RTS_COMPONENT).translation   # a bone is a socket name
    return [round(v.x, 2), round(v.y, 2), round(v.z, 2)]


def spawn_actor(mesh, name, index):
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.SkeletalMeshActor, unreal.Vector(0.0, 400.0 * index, 0.0))
    comp = actor.skeletal_mesh_component
    comp.set_skeletal_mesh_asset(mesh)
    if name != "ABP_Ref":
        comp.set_editor_property("animation_mode", unreal.AnimationMode.ANIMATION_BLUEPRINT)
        comp.set_editor_property("anim_class", unreal.load_asset(asset_path(name)).generated_class())
    comp.set_editor_property("visibility_based_anim_tick_option", unreal.VisibilityBasedAnimTickOption.ALWAYS_TICK_POSE_AND_REFRESH_BONES)
    actor.tags = [name]
    return actor


def script_play():
    mesh = unreal.load_asset(MESH)
    bone = os.environ.get("AB_BONE", "Bone02")
    report["bone_keyed"] = bone
    names = ["ABP_Ref", "ABP_CtrlA", "ABP_CtrlB", "ABP_CtrlC", "ABP_Machine", "ABP_B2D_00", "ABP_B2D_10", "ABP_B2D_01", "ABP_B2D_mid", "ABP_LayerHost"]
    for i, name in enumerate(names):
        step("spawn_" + name, lambda i=i, name=name: spawn_actor(mesh, name, i) and None)
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_begin_play()
    yield 8.0
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_game_world()
    report["play_world"] = world.get_path_name() if world else None
    found = {}
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.SkeletalMeshActor):
        for name in names:
            if name in [str(t) for t in actor.tags]:
                found[name] = actor
    report["play_actors"] = sorted(found)
    series = {name: [] for name in found}
    report["series"] = series
    guest_class = unreal.load_asset(asset_path("ABP_LayerGuest")).generated_class()
    machine = found.get("ABP_Machine").skeletal_mesh_component.get_anim_instance() if "ABP_Machine" in found else None
    host = found.get("ABP_LayerHost").skeletal_mesh_component.get_anim_instance() if "ABP_LayerHost" in found else None
    report["instances"] = {"machine": machine.get_class().get_name() if machine else None, "host": host.get_class().get_name() if host else None}
    machine_name = None
    if machine:
        names_read = [str(n) for n in machine.get_machine_names()]
        report["machine_names"] = names_read
        machine_name = names_read[0] if names_read else None
    for tick in range(52):
        phase = "baseline" if tick < 12 else ("second" if tick < 32 else "third")
        if tick == 12:
            if machine:
                machine.set_machine_inputs(True, False)
            if host:
                step("link_guest", lambda: host.link_anim_class_layers(guest_class) or True)
                note("linked_instance", lambda: str(host.get_linked_anim_layer_instance_by_class(guest_class, False)))
        if tick == 32:
            if machine:
                machine.set_machine_inputs(False, True)
            if host:
                step("unlink_guest", lambda: host.link_anim_class_layers(None) or True)
        for name, actor in found.items():
            comp = actor.skeletal_mesh_component
            entry = {"phase": phase, "tick": tick, "loc": bone_location(comp, bone)}
            if name == "ABP_Machine" and machine and machine_name:
                entry["state"] = str(machine.get_machine_state(machine_name))
            series[name].append(entry)
        yield 0.1
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_end_play()
    yield 2.0


def finish():
    state["done"] = True
    os.makedirs(os.path.dirname(REPORT) or ".", exist_ok=True)
    with open(REPORT, "w") as fh:
        json.dump(report, fh, indent=2, default=str)
    unreal.log("[anim-runtime] report written")
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
            state["gen"] = script_build() if MODE == "build" else script_play()
        state["wait"] = next(state["gen"])
    except StopIteration:
        finish()
    except Exception as exc:
        report["errors"].append({"step": "script", "error": repr(exc)[:500], "trace": traceback.format_exc()[-1200:]})
        finish()
    finally:
        state["busy"] = False


handle = unreal.register_slate_post_tick_callback(tick)
