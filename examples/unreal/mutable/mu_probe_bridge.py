"""Mutable probe, bridge half (question 1): the editor starts with the MutableBridge module built into the project and Python sees its library.
Prepared 2026-10-30.

  UnrealEditor.exe Project.uproject -RenderOffScreen -ExecCmds="py <abs path to this file>" -abslog=<log> -notraceserver -nosplash -unattended -nosound
Environment: MU_PROBE_DIR, MU_REPORT (see mu_probe_common.py).

The module build itself is a node-side phase (Unreal Build Tool); this script only runs when that build succeeded. Steps written: library (is
unreal.MutableBridgeLibrary there, which of the expected functions it has, are its result structs there, is the plugin's own editor library there) and
categories (a call that reads the editor module's exported pin-category constants, so a module that loaded but could not reach the editor module's
symbols would fail here).
"""
import os
import sys

import unreal

sys.path.insert(0, os.environ["MU_PROBE_DIR"])
import mu_probe_common as c  # noqa: E402

EXPECTED = ("add_node", "set_node_property", "get_node_property", "reconstruct_node", "get_node_pins", "link_pins", "get_graph_nodes", "get_graph_links", "get_pin_categories")
STRUCTS = ("MutableBridgeResult", "MutableBridgeNodeResult", "MutableBridgePin", "MutableBridgeNodeInfo", "MutableBridgeLink")
probe = c.Probe("bridge")
library = getattr(unreal, "MutableBridgeLibrary", None)


def step_library():
    out = {"present": library is not None, "editor_library_present": hasattr(unreal, "CustomizableObjectEditorFunctionLibrary")}
    out["structs"] = {name: hasattr(unreal, name) for name in STRUCTS}
    if library is not None:
        out["functions"] = [name for name in EXPECTED if hasattr(library, name)]
        out["missing"] = [name for name in EXPECTED if not hasattr(library, name)]
        out["all_names"] = sorted(n for n in dir(library) if not n.startswith("_") and n not in dir(unreal.BlueprintFunctionLibrary))
    return out


def step_categories():
    categories = [str(x) for x in library.get_pin_categories()]
    return {"categories": categories}


def task():
    probe.guarded("library", step_library)
    yield 1.0
    if library is not None:
        probe.guarded("categories", step_categories)
    yield 1.0


c.drive(probe, task)
unreal.log("[mu_probe_bridge] tick callback registered")
