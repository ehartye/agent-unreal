"""Shared data of the ink-brush groups of the stylized probe (outline, ribbon, mesh, cost): the groups a run covers and the stations
(one per look) that stylized_build.py places in the level and stylized_render.py visits. No Unreal calls here, so both scripts and
the node test can read it.

Environment: STYLIZED_GROUPS is a comma list of base, outline, ribbon, mesh and cost (default all).
A station is (name, group, system asset, custom depth stencil). The stencil stations are drawn twice by the render script, once with
the stencil outline post process on and once with it off, so a frame difference isolates the outline.
"""
import os

ALL_GROUPS = ("base", "outline", "ribbon", "mesh", "cost")
OUTLINE_COLOR = (0.05, 0.85, 0.75)    # linear emissive of every outline, flat swatch included
COST_COUNT = 2048                       # particles in each cost scene; the sprites overlap, so every one is shaded over the others
COST_SIZE = 800.0                       # sprite size of the cost scenes (the camera sees most of it)
COST_FRAMES = 300                       # frames in each measured window
COST_ROUNDS = 2                         # every scene is measured this many times, interleaved
RIBBON_LENGTH = 2400.0                  # longer than the view, so the ends are off screen
RIBBON_WIDTH = 250.0

STATIONS = (
    ("o_swatch", "outline", "NS_Swatch", False),
    ("o_none", "outline", "NS_Drawn9", False),
    ("o_ramp", "outline", "NS_OutlineRamp", False),
    ("o_flange", "outline", "NS_OutlineFlange", False),
    ("o_stencil_sprite", "outline", "NS_Drawn9", True),
    ("o_stencil_mesh", "outline", "NS_MeshInk", True),
    ("r_smooth", "ribbon", "NS_RibbonSmooth", False),
    ("r_ink", "ribbon", "NS_RibbonInk", False),
    ("r_edge", "ribbon", "NS_RibbonEdge", False),
    ("r_stencil", "ribbon", "NS_RibbonInk", True),
    ("m_smooth", "mesh", "NS_MeshSmooth", False),
    ("m_ink", "mesh", "NS_MeshInk", False),
    ("m_stencil", "mesh", "NS_MeshInk", True),
    ("c_control", "cost", "NS_CostControl", False),
    ("c_ink", "cost", "NS_CostInk", False),
    ("c_drawn", "cost", "NS_CostDrawn", False),
)
COST_SCENES = tuple(s[0] for s in STATIONS if s[1] == "cost")


def groups():
    raw = os.environ.get("STYLIZED_GROUPS", "") or ",".join(ALL_GROUPS)
    chosen = tuple(g for g in (x.strip() for x in raw.split(",")) if g in ALL_GROUPS)
    return chosen or ALL_GROUPS


def stations(selected):
    return [s for s in STATIONS if s[1] in selected]


def systems(selected):
    """The system assets the selected stations show, once each, in order."""
    seen = []
    for _, _, system, _ in stations(selected):
        if system not in seen:
            seen.append(system)
    return seen
