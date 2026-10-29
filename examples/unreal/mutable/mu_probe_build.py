"""Mutable probe, build half (question 1): import the parts, create a Customizable Object, try to reach its graph, compile it under a limit.
Prepared 2026-10-29.

  UnrealEditor.exe Project.uproject -RenderOffScreen -ExecCmds="py <abs path to this file>" -abslog=<log> -notraceserver -nosplash -unattended -nosound
Environment: MU_PROBE_DIR, MU_REPORT, MU_CO, MU_COMPILE_TIMEOUT_S, MU_COMPILE_MODE (see mu_probe_common.py), MU_PARTS (JSON list of {"id", "path"}).

Steps written to the report (the shapes mu-probe-checks.mjs reads): surface, import, create, graph, compile, readback, instance, save.
The graph step asks what a script can reach. It does not guess a way in: it tries the object's `source` property, a lookup of the graph subobject, a mesh
node created in it, and lists the calls on the graph and node classes whose names mention a pin or link. The compile then runs on whatever the object holds.
"""
import json
import os
import sys

import unreal

sys.path.insert(0, os.environ["MU_PROBE_DIR"])
import mu_probe_common as c  # noqa: E402

PARTS = json.loads(os.environ.get("MU_PARTS", "[]"))
FOLDER = "/Game/Mu"
probe = c.Probe("build")
ctx = {"co": None}


def combine_by_skeleton_pipeline():
    """A saved pipeline asset that merges the skins of one skeleton into one SkeletalMesh (as the Niagara wire probe does)."""
    behavior = unreal.InterchangeCombineSkeletalMeshesBehavior.BY_SKELETON
    folder, name = "/Game/Pipelines", "P_combine_by_skeleton"
    c.eal.make_directory(folder)
    if not c.eal.does_asset_exist(folder + "/" + name):
        asset = unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, folder, unreal.InterchangeGenericAssetsPipeline, None)
        asset.get_editor_property("mesh_pipeline").set_editor_property("combine_skeletal_meshes_behavior", behavior)
        c.eal.save_asset(folder + "/" + name)
    return unreal.SoftObjectPath(folder + "/" + name + "." + name)


def import_part(part):
    dest = "%s/Parts/%s" % (FOLDER, part["id"])
    manager = unreal.InterchangeManager.get_interchange_manager_scripted()
    source = unreal.InterchangeManager.create_source_data(part["path"])
    params = unreal.ImportAssetParameters()
    params.is_automated = True
    params.override_pipelines = [combine_by_skeleton_pipeline()]
    returned = bool(manager.import_asset(dest, source, params))
    c.eal.save_directory(dest, only_if_is_dirty=False, recursive=True)
    skeletal, static, skeleton = [], [], ""
    for path in c.eal.list_assets(dest, recursive=True, include_folder=False):
        asset = c.eal.load_asset(str(path))
        if isinstance(asset, unreal.SkeletalMesh):
            skeletal.append(str(path))
            try:
                skeleton = asset.get_editor_property("skeleton").get_name()
            except Exception:
                pass
        elif isinstance(asset, unreal.StaticMesh):
            static.append(str(path))
    return {"id": part["id"], "returned": returned, "skeletal": len(skeletal), "static": len(static), "skeleton": skeleton, "skeletal_paths": skeletal}


def step_surface():
    classes = sorted(n for n in dir(unreal) if n.startswith(("CustomizableObjectNode", "CONode")))
    base = set(dir(unreal.EdGraphNode))
    extra = {}
    for name in ("CustomizableObjectNodeSkeletalMesh", "CustomizableObjectNodeObject", "CustomizableObjectNodeObjectGroup", "CustomizableObjectNodeSkeletalMeshParameter", "CustomizableObjectNodeEnumParameter"):
        cls = getattr(unreal, name, None)
        extra[name] = None if cls is None else len([m for m in dir(cls) if m not in base and not m.startswith("_")])
    return {"node_class_count": len(classes), "node_extra_members": extra, "has_graph_class": hasattr(unreal, "CustomizableObjectGraph"),
            "api": {n: bool(hasattr(unreal, n)) for n in ("CustomizableObject", "CustomizableObjectInstance", "CompileParams", "CustomizableObjectEditorFunctionLibrary", "CustomizableSkeletalMeshActor")}}


def step_import():
    parts = []
    for part in PARTS:
        try:
            parts.append(import_part(part))
        except Exception as exc:
            parts.append({"id": part["id"], "skeletal": 0, "static": 0, "error": str(exc)[:300]})
    return {"parts": parts}


def step_create():
    c.eal.make_directory(FOLDER)
    package, name = c.CO_PATH.rsplit("/", 1)
    params = unreal.NewCustomizableObjectParameters()
    params.set_editor_property("package_path", package)
    params.set_editor_property("asset_name", name)
    co = unreal.CustomizableObjectEditorFunctionLibrary.new_customizable_object(params)
    if co is None:
        return {"created": False, "error": "new_customizable_object returned None"}
    ctx["co"] = co
    return {"created": True, "path": c.CO_PATH, "compiled_before": bool(co.is_compiled()), "class": co.get_class().get_name()}


def attempt(fn):
    """'ok' or the first line of the error, so the report shows what each way in did."""
    try:
        fn()
        return "ok"
    except Exception as exc:
        return str(exc).strip().splitlines()[0][:160] if str(exc).strip() else exc.__class__.__name__


def step_graph():
    """What a script can reach in the object's graph. Each way in is one attempt whose outcome is recorded; none is assumed to work."""
    co = ctx["co"]
    out = {"graph_found": False, "node_created": False, "node_property_set": False, "node_extra_members": 0, "pin_api": [], "attempts": {}}
    out["attempts"]["co.source read"] = attempt(lambda: co.get_editor_property("source"))
    out["source_property_error"] = out["attempts"]["co.source read"]
    graph = None
    for suffix in ("_0", "_1", ""):
        try:
            graph = unreal.find_object(co, "CustomizableObjectGraph" + suffix)
        except Exception:
            graph = None
        if graph is not None:
            out["graph_found"], out["graph_class"], out["graph_name"] = True, graph.get_class().get_name(), graph.get_name()
            break
    base_node, base_graph = set(dir(unreal.EdGraphNode)), set(dir(unreal.EdGraph))
    node_cls = getattr(unreal, "CustomizableObjectNodeSkeletalMesh", None)
    node = None
    try:
        node = unreal.new_object(node_cls, outer=graph if graph is not None else co) if node_cls else None
        out["node_created"] = node is not None
        if node is not None:
            out["node_extra_members"] = len([m for m in dir(node) if m not in base_node and not m.startswith("_")])
    except Exception as exc:
        out["error"] = str(exc)[:300]
    if node is not None:
        mesh = c.eal.load_asset("%s/Parts/person_body/person_body" % FOLDER)
        # TSoftObjectPtr<USkeletalMesh> SkeletalMesh is EditAnywhere on the node; dir() does not list it, so the reflection route is tried by name
        out["attempts"]["node.skeletal_mesh set"] = attempt(lambda: node.set_editor_property("skeletal_mesh", mesh))
        try:
            out["node_property_read"] = str(node.get_editor_property("skeletal_mesh"))[:160]
        except Exception as exc:
            out["node_property_read"] = "error: " + str(exc).strip().splitlines()[0][:120]
        out["node_property_set"] = out["attempts"]["node.skeletal_mesh set"] == "ok" and mesh is not None and mesh.get_name() in out["node_property_read"]
        out["attempts"]["node.pins read"] = attempt(lambda: node.get_editor_property("pins"))
        for method in ("AllocateDefaultPins", "AutowireNewNode", "MakeLinkTo"):
            out["attempts"]["node.call_method " + method] = attempt(lambda m=method: node.call_method(m))
    if graph is not None:
        out["attempts"]["graph.nodes read"] = attempt(lambda: graph.get_editor_property("nodes"))
        if node is not None:
            out["attempts"]["graph.call_method AddNode"] = attempt(lambda: graph.call_method("AddNode", (node, True, False)))
    names = sorted(set(m for m in list(base_node) + list(base_graph) + (dir(graph) if graph is not None else []) if any(k in m.lower() for k in ("pin", "link", "connect", "add_node", "nodes"))))
    out["pin_api"] = [m for m in names if not m.startswith("_")]
    # a way to add the node to the graph or link a pin that did not raise
    out["link_call_ok"] = any(v == "ok" for k, v in out["attempts"].items() if "call_method" in k)
    return out


def task():
    for name, fn in (("surface", step_surface), ("import", step_import), ("create", step_create), ("graph", step_graph)):
        probe.guarded(name, fn)
        yield 1.0
    co = ctx["co"]
    if co is None:
        return
    record = {}
    try:
        yield from c.run_compile(co, record)
    except Exception:
        import traceback
        record["error"] = traceback.format_exc()[-700:]
    probe.step("compile", **record)
    probe.guarded("readback", lambda: c.read_back(co))
    probe.guarded("instance", lambda: instance_step(co))
    probe.guarded("save", lambda: {"saved": bool(c.eal.save_asset(c.CO_PATH, only_if_is_dirty=False))})
    yield 1.0


def instance_step(co):
    inst = co.create_instance()
    return {"created": inst is not None, "has_any_parameters": bool(inst.has_any_parameters()) if inst else None,
            "has_any_skeletal_mesh": bool(inst.has_any_skeletal_mesh()) if inst else None}


c.drive(probe, task)
unreal.log("[mu_probe_build] tick callback registered")
