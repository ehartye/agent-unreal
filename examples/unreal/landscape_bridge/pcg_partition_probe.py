"""Generate a PCG graph with a Landscape input on a partitioned Landscape, in the editor, and read it per grid actor (Unreal 5.8, editor).

  UnrealEditor.exe Project.uproject -nullrhi -ExecCmds="py <absolute-path-to-this-file>" -unattended -nosplash -nosound -notraceserver
      (in Git Bash set MSYS_NO_PATHCONV=1 or /Game/... is rewritten; -RenderOffScreen instead of -nullrhi runs the same script in a rendering editor)
Environment: LW_REPORT (JSON path). Needs the LandscapeBridge module (landscape_world.mjs builds it) and the PCG plugin.

The fixture is a World Partition map made with new_level(path, True) and a bridge Landscape of 16 components in 4 streaming proxies
(grid size 2), the same map landscape_bridge.mjs checks. It is saved before any PCG work, so wp_unload_probe.py can open the clean map.
Graph: Get Landscape Data -> Surface Sampler -> Transform Points -> Static Mesh Spawner (a cube); the sampler points also go to the graph
output, and so does the Landscape data, so the output of each generated component shows the Landscape data it was given.
Order: a control volume with is_component_partitioned False over the whole Landscape, generated and measured; then a second volume with
it set True, which makes the editor add the PCG World Actor and the partition (grid) actors, generated and measured per grid actor.
The probe ran on Unreal 5.8.4 (rendering editor 18 of 18 checks, -nullrhi editor 16 of 18 across the three probes). Expectations written
from the install's sources before the first run:
  - Get Landscape Data builds one PCGLandscapeData over every loaded ALandscapeProxy it finds and prepares it for the executing
    component's bounds (PCG/Private/Elements/PCGTypedGetter.cpp, FPCGGetLandscapeDataElement::ProcessActors). A local component's bounds
    are its grid cell, so each cell is expected to get one Landscape data, whose Landscapes list is the proxies found, not only its own.
  - Surface Sampler cells are indexed in world space (PCG/Private/Elements/PCGSurfaceSampler.cpp, FSurfaceSamplerData::Initialize), so
    the partitioned total is expected to be close to the control total; this is recorded, not asserted.
  - A projected point sits on the surface: its z is compared with the input surface (landscape_fixture.expected_height_cm).
"""
import os
import sys
import time
import traceback

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import landscape_fixture as fx  # noqa: E402

pc = fx.pc
report = fx.make_report("pcg-partition.json")
EL = unreal.EditorLevelLibrary
MAP = os.environ.get("LW_MAP", "/Game/Maps/LandscapeWp2")
HALF_XY, HALF_Z = 25000.0, 4000.0       # the volume covers the Landscape (half side 25200 cm) and its height range (+-2000 cm)
POINTS_PER_M2 = 0.005                   # about 1270 sampler points over the 504 m square
Z_SAMPLE = 400                          # points checked against the input surface per measurement


def partition_actors():
    found = []
    for a in fx.actors():
        cls = getattr(unreal, "PCGPartitionActor", None)
        if (cls is not None and isinstance(a, cls)) or a.get_class().get_name() == "PCGPartitionActor":
            found.append(a)
    return found


def landscape_data_of(output):
    """The Landscape data objects in a generated output: how many, and the Landscape actors each one lists."""
    cls = getattr(unreal, "PCGLandscapeData", None)
    if cls is None:
        return {"class_exposed": False}
    try:
        items = unreal.PCGDataFunctionLibrary.get_typed_inputs(output, cls)[0]
    except Exception as exc:
        return {"class_exposed": True, "error": str(exc)[:200]}
    listed = []
    for data in items:
        try:
            listed.append([str(p) for p in data.get_editor_property("landscapes")])   # raw text of each soft pointer: how Python prints it is not known
        except Exception as exc:
            listed.append("unreadable: " + str(exc)[:120])
    return {"class_exposed": True, "count": len(items), "landscapes": listed}


def z_error(points):
    """Largest and mean absolute difference between a point's z and the input surface, over an even sample of the points, in cm."""
    if not points:
        return {"sampled": 0}
    step = max(1, len(points) // Z_SAMPLE)
    errors = [abs(p[2] - fx.expected_height_cm(p[0], p[1])) for p in points[::step]]
    return {"sampled": len(errors), "max_cm": round(max(errors), 2), "mean_cm": round(sum(errors) / len(errors), 2)}


def read_output(component):
    out = component.get_generated_graph_output()
    pts = []
    try:
        pts = pc.points_of(component)
    except Exception as exc:
        return {"points": 0, "error": str(exc)[:200], "landscape_data": landscape_data_of(out)}
    return {"points": len(pts), "z": z_error(pts), "landscape_data": landscape_data_of(out), "point_list": pts}


def generate(component, label, seconds=150):
    """Generate on demand and wait for the completion event; True when it fired. A generator: use `yield from`."""
    done = {"flag": False, "at": None}
    start = time.time()

    def on_generated(_component):
        done["flag"], done["at"] = True, round(time.time() - start, 1)

    component.on_pcg_graph_generated_external.add_callable(on_generated)
    component.cleanup(True)
    yield 3
    done["flag"] = False
    component.generate(True)
    ok = yield from pc.wait_for(lambda: done["flag"], seconds)
    yield 30     # the cells finish a little after the original's event
    try:
        component.on_pcg_graph_generated_external.remove_callable(on_generated)
    except Exception:
        pass
    return {"label": label, "event_fired": ok, "seconds_to_event": done["at"], "seconds_total": round(time.time() - start, 1)}


def build_graph(cube):
    warnings = []
    graph = pc.new_graph("PCG_Landscape_Partition")
    land, _ = pc.add_node(graph, unreal.PCGGetLandscapeSettings, warnings)
    sampler, _ = pc.add_node(graph, unreal.PCGSurfaceSamplerSettings, warnings, points_per_squared_meter=POINTS_PER_M2, point_extents=unreal.Vector(50, 50, 50))
    xform, _ = pc.add_node(graph, unreal.PCGTransformPointsSettings, warnings, scale_min=unreal.Vector(2.0, 2.0, 2.0), scale_max=unreal.Vector(3.0, 3.0, 3.0))
    spawner, spawner_settings = pc.add_node(graph, unreal.PCGStaticMeshSpawnerSettings, warnings)
    pc.weighted_mesh_entries(spawner_settings, [(cube, None, 1)], warnings)
    graph.add_edge(land, "Out", sampler, "Surface")
    graph.add_edge(sampler, "Out", xform, "In")
    graph.add_edge(xform, "Out", graph.get_output_node(), "Out")
    graph.add_edge(land, "Out", graph.get_output_node(), "Out")
    graph.add_edge(xform, "Out", spawner, "In")
    return graph, warnings


def cell_row(pa, original):
    local = pa.get_local_component(original)
    row = {"actor": pa.get_name(), "label": pa.get_actor_label(), "location": [round(c, 1) for c in (pa.get_actor_location().x, pa.get_actor_location().y, pa.get_actor_location().z)],
           "instances_on_actor": pc.instance_count(pa), "has_local_component": local is not None}
    try:
        row["grid_size_cm"] = pa.bp_get_pcg_grid_size()
    except Exception as exc:
        row["grid_size_error"] = str(exc)[:120]
    if local is not None:
        out = read_output(local)
        out.pop("point_list", None)
        row.update(out)
    return row


def stages():
    yield 30
    landscape = fx.ensure_wp2_map(MAP, report)
    report["bridge_members"] = fx.bridge_members()
    if landscape is None:
        report["errors"].append({"step": "fixture", "error": "map or Landscape was not created (module missing or new_level failed)"})
        return
    yield 60
    lands, proxies = fx.snapshot_world(report, "fixture")
    report["fixture"]["proxies_in_descs"] = len([d for d in unreal.WorldPartitionBlueprintLibrary.get_actor_descs() if "LandscapeStreamingProxy" in str(d.native_class)])
    report.flush()

    cube = unreal.load_asset("/Engine/BasicShapes/Cube")
    graph, warnings = build_graph(cube)
    report["graph"] = {"path": graph.get_path_name(), "warnings": warnings}
    centre = unreal.Vector(0.0, 0.0, 0.0)

    # control: not partitioned
    vol, comp = pc.spawn_volume("PcgControl", centre, HALF_XY, HALF_XY, HALF_Z, graph)
    control = {"partitioned_readback": bool(comp.get_editor_property("is_component_partitioned"))}
    control.update((yield from generate(comp, "control")))
    out = read_output(comp)
    out.pop("point_list", None)
    control.update(out)
    control["instances_on_volume"] = pc.instance_count(vol)
    control["partition_actors_during"] = len(partition_actors())
    report["control"] = control
    report.flush()
    EL.destroy_actor(vol)
    yield 30

    # partitioned
    vol, comp = pc.spawn_volume("PcgPartitioned", centre, HALF_XY, HALF_XY, HALF_Z, graph)
    pc.soft_set(comp, "is_component_partitioned", True, warnings)
    result = {"partitioned_readback": bool(comp.get_editor_property("is_component_partitioned"))}
    appeared = yield from pc.wait_for(lambda: len(partition_actors()) > 0, 90)
    yield 20
    result["partition_actors_created"] = len(partition_actors())
    result["partition_actors_appeared"] = appeared
    world_actors = [a for a in fx.actors() if isinstance(a, unreal.PCGWorldActor)]
    result["pcg_world_actors"] = len(world_actors)
    if world_actors:
        result["pcg_grid_size_cm"] = world_actors[0].bp_get_pcg_grid_size()
    report["partitioned"] = result
    report.flush()

    result.update((yield from generate(comp, "partitioned")))
    original = read_output(comp)
    original.pop("point_list", None)
    result["original_component_output"] = original
    cells = [cell_row(pa, comp) for pa in partition_actors()]
    result["cells"] = cells
    result["cells_with_points"] = len([c for c in cells if c.get("points", 0) > 0])
    result["total_points"] = sum(c.get("points", 0) for c in cells)
    result["total_instances_on_cells"] = sum(c.get("instances_on_actor", 0) for c in cells)
    result["instances_on_volume"] = pc.instance_count(vol)
    zs = [c["z"] for c in cells if isinstance(c.get("z"), dict) and c["z"].get("sampled")]
    result["z_max_cm"] = max((z["max_cm"] for z in zs), default=None)
    result["control_points"] = control.get("points")
    result["ratio_to_control"] = round(result["total_points"] / control["points"], 4) if control.get("points") else None
    report.flush()


def guarded():
    try:
        yield from stages()
    except Exception:
        report["errors"].append({"step": "stages", "error": traceback.format_exc()[-1500:]})


pc.run_stages(guarded, report)
unreal.log("[pcg_partition_probe] stages registered")
