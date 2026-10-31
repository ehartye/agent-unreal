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
- [general] Both are anecdotal. Neither was reproduced or ruled out by the empty, three-mesh or four-by-six generated fixtures; the newer fixture does not establish production morph-target or child-object memory costs.

## Missing or empty documentation

- [general] Four of Epic's Mutable concept pages (overview, quickstart, resource usage and Mutable with MetaHumans) could not be captured. Open them in the browser for resource and memory guidance, and for the quickstart steps for authoring the graph in the editor.
- [tested] 2026-10-29: the installed Mutable plugin held no Python example scripts and no stubs.
- [general] Names have to come from the headers and a listing of the editor's `unreal` module.

## Not established

- [tested] 2026-10-29: Python alone found no route to add a node or link a pin: two runs found none and a third repeated them.
- [tested] 2026-10-30, bridge runs 1 and 2: with an editor C++ bridge a script built a graph with swappable options, its Instance drew a different part for each option, and it compiled headless; see [Authoring the graph](unreal-mutable-graph.md).
- [tested] B-Q2 run 2 (2026-10-31) measured four six-option parameters in the rendering editor: NONE/MAXIMUM completed in 0.39/0.50 s with sampled working-set maxima 3,404.38/3,406.14 MiB. [The record](../../unreal-editor-scripting/references/unreal-mutable-scale.md) qualifies the subsecond endpoint samples, lifetime peak and warm ordering.
- [general] Production-scale compile costs and a headless run of the four-by-six fixture remain unestablished. The small generated fixture is not a benchmark for the reported problem graphs.
- [general] Replication, packaging and cooking of Mutable content, Game Feature use and memory limits per platform. Not covered or run here; read Epic's pages.
- [general] A MetaHuman as a Mutable object (Epic's sample builds one as a dataless object): see unreal-metahuman and the sample.
