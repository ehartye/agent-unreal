"""Helpers shared by the PCG game-process scripts (Unreal 5.8, editor or game Python).

Import it from a sibling script with:  sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  then  import pcg_common as pc
It holds the report writer, the stage runner (a generator that yields once per Slate tick while PCG works), a soft property setter, the
graph builder for the experiment variants, the volume spawner and the instance counter. Nothing here touches the editor-only
EditorLevelLibrary unless the caller does, so the runner and the counter also work inside a game process.
"""
import json
import os
import time
import traceback

import unreal

PCG_DIR = "/Game/Pcg"
BRUSH_HALF = 100.0   # half extent of a PCG volume at scale 1, in centimetres (the default cube brush is 200 cm wide)


class Report(dict):
    """A dict that writes itself as JSON to the PCG_REPORT path (absolute) whenever flush() is called."""

    def __init__(self, default_name):
        super().__init__()
        self.path = os.environ.get("PCG_REPORT", default_name).replace("\\", "/")
        self["engine"] = unreal.SystemLibrary.get_engine_version()

    def flush(self):
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        with open(self.path, "w") as fh:
            json.dump(self, fh, indent=1, default=str)


def soft_set(obj, name, value, warnings=None):
    """Set an editor property; on failure record the exact engine message instead of aborting the build."""
    try:
        obj.set_editor_property(name, value)
        return True
    except Exception as exc:
        if warnings is not None:
            warnings.append({"property": name, "error": str(exc)})
        return False


def run_stages(stages, report, quit_command="QUIT_EDITOR"):
    """Run a generator on the Slate post-tick callback. Each `yield n` waits n ticks; `yield from wait_for(...)` waits for a condition.
    The report is written when the generator ends or raises, then the process quits with quit_command.
    The generator form keeps stage code linear: PCG generation, asset loads and shader compiles all need ticks between steps.
    """
    gen = stages()
    state = {"wait": 0, "done": False, "busy": False}

    def finish():
        state["done"] = True
        report.flush()
        unreal.log("[pcg] stages finished, report " + report.path)
        if quit_command:
            unreal.SystemLibrary.execute_console_command(None, quit_command)

    def tick(_dt):
        if state["done"] or state["busy"]:   # busy: a blocking call such as load_map or save ran nested Slate ticks
            return
        if state["wait"] > 0:
            state["wait"] -= 1
            return
        state["busy"] = True
        try:
            state["wait"] = next(gen) or 0
        except StopIteration:
            finish()
        except Exception:
            report["error"] = traceback.format_exc()[-1500:]
            unreal.log_error("[pcg] stage error " + report["error"][-300:])
            finish()
        finally:
            state["busy"] = False

    unreal.register_slate_post_tick_callback(tick)


def wait_for(cond, seconds):
    """Use as `ok = yield from wait_for(lambda: ..., 60)`: yields one tick at a time until cond() or the time is up."""
    end = time.time() + seconds
    while time.time() < end:
        if cond():
            return True
        yield 1
    return bool(cond())


def asset_exists(path):
    return unreal.EditorAssetLibrary.does_asset_exist(path)


def make_material(name, color, flagged):
    at = unreal.AssetToolsHelpers.get_asset_tools()
    if asset_exists(PCG_DIR + "/" + name):   # a second run in the same project reuses the material
        mat = unreal.load_asset(PCG_DIR + "/" + name)
        mat.set_editor_property("used_with_instanced_static_meshes", flagged)
        unreal.MaterialEditingLibrary.recompile_material(mat)
        unreal.EditorAssetLibrary.save_loaded_asset(mat)
        return mat
    mat = at.create_asset(name, PCG_DIR, unreal.Material, unreal.MaterialFactoryNew())
    mel = unreal.MaterialEditingLibrary
    expr = mel.create_material_expression(mat, unreal.MaterialExpressionConstant3Vector, -300, 0)
    expr.set_editor_property("constant", unreal.LinearColor(color[0], color[1], color[2], 1.0))
    mel.connect_material_property(expr, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    mat.set_editor_property("used_with_instanced_static_meshes", flagged)
    mel.recompile_material(mat)
    unreal.EditorAssetLibrary.save_loaded_asset(mat)
    return mat


def new_graph(name):
    unreal.EditorAssetLibrary.make_directory(PCG_DIR)
    unique, n = name, 1
    while asset_exists(PCG_DIR + "/" + unique):   # a deleted asset cannot be created again in the same session, so pick a new name
        n += 1
        unique = "%s_%d" % (name, n)
    return unreal.AssetToolsHelpers.get_asset_tools().create_asset(unique, PCG_DIR, unreal.PCGGraph, unreal.PCGGraphFactory())


def add_node(graph, settings_class, warnings=None, **props):
    """Add a node and set its settings properties (snake_case names); returns (node, settings)."""
    node, settings = graph.add_node_of_type(settings_class)
    for key, value in props.items():
        soft_set(settings, key, value, warnings)
    return node, settings


def weighted_mesh_entries(settings, meshes, warnings=None):
    """Make a Static Mesh Spawner pick from `meshes`, a list of (static_mesh, material_or_None, weight).
    mesh_selector_parameters is read-only from Python: choose the selector type, then edit the returned object in place."""
    settings.set_mesh_selector_type(unreal.PCGMeshSelectorWeighted)
    params = settings.get_editor_property("mesh_selector_parameters")
    entries = params.get_editor_property("mesh_entries")
    for mesh, material, weight in meshes:
        entry = unreal.PCGMeshSelectorWeightedEntry()
        desc = entry.get_editor_property("descriptor")
        desc.set_editor_property("static_mesh", mesh)
        if material is not None:
            desc.set_editor_property("override_materials", [material])
        entry.set_editor_property("descriptor", desc)
        entry.set_editor_property("weight", weight)
        entries.append(entry)
    return params


def build_variant(name, steps, spawner=None, warnings=None):
    """Build a graph: Get Landscape Data -> steps... -> (Graph output, and the spawner when given).

    steps: [(settings_class, {property: value}), ...]. The first step must be a surface sampler or points generator that takes the
    Landscape on its Surface pin; later steps take the previous node's Out on In. spawner: (static_mesh, material) or None.
    Returns (graph, nodes) where nodes maps step index to (node, settings).
    """
    graph = new_graph(name)
    land, _ = add_node(graph, unreal.PCGGetLandscapeSettings, warnings)
    prev, prev_pin, nodes = land, "Out", {}
    for index, (cls, props) in enumerate(steps):
        node, settings = add_node(graph, cls, warnings, **props)
        graph.add_edge(prev, prev_pin, node, "Surface" if index == 0 else "In")
        prev, prev_pin = node, "Out"
        nodes[index] = (node, settings)
    graph.add_edge(prev, "Out", graph.get_output_node(), "Out")
    if spawner is not None:
        mesh, material = spawner
        node, settings = add_node(graph, unreal.PCGStaticMeshSpawnerSettings, warnings)
        weighted_mesh_entries(settings, [(mesh, material, 1)], warnings)
        graph.add_edge(prev, "Out", node, "In")
        nodes["spawner"] = (node, settings)
    return graph, nodes


def spawn_volume(label, center, half_x, half_y, half_z, graph=None, on_demand=True):
    """Spawn a PCG volume whose box is the given half extents in centimetres (editor only)."""
    vol = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.PCGVolume, center)
    vol.set_actor_label(label)
    vol.set_actor_scale3d(unreal.Vector(half_x / BRUSH_HALF, half_y / BRUSH_HALF, half_z / BRUSH_HALF))
    comp = vol.get_editor_property("pcg_component")
    if on_demand:
        comp.set_editor_property("generation_trigger", unreal.PCGComponentGenerationTrigger.GENERATE_ON_DEMAND)
    if graph is not None:
        comp.set_graph(graph)
    return vol, comp


def ism_components(actor):
    return list(actor.get_components_by_class(unreal.InstancedStaticMeshComponent))


def instance_count(actor):
    return sum(c.get_instance_count() for c in ism_components(actor))


def points_of(comp):
    """The points in the graph output (all point data), as (x, y, z, density) tuples. Python reaches the data through the
    PCGDataFunctionLibrary typed-input call, because PCGTaggedData does not expose its data member."""
    out = comp.get_generated_graph_output()
    pts = []
    for data in unreal.PCGDataFunctionLibrary.get_typed_inputs(out, unreal.PCGBasePointData)[0]:
        for i in range(data.get_num_points()):
            loc = data.get_transform(i).translation
            pts.append((loc.x, loc.y, loc.z, data.get_density(i)))
    return pts


def generate_and_count(vol, comp, seconds=90):
    """Generate on demand, wait for the completion event, return {"instances": n, "points": [..]}. A generator: use yield from."""
    done = {"flag": False}

    def on_generated(_component):
        done["flag"] = True

    comp.on_pcg_graph_generated_external.add_callable(on_generated)
    comp.cleanup(True)
    yield 3
    done["flag"] = False
    comp.generate(True)
    ok = yield from wait_for(lambda: done["flag"], seconds)
    yield 2
    try:
        comp.on_pcg_graph_generated_external.remove_callable(on_generated)
    except Exception:
        pass
    return {"completed": ok, "instances": instance_count(vol), "points": points_of(comp)}
