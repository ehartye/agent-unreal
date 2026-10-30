# Known Mutable bugs in 5.8, reports and what is not established

Target: Unreal Engine 5.8 on Windows. This page lists what Epic's tracker and the community report, and what the probe could not decide. None of the bugs below was reproduced.

## Epic's tracker (by title)

- [documented] UE-355264: a Customizable Object from a disabled Modular Gameplay Feature (Game Feature plugin) is still compiled by its parent after an editor restart. Backlogged; the tracker page lists 5.7 as affected and a target fix of 6.0.
- [general] For UE-355264, keep a parent object's child objects inside plugins that are enabled when it compiles, or compile in a project where the Game Feature is on.
- [documented] UE-391214: "Mutable COIs built from ChildCustomizableObjects are engine only but do not denote that in anyway". Unresolved; the tracker lists 5.8 as affected and a target fix of 6.0. The captured entry holds the title and no description. The title says new Instances built from child objects carry editor-only references.
- [general] These are the two entries known, not a list of 5.8 bugs. Search Epic's tracker for the current state of both before relying on either status.

## Reports not tested

- [general] A compile that hangs when the graph holds Extension Data constants: a forum report. Bound every compile with a timeout ([Build and compile](unreal-mutable-build-compile.md)) and take the constants out of a graph that hangs, to see whether they are the cause.
- [general] A compile that needs very large memory with many morph targets and child objects: a forum report. Keep morph targets and child objects few in a first graph, and watch memory on the compiling machine.
- [general] Both are anecdotal. Neither was seen or ruled out; the compiles that ran had an empty graph or three small meshes with no Extension Data constants.

## Missing or empty documentation

- [general] Four of Epic's Mutable concept pages (overview, quickstart, resource usage and Mutable with MetaHumans) could not be captured. Open them in the browser for resource and memory guidance, and for the quickstart steps for authoring the graph in the editor.
- [tested] 2026-10-29: the installed Mutable plugin held no Python example scripts and no stubs.
- [general] Names have to come from the headers and a listing of the editor's `unreal` module.

## Not established

- [tested] 2026-10-29: Python alone found no route to add a node or link a pin: two runs found none and a third repeated them.
- [tested] 2026-10-30, bridge runs 1 and 2: with an editor C++ bridge a script built a graph with swappable options, its Instance drew a different part for each option, and it compiled headless; see [Authoring the graph](unreal-mutable-graph.md).
- [general] Not run: the cost of a large graph's compile, in time and memory, in the editor or headless. The three-mesh graph compiled in under a second.
- [general] Replication, packaging and cooking of Mutable content, Game Feature use and memory limits per platform. Not covered or run here; read Epic's pages.
- [general] A MetaHuman as a Mutable object (Epic's sample builds one as a dataless object): see unreal-metahuman and the sample.
