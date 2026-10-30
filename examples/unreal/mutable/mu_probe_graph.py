"""Mutable probe, graph half (questions 2 and 3): add nodes and link pins through the MutableBridge module, then build and compile a swappable-parts object.
Prepared 2026-10-30.

  UnrealEditor.exe Project.uproject -RenderOffScreen -ExecCmds="py <abs path to this file>" -abslog=<log> -notraceserver -nosplash -unattended -nosound
Environment: MU_PROBE_DIR, MU_REPORT, MU_CO (the swappable object's package path), MU_COMPILE_TIMEOUT_S, MU_COMPILE_MODE, MU_PARTS (JSON list of {"id", "path"}).
The parts were imported by the build half of this probe (/Game/Mu/Parts/<id>/...).

Steps written: surface, parts, link_test, swap, compile, readback, save.
  link_test (question 2) works on a second, throwaway object: add a skeletal-mesh node, set its mesh, add a mesh-section node, link the mesh pin to the
    section's mesh input, read the graph back, then ask for links and nodes that must be refused (an unknown pin, pins of two different kinds, a null node,
    an unknown class, an abstract class, a class that is not a node) and read the graph back again to see that nothing changed.
  swap (question 3) builds, on the object that is compiled and shown: one mesh node and one mesh-section node per part (the first part whose id holds
    "body" is the fixed body), an enum parameter whose options are the accessory parts, a switch over mesh sections driven by that parameter, a skeletal-mesh
    make node, a passthrough object make node, a skeletal-mesh component node and the link to the base object node. Pins are found by direction and
    category (get_node_pins), not by guessed names, and every operation is recorded with the bridge's own message.
"""
import json
import os
import sys
import traceback

import unreal

sys.path.insert(0, os.environ["MU_PROBE_DIR"])
import mu_probe_common as c  # noqa: E402

PARTS = json.loads(os.environ.get("MU_PARTS", "[]"))
FOLDER = "/Game/Mu"
LINK_CO = FOLDER + "/CO_Link"
PARAMETER = "Hat"
probe = c.Probe("graph")
ctx = {"co": None, "parts": []}
bridge = getattr(unreal, "MutableBridgeLibrary", None)

# class names are the C++ names without the U prefix (Mutable keeps these classes private, so they are looked up by name)
OBJECT_NODE, MESH_NODE, SECTION_NODE = "CustomizableObjectNodeObject", "CustomizableObjectNodeSkeletalMesh", "CONodeSkeletalMeshSection"
ENUM_NODE, SWITCH_NODE = "CustomizableObjectNodeEnumParameter", "CONodeSwitch"
MAKE_NODE, OBJECT_MAKE_NODE, COMPONENT_NODE = "CONodeSkeletalMeshMake_V2", "CONodeSkeletalMeshObjectMake", "CONodeComponentSkeletalMesh"
SECTION_CATEGORY = "material"        # the Mutable pin category of a mesh section


class Stop(Exception):
    """A bridge call was refused or a pin was not found; the operations so far stay in the report."""


def new_co(path):
    package, name = path.rsplit("/", 1)
    params = unreal.NewCustomizableObjectParameters()
    params.set_editor_property("package_path", package)
    params.set_editor_property("asset_name", name)
    return unreal.CustomizableObjectEditorFunctionLibrary.new_customizable_object(params)


def pick_pin(node, direction, category, name=None):
    """The name of the first visible pin of `node` with the direction and category (and the exact name when given), or None."""
    for pin in bridge.get_node_pins(node):
        if str(pin.direction) != direction or str(pin.category) != category or pin.hidden or pin.orphaned:
            continue
        if name is None or str(pin.name) == name:
            return str(pin.name)
    return None


def pin_summary(node):
    return [{"name": str(p.name), "direction": str(p.direction), "category": str(p.category), "array": bool(p.is_array), "links": int(p.link_count)} for p in bridge.get_node_pins(node)]


class Builder:
    """Adds nodes, sets properties and links pins on one object, recording each operation."""

    def __init__(self, co):
        self.co, self.nodes, self.ops = co, {}, []

    def record(self, op, ok, message):
        self.ops.append({"op": op, "ok": bool(ok), "message": str(message)[:260]})
        if not ok:
            raise Stop("%s: %s" % (op, message))

    def add(self, key, class_name, x, y, props=None, fallback=None):
        """Add a node; props (name -> text) are set before the node builds its pins. When the bridge refuses a property and fallback (python name ->
        value) is given, the node is added without properties and the Python values are set instead, then the pins are rebuilt."""
        names = list((props or {}).keys())
        values = [props[n] for n in names]
        label = "add %s (%s)" % (key, class_name)
        result = bridge.add_node(self.co, class_name, unreal.Vector2D(x, y), names, values)
        if not result.ok and fallback:
            self.ops.append({"op": label + " with properties", "ok": False, "message": str(result.message)[:260]})
            result = bridge.add_node(self.co, class_name, unreal.Vector2D(x, y), [], [])
            self.record(label + " without properties", result.ok, result.message)
            for python_name, value in fallback.items():
                result.node.set_editor_property(python_name, value)
            self.record("reconstruct %s" % key, bridge.reconstruct_node(result.node).ok, "after the Python property values")
        else:
            self.record(label, result.ok, result.message)
        self.nodes[key] = result.node
        return result.node

    def link(self, out_key, in_key, out_category, in_category, out_name=None, in_name=None):
        out_node, in_node = self.nodes[out_key], self.nodes[in_key]
        out_pin = pick_pin(out_node, "Output", out_category, out_name)
        in_pin = pick_pin(in_node, "Input", in_category, in_name)
        label = "link %s.%s -> %s.%s" % (out_key, out_pin, in_key, in_pin)
        if out_pin is None or in_pin is None:
            self.record(label, False, "no %s output pin of category %s on %s, or no %s input pin of category %s on %s (pins %s | %s)" % (
                out_name or "", out_category, out_key, in_name or "", in_category, in_key, json.dumps(pin_summary(out_node))[:300], json.dumps(pin_summary(in_node))[:300]))
        result = bridge.link_pins(out_node, out_pin, in_node, in_pin)
        self.record(label, result.ok, result.message)


def asset_parts():
    """[{id, option, path, mesh}] for the imported parts; the body is the part whose id holds "body" (else the first)."""
    found = []
    for part in PARTS:
        mesh = None
        for asset_path in c.eal.list_assets("%s/Parts/%s" % (FOLDER, part["id"]), recursive=True, include_folder=False):
            asset = c.eal.load_asset(str(asset_path))
            if isinstance(asset, unreal.SkeletalMesh):
                mesh = asset
                break
        found.append({"id": part["id"], "option": part["id"].split("_", 1)[-1].capitalize(), "mesh": mesh})
    return found


def step_surface():
    return {"library_present": bridge is not None, "functions": [n for n in ("add_node", "link_pins", "get_node_pins", "set_node_property", "get_graph_nodes", "get_graph_links") if bridge is not None and hasattr(bridge, n)]}


def step_parts():
    found = asset_parts()
    ctx["parts"] = found
    return {"parts": [{"id": p["id"], "option": p["option"], "path": p["mesh"].get_path_name() if p["mesh"] else None} for p in found]}


def graph_state(co):
    nodes, links = list(bridge.get_graph_nodes(co)), list(bridge.get_graph_links(co))
    return {"node_count": len(nodes), "classes": sorted(str(n.class_name) for n in nodes), "link_count": len(links),
            "links": [{"from": "%s.%s" % (l.from_class, l.from_pin), "to": "%s.%s" % (l.to_class, l.to_pin)} for l in links]}


def step_link_test():
    """Question 2 on a throwaway object: add a node, link a pin, read the graph back, and ask for what must be refused."""
    body = next((p for p in ctx["parts"] if "body" in p["id"]), ctx["parts"][0] if ctx["parts"] else None)
    co = new_co(LINK_CO)
    out = {"co": LINK_CO, "created": co is not None}
    if co is None or body is None or body["mesh"] is None:
        out["error"] = "no object or no body mesh"
        return out
    before = graph_state(co)
    out["before"] = before
    out["base_node_present"] = OBJECT_NODE in before["classes"]
    builder = Builder(co)
    try:
        mesh_node = builder.add("mesh", MESH_NODE, -700, 0, {"SkeletalMesh": body["mesh"].get_path_name()}, {"skeletal_mesh": body["mesh"]})
        section_node = builder.add("section", SECTION_NODE, -350, 0)
        out["mesh_pins"] = pin_summary(mesh_node)
        out["section_pins"] = pin_summary(section_node)
        out["after_add"] = graph_state(co)
        builder.link("mesh", "section", "mesh", "mesh")
        out["after_link"] = graph_state(co)
    except Stop as exc:
        out["error"] = str(exc)[:400]
    out["ops"] = builder.ops
    out["added_ok"] = bool(builder.nodes.get("mesh") is not None and builder.nodes.get("section") is not None)
    # the refusals: each must come back as ok False with a reason, with no exception and no change to the graph
    refusals = []
    mesh_node, section_node = builder.nodes.get("mesh"), builder.nodes.get("section")
    linked_before = graph_state(co)

    def refused(case, call):
        try:
            result = call()
            refusals.append({"case": case, "ok": bool(result.ok), "message": str(result.message)[:260]})
        except Exception as exc:
            refusals.append({"case": case, "raised": str(exc).strip().splitlines()[-1][:200] if str(exc).strip() else exc.__class__.__name__})

    if mesh_node is not None and section_node is not None:
        mesh_out = pick_pin(mesh_node, "Output", "mesh")
        section_in = pick_pin(section_node, "Input", "mesh")
        material_in = pick_pin(section_node, "Input", "materialAsset")
        refused("unknown input pin", lambda: bridge.link_pins(mesh_node, mesh_out, section_node, "No Such Pin"))
        refused("unknown output pin", lambda: bridge.link_pins(mesh_node, "No Such Pin", section_node, section_in))
        if material_in:
            refused("pins of different kinds (mesh output to material input)", lambda: bridge.link_pins(mesh_node, mesh_out, section_node, material_in))
        refused("a null output node", lambda: bridge.link_pins(None, "x", section_node, section_in))
        refused("an input pin passed as the output", lambda: bridge.link_pins(section_node, section_in, mesh_node, mesh_out))
    refused("a class that does not exist", lambda: bridge.add_node(co, "NoSuchMutableNode", unreal.Vector2D(0, 0), [], []))
    refused("a class that is not a node (StaticMesh)", lambda: bridge.add_node(co, "StaticMesh", unreal.Vector2D(0, 0), [], []))
    refused("an abstract node class", lambda: bridge.add_node(co, "CustomizableObjectNodeParameter", unreal.Vector2D(0, 0), [], []))
    refused("a null Customizable Object", lambda: bridge.add_node(None, MESH_NODE, unreal.Vector2D(0, 0), [], []))
    refused("a property the node does not have", lambda: bridge.add_node(co, MESH_NODE, unreal.Vector2D(0, 0), ["NoSuchProperty"], ["1"]))
    refused("an object that is not a Customizable Object", lambda: bridge.add_node(body["mesh"], MESH_NODE, unreal.Vector2D(0, 0), [], []))
    out["refusals"] = refusals
    out["after_refusals"] = graph_state(co)
    out["unchanged_by_refusals"] = (out["after_refusals"]["node_count"], out["after_refusals"]["link_count"]) == (linked_before["node_count"], linked_before["link_count"])
    return out


def step_swap():
    """Question 3: build the swappable-parts graph on the object that is compiled and shown."""
    co = new_co(c.CO_PATH)
    ctx["co"] = co
    out = {"created": co is not None, "co": c.CO_PATH}
    parts = ctx["parts"]
    body = next((p for p in parts if "body" in p["id"]), parts[0] if parts else None)
    accessories = [p for p in parts if p is not body and p["mesh"] is not None]
    out["body"] = body["id"] if body else None
    out["options"] = [p["option"] for p in accessories]
    if co is None or body is None or body["mesh"] is None or len(accessories) < 2:
        out["error"] = "need the object, a body mesh and at least two accessory meshes"
        return out
    out["before"] = graph_state(co)
    builder = Builder(co)
    ctx["builder"] = builder
    try:
        # the parts: one mesh node each, and one mesh-section node per mesh section (a skeletal mesh node has one mesh output pin per section)
        sections = {}
        for i, part in enumerate([body] + accessories):
            key = part["id"]
            node = builder.add("mesh_" + key, MESH_NODE, -1400, i * 520, {"SkeletalMesh": part["mesh"].get_path_name()}, {"skeletal_mesh": part["mesh"]})
            pins = [str(p.name) for p in bridge.get_node_pins(node) if str(p.direction) == "Output" and str(p.category) == "mesh" and not p.hidden and not p.orphaned]
            sections[key] = len(pins)
            for k, pin in enumerate(pins):
                builder.add("section_%s_%d" % (key, k), SECTION_NODE, -1050, i * 520 + k * 110)
                builder.link("mesh_" + key, "section_%s_%d" % (key, k), "mesh", "mesh", out_name=pin)
        out["sections"] = sections
        # the parameter, and one switch over mesh sections per section slot of the accessories (slot k takes section k of each accessory)
        builder.add("param", ENUM_NODE, -1050, -300, {"ParameterName": PARAMETER, "Values": "(%s)" % ",".join('(Name="%s")' % p["option"] for p in accessories), "DefaultIndex": "0"})
        slots = max(sections[p["id"]] for p in accessories)
        for k in range(slots):
            builder.add("switch_%d" % k, SWITCH_NODE, -700, 260 + k * 160, {"PinType": SECTION_CATEGORY})
            builder.link("param", "switch_%d" % k, "enum", "enum")
            for part in accessories:
                if k < sections[part["id"]]:
                    builder.link("section_%s_%d" % (part["id"], k), "switch_%d" % k, SECTION_CATEGORY, SECTION_CATEGORY, in_name=part["option"])
        out["switch_pins"] = pin_summary(builder.nodes["switch_0"])
        # the output wiring: sections -> skeletal mesh -> passthrough object -> component -> base object
        builder.add("make", MAKE_NODE, -350, 0)
        for k in range(sections[body["id"]]):
            builder.link("section_%s_%d" % (body["id"], k), "make", SECTION_CATEGORY, SECTION_CATEGORY)
        for k in range(slots):
            builder.link("switch_%d" % k, "make", SECTION_CATEGORY, SECTION_CATEGORY)
        builder.add("object_make", OBJECT_MAKE_NODE, -50, 0)
        builder.link("make", "object_make", "skeletalMesh", "skeletalMesh")
        builder.add("component", COMPONENT_NODE, 250, 0, {"ReferenceSkeletalMesh": body["mesh"].get_path_name()}, {"reference_skeletal_mesh": body["mesh"]})
        builder.link("object_make", "component", "passThroughSkeletalMesh", "passThroughSkeletalMesh")
        base = [n for n in bridge.get_graph_nodes(co) if str(n.class_name) == OBJECT_NODE]
        if not base:
            builder.record("find the base object node", False, "the graph holds no %s" % OBJECT_NODE)
        builder.nodes["base"] = base[0].node
        builder.link("component", "base", "component", "component")
        out["parameter_read_back"] = {"ParameterName": str(bridge.get_node_property(builder.nodes["param"], "ParameterName").message),
                                      "Values": str(bridge.get_node_property(builder.nodes["param"], "Values").message)[:300]}
        # what the plan adds: a mesh node per part, a section node per section, the parameter, a switch per slot, make, object make and the component
        total_sections = sum(sections.values())
        accessory_sections = sum(sections[p["id"]] for p in accessories)
        out["expected_nodes"] = len(sections) + total_sections + 1 + slots + 3
        out["expected_links"] = total_sections + slots + accessory_sections + sections[body["id"]] + slots + 3
    except Stop as exc:
        out["error"] = str(exc)[:500]
    except Exception:
        out["error"] = traceback.format_exc()[-600:]
    out["ops"] = builder.ops
    out["ops_ok"] = all(o["ok"] for o in builder.ops) and len(builder.ops) > 0
    out["after"] = graph_state(co)
    return out


def task():
    for name, fn in (("surface", step_surface), ("parts", step_parts)):
        probe.guarded(name, fn)
        yield 1.0
    if bridge is None:
        return
    probe.guarded("link_test", step_link_test)
    yield 1.0
    probe.guarded("swap", step_swap)
    yield 1.0
    co = ctx["co"]
    if co is None:
        return
    record = {}
    try:
        yield from c.run_compile(co, record)
    except Exception:
        record["error"] = traceback.format_exc()[-700:]
    probe.step("compile", **record)
    probe.guarded("readback", lambda: c.read_back(co))
    probe.guarded("save", lambda: {"saved": bool(c.eal.save_asset(c.CO_PATH, only_if_is_dirty=False))})
    yield 1.0


c.drive(probe, task)
unreal.log("[mu_probe_graph] tick callback registered")
