"""PCG experiment harness: build graph variants, generate each on a test volume, count the points and the spawned instances (Unreal 5.8, editor).

  UnrealEditor.exe Project.uproject /Game/Maps/PcgBase -nullrhi -ExecCmds="py <absolute-path-to-this-file>" -unattended -nosplash -nosound -notraceserver
      (in Git Bash set MSYS_NO_PATHCONV=1 or /Game/... is rewritten)
Environment: PCG_REPORT (JSON path). The map is the copy that pcg_maps.py makes; the editor keeps running until the stages end, because
PCG generation needs ticks (see pcg_common.run_stages). Nothing is saved.

The method: a variant is a short chain of nodes after Get Landscape Data. Each one is generated on a volume over the whole Landscape and
the report records the point count, the density spread and the spawned ISM instance count, so a node that empties the output shows up in one
run instead of after a long build. Experiments (names are the report keys):
  cvars           the runtime-generation and frame-time console variable defaults
  mesh_selector   what Python accepts for the Static Mesh Spawner's mesh selector and seed
  noise_scale     Spatial Noise at several transform scales: value spread and correlation length
  noise_threshold a Density Filter at 0.6 after a near-constant noise value and after a normal one
  noise_flags     Spatial Noise tiling is a bool; contrast widens the value band
  attr_noise      Attribute Noise mode Set against Multiply after a noise-driven density
  edge_chain      Spatial Noise EDGE_MASK2D, then Attribute Noise MULTIPLY, then Density Filter, stage by stage, on a Landscape-wide
                  volume and on a 40 m volume
"""
import math
import os
import random
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pcg_common as pc  # noqa: E402

report = pc.Report("pcg-experiments.json")
warnings = []
CUBE = None
HALF = 25000.0   # the volume covers the whole Landscape in x and y (cm)
CENTER = unreal.Vector(0, 0, -900)
PPM2 = 0.01      # sampler points per square metre: about 2600 points over the Landscape


def spatial(scale, mode=None, **extra):
    props = {"transform": unreal.Transform(unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0), unreal.Vector(scale, scale, scale))}
    if mode is not None:
        props["mode"] = mode
    props.update(extra)
    return unreal.PCGSpatialNoiseSettings, props


def sampler():
    return unreal.PCGSurfaceSamplerSettings, {"points_per_squared_meter": PPM2, "point_extents": unreal.Vector(50, 50, 50)}


def stats(points):
    values = sorted(p[3] for p in points)
    n = len(values)
    if not n:
        return {"points": 0}
    mean = sum(values) / n
    std = math.sqrt(sum((v - mean) ** 2 for v in values) / n)
    pick = lambda q: values[min(n - 1, int(q * n))]
    return {"points": n, "min": round(values[0], 4), "max": round(values[-1], 4), "mean": round(mean, 4), "std": round(std, 4),
            "p10": round(pick(0.1), 4), "p90": round(pick(0.9), 4)}


def correlation_profile(points, bin_m=10, max_m=400, sample=900):
    """Mean absolute value difference between point pairs by distance. range_m is the distance at which it reaches 90 percent of the
    level of unrelated points: the size over which the noise stays correlated, which tracks the Perlin lattice spacing."""
    rng = random.Random(7)
    pts = rng.sample(points, min(sample, len(points)))
    sums, counts = {}, {}
    alldiff = []
    for i in range(len(pts)):
        xi, yi, _zi, vi = pts[i]
        for j in range(i + 1, len(pts)):
            xj, yj, _zj, vj = pts[j]
            d = math.hypot(xi - xj, yi - yj) / 100.0
            diff = abs(vi - vj)
            if d < max_m:
                b = int(d // bin_m)
                sums[b] = sums.get(b, 0.0) + diff
                counts[b] = counts.get(b, 0) + 1
            alldiff.append(diff)
    profile = {b: sums[b] / counts[b] for b in sums if counts[b] >= 30}
    # the mean difference of unrelated points is the mean over all pairs, because most pairs are far apart
    plateau = sum(alldiff) / len(alldiff) if alldiff else 0.0
    half = rng90 = None
    for b in sorted(profile):
        if plateau > 0.01 and half is None and profile[b] >= 0.5 * plateau:
            half = (b + 0.5) * bin_m
        if plateau > 0.01 and profile[b] >= 0.9 * plateau:
            rng90 = (b + 0.5) * bin_m
            break
    return {"plateau": round(plateau, 4), "half_distance_m": half, "range_m": rng90,
            "profile": [[(b + 0.5) * bin_m, round(profile[b], 4)] for b in sorted(profile)]}


def run_variant(name, steps, spawn=False, half=HALF):
    graph, nodes = pc.build_variant(name, steps, spawner=(CUBE, None) if spawn else None, warnings=warnings)
    vol, comp = pc.spawn_volume(name, CENTER, half, half, 3000, graph)
    result = yield from pc.generate_and_count(vol, comp)
    unreal.EditorLevelLibrary.destroy_actor(vol)
    result["stats"] = stats(result["points"])
    return result


def stages():
    global CUBE
    yield 30
    CUBE = unreal.load_asset("/Engine/BasicShapes/Cube")
    report["map"] = unreal.EditorLevelLibrary.get_editor_world().get_name()

    # cvars: the defaults this engine build declares for the runtime-generation and frame-time console variables
    cvars = {}
    for name in ["pcg.RuntimeGeneration.Enable", "pcg.RuntimeGeneration.EnablePooling", "pcg.RuntimeGeneration.BasePoolSize",
                 "pcg.RuntimeGeneration.NumGeneratingComponents", "pcg.RuntimeGeneration.EnableDebugging", "pcg.RuntimeGeneration.GlobalRadiusMultiplier",
                 "pcg.FrameTime", "pcg.EditorFrameTime"]:
        cvars[name] = unreal.SystemLibrary.get_console_variable_float_value(name)
    report["cvars"] = cvars

    # mesh_selector: what Python accepts
    ms = {}
    graph = pc.new_graph("PCG_Selector")
    _land, _ = pc.add_node(graph, unreal.PCGGetLandscapeSettings)
    _spawn, settings = graph.add_node_of_type(unreal.PCGStaticMeshSpawnerSettings)
    for label, fn in [
        ("set_mesh_selector_parameters", lambda: settings.set_editor_property("mesh_selector_parameters", None)),
        ("read_use_seed", lambda: settings.get_editor_property("use_seed")),
        ("set_use_seed", lambda: settings.set_editor_property("use_seed", True)),
        ("set_seed", lambda: settings.set_editor_property("seed", 5)),
    ]:
        try:
            fn()
            ms[label] = "ok"
        except Exception as exc:
            ms[label] = str(exc)
    pc.weighted_mesh_entries(settings, [(CUBE, None, 1)])
    ms["entries"] = len(settings.get_editor_property("mesh_selector_parameters").get_editor_property("mesh_entries"))
    report["mesh_selector"] = ms
    report.flush()

    # baseline: sampler then spawner
    base = yield from run_variant("PCG_Base", [sampler()], spawn=True)
    report["baseline"] = {"instances": base["instances"], "points": base["stats"]["points"], "completed": base["completed"]}
    report.flush()

    # noise_scale
    scales = {}
    for label, scale in [("5e-5", 5e-5), ("0.4", 0.4), ("1.0", 1.0), ("1.5", 1.5), ("5.0", 5.0)]:
        res = yield from run_variant("PCG_Noise_" + label.replace(".", "_").replace("-", "m"), [sampler(), spatial(scale)])
        entry = dict(res["stats"])
        entry["completed"] = res["completed"]
        entry["correlation"] = correlation_profile(res["points"]) if len(res["points"]) > 100 else None
        scales[label] = entry
        report["noise_scale"] = scales
        report.flush()

    # a near-constant noise value is all or nothing at a Density Filter threshold
    hi = (unreal.PCGDensityFilterSettings, {"lower_bound": 0.6, "upper_bound": 1.0})
    for label, scale in [("const_5e-5", 5e-5), ("perlin_1_0", 1.0)]:
        res = yield from run_variant("PCG_Thresh_" + label.replace(".", "_").replace("-", "m"), [sampler(), spatial(scale), hi], spawn=True)
        report.setdefault("noise_threshold", {})[label] = {"instances": res["instances"], "points": res["stats"]["points"], "of": base["stats"]["points"]}
        report.flush()

    # noise_flags: tiling type, contrast
    flags = {}
    graph = pc.new_graph("PCG_Flags")
    _n, noise = graph.add_node_of_type(unreal.PCGSpatialNoiseSettings)
    for value in (True, 5.0):
        try:
            noise.set_editor_property("tiling", value)
            flags["tiling=" + repr(value)] = "ok"
        except Exception as exc:
            flags["tiling=" + repr(value)] = str(exc)
    flags["tiling_type"] = type(noise.get_editor_property("tiling")).__name__
    contrast = yield from run_variant("PCG_Contrast", [sampler(), spatial(1.0, contrast=6.0)])
    flags["contrast6_stats"] = contrast["stats"]
    report["noise_flags"] = flags
    report.flush()

    # attr_noise: Set against Multiply after a density that is already noise-driven
    attr = {}
    flt = (unreal.PCGDensityFilterSettings, {"lower_bound": 0.5, "upper_bound": 1.0})
    defaults = unreal.PCGAttributeNoiseSettings.get_default_object()
    attr["default_mode"] = str(defaults.get_editor_property("mode"))
    for label, mode in [("set", unreal.PCGAttributeNoiseMode.SET), ("multiply", unreal.PCGAttributeNoiseMode.MULTIPLY)]:
        res = yield from run_variant("PCG_Attr_" + label, [sampler(), spatial(1.0), (unreal.PCGAttributeNoiseSettings, {"mode": mode}), flt], spawn=True)
        attr[label] = {"instances": res["instances"], "points": res["stats"]["points"], "completed": res["completed"]}
        report["attr_noise"] = attr
        report.flush()
    attr["sampler_points"] = base["stats"]["points"]

    # edge_chain: stage by stage
    chain = {}
    edge = spatial(1.0, mode=unreal.PCGSpatialNoiseMode.EDGE_MASK2D)
    mult = (unreal.PCGAttributeNoiseSettings, {"mode": unreal.PCGAttributeNoiseMode.MULTIPLY})
    for label, steps in [
        ("edge", [sampler(), edge]),
        ("edge_filter", [sampler(), edge, flt]),
        ("edge_multiply", [sampler(), edge, mult]),
        ("edge_multiply_filter", [sampler(), edge, mult, flt]),
        ("perlin_multiply_filter", [sampler(), spatial(1.0), mult, flt]),
        ("perlin_filter", [sampler(), spatial(1.0), flt]),
    ]:
        res = yield from run_variant("PCG_Edge_" + label, steps, spawn=label.endswith("filter"))
        chain[label] = {"instances": res["instances"], "stats": res["stats"], "completed": res["completed"]}
        report["edge_chain"] = chain
        report.flush()
    # the same chain on a small volume (40 m square, denser points)
    small = (unreal.PCGSurfaceSamplerSettings, {"points_per_squared_meter": 0.5, "point_extents": unreal.Vector(50, 50, 50)})
    for label, steps in [
        ("small_sampler", [small]),
        ("small_edge", [small, edge]),
        ("small_edge_filter", [small, edge, flt]),
        ("small_edge_multiply", [small, edge, mult]),
        ("small_edge_multiply_filter", [small, edge, mult, flt]),
        # the blend distance is in noise units: 1.0 at transform scale 1 is 100 m, so a 40 m volume never reaches 0.5; 0.1 is 10 m
        ("small_edge_blend10m_multiply_filter", [small, spatial(1.0, mode=unreal.PCGSpatialNoiseMode.EDGE_MASK2D, edge_blend_distance=0.1), mult, flt]),
        ("small_edge_scale10_multiply_filter", [small, spatial(10.0, mode=unreal.PCGSpatialNoiseMode.EDGE_MASK2D), mult, flt]),
    ]:
        res = yield from run_variant("PCG_" + label, steps, spawn=label.endswith("filter"), half=2000.0)
        chain[label] = {"instances": res["instances"], "stats": res["stats"], "completed": res["completed"]}
        report["edge_chain"] = chain
        report.flush()
    report["warnings"] = warnings


pc.run_stages(stages, report)
unreal.log("[pcg_experiments] stages registered")
